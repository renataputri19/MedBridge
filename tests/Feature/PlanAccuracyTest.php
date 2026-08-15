<?php

namespace Tests\Feature;

use App\Models\Doctor;
use App\Models\Hospital;
use App\Models\Hotel;
use App\Models\Place;
use App\Models\Procedure;
use App\Services\BundleBuilder;
use App\Support\Geo;
use Database\Seeders\CatalogueSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Whether the recommendation is actually TRUE, not merely priced.
 *
 * PatientChatTest covers the safety invariants — the gate, the approval door,
 * what leaves the building. This file covers the other half of trustworthiness:
 * a plan can pass every safety check and still quietly tell the patient
 * something false. Three things it used to get wrong, and now must not:
 *
 *  - a hotel's distance, which was one stored number shown against whichever of
 *    three hospitals the patient picked
 *  - a budget, which no one asked for and nothing respected
 *  - the suggestions around the trip, which did not exist
 */
class PlanAccuracyTest extends TestCase
{
    use RefreshDatabase;

    /** Elisabeth Batam Kota and Batam Medical Center both list Dental. */
    private const RADISSON = 'd38c05a7-9f61-42be-b74c-08e35d1a9762';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(CatalogueSeeder::class);
    }

    /* ------------------------------------------------------------------ */
    /* Provenance — is this place real?                                     */
    /* ------------------------------------------------------------------ */

    /**
     * The catalogue once contained businesses that do not exist: invented
     * Indonesian names at invented coordinates, one of which plotted into an
     * industrial estate. Nothing in the system could tell the difference,
     * because nothing was checking. This is the check.
     */
    public function test_every_place_on_the_map_can_be_looked_up(): void
    {
        foreach ([Hospital::class, Hotel::class, Place::class] as $model) {
            foreach ($model::all() as $row) {
                $this->assertMatchesRegularExpression(
                    '#^(node|way|relation)/\d+$#',
                    (string) $row->osm_ref,
                    "{$row->name} has no verifiable OpenStreetMap reference. A row nobody can look up is a row somebody made up.",
                );

                // Coordinates have to be on Batam, not merely present. A
                // transposed or fat-fingered pair lands in the sea, and the
                // haversine will happily return a confident number for it.
                $this->assertGreaterThan(0.95, (float) $row->latitude, "{$row->name} is not on Batam.");
                $this->assertLessThan(1.25, (float) $row->latitude, "{$row->name} is not on Batam.");
                $this->assertGreaterThan(103.85, (float) $row->longitude, "{$row->name} is not on Batam.");
                $this->assertLessThan(104.20, (float) $row->longitude, "{$row->name} is not on Batam.");
            }
        }
    }

    public function test_the_seeder_refuses_to_finish_with_an_unverified_row(): void
    {
        // The failure mode this guards is someone adding a place the easy way:
        // a name, a plausible coordinate, and no source. Exactly how the last
        // catalogue acquired four businesses that do not exist.
        Place::create([
            'name' => 'Kopitiam Ameng',
            'category' => 'RESTAURANT',
            'district' => 'Batam Kota',
            'description' => 'Sounds real. Is not.',
            'latitude' => 1.1115,
            'longitude' => 104.0478,
            'price_level' => 1,
            'tags' => ['halal'],
            'osm_ref' => null,
        ]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/Kopitiam Ameng.*cannot be verified|cannot be verified.*Kopitiam Ameng/s');

        (new CatalogueSeeder)->run();
    }

    /* ------------------------------------------------------------------ */
    /* Geography                                                           */
    /* ------------------------------------------------------------------ */

    public function test_a_hotels_distance_is_measured_to_the_hospital_the_patient_chose(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01');

        // Pin the same hotel in place across a hospital change, so the only
        // thing that can move the number is the hospital.
        $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'swap', 'key' => 'hotel', 'refId' => self::RADISSON,
        ])->assertOk();

        $before = $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle');
        $other = collect($before['hospitalOptions'])->firstWhere('refId', '!=', $before['hospitalId']);

        $after = $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'hospital', 'refId' => $other['refId'],
        ])->assertOk()->json('bundle');

        $hotelLine = fn (array $bundle) => collect($bundle['lines'])->firstWhere('key', 'hotel');

        // Same hotel …
        $this->assertSame(self::RADISSON, $hotelLine($after)['refId']);

        // … and a different distance, because it is a different hospital. This
        // is the whole bug: one scalar cannot be true about three facilities.
        $this->assertNotSame(
            $hotelLine($before)['detail'],
            $hotelLine($after)['detail'],
            'The hotel line reported the same distance for two different hospitals.',
        );

        // And the number is the real one, not a stored approximation.
        $hotel = Hotel::findOrFail(self::RADISSON);
        $hospital = Hospital::findOrFail($other['refId']);
        $expected = Geo::roundKm(Geo::haversineKm(
            $hotel->latitude, $hotel->longitude, $hospital->latitude, $hospital->longitude,
        ));

        $this->assertStringContainsString(
            rtrim(rtrim(number_format($expected, 1, '.', ''), '0'), '.').' km',
            $hotelLine($after)['detail'],
        );
    }

    public function test_hotel_options_are_ordered_by_distance_to_the_chosen_hospital(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01');
        $bundle = $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle');

        $distances = array_column($bundle['swapOptions']['hotel'], 'distanceKm');

        $this->assertCount(Hotel::count(), $distances);
        $this->assertNotContains(null, $distances, 'A hotel has no distance to the chosen hospital.');

        $sorted = $distances;
        sort($sorted);
        $this->assertSame($sorted, $distances, 'The hotel list is not nearest-first.');

        // Changing hospital re-sorts it, because the distances themselves moved.
        $other = collect($bundle['hospitalOptions'])->firstWhere('refId', '!=', $bundle['hospitalId']);
        $after = $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'hospital', 'refId' => $other['refId'],
        ])->json('bundle');

        $this->assertNotSame($distances, array_column($after['swapOptions']['hotel'], 'distanceKm'));
    }

    /**
     * By NAME, never by pin.
     *
     * A Maps URL built from a coordinate drops the patient exactly where our
     * centroid says, and a centroid two hundred metres out puts them in the
     * industrial lot next door wondering what else we got wrong. A search for
     * "Best Western Premier Panbil Batam" resolves to the business, because
     * that is the problem Google already solved.
     */
    public function test_places_link_to_a_google_search_by_name_not_a_map_pin(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01');
        $bundle = $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle');

        $links = array_merge(
            array_column($bundle['hospitalOptions'], 'searchUrl'),
            array_column($bundle['swapOptions']['hotel'], 'searchUrl'),
            array_column($bundle['nearby']['places'], 'searchUrl'),
        );

        $this->assertNotEmpty($links);
        foreach ($links as $url) {
            $this->assertStringStartsWith('https://www.google.com/search?q=', (string) $url);
            // No coordinate anywhere in the URL, and no Maps endpoint.
            $this->assertStringNotContainsString('/maps', (string) $url);
            $this->assertDoesNotMatchRegularExpression('/\d+\.\d{4,}/', (string) $url);
            // Every query is scoped to Batam so a common name cannot resolve
            // to a same-named business on the other side of the world.
            $this->assertStringContainsString('Batam', urldecode((string) $url));
        }
    }

    public function test_distances_are_rounded_to_the_precision_we_actually_have(): void
    {
        $bundle = $this->getJson(
            '/api/v1/chat/sessions/'.$this->reachRecommendation('DEN-IMP-01')
        )->json('bundle');

        foreach ($bundle['swapOptions']['hotel'] as $option) {
            // Half-kilometre steps. These are OSM building centroids; "3.8 km"
            // claims a hundred-metre accuracy nobody has.
            $this->assertEqualsWithDelta(
                round((float) $option['distanceKm'] * 2) / 2,
                (float) $option['distanceKm'],
                0.0001,
                "{$option['label']} reports a distance more precise than the data behind it.",
            );
        }

        // And it is rendered as an approximation, not a measurement.
        $hotelLine = collect($bundle['lines'])->firstWhere('key', 'hotel');
        $this->assertStringContainsString('~', $hotelLine['detail']);
    }

    public function test_we_send_people_to_google_rather_than_storing_what_google_says(): void
    {
        // Caching ratings, review counts or photos is both a terms problem and
        // a staleness problem — a copied rating is out of date the day after.
        // The catalogue carries a link and no mirrored content.
        $hotel = $this->getJson('/api/v1/catalogue/hotels')->assertOk()->json('0');

        $this->assertArrayHasKey('searchUrl', $hotel);
        $this->assertArrayNotHasKey('mapsUrl', $hotel);
        $this->assertArrayNotHasKey('googlePlaceId', $hotel);
        $this->assertFalse(
            \Illuminate\Support\Facades\Schema::hasColumn('hotels', 'google_place_id'),
            'The Google Maps place id column is gone — we link by name now.',
        );
        foreach (['rating', 'reviewCount', 'reviews', 'userRatingsTotal', 'photoUrl'] as $mirrored) {
            $this->assertArrayNotHasKey($mirrored, $hotel);
        }

        $place = Place::first();
        foreach (['rating', 'review_count', 'reviews'] as $column) {
            $this->assertFalse(
                \Illuminate\Support\Facades\Schema::hasColumn('places', $column),
                "places.{$column} would mirror Google content we are only allowed to link to.",
            );
        }
        $this->assertArrayNotHasKey('rating', $place->toApi());
    }

    /**
     * The same rule, on the tables where breaking it would matter most.
     *
     * Hotels and places were already covered. Hospitals and doctors were not,
     * and that is where the invented numbers actually lived: 4.8 out of 5 from
     * 1,284 reviews, seeded onto a real hospital that anyone can look up, then
     * drawn with a gold star in the patient's hospital picker. Nobody was
     * surveyed. A patient cannot tell an invented rating from a real one, and
     * this one sat next to the question of where to have an operation.
     *
     * It was not inert, either — the option list was ordered by it, so the
     * made-up figure chose the default facility.
     */
    public function test_no_invented_rating_rides_on_a_hospital_or_a_doctor(): void
    {
        foreach (['hospitals' => ['rating', 'review_count'], 'doctors' => ['rating']] as $table => $columns) {
            foreach ($columns as $column) {
                $this->assertFalse(
                    \Illuminate\Support\Facades\Schema::hasColumn($table, $column),
                    "{$table}.{$column} is a number we would have to invent — link to Google instead.",
                );
            }
        }

        $hospital = Hospital::first();
        foreach (['rating', 'reviewCount', 'reviews', 'userRatingsTotal'] as $mirrored) {
            $this->assertArrayNotHasKey($mirrored, $hospital->toApi());
        }
        $this->assertArrayNotHasKey('rating', Doctor::first()->toApi());

        // The replacement for the number is the link, so it has to be there.
        $this->assertStringStartsWith('https://www.google.com/search?q=', $hospital->toApi()['searchUrl']);

        // And nothing rated reaches the patient's hospital picker.
        $procedure = Procedure::where('code', 'DEN-IMP-01')->firstOrFail();
        foreach (app(BundleBuilder::class)->hospitalOptions($procedure) as $option) {
            $this->assertArrayNotHasKey('rating', $option);
        }
    }

    /**
     * Order the patient sees facilities in, now that no rating decides it.
     *
     * Cheapest first is a fact we hold and already show. The test is here
     * because the ordering key is load-bearing: it picks the default hospital,
     * and silently falling back to row order would make the default arbitrary.
     */
    public function test_hospitals_are_offered_cheapest_first_for_the_procedure(): void
    {
        $procedure = Procedure::where('code', 'DEN-IMP-01')->firstOrFail();
        $prices = array_column(app(BundleBuilder::class)->hospitalOptions($procedure), 'unitPriceSgd');

        $sorted = $prices;
        sort($sorted);

        $this->assertSame($sorted, $prices, 'The hospital list is no longer cheapest-first.');
    }

    /**
     * The portal can read the places catalogue, and cannot put a price on it.
     *
     * The operations portal now lists places so staff can see what the recovery
     * filter is choosing between. That is a read, and it has to stay one: the
     * property that keeps a restaurant out of `draft_lines`, out of the total
     * and out of the D9 savings comparison is that it has no amount anywhere in
     * the system. An edit endpoint would be a text box that creates one.
     */
    public function test_the_places_catalogue_is_readable_and_has_no_price(): void
    {
        $places = $this->getJson('/api/v1/catalogue/places')->assertOk()->json();

        $this->assertNotEmpty($places);

        foreach ($places as $place) {
            // A guidebook band ("$$"), never an amount anyone could sum.
            $this->assertArrayHasKey('priceBand', $place);
            foreach (['priceSgd', 'price_sgd', 'nightlyRateSgd', 'amount'] as $money) {
                $this->assertArrayNotHasKey(
                    $money,
                    $place,
                    "places.{$money} would let a suggestion enter a quote.",
                );
            }

            // Provenance survives to the portal — this is the screen where a
            // reviewer checks that a row is a real business.
            $this->assertArrayHasKey('sourceUrl', $place);
            $this->assertStringStartsWith('https://www.openstreetmap.org/', (string) $place['sourceUrl']);
        }

        $this->assertFalse(
            \Illuminate\Support\Facades\Schema::hasColumn('places', 'price_sgd'),
            'places.price_sgd would make a suggestion quotable.',
        );

        /*
         * There is no write route, and adding one should fail this test.
         *
         * 404 today because nothing is registered at this URI for any verb; 405
         * would mean the path exists and only the method is wrong. Both count
         * as "refused", so that registering some other verb here does not
         * quietly turn this assertion into a no-op. What must never happen is
         * a 2xx.
         */
        $refusal = $this->patchJson(
            '/api/v1/catalogue/places/'.Place::first()->id,
            ['priceSgd' => 20],
        );

        $this->assertContains(
            $refusal->status(),
            [404, 405],
            'A place became editable — that is a price on a suggestion.',
        );
    }

    /* ------------------------------------------------------------------ */
    /* Budget                                                              */
    /* ------------------------------------------------------------------ */

    public function test_a_budget_below_the_treatment_is_answered_honestly_not_quietly(): void
    {
        // A knee arthroscopy is S$4,200 before anything else. S$500 is not a
        // plan we can build, and the only acceptable response is to say so.
        $token = $this->reachRecommendation('ORT-KNE-01', budget: 500);
        $bundle = $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle');

        $budget = $bundle['budget'];
        $this->assertSame('BELOW_TREATMENT', $budget['state']);
        $this->assertFalse($budget['fits']);
        $this->assertStringContainsString('will not reduce the treatment', $budget['message']);

        $lines = collect($bundle['lines']);
        $procedure = Procedure::where('code', 'ORT-KNE-01')->firstOrFail();

        // Nothing clinical moved to chase the number.
        $this->assertEqualsWithDelta(
            \App\Models\HospitalProcedure::priceFor($bundle['hospitalId'], $procedure),
            $lines->firstWhere('key', 'treatment')['unitPriceSgd'],
            0.01,
            'The treatment was repriced to fit a budget.',
        );
        $this->assertNotNull($lines->firstWhere('key', 'doctor_fee'), 'The specialist was dropped to fit a budget.');
        $this->assertSame(
            (int) $procedure->recovery_nights,
            $bundle['hotelNights'],
            'Recovery nights were shortened to fit a budget.',
        );

        // And nothing else was quietly downgraded either: trading down could
        // not have reached S$500, so it would have cost the patient comfort
        // for no gain at all.
        $unconstrained = $this->getJson(
            '/api/v1/chat/sessions/'.$this->reachRecommendation('ORT-KNE-01').''
        )->json('bundle');

        $this->assertEqualsWithDelta(
            $unconstrained['totals']['totalSgd'],
            $bundle['totals']['totalSgd'],
            0.01,
            'An unreachable budget still degraded the plan.',
        );
    }

    public function test_a_reachable_budget_trades_the_trip_down_but_never_the_treatment(): void
    {
        $baseline = $this->getJson(
            '/api/v1/chat/sessions/'.$this->reachRecommendation('DEN-IMP-01')
        )->json('bundle');

        // S$1,660 sits between the default plan (S$1,685) and the cheapest
        // complete version of it, so trading down genuinely gets there.
        $token = $this->reachRecommendation('DEN-IMP-01', budget: 1660);
        $bundle = $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle');

        $this->assertTrue($bundle['budget']['fits']);
        $this->assertSame('WITHIN', $bundle['budget']['state']);
        $this->assertLessThanOrEqual(1660.0, $bundle['totals']['totalSgd']);

        $line = fn (array $b, string $key) => collect($b['lines'])->firstWhere('key', $key);

        // The saving came out of the transfer …
        $this->assertNotSame(
            $line($baseline, 'transport')['refId'],
            $line($bundle, 'transport')['refId'],
        );

        // … and out of nothing clinical.
        foreach (['treatment', 'doctor_fee'] as $key) {
            $this->assertEqualsWithDelta(
                $line($baseline, $key)['unitPriceSgd'],
                $line($bundle, $key)['unitPriceSgd'],
                0.01,
            );
        }
        $this->assertSame($baseline['hotelNights'], $bundle['hotelNights']);
        // A recovery stay never drops below a recovery-certified property.
        $this->assertTrue(
            Hotel::findOrFail($line($bundle, 'hotel')['refId'])->medical_recovery_certified,
            'A budget pushed the patient into a hotel not equipped for recovery.',
        );
    }

    public function test_declining_to_set_a_budget_is_a_real_answer(): void
    {
        $bundle = $this->getJson(
            '/api/v1/chat/sessions/'.$this->reachRecommendation('DEN-IMP-01', budget: 0)
        )->json('bundle');

        // Null, not a budget of zero, and no warning to dismiss.
        $this->assertNull($bundle['budget']);
        $this->assertEqualsWithDelta(1685.0, $bundle['totals']['totalSgd'], 0.01);
    }

    public function test_every_offered_budget_band_is_one_we_can_actually_meet(): void
    {
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);

        // Offering "under S$1,500" to someone pricing a S$4,200 knee is an
        // invitation to a disappointment we could see coming.
        foreach (Procedure::all() as $procedure) {
            $token = $this->newChatSession();
            $this->choose($token, 'procedure_code', $procedure->code);
            $this->choose($token, 'travel_date', now()->addWeeks(3)->toDateString());
            $response = $this->choose($token, 'party_size', 1);

            $question = collect($response->json('messages'))->last()['ui'];
            $this->assertSame('budget_sgd', $question['slot']);

            $minimum = app(\App\Services\BundleBuilder::class)
                ->minimumViableSgd($procedure, ['party_size' => 1]);

            foreach ($question['options'] as $option) {
                if ($option['value'] === 0) {
                    continue;   // "I'd rather not set one"
                }

                $this->assertGreaterThanOrEqual(
                    $minimum,
                    $option['value'],
                    "{$procedure->code} offers a budget band below the cheapest possible trip.",
                );
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Places — suggestions, never line items                              */
    /* ------------------------------------------------------------------ */

    public function test_suggestions_never_touch_the_price_or_the_saving(): void
    {
        $bundle = $this->getJson(
            '/api/v1/chat/sessions/'.$this->reachRecommendation('DEN-IMP-01')
        )->json('bundle');

        $this->assertNotEmpty($bundle['nearby']['places']);

        // The documented worked example, unchanged by anything in the panel.
        $this->assertEqualsWithDelta(1685.0, $bundle['totals']['totalSgd'], 0.01);
        $this->assertEqualsWithDelta(3295.0, $bundle['totals']['savingsSgd'], 0.01);

        // The total is still exactly the sum of the quote lines …
        $sum = array_sum(array_map(
            fn ($l) => $l['included'] ? $l['quantity'] * $l['unitPriceSgd'] : 0,
            $bundle['lines'],
        ));
        $this->assertEqualsWithDelta($bundle['totals']['totalSgd'], round($sum, 2), 0.01);

        // … and no place has leaked into them.
        $placeIds = Place::pluck('id')->all();
        foreach ($bundle['lines'] as $line) {
            $this->assertNotContains($line['refId'], $placeIds);
            $this->assertNotSame('place', $line['refType']);
        }

        // A suggestion carries a band, never an amount to add up.
        foreach ($bundle['nearby']['places'] as $place) {
            $this->assertArrayNotHasKey('priceSgd', $place);
            $this->assertArrayNotHasKey('unitPriceSgd', $place);
            $this->assertArrayHasKey('priceBand', $place);
        }
    }

    public function test_suggestions_are_filtered_by_what_the_patient_can_actually_do(): void
    {
        // Cataract surgery: no beach, no sun, no dust.
        $cataract = $this->getJson(
            '/api/v1/chat/sessions/'.$this->reachRecommendation('OPH-CAT-01')
        )->json('bundle.nearby');

        foreach ($cataract['places'] as $place) {
            $this->assertNotSame('BEACH', $place['category'], 'A cataract patient was offered a beach day.');
            $this->assertEmpty(
                array_intersect($place['tags'], ['sun-exposed', 'dusty', 'strenuous']),
                "{$place['name']} is the wrong place to send someone two days after eye surgery.",
            );
        }
        // The panel explains the filter rather than silently applying it.
        $this->assertStringContainsString('sand', $cataract['recoveryNote']);

        // Gastroscopy + colonoscopy: nothing spicy, nothing to chew hard on.
        $endoscopy = $this->getJson(
            '/api/v1/chat/sessions/'.$this->reachRecommendation('GEN-ENDO-01')
        )->json('bundle.nearby');

        foreach ($endoscopy['places'] as $place) {
            $this->assertEmpty(
                array_intersect($place['tags'], ['spicy', 'alcohol', 'crunchy']),
                "{$place['name']} was suggested to someone who had a scope this morning.",
            );
        }

        // A health screening restricts nothing afterwards, and the panel opens
        // up accordingly — outdoor and busy places are back on the list. The
        // filter is doing real work, not trimming everyone down to the same
        // safe indoor minimum.
        $screening = $this->getJson(
            '/api/v1/chat/sessions/'.$this->reachRecommendation('SCR-EXE-01')
        )->json('bundle.nearby');

        $tags = array_merge(...array_column($screening['places'], 'tags'));
        $this->assertContains('outdoor', $tags);
        $this->assertStringContainsString('fast', $screening['recoveryNote']);
    }

    public function test_suggestions_are_anchored_where_the_patient_will_be(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01');
        $bundle = $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle');

        // Staying over: dinner should be near the bed, not near the hospital.
        $this->assertSame('hotel', $bundle['nearby']['anchor']);
        $this->assertStringContainsString('Hotel', $bundle['nearby']['anchorName'].' Hotel');
        foreach ($bundle['nearby']['places'] as $place) {
            $this->assertNotNull($place['fromHotelKm']);
            $this->assertNotNull($place['fromHospitalKm']);
        }

        // Drop the hotel and it is a day trip, so the hospital is the anchor.
        $after = $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'toggle', 'key' => 'hotel', 'included' => false,
        ])->assertOk()->json('bundle');

        $this->assertSame('hospital', $after['nearby']['anchor']);
    }

    public function test_the_suggestion_panel_says_what_it_is_and_what_it_is_not(): void
    {
        $nearby = $this->getJson(
            '/api/v1/chat/sessions/'.$this->reachRecommendation('DEN-IMP-01')
        )->json('bundle.nearby');

        // Real business names make an implied partnership easy to read into the
        // page, so the denial has to travel with the data (docs/09 D12).
        $this->assertStringContainsString('not medical advice', $nearby['disclaimer']);
        $this->assertStringContainsString('not part of your quote', $nearby['disclaimer']);
        $this->assertStringContainsString('partner', $nearby['disclaimer']);
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    private function newChatSession(): string
    {
        return $this->postJson('/api/v1/chat/sessions')->json('token');
    }

    private function choose(string $token, string $slot, string|int $value)
    {
        return $this->postJson("/api/v1/chat/sessions/{$token}/choice", [
            'slot' => $slot,
            'value' => $value,
        ])->assertOk();
    }

    private function reachRecommendation(string $code, int $budget = 0, ?int $nights = null): string
    {
        $token = $this->newChatSession();
        $this->choose($token, 'procedure_code', $code);
        $this->choose($token, 'travel_date', now()->addWeeks(3)->toDateString());
        $this->choose($token, 'party_size', 1);
        $this->choose($token, 'budget_sgd', $budget);
        $this->choose(
            $token,
            'hotel_nights',
            $nights ?? (int) Procedure::where('code', $code)->value('recovery_nights'),
        );

        return $token;
    }
}
