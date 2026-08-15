<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityEvent;
use App\Models\Doctor;
use App\Models\Inquiry;
use App\Models\Patient;
use App\Models\Procedure;
use App\Models\Quote;
use App\Services\Commission;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * Read models for the operations portal: KPIs, the audit feed, the directories
 * and analytics. All derived from real rows — nothing here is shaped or
 * synthetic.
 */
class OperationsController extends Controller
{
    private const REVIEW_STATUSES = ['HOSPITAL_REVIEW_REQUIRED', 'HUMAN_TAKEOVER'];
    private const CLOSED_WON = ['CONFIRMED_BOOKING', 'TRAVEL_READY', 'COMPLETED'];

    /** Pipeline order, used to make the funnel monotonic. */
    private const STATUS_ORDER = [
        'NEW_INQUIRY' => 0, 'AI_PROCESSING' => 1, 'AI_ITINERARY_READY' => 2,
        'HOSPITAL_REVIEW_REQUIRED' => 3, 'QUOTE_APPROVED' => 5,
        'PATIENT_CONFIRMATION_PENDING' => 6, 'CONFIRMED_BOOKING' => 7, 'TRAVEL_READY' => 8,
        'COMPLETED' => 9, 'HUMAN_TAKEOVER' => 3,
    ];

    /** GET /dashboard/kpis */
    public function kpis(): JsonResponse
    {
        $inquiries = Inquiry::all();
        $thisWeek = $inquiries->where('created_at', '>=', now()->subWeek());
        $lastWeek = $inquiries->filter(
            fn ($i) => $i->created_at >= now()->subWeeks(2) && $i->created_at < now()->subWeek()
        );

        $savings = $this->approvedSavings();

        return response()->json([
            'singaporeLeads' => $inquiries->count(),
            'singaporeLeadsDelta' => $this->delta($thisWeek->count(), $lastWeek->count()),

            'aiItineraries' => Quote::count(),
            'aiItinerariesDelta' => $this->delta(
                Quote::where('created_at', '>=', now()->subWeek())->count(),
                Quote::whereBetween('created_at', [now()->subWeeks(2), now()->subWeek()])->count(),
            ),

            'pendingReviews' => $inquiries->whereIn('status', self::REVIEW_STATUSES)->count(),
            'pendingReviewsDelta' => $this->delta(
                $thisWeek->whereIn('status', self::REVIEW_STATUSES)->count(),
                $lastWeek->whereIn('status', self::REVIEW_STATUSES)->count(),
            ),

            'confirmedBookings' => $inquiries->whereIn('status', self::CLOSED_WON)->count(),
            'confirmedBookingsDelta' => $this->delta(
                $thisWeek->whereIn('status', self::CLOSED_WON)->count(),
                $lastWeek->whereIn('status', self::CLOSED_WON)->count(),
            ),

            'totalSavingsSgd' => round($savings['total'], 2),
            'totalSavingsDelta' => $this->delta($savings['thisWeek'], $savings['lastWeek']),
        ]);
    }

    /** GET /activity?limit=100 — newest first. */
    public function activity(Request $request): JsonResponse
    {
        $limit = min(max((int) $request->query('limit', 100), 1), 500);

        return response()->json(
            ActivityEvent::orderByDesc('created_at')->limit($limit)->get()->map->toApi()->values()
        );
    }

    /** GET /patients */
    public function patients(): JsonResponse
    {
        $inquiries = Inquiry::with('procedure')->get()->groupBy('patient_id');
        $savingsByInquiry = $this->savingsByInquiry();

        return response()->json(
            Patient::orderByDesc('created_at')->get()->map(function (Patient $patient) use ($inquiries, $savingsByInquiry) {
                $cases = $inquiries->get($patient->id, collect());
                $latest = $cases->sortByDesc('created_at')->first();

                return [
                    'patient' => $patient->toApi(),
                    'caseCount' => $cases->count(),
                    'activeCaseCount' => $cases->whereNotIn('status', ['COMPLETED'])->count(),
                    'completedCaseCount' => $cases->where('status', 'COMPLETED')->count(),
                    'lifetimeSavingsSgd' => round($cases->sum(fn ($i) => $savingsByInquiry[$i->id]['savings'] ?? 0), 2),
                    'lifetimeValueSgd' => round($cases->sum(fn ($i) => $savingsByInquiry[$i->id]['total'] ?? 0), 2),
                    'lastContactAt' => $latest?->created_at?->toIso8601String(),
                    'latestStatus' => $latest?->status,
                    'latestInquiryId' => $latest?->id,
                    'procedures' => $cases->pluck('procedure.name')->filter()->unique()->values()->all(),
                ];
            })->values()
        );
    }

    /** GET /doctors */
    public function doctors(): JsonResponse
    {
        $inquiries = Inquiry::whereNotNull('doctor_id')->get()->groupBy('doctor_id');

        return response()->json(
            Doctor::with('hospital')->orderBy('full_name')->get()->map(function (Doctor $doctor) use ($inquiries) {
                $cases = $inquiries->get($doctor->id, collect());

                return [
                    'doctor' => $doctor->toApi(),
                    'hospitalName' => $doctor->hospital?->name ?? '—',
                    'assignedCaseCount' => $cases->count(),
                    'pendingReviewCount' => $cases->where('status', 'HOSPITAL_REVIEW_REQUIRED')->count(),
                    'clearedCount' => $cases->whereIn('status', ['HOSPITAL_REVIEW_REQUIRED', 'QUOTE_APPROVED'])->count(),
                    'completedCount' => $cases->where('status', 'COMPLETED')->count(),
                ];
            })->values()
        );
    }

    /** GET /quotes */
    public function quotes(): JsonResponse
    {
        $quotes = Quote::with(['lineItems', 'inquiry.patient', 'inquiry.procedure', 'inquiry.hospital'])
            ->orderByDesc('created_at')
            ->get();

        return response()->json(
            $quotes->filter(fn (Quote $q) => $q->inquiry !== null)->map(function (Quote $quote) {
                $totals = $quote->totals();
                $inquiry = $quote->inquiry;

                return [
                    'quoteId' => $quote->id,
                    'inquiryId' => $inquiry->id,
                    'reference' => $inquiry->reference,
                    'patientName' => $inquiry->patient?->full_name ?? '—',
                    'procedureName' => $inquiry->procedure?->name ?? 'Unmapped request',
                    'hospitalName' => $inquiry->hospital?->name ?? '—',
                    'status' => $quote->status,
                    'inquiryStatus' => $inquiry->status,
                    'totalSgd' => $totals['totalSgd'],
                    'totalIdr' => $totals['totalIdr'],
                    'sgBenchmarkSgd' => $totals['sgBenchmarkSgd'],
                    'savingsSgd' => $totals['savingsSgd'],
                    'savingsPct' => round($totals['savingsPct'], 1),
                    'lineItemCount' => $quote->lineItems->count(),
                    'approvedByName' => $quote->approved_by_name,
                    'approvedAt' => $quote->approved_at?->toIso8601String(),
                    'validUntil' => $quote->valid_until?->toIso8601String(),
                    'itineraryToken' => $inquiry->itinerary_token,
                    'createdAt' => $quote->created_at?->toIso8601String(),
                ];
            })->values()
        );
    }

    /**
     * GET /saas/summary — the business behind the operations portal.
     *
     * This answers "how is MedBridge doing", which is a different question from
     * "what needs doing today". Gross booking value is what patients are
     * quoted; commission is our entitlement on it; supplier payout is what the
     * partners are owed.
     *
     * NOTHING HERE IS CASH. There is no payments table (see App\Services\
     * Commission), so `committed` counts patients who accepted their pass, not
     * patients who paid. The payload carries `basis` so the UI cannot quietly
     * present an entitlement as revenue received.
     */
    public function saas(): JsonResponse
    {
        $quotes = Commission::countableQuotes();

        $gross = 0.0;
        $commission = 0.0;
        $committedGross = 0.0;
        $committedCommission = 0.0;
        $byCategory = [];
        $patients = [];
        $committedPatients = [];

        foreach ($quotes as $quote) {
            $totals = Commission::onQuote($quote);
            $committed = Commission::isCommitted($quote);

            $gross += $totals['grossSgd'];
            $commission += $totals['commissionSgd'];

            if ($committed) {
                $committedGross += $totals['grossSgd'];
                $committedCommission += $totals['commissionSgd'];
            }

            foreach ($totals['byCategory'] as $category => $amount) {
                $byCategory[$category] = round(($byCategory[$category] ?? 0.0) + $amount, 2);
            }

            if ($patientId = $quote->inquiry?->patient_id) {
                $patients[$patientId] = true;
                if ($committed) {
                    $committedPatients[$patientId] = true;
                }
            }
        }

        $committedCount = $quotes->filter(fn (Quote $q) => Commission::isCommitted($q))->count();

        /*
         * What is quoted but not yet signed off.
         *
         * Kept strictly out of every figure above, and reported because a
         * dashboard reading zero while six patients are mid-review tells the
         * owner nothing is happening, which is its own kind of wrong.
         */
        $pending = Commission::allQuotes()->reject(fn (Quote $q) => Commission::isPayable($q));
        $pendingGross = 0.0;
        $pendingCommission = 0.0;

        foreach ($pending as $quote) {
            $totals = Commission::onQuote($quote);
            $pendingGross += $totals['grossSgd'];
            $pendingCommission += $totals['commissionSgd'];
        }

        return response()->json([
            'basis' => 'Entitlement from approved quotes. No payment has been recorded or settled.',

            'pendingQuotes' => $pending->count(),
            'pipelineGrossSgd' => round($pendingGross, 2),
            'pipelineCommissionSgd' => round($pendingCommission, 2),

            'approvedQuotes' => $quotes->count(),
            'committedQuotes' => $committedCount,
            'patients' => count($patients),
            'committedPatients' => count($committedPatients),

            'grossBookingSgd' => round($gross, 2),
            'commissionSgd' => round($commission, 2),
            'supplierPayoutSgd' => round($gross - $commission, 2),

            // The half that a patient has actually said yes to.
            'committedGrossSgd' => round($committedGross, 2),
            'committedCommissionSgd' => round($committedCommission, 2),

            'takeRatePct' => $gross > 0 ? round(($commission / $gross) * 100, 1) : 0.0,
            'averageBookingSgd' => $quotes->count() > 0 ? round($gross / $quotes->count(), 2) : 0.0,

            'commissionByCategory' => collect($byCategory)
                ->map(fn (float $amount, string $category) => [
                    'category' => $category,
                    'commissionSgd' => $amount,
                    'ratePct' => round(Commission::rateFor($category) * 100, 1),
                ])
                ->sortByDesc('commissionSgd')
                ->values()
                ->all(),

            'takeRates' => collect((array) config('medbridge.commission.take_rate'))
                ->map(fn (float $rate, string $category) => [
                    'category' => $category,
                    'ratePct' => round($rate * 100, 1),
                ])->values()->all(),
        ]);
    }

    /** GET /analytics/summary */
    public function analytics(): JsonResponse
    {
        $inquiries = Inquiry::with('procedure')->get();
        $savings = $this->savingsByInquiry();
        $total = $inquiries->count();

        return response()->json([
            'funnel' => $this->funnel($inquiries),
            'treatments' => $this->treatments($inquiries, $savings),
            'priceComparison' => Procedure::orderBy('name')->get()->map(function (Procedure $p) {
                $sg = (float) $p->sg_benchmark_sgd;
                $mb = (float) $p->batam_price_sgd;

                return [
                    'procedureId' => $p->id,
                    'name' => $p->name,
                    'singaporeSgd' => $sg,
                    'medbridgeSgd' => $mb,
                    'savingsSgd' => $sg - $mb,
                    'savingsPct' => $sg > 0 ? round((($sg - $mb) / $sg) * 100, 1) : 0.0,
                ];
            })->values(),
            'trend' => $this->trend($inquiries, $savings),
            'conversionRate' => $total > 0
                ? round(($inquiries->whereIn('status', self::CLOSED_WON)->count() / $total) * 100, 1)
                : 0.0,
            'avgResponseMinutes' => $this->avgResponseMinutes(),
            // The share of cases where extraction produced a usable procedure
            // match. NOT a share of cases released without a human — that is
            // always zero, by design.
            'aiAutomationRate' => $total > 0
                ? round(($inquiries->whereNotNull('procedure_id')->count() / $total) * 100, 1)
                : 0.0,
            'avgSavingsPct' => $this->avgSavingsPct($savings),
        ]);
    }

    /* ------------------------------------------------------------------ */
    /* Derivations                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * Counts how many cases have reached at least each stage, so the series is
     * monotonically non-increasing by construction. A rising funnel stage is a
     * data bug, and building it this way makes that impossible.
     */
    private function funnel(Collection $inquiries): array
    {
        $stages = [
            'Inquiries' => 0,
            'AI processed' => 1,
            'Reviewed' => 3,
            'Approved' => 5,
            'Confirmed' => 7,
            'Completed' => 9,
        ];

        return collect($stages)->map(fn (int $order, string $label) => [
            'stage' => $label,
            'count' => $inquiries->filter(
                fn ($i) => (self::STATUS_ORDER[$i->status] ?? 0) >= $order
            )->count(),
        ])->values()->all();
    }

    private function treatments(Collection $inquiries, array $savings): array
    {
        return $inquiries
            ->filter(fn ($i) => $i->procedure !== null)
            ->groupBy('procedure_id')
            ->map(function (Collection $cases, string $procedureId) use ($savings) {
                $procedure = $cases->first()->procedure;

                return [
                    'procedureId' => $procedureId,
                    'name' => $procedure->name,
                    'category' => $procedure->category,
                    'count' => $cases->count(),
                    'revenueSgd' => round($cases->sum(fn ($i) => $savings[$i->id]['total'] ?? 0), 2),
                ];
            })
            ->sortByDesc('count')
            ->values()
            ->all();
    }

    private function trend(Collection $inquiries, array $savings): array
    {
        return collect(range(13, 0))->map(function (int $daysAgo) use ($inquiries, $savings) {
            $day = now()->subDays($daysAgo);
            $onDay = $inquiries->filter(fn ($i) => $i->created_at?->isSameDay($day));

            return [
                'date' => $day->format('j M'),
                'inquiries' => $onDay->count(),
                'confirmed' => $onDay->whereIn('status', self::CLOSED_WON)->count(),
                'savingsSgd' => round($onDay->sum(fn ($i) => $savings[$i->id]['savings'] ?? 0), 2),
            ];
        })->values()->all();
    }

    /** Median-ish: mean minutes from inquiry creation to its first staff event. */
    private function avgResponseMinutes(): int
    {
        $responded = ActivityEvent::whereIn('actor', ['STAFF', 'DOCTOR'])
            ->whereNotNull('inquiry_id')
            ->with('inquiry')
            ->get()
            ->groupBy('inquiry_id')
            ->map(fn (Collection $events) => $events->sortBy('created_at')->first());

        if ($responded->isEmpty()) {
            return 0;
        }

        $minutes = $responded
            ->filter(fn ($e) => $e->inquiry !== null)
            ->map(fn ($e) => $e->inquiry->created_at->diffInMinutes($e->created_at));

        return $minutes->isEmpty() ? 0 : (int) round($minutes->avg());
    }

    private function avgSavingsPct(array $savings): float
    {
        $pcts = collect($savings)->pluck('pct')->filter(fn ($p) => $p > 0);

        return $pcts->isEmpty() ? 0.0 : round($pcts->avg(), 1);
    }

    /** @return array<string, array{total:float, savings:float, pct:float}> */
    private function savingsByInquiry(): array
    {
        return Quote::with('lineItems')->get()
            ->mapWithKeys(function (Quote $quote) {
                $totals = $quote->totals();

                return [$quote->inquiry_id => [
                    'total' => $totals['totalSgd'],
                    'savings' => $totals['savingsSgd'],
                    'pct' => $totals['savingsPct'],
                ]];
            })
            ->all();
    }

    /** @return array{total:float, thisWeek:float, lastWeek:float} */
    private function approvedSavings(): array
    {
        $approved = Quote::where('status', 'APPROVED')->with('lineItems')->get();

        $sum = fn (Collection $rows) => $rows->sum(fn (Quote $q) => $q->totals()['savingsSgd']);

        return [
            'total' => $sum($approved),
            'thisWeek' => $sum($approved->where('approved_at', '>=', now()->subWeek())),
            'lastWeek' => $sum($approved->filter(
                fn (Quote $q) => $q->approved_at
                    && $q->approved_at >= now()->subWeeks(2)
                    && $q->approved_at < now()->subWeek()
            )),
        ];
    }

    /** Percentage change, week over week. */
    private function delta(float $current, float $previous): int
    {
        if ($previous <= 0) {
            return $current > 0 ? 100 : 0;
        }

        return (int) round((($current - $previous) / $previous) * 100);
    }
}
