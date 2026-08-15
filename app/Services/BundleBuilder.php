<?php

namespace App\Services;

use App\Models\Doctor;
use App\Models\FerryRoute;
use App\Models\GroundTransport;
use App\Models\Hospital;
use App\Models\HospitalProcedure;
use App\Models\Hotel;
use App\Models\Inquiry;
use App\Models\Procedure;
use App\Models\Quote;
use App\Models\QuoteLineItem;
use Illuminate\Support\Collection;

/**
 * Turns filled slots into a priced cross-border bundle.
 *
 * This is ordinary deterministic business logic — no model is involved. Hermes
 * decides *what* the visitor wants; this decides what it costs. Keeping the two
 * apart is why prices in this system are never hallucinated.
 *
 * Every line carries `removable` and `swappable` flags, because the visitor
 * shapes this bundle directly. Treatment and coordination are fixed; travel and
 * accommodation are theirs to drop or exchange.
 */
class BundleBuilder
{
    /** Procedure category → the specialty a hospital must advertise. */
    private const CATEGORY_SPECIALTY = [
        'DENTAL' => 'Dental',
        'SCREENING' => 'Health Screening',
        'OPHTHALMOLOGY' => 'Ophthalmology',
        'ORTHOPEDICS' => 'Orthopedics',
        'GENERAL_SURGERY' => 'General Surgery',
    ];

    /**
     * Procedure category → the word that identifies a qualified doctor.
     *
     * Deliberately explicit rather than derived from CATEGORY_SPECIALTY: doctor
     * specialties are written as a clinician would ("Orthopedic & Sports
     * Traumatology"), which no naive substring of "Orthopedics" matches. Getting
     * this wrong assigns the wrong specialist silently, so it is spelled out.
     */
    private const CATEGORY_DOCTOR_KEYWORD = [
        'DENTAL' => 'dental',
        'SCREENING' => 'screening',
        'OPHTHALMOLOGY' => 'ophthalmology',
        'ORTHOPEDICS' => 'orthopedic',
        'GENERAL_SURGERY' => 'surgery',
    ];

    /**
     * Categories a budget is allowed to trade down, in the order we try them.
     *
     * The order is the argument. A ferry operator is pure price. A hotel, so
     * long as it stays recovery-certified, is close to it. A private car is the
     * thing that gets a sedated patient from the terminal to their room, so it
     * goes last. Treatment, the specialist and the recovery nights are not on
     * this list and must never be added to it — see docs/09 D23.
     */
    private const BUDGET_TRADE_ORDER = ['ferry_out', 'ferry_return', 'hotel', 'transport'];

    /**
     * Build the recommended bundle for a procedure and the visitor's slots.
     *
     * `$shapeToBudget` is true only for the first recommendation. Once the
     * patient has started editing, their choices win over our arithmetic: a
     * budget may pick their starting point, but it may never quietly undo
     * something they picked themselves.
     *
     * @param  array<string,mixed>  $slots
     * @return array{lines:list<array<string,mixed>>, hospitalId:string, doctorId:?string, benchmarkSgd:float}
     */
    public function recommend(Procedure $procedure, array $slots, bool $shapeToBudget = true): array
    {
        $partySize = max(1, (int) ($slots['party_size'] ?? 1));

        // Nights are the patient's call. The procedure's recovery_nights is the
        // clinical recommendation and the default, not a floor — someone with
        // family in Batam may not need a hotel at all.
        $nights = isset($slots['hotel_nights']) && $slots['hotel_nights'] !== null
            ? max(0, (int) $slots['hotel_nights'])
            : (int) $procedure->recovery_nights;

        // The patient chooses the hospital. We only pick a starting point.
        $hospital = $this->resolveHospital($procedure, $slots['hospital_id'] ?? null);
        $doctor = $this->pickDoctor($procedure, $hospital);
        $ferryOut = $this->pickFerry('SG_TO_BATAM', $hospital);
        $ferryReturn = $this->pickFerry('BATAM_TO_SG', $hospital);
        $hotel = $this->pickHotel();
        $transport = GroundTransport::where('type', 'PRIVATE_CAR')->first()
            ?? GroundTransport::orderBy('price_sgd')->first();

        $lines = [];

        $lines[] = $this->line(
            key: 'treatment',
            category: 'TREATMENT',
            label: $procedure->name.' at '.$hospital->name,
            detail: sprintf('%s · %d clinical day(s) · %s', $procedure->code, $procedure->treatment_days, $hospital->district),
            quantity: 1,
            unitPrice: HospitalProcedure::priceFor($hospital->id, $procedure),
            refType: 'procedure',
            refId: $procedure->id,
            // The reason they are here. Removing it would leave a travel package.
            removable: false,
            swappable: false,
        );

        $lines[] = $this->line(
            key: 'doctor_fee',
            category: 'DOCTOR_FEE',
            label: $doctor ? 'Specialist consultation — '.$doctor->full_name : 'Specialist consultation',
            detail: $doctor?->specialty ?? 'Assigned on confirmation',
            quantity: 1,
            unitPrice: (float) ($doctor?->consultation_fee_sgd ?? 50),
            refType: $doctor ? 'doctor' : null,
            refId: $doctor?->id,
            // Being seen is not optional; who sees you is.
            removable: false,
            swappable: (bool) $doctor,
            swapGroup: 'doctor',
        );

        if ($ferryOut) {
            $lines[] = $this->line(
                key: 'ferry_out',
                category: 'FERRY',
                label: 'Ferry — Singapore → '.str_replace(' Ferry Terminal', '', $ferryOut->arrive_terminal),
                detail: sprintf('%s · departs %s · %d min', $ferryOut->operator, $ferryOut->departure_time, $ferryOut->duration_minutes),
                quantity: $partySize,
                unitPrice: (float) $ferryOut->price_sgd,
                refType: 'ferry',
                refId: $ferryOut->id,
                removable: true,
                swappable: true,
                swapGroup: 'ferry_out',
            );
        }

        if ($ferryReturn) {
            $lines[] = $this->line(
                key: 'ferry_return',
                category: 'FERRY',
                label: 'Ferry — '.str_replace(' Ferry Terminal', '', $ferryReturn->depart_terminal).' → Singapore',
                detail: sprintf('%s · departs %s · %d min', $ferryReturn->operator, $ferryReturn->departure_time, $ferryReturn->duration_minutes),
                quantity: $partySize,
                unitPrice: (float) $ferryReturn->price_sgd,
                refType: 'ferry',
                refId: $ferryReturn->id,
                removable: true,
                swappable: true,
                swapGroup: 'ferry_return',
            );
        }

        // Only quoted when the procedure actually needs overnight recovery — a
        // day case should not be sold a hotel room.
        if ($nights > 0 && $hotel) {
            $lines[] = $this->line(
                key: 'hotel',
                category: 'HOTEL',
                label: 'Recovery stay — '.$hotel->name,
                detail: $this->hotelDetail($hotel, $hospital),
                quantity: $nights,
                unitPrice: (float) $hotel->nightly_rate_sgd,
                refType: 'hotel',
                refId: $hotel->id,
                removable: true,
                swappable: true,
                swapGroup: 'hotel',
            );
        }

        if ($transport) {
            $lines[] = $this->line(
                key: 'transport',
                category: 'TRANSPORT',
                label: 'Local transport — '.$transport->provider,
                detail: explode('.', $transport->description)[0],
                quantity: 1,
                unitPrice: (float) $transport->price_sgd,
                refType: 'transport',
                refId: $transport->id,
                removable: true,
                swappable: true,
                swapGroup: 'transport',
            );
        }

        $lines[] = $this->line(
            key: 'admin',
            category: 'ADMIN',
            label: 'MedBridge case coordination',
            detail: 'Interpreter, appointment scheduling and 24/7 support line',
            quantity: 1,
            unitPrice: (float) config('medbridge.pricing.coordination_fee_sgd'),
            refType: null,
            refId: null,
            removable: false,
            swappable: false,
        );

        if ($shapeToBudget) {
            $lines = $this->shapeToBudget($lines, $procedure, $slots, $hospital);
        }

        return [
            'lines' => $lines,
            'hospitalId' => $hospital->id,
            'doctorId' => $doctor?->id,
            'benchmarkSgd' => $this->benchmarkFor($procedure),
        ];
    }

    /**
     * How far this hotel is from the hospital the patient actually chose.
     *
     * This used to read `$hotel->distance_to_hospital_km` — one stored scalar,
     * shown identically whichever of the three hospitals was selected. Sekupang
     * is a 12 km drive from Batam Centre, so that number was simply wrong for
     * two thirds of the choices on screen. Now it is computed against the
     * chosen facility, and it moves when they change hospital.
     */
    private function hotelDetail(Hotel $hotel, ?Hospital $hospital): string
    {
        $distance = $hotel->distanceKmTo($hospital);

        return implode(' · ', array_filter([
            $hotel->star_rating.'★',
            // "~4 km", not "3.8 km". These are building centroids, good to a
            // couple of hundred metres — printing a decimal claims an accuracy
            // we do not have, and the patient only uses the rough magnitude.
            $distance !== null && $hospital
                ? sprintf('~%s km from %s', $this->formatKm($distance), $this->shortHospitalName($hospital))
                : $hotel->district,
            $hotel->medical_recovery_certified ? 'recovery-certified' : null,
        ]));
    }

    /** "3" rather than "3.0", "0.8" rather than "0.80". */
    private function formatKm(float $km): string
    {
        return rtrim(rtrim(number_format($km, 1, '.', ''), '0'), '.');
    }

    /**
     * A hospital name that fits in a line detail beside a distance.
     *
     *   RSBP Batam (Rumah Sakit Badan Pengusahaan) → RSBP Batam
     *   Awal Bros Hospital Batam                   → Awal Bros
     *   RS Santa Elisabeth Batam Kota              → RS Santa Elisabeth
     *
     * Trimming is presentational only. The full registered name is what the
     * plan header and the map link use, because that is what the patient needs
     * when they turn up at a reception desk.
     */
    private function shortHospitalName(Hospital $hospital): string
    {
        // Drop a parenthetical expansion, then anything after an em dash.
        $name = trim(preg_replace('/\s*\(.*$/u', '', $hospital->name) ?? $hospital->name);
        $name = trim(explode('—', $name)[0]);

        // "Awal Bros Hospital Batam" — the word itself is the natural cut.
        if (str_contains($name, ' Hospital')) {
            return trim(explode(' Hospital', $name)[0]);
        }

        $words = preg_split('/\s+/', $name) ?: [$name];

        return implode(' ', array_slice($words, 0, 3));
    }

    /**
     * The Singapore comparison basket: treatment + one specialist consultation.
     *
     * It excludes ferry and hotel on purpose. A Singapore patient treated at
     * home would not incur them, so counting them would inflate the saving.
     * It is also FIXED against the procedure — dropping the hotel from the
     * bundle must not make the advertised saving grow (docs/09 D9).
     */
    public function benchmarkFor(Procedure $procedure): float
    {
        return (float) $procedure->sg_benchmark_sgd + (float) config('medbridge.pricing.sg_consult_benchmark_sgd');
    }

    /**
     * Alternatives the visitor can swap to, per swap group.
     *
     * @return array<string, list<array<string,mixed>>>
     */
    public function swapOptions(?string $hospitalId = null, ?Procedure $procedure = null): array
    {
        $hospital = $hospitalId ? Hospital::find($hospitalId) : null;

        $ferryOptions = fn (string $direction) => FerryRoute::where('direction', $direction)
            ->orderBy('departure_time')
            ->get()
            ->map(fn (FerryRoute $f) => [
                'refId' => $f->id,
                'label' => $f->operator,
                'detail' => sprintf(
                    '%s → %s · %s · %d min',
                    str_replace(' Centre, Singapore', '', $f->depart_terminal),
                    str_replace(' Ferry Terminal', '', $f->arrive_terminal),
                    $f->departure_time,
                    $f->duration_minutes
                ),
                'unitPriceSgd' => (float) $f->price_sgd,
            ])->values()->all();

        return [
            'ferry_out' => $ferryOptions('SG_TO_BATAM'),
            'ferry_return' => $ferryOptions('BATAM_TO_SG'),

            /*
             * Hotels, nearest to the CHOSEN hospital first.
             *
             * Ordering by price would be defensible; ordering by a distance
             * that ignores which hospital they picked is not, and that is what
             * the stored scalar did. Someone recovering from surgery reads this
             * list as "how far will I have to travel back for my follow-up",
             * and the answer has to be about their hospital. Price is on every
             * row, so trading down is still one tap away.
             */
            'hotel' => $this->hotelsNear($hospital)->map(fn (Hotel $h) => [
                'refId' => $h->id,
                'label' => $h->name,
                'detail' => $this->hotelDetail($h, $hospital),
                'unitPriceSgd' => (float) $h->nightly_rate_sgd,
                'distanceKm' => $h->distanceKmTo($hospital),
                'searchUrl' => $h->searchUrl(),
            ])->values()->all(),

            'transport' => GroundTransport::orderBy('price_sgd')->get()->map(fn (GroundTransport $t) => [
                'refId' => $t->id,
                'label' => $t->provider.' — '.str_replace('_', ' ', strtolower($t->type)),
                'detail' => explode('.', $t->description)[0],
                'unitPriceSgd' => (float) $t->price_sgd,
            ])->values()->all(),

            /*
             * Specialists at the chosen hospital who are qualified for THIS
             * procedure. Both filters matter: a doctor at another facility is
             * not someone this patient can be seen by, and offering an
             * ophthalmologist as an option for a dental implant would be a
             * clinical error dressed up as patient choice.
             */
            'doctor' => $this->eligibleDoctors($procedure, $hospital)
                ->map(fn (Doctor $d) => [
                    'refId' => $d->id,
                    'label' => $d->full_name,
                    'detail' => $d->specialty,
                    'unitPriceSgd' => (float) $d->consultation_fee_sgd,
                ])->values()->all(),
        ];
    }

    /**
     * Hotels ordered by how far they are from a given hospital.
     *
     * Falls back to price when we have no fix on either end — an unknown
     * distance must not silently sort to the front as 0 km.
     *
     * @return Collection<int, Hotel>
     */
    public function hotelsNear(?Hospital $hospital): Collection
    {
        $hotels = Hotel::orderBy('nightly_rate_sgd')->get();

        if (! $hospital || ! $hospital->hasCoordinates()) {
            return $hotels;
        }

        return $hotels
            ->sortBy(fn (Hotel $h) => $h->distanceKmTo($hospital) ?? PHP_FLOAT_MAX)
            ->values();
    }

    /**
     * Apply a swap to a draft line, repricing from the catalogue row rather
     * than trusting anything the client sent.
     *
     * The hospital comes along because a hotel's detail line quotes its
     * distance to THAT hospital — swapping hotels without it would print a
     * distance to nowhere in particular.
     *
     * @param  list<array<string,mixed>>  $lines
     * @return list<array<string,mixed>>
     */
    public function applySwap(array $lines, string $key, string $refId, ?Hospital $hospital = null): array
    {
        return array_map(function (array $line) use ($key, $refId, $hospital) {
            if ($line['key'] !== $key || ! ($line['swappable'] ?? false)) {
                return $line;
            }

            return match ($line['swapGroup'] ?? null) {
                'hotel' => $this->rehydrateHotel($line, $refId, $hospital),
                'transport' => $this->rehydrateTransport($line, $refId),
                'ferry_out', 'ferry_return' => $this->rehydrateFerry($line, $refId),
                'doctor' => $this->rehydrateDoctor($line, $refId),
                default => $line,
            };
        }, $lines);
    }

    /**
     * @param  list<array<string,mixed>>  $lines
     * @return array{totalSgd:float,totalIdr:int,sgBenchmarkSgd:float,savingsSgd:float,savingsPct:float}
     */
    public function totals(array $lines, float $benchmarkSgd): array
    {
        $total = 0.0;
        foreach ($lines as $line) {
            if ($line['included'] ?? true) {
                $total += $line['quantity'] * $line['unitPriceSgd'];
            }
        }
        $total = round($total, 2);
        $savings = $benchmarkSgd - $total;

        return [
            'totalSgd' => $total,
            'totalIdr' => (int) round($total * (float) config('medbridge.pricing.idr_per_sgd')),
            'sgBenchmarkSgd' => $benchmarkSgd,
            'savingsSgd' => round($savings, 2),
            'savingsPct' => $benchmarkSgd > 0 ? round(($savings / $benchmarkSgd) * 100, 1) : 0.0,
        ];
    }

    /* ------------------------------------------------------------------ */
    /* Budget                                                              */
    /* ------------------------------------------------------------------ */

    /*
     * A budget is a real constraint and we treat it as one — but it constrains
     * the TRIP, never the TREATMENT.
     *
     * Everything below can trade a ferry operator, a hotel or a transfer to fit
     * a number. Nothing below can touch the procedure, the specialist, or the
     * nights the procedure clinically calls for. If the sums do not work, the
     * honest answer is to say so and hand the case to a coordinator, not to
     * quietly assemble a cheaper, worse version of the same operation.
     *
     * See docs/09 D23.
     */

    /**
     * The part of the plan that exists to treat them. Not negotiable.
     *
     * Treatment at the lowest-priced eligible facility, the cheapest specialist
     * qualified to perform it there, and coordination. Quoting a figure below
     * this as "achievable" would be a promise we cannot keep.
     */
    public function essentialsSgd(Procedure $procedure): float
    {
        $hospital = $this->resolveHospital($procedure, null);
        $doctor = $this->eligibleDoctors($procedure, $hospital)
            ->sortBy('consultation_fee_sgd')
            ->first();

        return round(
            HospitalProcedure::priceFor($hospital->id, $procedure)
            + (float) ($doctor?->consultation_fee_sgd ?? 50)
            + (float) config('medbridge.pricing.coordination_fee_sgd'),
            2,
        );
    }

    /**
     * The cheapest COMPLETE trip we would actually put a patient on.
     *
     * Essentials, plus the cheapest crossing each way, plus the cheapest
     * recovery-certified hotel for the nights they asked for, plus the cheapest
     * transfer. The hotel floor stays certified on purpose: we will trade a
     * patient down on price, but not out of a property equipped to look after
     * someone who has just had surgery.
     *
     * @param  array<string,mixed>  $slots
     */
    public function minimumViableSgd(Procedure $procedure, array $slots): float
    {
        $partySize = max(1, (int) ($slots['party_size'] ?? 1));
        $nights = isset($slots['hotel_nights']) && $slots['hotel_nights'] !== null
            ? max(0, (int) $slots['hotel_nights'])
            : (int) $procedure->recovery_nights;

        $cheapestFerry = fn (string $direction) => (float) (FerryRoute::where('direction', $direction)
            ->orderBy('price_sgd')->value('price_sgd') ?? 0);

        $hotelRate = $nights > 0
            ? (float) (Hotel::where('medical_recovery_certified', true)
                ->orderBy('nightly_rate_sgd')->value('nightly_rate_sgd')
                ?? Hotel::orderBy('nightly_rate_sgd')->value('nightly_rate_sgd')
                ?? 0)
            : 0.0;

        return round(
            $this->essentialsSgd($procedure)
            + $partySize * ($cheapestFerry('SG_TO_BATAM') + $cheapestFerry('BATAM_TO_SG'))
            + $nights * $hotelRate
            + (float) (GroundTransport::orderBy('price_sgd')->value('price_sgd') ?? 0),
            2,
        );
    }

    /**
     * Where this plan stands against the number the visitor gave us.
     *
     * Returns null when they did not set one — an absent budget is not a budget
     * of zero, and a visitor who declined to answer must not be nagged.
     *
     * Every sentence here comes from this fixed bank, like every other sentence
     * the visitor reads (docs/09 D17). No model writes a word of it.
     *
     * @param  list<array<string,mixed>>  $lines
     * @param  array<string,mixed>  $slots
     * @return array<string,mixed>|null
     */
    public function budgetStatus(array $lines, Procedure $procedure, array $slots): ?array
    {
        $budget = (float) ($slots['budget_sgd'] ?? 0);

        if ($budget <= 0) {
            return null;
        }

        $total = $this->totals($lines, 0.0)['totalSgd'];
        $essentials = $this->essentialsSgd($procedure);
        $minimum = $this->minimumViableSgd($procedure, $slots);
        $money = fn (float $v) => 'S$'.number_format($v, 0);

        [$state, $message] = match (true) {
            $total <= $budget => [
                'WITHIN',
                sprintf('This plan comes in %s under your %s budget.', $money($budget - $total), $money($budget)),
            ],

            // Over, but reachable by dropping or downgrading the extras.
            $budget >= $minimum => [
                'TRIMMABLE',
                sprintf(
                    'This plan is %s over your %s budget. The cheapest complete version comes to %s — dropping a transfer or a night gets you there.',
                    $money($total - $budget),
                    $money($budget),
                    $money($minimum),
                ),
            ],

            // The treatment fits; the trip around it does not.
            $budget >= $essentials => [
                'TRAVEL_OVER',
                sprintf(
                    'Your treatment and specialist fit your %s budget, but the cheapest complete trip with travel and a room is %s. We will not shorten your recovery stay to close that gap — a coordinator can go through what to leave out.',
                    $money($budget),
                    $money($minimum),
                ),
            ],

            default => [
                'BELOW_TREATMENT',
                sprintf(
                    'The treatment and specialist alone come to %s at the lowest-priced hospital that performs it, which is already more than your %s budget. We will not reduce the treatment or change your specialist to reach a number — send the request anyway and a coordinator will call you to talk it through.',
                    $money($essentials),
                    $money($budget),
                ),
            ],
        };

        return [
            'budgetSgd' => $budget,
            'totalSgd' => $total,
            'state' => $state,
            'fits' => $state === 'WITHIN',
            'essentialsSgd' => $essentials,
            'minimumViableSgd' => $minimum,
            'overBySgd' => round(max(0.0, $total - $budget), 2),
            'message' => $message,
            // Said every time, because this is exactly where a system is
            // tempted to quietly do the wrong thing.
            'protected' => 'Your treatment, your specialist and your recommended recovery nights are never reduced to fit a budget.',
        ];
    }

    /**
     * Trade the trip down towards a budget — never the treatment.
     *
     * Walks BUDGET_TRADE_ORDER, swapping each category for the cheapest option
     * we would offer in it, and stops the moment the plan fits. It runs once,
     * on the first recommendation, to pick a sensible starting point. After
     * that the patient is editing and we only report (see budgetStatus).
     *
     * IT DOES NOTHING WHEN TRADING DOWN CANNOT REACH THE BUDGET. Someone who
     * says S$500 for a knee arthroscopy is not helped by being put on a shared
     * shuttle two days after surgery — the plan would still be thousands over,
     * and all they would have got out of it is a worse trip. When the numbers
     * cannot work, they are told the numbers cannot work.
     *
     * @param  array<string,mixed>  $slots
     * @param  list<array<string,mixed>>  $lines
     * @return list<array<string,mixed>>
     */
    private function shapeToBudget(array $lines, Procedure $procedure, array $slots, Hospital $hospital): array
    {
        $budget = (float) ($slots['budget_sgd'] ?? 0);

        if ($budget <= 0
            || $this->totals($lines, 0.0)['totalSgd'] <= $budget
            || $budget < $this->minimumViableSgd($procedure, $slots)
        ) {
            return $lines;
        }

        foreach (self::BUDGET_TRADE_ORDER as $group) {
            $cheapest = $this->cheapestIn($group);

            if ($cheapest !== null) {
                $key = collect($lines)->firstWhere('swapGroup', $group)['key'] ?? null;

                if ($key !== null) {
                    $lines = $this->applySwap($lines, $key, $cheapest, $hospital);
                }
            }

            if ($this->totals($lines, 0.0)['totalSgd'] <= $budget) {
                break;
            }
        }

        return $lines;
    }

    /** The cheapest catalogue row we would offer in a swap group. */
    private function cheapestIn(string $group): ?string
    {
        return match ($group) {
            'ferry_out' => FerryRoute::where('direction', 'SG_TO_BATAM')->orderBy('price_sgd')->value('id'),
            'ferry_return' => FerryRoute::where('direction', 'BATAM_TO_SG')->orderBy('price_sgd')->value('id'),
            // Certified only — the price floor for a recovery stay is a room
            // that can look after someone post-operative.
            'hotel' => Hotel::where('medical_recovery_certified', true)->orderBy('nightly_rate_sgd')->value('id'),
            'transport' => GroundTransport::orderBy('price_sgd')->value('id'),
            default => null,
        };
    }

    /**
     * Persist the visitor's bundle as a DRAFT quote hanging off the inquiry.
     *
     * DRAFT is the important word. This lands in the operations queue as a
     * pre-built quote for a human to check — it is not, and cannot become, an
     * approved one. Only QuoteController::approve does that.
     *
     * @param  list<array<string,mixed>>  $lines
     */
    public function persistQuote(Inquiry $inquiry, array $lines, float $benchmarkSgd): Quote
    {
        $quote = Quote::create([
            'inquiry_id' => $inquiry->id,
            'status' => 'DRAFT',
            'sg_benchmark_sgd' => $benchmarkSgd,
            // Frozen at quote time so this quote reprices identically later.
            'idr_per_sgd' => (float) config('medbridge.pricing.idr_per_sgd'),
            'valid_until' => now()->addDays((int) config('medbridge.pricing.quote_valid_days')),
            'notes' => 'Configured by the patient in the MedBridge web chat.',
        ]);

        $order = 0;
        foreach ($lines as $line) {
            if (! ($line['included'] ?? true)) {
                continue;
            }

            QuoteLineItem::create([
                'quote_id' => $quote->id,
                'category' => $line['category'],
                'label' => $line['label'],
                'detail' => $line['detail'] ?? '',
                'quantity' => $line['quantity'],
                'unit_price_sgd' => $line['unitPriceSgd'],
                'ref_type' => $line['refType'] ?? null,
                'ref_id' => $line['refId'] ?? null,
                'sort_order' => $order++,
            ]);
        }

        return $quote->load('lineItems');
    }

    /* ------------------------------------------------------------------ */
    /* Selection                                                           */
    /* ------------------------------------------------------------------ */

    /**
     * Every hospital that performs this procedure, with its own price.
     *
     * This is the list the patient chooses from. A facility appears only if it
     * lists the matching specialty — we do not offer a hospital a procedure it
     * has not claimed to perform.
     *
     * @return \Illuminate\Support\Collection<int, Hospital>
     */
    public function hospitalsFor(Procedure $procedure): Collection
    {
        $specialty = self::CATEGORY_SPECIALTY[$procedure->category] ?? null;

        /*
         * A facility that has switched a procedure off is not on the list.
         *
         * `hospital_procedure.available` is the ONE lever a hospital has over
         * what we sell on its behalf — theatre closed, surgeon on leave, list
         * full — and it was being written by the seeder and read by nobody, so
         * a hospital could mark a procedure unavailable and still be offered it
         * to patients.
         *
         * Absence of a row is not unavailability: it means the facility has no
         * negotiated price and falls back to the catalogue base, which is a
         * different situation and still quotable.
         */
        $withdrawn = HospitalProcedure::where('procedure_id', $procedure->id)
            ->where('available', false)
            ->pluck('hospital_id')
            ->all();

        $eligible = $this->rankHospitals(Hospital::all(), $procedure)
            ->filter(fn (Hospital $h) => ! in_array($h->id, $withdrawn, true))
            ->filter(fn (Hospital $h) => $specialty === null
                || in_array($specialty, $h->specialties ?? [], true));

        // A procedure no facility claims should still be quotable — the case is
        // going to a human anyway.
        return $eligible->isNotEmpty()
            ? $eligible->values()
            : $this->rankHospitals(Hospital::all(), $procedure);
    }

    /**
     * The order facilities are offered in, and so which one is the default.
     *
     * This used to be `orderByDesc('rating')`, against a rating the seeder had
     * made up — an invented number deciding where we suggest someone has an
     * operation. Price for THIS procedure is a fact we actually hold, it is
     * already on screen next to every option, and it puts the patient on the
     * cheapest qualifying facility rather than the one we flattered. Name
     * breaks ties so the list is stable rather than dependent on row order.
     *
     * @param  Collection<int, Hospital>  $hospitals
     * @return Collection<int, Hospital>
     */
    private function rankHospitals(Collection $hospitals, Procedure $procedure): Collection
    {
        return $hospitals
            ->sortBy([
                fn (Hospital $a, Hospital $b) => HospitalProcedure::priceFor($a->id, $procedure)
                    <=> HospitalProcedure::priceFor($b->id, $procedure),
                fn (Hospital $a, Hospital $b) => $a->name <=> $b->name,
            ])
            ->values();
    }

    /**
     * Hospital options as the chat renders them, priced per facility.
     *
     * @return list<array<string,mixed>>
     */
    public function hospitalOptions(Procedure $procedure): array
    {
        return $this->hospitalsFor($procedure)->map(fn (Hospital $h) => [
            'refId' => $h->id,
            'label' => $h->name,
            'detail' => sprintf(
                '%s · %s · %d min from %s',
                $h->district,
                $h->accreditation,
                $h->minutes_from_terminal,
                str_replace(' Ferry Terminal', '', $h->nearest_terminal),
            ),
            'unitPriceSgd' => HospitalProcedure::priceFor($h->id, $procedure),
            // No rating travels with the option. We do not have one, and the
            // one we used to send was invented. The link lets them go and read
            // what everyone else actually said — which is the honest thing to
            // offer, and the only thing the Maps terms allow us to offer.
            'searchUrl' => $h->searchUrl(),
        ])->values()->all();
    }

    /**
     * Honour the patient's choice when they have made one; otherwise start them
     * on the lowest-priced facility that performs the procedure.
     */
    private function resolveHospital(Procedure $procedure, ?string $hospitalId): Hospital
    {
        $eligible = $this->hospitalsFor($procedure);

        if ($hospitalId) {
            $chosen = $eligible->firstWhere('id', $hospitalId);
            if ($chosen) {
                return $chosen;
            }
        }

        // Default to the lowest-priced eligible facility. We are not qualified
        // to make a clinical recommendation between hospitals, and starting a
        // patient on the cheapest option is the neutral choice — the price,
        // the accreditation and a link to real reviews are all on screen for
        // them to trade up.
        return $eligible
            ->sortBy(fn (Hospital $h) => HospitalProcedure::priceFor($h->id, $procedure))
            ->first();
    }

    /**
     * Rebuild the bundle around a different hospital.
     *
     * Changing hospital is not a line-level swap: the treatment price, the
     * specialist and the ferry terminal all move together. What does NOT move
     * is anything the patient chose for themselves — their hotel, their
     * transfer, and every include/exclude decision carry across.
     *
     * @param  list<array<string,mixed>>  $previous
     * @return array{lines:list<array<string,mixed>>, hospitalId:string, doctorId:?string, benchmarkSgd:float}
     */
    public function rebuildForHospital(Procedure $procedure, array $slots, string $hospitalId, array $previous): array
    {
        // No budget shaping here: the patient is editing, and their decisions
        // outrank our arithmetic from this point on.
        $rebuilt = $this->recommend(
            $procedure,
            array_merge($slots, ['hospital_id' => $hospitalId]),
            shapeToBudget: false,
        );

        $hospital = Hospital::find($rebuilt['hospitalId']);
        $carry = collect($previous)->keyBy('key');

        $rebuilt['lines'] = array_map(function (array $line) use ($carry, $hospital) {
            $old = $carry->get($line['key']);
            if (! $old) {
                return $line;
            }

            // Keep what the patient decided.
            $line['included'] = $old['included'] ?? true;

            // Hotel and transport are independent of the hospital, so a choice
            // already made there survives the move. The hotel's DISTANCE does
            // not survive it — same hotel, different hospital, different drive
            // — which is exactly why the label is recomputed here.
            if (in_array($line['swapGroup'] ?? null, ['hotel', 'transport'], true)
                && ! empty($old['refId'])
                && $old['refId'] !== $line['refId']
            ) {
                $line = match ($line['swapGroup']) {
                    'hotel' => $this->rehydrateHotel($line, $old['refId'], $hospital),
                    'transport' => $this->rehydrateTransport($line, $old['refId']),
                    default => $line,
                };
            }

            return $line;
        }, $rebuilt['lines']);

        return $rebuilt;
    }

    /**
     * The specialist for a procedure at a given hospital.
     *
     * Ordered by specialty match first, then years of experience, then name —
     * so the result is stable rather than dependent on row order, and a dental
     * implant never lands on an internal-medicine physician just because they
     * were listed first at that facility.
     */
    private function pickDoctor(Procedure $procedure, Hospital $hospital): ?Doctor
    {
        return $this->doctorsFor($procedure, $hospital)->first();
    }

    /**
     * Doctors the patient may actually choose between for this procedure.
     *
     * Falls back to the full roster when the procedure is unknown or no one
     * matches — the case is bound for a human anyway, and an empty list would
     * leave the patient with no specialist at all.
     *
     * @return Collection<int, Doctor>
     */
    private function eligibleDoctors(?Procedure $procedure, ?Hospital $hospital): Collection
    {
        $roster = Doctor::when($hospital, fn ($q) => $q->where('hospital_id', $hospital->id))
            ->orderBy('full_name')
            ->get();

        if (! $procedure) {
            return $roster;
        }

        $keyword = self::CATEGORY_DOCTOR_KEYWORD[$procedure->category] ?? '';
        $qualified = $roster->filter(fn (Doctor $d) => $this->specialtyScore($d, $keyword) === 1);

        return $qualified->isNotEmpty() ? $qualified->values() : $roster;
    }

    /** @return Collection<int, Doctor> */
    private function doctorsFor(Procedure $procedure, Hospital $hospital): Collection
    {
        $keyword = self::CATEGORY_DOCTOR_KEYWORD[$procedure->category] ?? '';

        return Doctor::where('hospital_id', $hospital->id)
            ->get()
            ->sortBy([
                fn (Doctor $a, Doctor $b) => $this->specialtyScore($b, $keyword) <=> $this->specialtyScore($a, $keyword),
                // Experience, not an invented rating — see the note on the
                // hospitals table.
                fn (Doctor $a, Doctor $b) => $b->years_experience <=> $a->years_experience,
                fn (Doctor $a, Doctor $b) => $a->full_name <=> $b->full_name,
            ])
            ->values();
    }

    private function specialtyScore(Doctor $doctor, string $keyword): int
    {
        return $keyword !== '' && str_contains(mb_strtolower($doctor->specialty), $keyword) ? 1 : 0;
    }

    private function pickFerry(string $direction, Hospital $hospital): ?FerryRoute
    {
        $terminal = str_replace(' Ferry Terminal', '', $hospital->nearest_terminal);
        $column = $direction === 'SG_TO_BATAM' ? 'arrive_terminal' : 'depart_terminal';

        return FerryRoute::where('direction', $direction)
            ->where($column, 'like', "%{$terminal}%")
            ->orderBy('price_sgd')
            ->first()
            ?? FerryRoute::where('direction', $direction)->orderBy('price_sgd')->first();
    }

    private function pickHotel(): ?Hotel
    {
        return Hotel::where('medical_recovery_certified', true)
            ->orderBy('nightly_rate_sgd')
            ->first()
            ?? Hotel::orderBy('nightly_rate_sgd')->first();
    }

    /* ------------------------------------------------------------------ */
    /* Line construction                                                   */
    /* ------------------------------------------------------------------ */

    /** @return array<string,mixed> */
    private function line(
        string $key,
        string $category,
        string $label,
        string $detail,
        int $quantity,
        float $unitPrice,
        ?string $refType,
        ?string $refId,
        bool $removable,
        bool $swappable,
        ?string $swapGroup = null,
    ): array {
        return [
            'key' => $key,
            'category' => $category,
            'label' => $label,
            'detail' => $detail,
            'quantity' => $quantity,
            'unitPriceSgd' => round($unitPrice, 2),
            'refType' => $refType,
            'refId' => $refId,
            'removable' => $removable,
            'swappable' => $swappable,
            'swapGroup' => $swapGroup,
            'included' => true,
        ];
    }

    private function rehydrateHotel(array $line, string $refId, ?Hospital $hospital = null): array
    {
        $hotel = Hotel::find($refId);
        if (! $hotel) {
            return $line;
        }

        return array_merge($line, [
            'label' => 'Recovery stay — '.$hotel->name,
            'detail' => $this->hotelDetail($hotel, $hospital),
            'unitPriceSgd' => (float) $hotel->nightly_rate_sgd,
            'refId' => $hotel->id,
        ]);
    }

    private function rehydrateTransport(array $line, string $refId): array
    {
        $transport = GroundTransport::find($refId);
        if (! $transport) {
            return $line;
        }

        return array_merge($line, [
            'label' => 'Local transport — '.$transport->provider,
            'detail' => explode('.', $transport->description)[0],
            'unitPriceSgd' => (float) $transport->price_sgd,
            'refId' => $transport->id,
        ]);
    }

    private function rehydrateFerry(array $line, string $refId): array
    {
        $ferry = FerryRoute::find($refId);
        if (! $ferry || $ferry->direction !== ($line['swapGroup'] === 'ferry_out' ? 'SG_TO_BATAM' : 'BATAM_TO_SG')) {
            return $line;
        }

        $label = $ferry->direction === 'SG_TO_BATAM'
            ? 'Ferry — Singapore → '.str_replace(' Ferry Terminal', '', $ferry->arrive_terminal)
            : 'Ferry — '.str_replace(' Ferry Terminal', '', $ferry->depart_terminal).' → Singapore';

        return array_merge($line, [
            'label' => $label,
            'detail' => sprintf('%s · departs %s · %d min', $ferry->operator, $ferry->departure_time, $ferry->duration_minutes),
            'unitPriceSgd' => (float) $ferry->price_sgd,
            'refId' => $ferry->id,
        ]);
    }

    private function rehydrateDoctor(array $line, string $refId): array
    {
        $doctor = Doctor::find($refId);
        if (! $doctor) {
            return $line;
        }

        return array_merge($line, [
            'label' => 'Specialist consultation — '.$doctor->full_name,
            'detail' => $doctor->specialty,
            'unitPriceSgd' => (float) $doctor->consultation_fee_sgd,
            'refId' => $doctor->id,
        ]);
    }
}
