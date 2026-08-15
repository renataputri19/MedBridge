<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FerryRoute;
use App\Models\GroundTransport;
use App\Models\Hospital;
use App\Models\Hotel;
use App\Models\Quote;
use App\Models\QuoteLineItem;
use App\Services\Commission;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Collection;

/**
 * Partner portals — what one supplier sees of MedBridge.
 *
 * Four tenant types share this controller because they ask the same three
 * questions: what work is coming to me, what am I owed for it, and what are my
 * rates. Only the way a booking is attributed differs, and that difference is
 * isolated in `linesFor()`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCOPING IS THE WHOLE POINT. A partner sees ONLY its own rows.
 *
 * There is no authentication yet — these routes are open, exactly like the rest
 * of the operations API (see routes/api.php). The scoping here is therefore a
 * DATA-SHAPING decision, not a security boundary, and it must not be mistaken
 * for one: anyone who can reach `/api/v1/partners/hotel/{id}` can read that
 * hotel's arrivals. When Sanctum lands, a partner's token has to be pinned to
 * its own id and checked here.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHAT A PARTNER MUST NEVER SEE, and why each is withheld:
 *
 *  - Another partner's bookings, rates or volumes. A hotel learning what the
 *    hospital charges is a commercial leak with our name on it.
 *  - The patient's contact details. A partner gets the name they need to expect
 *    someone at a desk, and nothing that lets them contact a MedBridge patient
 *    directly.
 *  - MedBridge's commission. `supplierSgd` is what the partner is owed;
 *    `commissionSgd` is our margin on their line and is deliberately absent
 *    from every payload in this file. It belongs to the SaaS dashboard.
 */
class PartnerController extends Controller
{
    /** The four tenant types, and the `ref_type` each is attributed by. */
    private const TYPES = ['hospital', 'hotel', 'ferry', 'transport'];

    /**
     * GET /partners/{type} — the picker.
     *
     * Stands in for a login screen: with no auth, choosing a partner from a
     * list is how you "become" one.
     */
    public function index(string $type): JsonResponse
    {
        $this->assertType($type);

        // Every quote, not just the approved ones — a partner needs to see a
        // patient who is on their way while the case is still in review.
        $quotes = Commission::allQuotes();

        return response()->json(
            $this->partners($type)->map(function (Model $partner) use ($type, $quotes) {
                $lines = $this->linesFor($type, $partner, $quotes);

                return array_merge($this->identity($type, $partner), [
                    'bookingCount' => $lines->count(),
                    'pendingCount' => $this->countAtStage($lines, 'PENDING'),
                    'supplierSgd' => $this->supplierTotal($lines),
                    'pipelineSgd' => $this->pipelineTotal($lines),
                ]);
            })->values()
        );
    }

    /**
     * GET /partners/{type}/{id} — one partner's portal.
     */
    public function show(string $type, string $id): JsonResponse
    {
        $this->assertType($type);

        $partner = $this->partners($type)->firstWhere('id', $id)
            ?? abort(404, ucfirst($type).' not found.');

        $quotes = Commission::allQuotes();
        $lines = $this->linesFor($type, $partner, $quotes);

        // Bookings, newest first — one row per line item this partner supplies.
        $bookings = $lines
            ->map(function (array $row) {
                /** @var QuoteLineItem $line */
                $line = $row['line'];
                /** @var Quote $quote */
                $quote = $row['quote'];
                $inquiry = $quote->inquiry;
                $stage = Commission::stageOf($quote);

                return [
                    // The operational reference, never the inquiry UUID — a
                    // partner has no use for our primary keys.
                    'reference' => $inquiry->reference,
                    // First name only. Enough to expect someone; not enough to
                    // contact them behind us.
                    'patientFirstName' => strtok((string) ($inquiry->patient?->full_name ?? ''), ' ') ?: '—',
                    'status' => $inquiry->status,
                    'stage' => $stage,
                    'committed' => $stage === 'CONFIRMED',
                    'label' => $line->label,
                    'detail' => $line->detail ?? '',
                    'quantity' => (int) $line->quantity,
                    // What the partner is owed. Zero while the case is still
                    // pending — the amount is real, but it is not owed yet, and
                    // `pipelineSgd` below carries it instead.
                    'supplierSgd' => Commission::isPayable($quote)
                        ? Commission::supplierShareOfLine($line)
                        : 0.0,
                    'expectedSgd' => Commission::supplierShareOfLine($line),
                    'travelDate' => $inquiry->created_at?->toIso8601String(),
                ];
            })
            ->sortByDesc('travelDate')
            ->values()
            ->all();

        return response()->json(array_merge($this->identity($type, $partner), [
            'type' => $type,
            'bookingCount' => count($bookings),
            'pendingCount' => $this->countAtStage($lines, 'PENDING'),
            'committedCount' => count(array_filter($bookings, fn ($b) => $b['committed'])),
            'supplierSgd' => $this->supplierTotal($lines),
            'pipelineSgd' => $this->pipelineTotal($lines),
            'bookings' => $bookings,
            'catalogue' => $this->catalogue($type, $partner),
            'disclaimer' => 'Amounts shown are what MedBridge would owe you for confirmed travel. '
                .'They are derived from approved quotes and are not a settled payment or an invoice. '
                .'Pending rows are still with a coordinator and are not owed to you yet.',
        ]));
    }

    /* ------------------------------------------------------------------ */
    /* Attribution                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * The line items belonging to one partner.
     *
     * A hospital is attributed through `inquiries.hospital_id`, because the
     * treatment line names a procedure rather than a facility — the same
     * implant is performed at all three, and only the inquiry knows where the
     * patient actually went. Everything else is attributed by the line's own
     * `ref_id`, which is written when the bundle is built.
     *
     * @param  Collection<int, Quote>  $quotes
     * @return Collection<int, array{line: QuoteLineItem, quote: Quote}>
     */
    private function linesFor(string $type, Model $partner, Collection $quotes): Collection
    {
        $refType = match ($type) {
            'hotel' => 'hotel',
            'ferry' => 'ferry',
            'transport' => 'transport',
            default => null,
        };

        return $quotes->flatMap(function (Quote $quote) use ($type, $partner, $refType) {
            if ($type === 'hospital') {
                if ($quote->inquiry?->hospital_id !== $partner->id) {
                    return [];
                }

                // The clinical lines are the hospital's: the procedure and the
                // specialist who performs it. Ferry, hotel and transfer belong
                // to other partners and must not appear on this one's ledger.
                return $quote->lineItems
                    ->filter(fn (QuoteLineItem $l) => in_array($l->ref_type, ['procedure', 'doctor'], true))
                    ->map(fn (QuoteLineItem $l) => ['line' => $l, 'quote' => $quote])
                    ->all();
            }

            return $quote->lineItems
                ->filter(fn (QuoteLineItem $l) => $l->ref_type === $refType && $l->ref_id === $partner->id)
                ->map(fn (QuoteLineItem $l) => ['line' => $l, 'quote' => $quote])
                ->all();
        });
    }

    /**
     * What MedBridge would owe this partner — approved work only.
     *
     * @param  Collection<int, array{line: QuoteLineItem, quote: Quote}>  $lines
     */
    private function supplierTotal(Collection $lines): float
    {
        return round(
            $lines
                ->filter(fn (array $row) => Commission::isPayable($row['quote']))
                ->sum(fn (array $row) => Commission::supplierShareOfLine($row['line'])),
            2,
        );
    }

    /**
     * Work quoted but not yet signed off — expected, deliberately not owed.
     *
     * @param  Collection<int, array{line: QuoteLineItem, quote: Quote}>  $lines
     */
    private function pipelineTotal(Collection $lines): float
    {
        return round(
            $lines
                ->reject(fn (array $row) => Commission::isPayable($row['quote']))
                ->sum(fn (array $row) => Commission::supplierShareOfLine($row['line'])),
            2,
        );
    }

    /** @param Collection<int, array{line: QuoteLineItem, quote: Quote}> $lines */
    private function countAtStage(Collection $lines, string $stage): int
    {
        return $lines->filter(fn (array $row) => Commission::stageOf($row['quote']) === $stage)->count();
    }

    /* ------------------------------------------------------------------ */
    /* Partner shapes                                                      */
    /* ------------------------------------------------------------------ */

    /** @return Collection<int, Model> */
    private function partners(string $type): Collection
    {
        return match ($type) {
            'hospital' => Hospital::orderBy('name')->get(),
            'hotel' => Hotel::orderBy('name')->get(),
            'ferry' => FerryRoute::orderBy('operator')->orderBy('departure_time')->get(),
            'transport' => GroundTransport::orderBy('provider')->orderBy('price_sgd')->get(),
        };
    }

    /** Name and location — the minimum needed to recognise yourself in a list. */
    private function identity(string $type, Model $partner): array
    {
        return match ($type) {
            'hospital', 'hotel' => [
                'id' => $partner->id,
                'name' => $partner->name,
                'district' => $partner->district,
            ],
            'ferry' => [
                'id' => $partner->id,
                'name' => $partner->operator.' · '.$partner->departure_time,
                'district' => $partner->depart_terminal,
            ],
            'transport' => [
                'id' => $partner->id,
                'name' => $partner->provider.' · '.$partner->type,
                'district' => '—',
            ],
        };
    }

    /**
     * The partner's own rates, as MedBridge holds them.
     *
     * Read-only here. A partner asking to change a rate is a conversation with
     * a coordinator, not a text box — and the catalogue write paths already
     * live behind the operations portal.
     */
    private function catalogue(string $type, Model $partner): array
    {
        return match ($type) {
            'hospital' => [
                'accreditation' => $partner->accreditation,
                'specialties' => $partner->specialties ?? [],
                'nearestTerminal' => $partner->nearest_terminal,
                'minutesFromTerminal' => (int) $partner->minutes_from_terminal,
                /*
                 * Carries ids and the shared/partner-scoped split, because this
                 * list is now EDITABLE from the hospital's own portal — see
                 * PartnerCatalogueController. A row the facility has no
                 * negotiated price for still appears, at the catalogue base,
                 * so it can set one.
                 */
                'procedures' => $partner->procedures()
                    ->orderBy('name')
                    ->get()
                    ->map(fn ($procedure) => [
                        'procedureId' => $procedure->id,
                        'code' => $procedure->code,
                        'name' => $procedure->name,
                        'category' => $procedure->category,
                        'priceSgd' => (float) $procedure->pivot->price_sgd,
                        'available' => (bool) $procedure->pivot->available,
                        'hasOwnPrice' => true,
                        // Shared across every facility performing this — an edit
                        // here changes what the other hospitals sell too.
                        'sgBenchmarkSgd' => (float) $procedure->sg_benchmark_sgd,
                        'treatmentDays' => (int) $procedure->treatment_days,
                        'recoveryNights' => (int) $procedure->recovery_nights,
                        'requiresDoctorReview' => (bool) $procedure->requires_doctor_review,
                    ])->values()->all(),
                'doctors' => $partner->doctors()->orderBy('full_name')->get()
                    ->map(fn ($doctor) => [
                        'doctorId' => $doctor->id,
                        'name' => $doctor->full_name,
                        'specialty' => $doctor->specialty,
                        'qualifications' => $doctor->qualifications,
                        'yearsExperience' => (int) $doctor->years_experience,
                        'consultationFeeSgd' => (float) $doctor->consultation_fee_sgd,
                    ])->values()->all(),
            ],
            'hotel' => [
                'starRating' => (int) $partner->star_rating,
                'nightlyRateSgd' => (float) $partner->nightly_rate_sgd,
                'medicalRecoveryCertified' => (bool) $partner->medical_recovery_certified,
                'amenities' => $partner->amenities ?? [],
            ],
            'ferry' => [
                'operator' => $partner->operator,
                'direction' => $partner->direction,
                'departTerminal' => $partner->depart_terminal,
                'arriveTerminal' => $partner->arrive_terminal,
                'departureTime' => $partner->departure_time,
                'arrivalTime' => $partner->arrival_time,
                'durationMinutes' => (int) $partner->duration_minutes,
                'priceSgd' => (float) $partner->price_sgd,
            ],
            'transport' => [
                'provider' => $partner->provider,
                'vehicleType' => $partner->type,
                'description' => $partner->description,
                'capacity' => (int) $partner->capacity,
                'priceSgd' => (float) $partner->price_sgd,
            ],
        };
    }

    private function assertType(string $type): void
    {
        if (! in_array($type, self::TYPES, true)) {
            abort(404, 'Unknown partner type.');
        }
    }
}
