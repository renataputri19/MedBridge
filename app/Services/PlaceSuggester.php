<?php

namespace App\Services;

use App\Models\Hospital;
use App\Models\Hotel;
use App\Models\Place;
use App\Models\Procedure;
use Illuminate\Support\Collection;

/**
 * "While you're there" — somewhere to eat, walk or look at between appointments.
 *
 * FOUR THINGS THIS IS NOT, each of which it would be easy and wrong to make it:
 *
 * 1. NOT A PRICE. Nothing here enters the bundle, the total, the draft quote or
 *    the Singapore savings comparison. A place carries a guidebook band ("$$"),
 *    never an amount, precisely so no one is ever tempted to add it up. The
 *    savings figure in D9 is about treatment; a plate of congee has no business
 *    anywhere near it.
 *
 * 2. NOT MODEL OUTPUT. Every name, description and tag comes from the `places`
 *    table. Hermes is not consulted and could not be — asking a model for
 *    restaurant recommendations is exactly the invented-content path that
 *    docs/01 rule 5 and D17 exist to close.
 *
 * 3. NOT CLINICAL ADVICE. The recovery filter is a travel filter. It stops us
 *    suggesting a beach day two days after cataract surgery, which is basic
 *    attentiveness, not a medical opinion — and the panel says so on screen.
 *
 * 4. NOT A PARTNERSHIP. These are real Batam businesses that have agreed to
 *    nothing. The disclaimer gets louder here, not quieter (D12).
 */
class PlaceSuggester
{
    /** Enough to be useful, few enough to read. */
    private const LIMIT = 6;

    /** Never show more than this many of any one category — no all-malls list. */
    private const PER_CATEGORY = 2;

    /**
     * Suggestions for a patient, anchored on where they will actually be.
     *
     * The anchor is the hotel when they are staying overnight — that is where
     * they will be at 7pm looking for dinner — and the hospital when they are
     * not. Distances to both are returned either way, because "near the
     * hospital" is what matters on the morning of an appointment.
     *
     * @return array<string,mixed>|null
     */
    public function suggest(
        Procedure $procedure,
        ?Hospital $hospital,
        ?Hotel $hotel,
        bool $tightBudget = false,
    ): ?array {
        $anchor = $hotel ?? $hospital;

        if (! $anchor) {
            return null;
        }

        $profile = $procedure->recoveryProfile();
        $eligible = $this->eligible($profile, $tightBudget);

        if ($eligible->isEmpty()) {
            return null;
        }

        $ranked = $eligible
            ->map(function (Place $place) use ($hospital, $hotel, $anchor, $profile) {
                return [
                    'place' => $place,
                    'anchorKm' => $place->distanceKmTo($anchor) ?? PHP_FLOAT_MAX,
                    'preferred' => $this->matchCount($place, $profile['prefer_tags']),
                    'fromHotelKm' => $hotel ? $place->distanceKmTo($hotel) : null,
                    'fromHospitalKm' => $hospital ? $place->distanceKmTo($hospital) : null,
                ];
            })
            // Things the recovery profile actively suits come first — congee
            // before chilli crab after dental surgery — then by distance.
            ->sortBy([
                fn (array $a, array $b) => $b['preferred'] <=> $a['preferred'],
                fn (array $a, array $b) => $a['anchorKm'] <=> $b['anchorKm'],
            ])
            ->values();

        $picked = $this->capPerCategory($ranked);

        if ($picked->isEmpty()) {
            return null;
        }

        return [
            'anchor' => $hotel ? 'hotel' : 'hospital',
            'anchorName' => $anchor->name,
            'recoveryNote' => $profile['note'],
            'places' => $picked->map(fn (array $row) => array_merge(
                $row['place']->toApi(),
                [
                    'fromHotelKm' => $row['fromHotelKm'],
                    'fromHospitalKm' => $row['fromHospitalKm'],
                ],
            ))->values()->all(),
            // Two sentences that have to survive every redesign of this panel.
            'disclaimer' => 'Travel information only — not medical advice, and not part of your quote. '
                .'Nothing here is priced, booked or arranged by MedBridge, and none of these businesses '
                .'is a MedBridge partner. Check anything diet- or activity-related with your doctor first.',
        ];
    }

    /**
     * Places this patient can actually go to this week.
     *
     * A category or a tag on the avoid list is an exclusion, not a demotion.
     * Ranking a beach lower for a cataract patient still puts a beach on their
     * screen, and "we showed it, they chose it" is not a defence worth having.
     *
     * @param  array{avoid_categories:list<string>, avoid_tags:list<string>, prefer_tags:list<string>, note:string}  $profile
     * @return Collection<int, Place>
     */
    private function eligible(array $profile, bool $tightBudget): Collection
    {
        return Place::query()
            ->when($profile['avoid_categories'], fn ($q, $categories) => $q->whereNotIn('category', $categories))
            // A tight budget trims the splurges, and nothing else. It never
            // removes a free park or a temple, because those are the answer.
            ->when($tightBudget, fn ($q) => $q->where('price_level', '<=', 2))
            ->orderBy('name')
            ->get()
            ->reject(fn (Place $place) => $this->matchCount($place, $profile['avoid_tags']) > 0)
            ->values();
    }

    /**
     * Keep the list varied — six restaurants is a list of restaurants, not a
     * suggestion of what to do with three days.
     *
     * @param  Collection<int, array<string,mixed>>  $ranked
     * @return Collection<int, array<string,mixed>>
     */
    private function capPerCategory(Collection $ranked): Collection
    {
        $seen = [];
        $picked = collect();

        foreach ($ranked as $row) {
            $category = $row['place']->category;
            $seen[$category] = ($seen[$category] ?? 0) + 1;

            if ($seen[$category] <= self::PER_CATEGORY) {
                $picked->push($row);
            }

            if ($picked->count() >= self::LIMIT) {
                break;
            }
        }

        return $picked;
    }

    /** @param list<string> $tags */
    private function matchCount(Place $place, array $tags): int
    {
        return count(array_intersect($place->tags ?? [], $tags));
    }
}
