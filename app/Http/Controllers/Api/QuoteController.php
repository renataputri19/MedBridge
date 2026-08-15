<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityEvent;
use App\Models\Inquiry;
use App\Models\Quote;
use App\Models\QuoteLineItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Quote editing and the human-in-the-loop approval.
 *
 * approve() is the ONLY code path in this system that mints an itinerary token.
 * There is no auto-approve, no bulk approve, and no "approve above X
 * confidence". That is structural rather than policy — there is nothing to
 * misconfigure, and adding a second path would break the product's core safety
 * claim (docs/09 D4).
 */
class QuoteController extends Controller
{
    public function addLineItem(Request $request, string $inquiryId): JsonResponse
    {
        $quote = $this->quoteFor($inquiryId);
        $this->assertEditable($quote);

        $data = $request->validate([
            'category' => ['required', Rule::in(['TREATMENT', 'DOCTOR_FEE', 'FERRY', 'HOTEL', 'TRANSPORT', 'ADMIN'])],
            'label' => ['required', 'string', 'max:160'],
            'detail' => ['nullable', 'string', 'max:255'],
            'quantity' => ['required', 'integer', 'min:0', 'max:999'],
            'unitPriceSgd' => ['required', 'numeric', 'min:0'],
            'refType' => ['nullable', Rule::in(['procedure', 'doctor', 'ferry', 'hotel', 'transport'])],
            'refId' => ['nullable', 'uuid'],
        ]);

        QuoteLineItem::create([
            'quote_id' => $quote->id,
            'category' => $data['category'],
            'label' => $data['label'],
            'detail' => $data['detail'] ?? '',
            'quantity' => $data['quantity'],
            'unit_price_sgd' => $data['unitPriceSgd'],
            'ref_type' => $data['refType'] ?? null,
            'ref_id' => $data['refId'] ?? null,
            'sort_order' => (int) $quote->lineItems()->max('sort_order') + 1,
        ]);

        return response()->json($quote->fresh()->load('lineItems')->toApi());
    }

    public function updateLineItem(Request $request, string $inquiryId, string $lineItemId): JsonResponse
    {
        $quote = $this->quoteFor($inquiryId);
        $this->assertEditable($quote);

        $data = $request->validate([
            'quantity' => ['nullable', 'integer', 'min:0', 'max:999'],
            'unitPriceSgd' => ['nullable', 'numeric', 'min:0'],
            'label' => ['nullable', 'string', 'max:160'],
            'detail' => ['nullable', 'string', 'max:255'],
        ]);

        $item = $quote->lineItems()->whereKey($lineItemId)->firstOr(fn () => abort(404, 'Line item not found.'));

        $item->update(array_filter([
            'quantity' => $data['quantity'] ?? null,
            'unit_price_sgd' => $data['unitPriceSgd'] ?? null,
            'label' => $data['label'] ?? null,
            'detail' => $data['detail'] ?? null,
        ], fn ($v) => $v !== null));

        return response()->json($quote->fresh()->load('lineItems')->toApi());
    }

    public function removeLineItem(string $inquiryId, string $lineItemId): JsonResponse
    {
        $quote = $this->quoteFor($inquiryId);
        $this->assertEditable($quote);

        $quote->lineItems()->whereKey($lineItemId)->firstOr(fn () => abort(404, 'Line item not found.'))->delete();

        return response()->json($quote->fresh()->load('lineItems')->toApi());
    }

    /**
     * POST /inquiries/{id}/quote/approve — the gate.
     *
     * A human, named, pressing a button. Everything downstream of a patient
     * seeing their itinerary starts here and nowhere else.
     */
    public function approve(Request $request, string $inquiryId): JsonResponse
    {
        $data = $request->validate([
            'approvedByName' => ['required', 'string', 'min:2', 'max:120'],
        ]);

        $inquiry = $this->inquiry($inquiryId);
        $quote = $this->quoteFor($inquiryId);

        if ($quote->status === 'APPROVED') {
            abort(409, 'This quote has already been approved.');
        }

        // A case still waiting on clinical sign-off cannot be released by
        // operations, however confident anyone is about the price.
        if ($inquiry->status === 'DOCTOR_REVIEW_REQUIRED') {
            abort(409, 'This case needs clinical sign-off before it can be approved.');
        }

        DB::transaction(function () use ($inquiry, $quote, $data) {
            $quote->update([
                'status' => 'APPROVED',
                'approved_by_name' => $data['approvedByName'],
                'approved_at' => now(),
            ]);

            $inquiry->update([
                'status' => 'QUOTE_APPROVED',
                // Opaque, non-UUID, and given an expiry that is checked on
                // resolve. Minted here and only here.
                'itinerary_token' => Inquiry::newItineraryToken(),
                'token_expires_at' => now()->addDays((int) config('medbridge.itinerary_token_ttl_days')),
            ]);

            $totals = $quote->fresh()->load('lineItems')->totals();

            ActivityEvent::record(
                'QUOTE_APPROVED', 'STAFF',
                'Quote approved by '.$data['approvedByName'],
                'A human reviewed and approved this bundle. This is the only action that can release a case to a patient.',
                [
                    'approved_by' => $data['approvedByName'],
                    'total_sgd' => $totals['totalSgd'],
                    'savings_sgd' => $totals['savingsSgd'],
                    'savings_pct' => round($totals['savingsPct'], 1),
                ],
                $inquiry,
                'success',
            );

            ActivityEvent::record(
                'ITINERARY_ISSUED', 'SYSTEM',
                'Patient pass issued',
                'An opaque, expiring itinerary token was minted and the pass is now reachable.',
                [
                    // The token itself is deliberately not logged in full.
                    'token_prefix' => substr($inquiry->fresh()->itinerary_token, 0, 8),
                    'expires_at' => $inquiry->fresh()->token_expires_at?->toIso8601String(),
                ],
                $inquiry,
                'success',
            );
        });

        return response()->json($inquiry->fresh()->toApiDetail());
    }

    public function reject(Request $request, string $inquiryId): JsonResponse
    {
        $data = $request->validate([
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ]);

        $inquiry = $this->inquiry($inquiryId);
        $quote = $this->quoteFor($inquiryId);

        DB::transaction(function () use ($inquiry, $quote, $data) {
            $quote->update(['status' => 'REJECTED', 'notes' => $data['reason']]);
            $inquiry->update(['status' => 'HUMAN_TAKEOVER']);

            ActivityEvent::record(
                'STATUS_CHANGED', 'STAFF',
                'Quote rejected',
                $data['reason'],
                ['reason' => $data['reason'], 'resulting_status' => 'HUMAN_TAKEOVER'],
                $inquiry,
                'warning',
            );
        });

        return response()->json($inquiry->fresh()->toApiDetail());
    }

    private function inquiry(string $id): Inquiry
    {
        return Inquiry::whereKey($id)->firstOr(fn () => abort(404, 'Inquiry not found.'));
    }

    private function quoteFor(string $inquiryId): Quote
    {
        return Quote::where('inquiry_id', $inquiryId)
            ->with('lineItems')
            ->firstOr(fn () => abort(404, 'Quote not found.'));
    }

    /**
     * An approved quote is what a patient was shown. Editing it after the fact
     * would change a document someone has already received.
     */
    private function assertEditable(Quote $quote): void
    {
        if (in_array($quote->status, ['APPROVED', 'EXPIRED'], true)) {
            abort(409, 'An approved quote cannot be edited.');
        }
    }
}
