<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityEvent;
use App\Models\FerryRoute;
use App\Models\Inquiry;
use App\Models\QuoteLineItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;

/**
 * The public patient pass.
 *
 * Unauthenticated by design and resolved BY TOKEN ONLY — never by inquiry id.
 * The payload carries a first name and nothing else that identifies anyone: no
 * full name, phone, email, date of birth, clinical history, and no UUID
 * anywhere, so a forwarded link cannot be replayed against the API as a key
 * (docs/01 rule 4).
 */
class ItineraryController extends Controller
{
    public function show(string $token): JsonResponse
    {
        $inquiry = $this->resolve($token);

        return response()->json($this->payload($inquiry));
    }

    /** POST /itinerary/{token}/confirm — the patient accepts their pass. */
    public function confirm(string $token): JsonResponse
    {
        $inquiry = $this->resolve($token);

        if (in_array($inquiry->status, ['QUOTE_APPROVED', 'PATIENT_CONFIRMATION_PENDING'], true)) {
            $inquiry->update(['status' => 'CONFIRMED_BOOKING']);

            ActivityEvent::record(
                'PATIENT_CONFIRMED', 'PATIENT',
                'Patient confirmed their pass',
                'The patient accepted the itinerary from their private link.',
                ['reference' => $inquiry->reference],
                $inquiry,
                'success',
            );
        }

        return response()->json(['status' => $inquiry->fresh()->status]);
    }

    /**
     * Resolve by token, with an expiry check.
     *
     * An expired or unknown token gets a 404, never a 410 — a 410 would confirm
     * that the token once existed, which is information we do not owe anyone.
     */
    private function resolve(string $token): Inquiry
    {
        $inquiry = Inquiry::where('itinerary_token', $token)
            ->with(['patient', 'hospital', 'doctor', 'procedure', 'quote.lineItems', 'aiExtraction'])
            ->first();

        abort_if(! $inquiry, 404, 'This link is no longer valid.');
        abort_if($inquiry->token_expires_at && $inquiry->token_expires_at->isPast(), 404, 'This link is no longer valid.');
        abort_if(! $inquiry->quote || $inquiry->quote->status !== 'APPROVED', 404, 'This link is no longer valid.');

        return $inquiry;
    }

    /** @return array<string,mixed> */
    private function payload(Inquiry $inquiry): array
    {
        $quote = $inquiry->quote;
        $totals = $quote->totals();
        $travelDate = $this->travelDate($inquiry);

        return [
            'token' => $inquiry->itinerary_token,
            'reference' => $inquiry->reference,
            // First name only. Enough to feel personal, not enough to identify.
            'patientFirstName' => $inquiry->patient->firstName(),
            'status' => $inquiry->status,
            'hospitalName' => $inquiry->hospital->name,
            'hospitalAddress' => $inquiry->hospital->address,
            'doctorName' => $inquiry->doctor?->full_name,
            'doctorSpecialty' => $inquiry->doctor?->specialty,
            'procedureName' => $inquiry->procedure?->name ?? 'Treatment',
            'travelWindow' => $travelDate->format('j M Y'),
            'steps' => $this->steps($inquiry, $travelDate),
            'costLines' => $quote->lineItems->map(fn (QuoteLineItem $item) => [
                'label' => $item->label,
                'detail' => $item->quantity > 1
                    ? sprintf('%d × S$%s', $item->quantity, number_format((float) $item->unit_price_sgd, 0))
                    : ($item->detail ?? ''),
                'priceSgd' => $item->subtotalSgd(),
            ])->values()->all(),
            'totalSgd' => $totals['totalSgd'],
            'totalIdr' => $totals['totalIdr'],
            'singaporeBenchmarkSgd' => $totals['sgBenchmarkSgd'],
            'savingsSgd' => $totals['savingsSgd'],
            'savingsPct' => round($totals['savingsPct'], 1),
            'validUntil' => $quote->valid_until->toIso8601String(),
            'supportPhone' => config('medbridge.support_phone'),
            'issuedAt' => $quote->approved_at?->toIso8601String() ?? $quote->updated_at->toIso8601String(),
        ];
    }

    private function travelDate(Inquiry $inquiry): Carbon
    {
        $raw = $inquiry->aiExtraction?->preferred_window;

        try {
            return $raw ? Carbon::parse($raw) : $inquiry->created_at->copy()->addWeeks(2);
        } catch (\Throwable) {
            return $inquiry->created_at->copy()->addWeeks(2);
        }
    }

    /**
     * The day-by-day journey, assembled from the approved quote's line items so
     * a removed hotel or transfer never shows up on the pass.
     *
     * @return list<array<string,mixed>>
     */
    private function steps(Inquiry $inquiry, Carbon $travelDate): array
    {
        $quote = $inquiry->quote;
        $lines = $quote->lineItems;
        $steps = [];
        $order = 0;

        $ferryLines = $lines->where('ref_type', 'ferry');
        $ferryOut = $ferryLines->first(function (QuoteLineItem $l) {
            return FerryRoute::whereKey($l->ref_id)->value('direction') === 'SG_TO_BATAM';
        });
        $ferryReturn = $ferryLines->first(function (QuoteLineItem $l) {
            return FerryRoute::whereKey($l->ref_id)->value('direction') === 'BATAM_TO_SG';
        });

        $hotelLine = $lines->firstWhere('ref_type', 'hotel');
        $transportLine = $lines->firstWhere('ref_type', 'transport');
        $nights = $hotelLine ? (int) $hotelLine->quantity : 0;
        $returnDate = $travelDate->copy()->addDays(max($nights, 0));

        if ($ferryOut) {
            $route = FerryRoute::find($ferryOut->ref_id);
            $steps[] = [
                'kind' => 'FERRY_OUT',
                'order' => $order++,
                'title' => 'Ferry to Batam',
                'subtitle' => $route?->operator ?? 'Ferry crossing',
                'dayLabel' => 'Day 1 · '.$travelDate->format('D j M'),
                'timeLabel' => $route?->departure_time ?? '—',
                'location' => $route?->depart_terminal ?? 'HarbourFront Centre, Singapore',
                'details' => array_filter([
                    $route ? "Arrives {$route->arrive_terminal} at {$route->arrival_time}" : null,
                    'Bring your passport — check in 45 minutes before departure',
                    $ferryOut->quantity > 1 ? "{$ferryOut->quantity} seats reserved" : null,
                ]),
                'priceSgd' => $ferryOut->subtotalSgd(),
            ];
        }

        if ($transportLine) {
            $steps[] = [
                'kind' => 'PICKUP',
                'order' => $order++,
                'title' => 'Met at the terminal',
                'subtitle' => $transportLine->label,
                'dayLabel' => 'Day 1 · '.$travelDate->format('D j M'),
                'timeLabel' => 'On arrival',
                'location' => $inquiry->hospital->nearest_terminal,
                'details' => array_filter([
                    $transportLine->detail ?: null,
                    "{$inquiry->hospital->minutes_from_terminal} minutes to the hospital",
                ]),
                'priceSgd' => $transportLine->subtotalSgd(),
            ];
        }

        $treatmentLine = $lines->firstWhere('ref_type', 'procedure');
        $steps[] = [
            'kind' => 'HOSPITAL',
            'order' => $order++,
            'title' => $inquiry->procedure?->name ?? 'Treatment',
            'subtitle' => $inquiry->hospital->name,
            'dayLabel' => 'Day 1 · '.$travelDate->format('D j M'),
            'timeLabel' => 'Appointment confirmed on arrival',
            'location' => $inquiry->hospital->address,
            'details' => array_filter([
                $inquiry->doctor ? "With {$inquiry->doctor->full_name}" : null,
                $inquiry->hospital->accreditation,
                $inquiry->procedure ? "{$inquiry->procedure->treatment_days} clinical day(s)" : null,
                'English-speaking coordinator with you throughout',
            ]),
            'priceSgd' => $treatmentLine?->subtotalSgd(),
        ];

        if ($hotelLine && $nights > 0) {
            $steps[] = [
                'kind' => 'HOTEL',
                'order' => $order++,
                'title' => 'Recovery stay',
                'subtitle' => str_replace('Recovery stay — ', '', $hotelLine->label),
                'dayLabel' => 'Day 1–'.($nights + 1).' · '.$travelDate->format('D j M'),
                'timeLabel' => $nights === 1 ? '1 night' : "{$nights} nights",
                'location' => $hotelLine->detail ?: 'Batam',
                'details' => array_filter([
                    $hotelLine->detail ?: null,
                    'Late checkout arranged around your appointment',
                ]),
                'priceSgd' => $hotelLine->subtotalSgd(),
            ];
        }

        if ($ferryReturn) {
            $route = FerryRoute::find($ferryReturn->ref_id);
            $steps[] = [
                'kind' => 'FERRY_RETURN',
                'order' => $order++,
                'title' => 'Ferry home',
                'subtitle' => $route?->operator ?? 'Ferry crossing',
                'dayLabel' => 'Day '.($nights + 1).' · '.$returnDate->format('D j M'),
                'timeLabel' => $route?->departure_time ?? '—',
                'location' => $route?->depart_terminal ?? 'Batam Centre Ferry Terminal',
                'details' => array_filter([
                    $route ? "Arrives {$route->arrive_terminal} at {$route->arrival_time}" : null,
                    'Transfer to the terminal included',
                ]),
                'priceSgd' => $ferryReturn->subtotalSgd(),
            ];
        }

        return $steps;
    }
}
