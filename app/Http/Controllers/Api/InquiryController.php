<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityEvent;
use App\Models\Doctor;
use App\Models\DoctorReview;
use App\Models\Inquiry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class InquiryController extends Controller
{
    public const STATUSES = [
        'NEW_INQUIRY', 'AI_PROCESSING', 'AI_ITINERARY_READY', 'HOSPITAL_REVIEW_REQUIRED',
        'QUOTE_APPROVED', 'PATIENT_CONFIRMATION_PENDING',
        'CONFIRMED_BOOKING', 'TRAVEL_READY', 'COMPLETED', 'HUMAN_TAKEOVER',
    ];

    /** The only two channels a case can arrive through. */
    public const CHANNELS = ['WEB', 'INTERNAL'];

    /** GET /inquiries?status=A,B&search=&channel= */
    public function index(Request $request): JsonResponse
    {
        // Eager-loaded because toApi() emits a display label for each of the
        // first four, and a confidence plus quote totals from the last two.
        // Without this the list is a guaranteed N+1 — and `quote.lineItems`
        // matters most, since totals() sums them per row.
        $query = Inquiry::query()
            ->with(['patient', 'procedure', 'hospital', 'doctor', 'aiExtraction', 'quote.lineItems'])
            ->orderByDesc('created_at');

        if ($statuses = array_filter(explode(',', (string) $request->query('status')))) {
            $query->whereIn('status', $statuses);
        }

        /*
         * Only a channel we actually issue filters anything. An unrecognised
         * value shows the full pipeline rather than an empty one — a filter
         * nobody asked for that silently returns zero rows reads as "quiet
         * day" instead of "bad query string", which is how a UI sentinel once
         * emptied this board.
         */
        $channel = $request->query('channel');
        if (in_array($channel, self::CHANNELS, true)) {
            $query->where('channel', $channel);
        }

        if ($search = trim((string) $request->query('search'))) {
            $query->where(function ($q) use ($search) {
                $q->where('reference', 'like', "%{$search}%")
                    ->orWhere('source_message', 'like', "%{$search}%")
                    ->orWhereHas('patient', fn ($p) => $p->where('full_name', 'like', "%{$search}%"));
            });
        }

        return response()->json($query->limit(300)->get()->map->toApi()->values());
    }

    /** GET /inquiries/{id} — joined with everything the operations UI needs. */
    public function show(string $id): JsonResponse
    {
        return response()->json($this->find($id)->toApiDetail());
    }

    /** PATCH /inquiries/{id}/status */
    public function setStatus(Request $request, string $id): JsonResponse
    {
        $inquiry = $this->find($id);

        $data = $request->validate([
            'status' => ['required', Rule::in(self::STATUSES)],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        $from = $inquiry->status;
        $inquiry->update(['status' => $data['status']]);

        ActivityEvent::record(
            'STATUS_CHANGED', 'STAFF',
            'Status changed to '.$data['status'],
            $data['note'] ?: "Moved from {$from} to {$data['status']}.",
            ['from' => $from, 'to' => $data['status'], 'note' => $data['note'] ?? null],
            $inquiry,
        );

        return response()->json($inquiry->fresh()->toApi());
    }

    /** PATCH /inquiries/{id}/assign */
    public function assign(Request $request, string $id): JsonResponse
    {
        $inquiry = $this->find($id);

        $data = $request->validate([
            'doctorId' => ['nullable', 'uuid', Rule::exists('doctors', 'id')],
            'staffName' => ['nullable', 'string', 'max:120'],
        ]);

        $inquiry->update([
            'doctor_id' => $data['doctorId'] ?? null,
            'assigned_to_name' => $data['staffName'] ?? $inquiry->assigned_to_name,
        ]);

        ActivityEvent::record(
            'STATUS_CHANGED', 'STAFF',
            'Case assigned',
            trim(sprintf(
                '%s%s',
                $data['staffName'] ? "Owner: {$data['staffName']}. " : '',
                $data['doctorId'] ? 'Doctor: '.Doctor::whereKey($data['doctorId'])->value('full_name').'.' : 'No doctor assigned.'
            )),
            ['doctor_id' => $data['doctorId'] ?? null, 'staff_name' => $data['staffName'] ?? null],
            $inquiry,
        );

        return response()->json($inquiry->fresh()->toApiDetail());
    }

    private function find(string $id): Inquiry
    {
        return Inquiry::whereKey($id)->firstOr(fn () => abort(404, 'Inquiry not found.'));
    }
}
