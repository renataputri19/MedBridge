<?php

namespace Tests\Feature;

use App\Models\ActivityEvent;
use App\Models\ChatSession;
use App\Models\Inquiry;
use App\Models\Hospital;
use App\Models\HospitalProcedure;
use App\Models\Patient;
use App\Models\Procedure;
use App\Models\Quote;
use Database\Seeders\CatalogueSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The invariants that make MedBridge safe to put in front of a patient.
 *
 * These replace the scratch suites described in docs/08 for everything that has
 * moved server-side. They assert behaviour, not implementation: the gate stops
 * cases, approval is the only door to a patient, and the public payload carries
 * nothing that identifies anyone.
 */
class PatientChatTest extends TestCase
{
    use RefreshDatabase;

    private const UUID_V4 = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(CatalogueSeeder::class);
    }

    /* ------------------------------------------------------------------ */
    /* Conversation                                                        */
    /* ------------------------------------------------------------------ */

    public function test_a_session_opens_with_a_greeting_and_waits_for_the_visitor(): void
    {
        $response = $this->postJson('/api/v1/chat/sessions')->assertCreated();

        $this->assertStringStartsWith('mbs_', $response->json('token'));
        // The session token must NOT be a UUID: it lives in a browser and must
        // never be replayable against the API as a database key.
        $this->assertDoesNotMatchRegularExpression(self::UUID_V4, $response->json('token'));

        $this->assertSame('COLLECTING', $response->json('stage'));

        // Exactly one turn, and it is not a question. The conversation is meant
        // to start with the visitor, not with a form.
        $this->assertCount(1, $response->json('messages'));
        $this->assertSame('intro', $response->json('messages.0.ui.kind'));

        // Openers they can tap, which post as their own message …
        $this->assertNotEmpty($response->json('messages.0.ui.quickReplies'));
        // … and the full catalogue, available but not shoved in their face.
        $this->assertCount(
            Procedure::count(),
            $response->json('messages.0.ui.browse'),
        );

        // Nothing identifying exists yet.
        $this->assertSame(0, Patient::count());
        $this->assertNull(ChatSession::first()->patient_id);
    }

    public function test_free_text_resolves_a_procedure_and_advances(): void
    {
        $token = $this->newChatSession();

        $response = $this->postJson("/api/v1/chat/sessions/{$token}/messages", [
            'body' => 'hi i want to go to hospital in batam for a dental implant',
        ])->assertOk();

        $this->assertSame('DEN-IMP-01', $response->json('slots.procedureCode'));

        // greeting, the visitor's message, then the next question.
        $this->assertSame('date', $response->json('messages.2.ui.kind'));
    }

    public function test_a_tapped_opener_reads_as_the_visitors_own_words(): void
    {
        $token = $this->newChatSession();

        $opener = $this->getJson("/api/v1/chat/sessions/{$token}")
            ->json('messages.0.ui.quickReplies.0');

        $response = $this->postJson("/api/v1/chat/sessions/{$token}/messages", [
            'body' => $opener['message'],
        ])->assertOk();

        $messages = $response->json('messages');
        $this->assertSame('PATIENT', $messages[1]['role']);
        $this->assertSame($opener['message'], $messages[1]['body']);
        $this->assertNotNull($response->json('slots.procedureCode'));
    }

    public function test_the_transcript_stays_in_order(): void
    {
        $token = $this->newChatSession();
        $this->choose($token, 'procedure_code', 'DEN-IMP-01');
        $this->choose($token, 'travel_date', now()->addWeeks(3)->toDateString());
        $response = $this->choose($token, 'party_size', 1);

        $roles = array_column($response->json('messages'), 'role');

        // greeting, answer, ask date, answer, ask party, answer, ask budget.
        // No question before the visitor has spoken.
        $this->assertSame(
            ['SYSTEM', 'PATIENT', 'SYSTEM', 'PATIENT', 'SYSTEM', 'PATIENT', 'SYSTEM'],
            $roles,
        );
    }

    /* ------------------------------------------------------------------ */
    /* Out of scope — what this assistant will not answer                   */
    /* ------------------------------------------------------------------ */

    /**
     * "Who is Jokowi?" used to be answered with "I couldn't match that to a
     * treatment we cover yet" and six treatment cards. That reads as a system
     * that is not listening, and it buries the one thing worth saying: this
     * assistant plans treatment trips and nothing else.
     */
    public function test_an_off_topic_question_is_declined_rather_than_answered_or_ignored(): void
    {
        $this->fakeExtraction(['off_topic' => true, 'confidence' => 0.0]);

        $response = $this->postJson("/api/v1/chat/sessions/{$this->newChatSession()}/messages", [
            'body' => 'who jokowi?',
        ])->assertOk();

        $ui = $response->json('messages.2.ui');

        $this->assertSame('scope', $ui['kind']);
        // A way back into the conversation, not a dead end …
        $this->assertNotEmpty($ui['quickReplies']);
        // … but not the whole catalogue on a first stray question.
        $this->assertArrayNotHasKey('browse', $ui);

        // Nothing a model wrote reaches the visitor — the words are ours.
        $this->assertStringContainsString('treatment trips to Batam', $response->json('messages.2.body'));

        // The flow is paused, not abandoned or escalated.
        $this->assertSame('COLLECTING', $response->json('stage'));
        $this->assertNull($response->json('slots.procedureCode'));
    }

    /**
     * A stray question must not become the case file. `source_message` is what
     * a coordinator reads as "what the patient asked for", and a question about
     * a politician sitting in that field is worse than an empty one.
     */
    public function test_an_off_topic_question_never_becomes_the_inquirys_source_message(): void
    {
        $this->fakeExtraction(['off_topic' => true, 'confidence' => 0.0]);
        $token = $this->newChatSession();

        $this->postJson("/api/v1/chat/sessions/{$token}/messages", ['body' => 'who jokowi?'])->assertOk();

        $slots = ChatSession::where('token', $token)->first()->slots;
        $this->assertArrayNotHasKey('source_message', $slots);
        $this->assertSame([], $slots['symptom_keywords'] ?? []);
    }

    /** Asked twice, the answer stops nudging and offers a person instead. */
    public function test_a_second_off_topic_question_offers_the_catalogue_and_a_human(): void
    {
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
        $this->fakeExtraction(['off_topic' => true, 'confidence' => 0.0]);
        $token = $this->newChatSession();

        $this->postJson("/api/v1/chat/sessions/{$token}/messages", ['body' => 'who jokowi?'])->assertOk();
        $response = $this->postJson("/api/v1/chat/sessions/{$token}/messages", [
            'body' => 'what is the weather in jakarta',
        ])->assertOk();

        $ui = $response->json('messages.4.ui');

        $this->assertSame('scope', $ui['kind']);
        $this->assertCount(Procedure::count(), $ui['browse']);
        $this->assertSame(config('medbridge.support_phone'), $ui['supportPhone']);
    }

    /**
     * The deflection is conservative on purpose: anything the visitor actually
     * asked for outranks the model's opinion that they were off topic.
     */
    public function test_a_message_that_names_a_treatment_is_answered_not_deflected(): void
    {
        $this->fakeExtraction([
            'procedure_code' => 'DEN-IMP-01',
            'off_topic' => true,
            'confidence' => 0.9,
        ]);

        $response = $this->postJson("/api/v1/chat/sessions/{$this->newChatSession()}/messages", [
            'body' => 'dental implant in batam, and who won the game last night?',
        ])->assertOk();

        $this->assertSame('DEN-IMP-01', $response->json('slots.procedureCode'));
        $this->assertSame('date', $response->json('messages.2.ui.kind'));
    }

    /** Acute language outranks every other reading of a message, always. */
    public function test_urgent_language_is_never_deflected_as_off_topic(): void
    {
        $this->fakeExtraction(['off_topic' => true, 'urgency' => 'URGENT', 'confidence' => 0.0]);

        $response = $this->postJson("/api/v1/chat/sessions/{$this->newChatSession()}/messages", [
            'body' => 'i feel very unwell and frightened',
        ])->assertOk();

        $this->assertSame('EMERGENCY', $response->json('stage'));
        $this->assertSame('emergency', $response->json('messages.2.ui.kind'));
    }

    /**
     * The keyword fallback never reports off_topic, so a visitor talking to a
     * degraded system gets the normal flow and a human at the end — never a
     * brush-off produced by a provider outage.
     */
    public function test_an_unreachable_provider_can_never_deflect_anybody(): void
    {
        config(['medbridge.hermes.enabled' => true, 'medbridge.hermes.api_key' => 'test-key']);
        Http::fake(['*' => Http::response(null, 503)]);

        $response = $this->postJson("/api/v1/chat/sessions/{$this->newChatSession()}/messages", [
            'body' => 'who jokowi?',
        ])->assertOk();

        // The old behaviour, which is the right one when we genuinely cannot
        // tell an off-topic question from a treatment we failed to match.
        $this->assertSame('choice', $response->json('messages.2.ui.kind'));
        $this->assertSame('procedure_code', $response->json('messages.2.ui.slot'));
    }

    /* ------------------------------------------------------------------ */
    /* Choice — the patient decides, we only pick a starting point          */
    /* ------------------------------------------------------------------ */

    public function test_the_patient_is_offered_every_hospital_that_performs_the_procedure(): void
    {
        $bundle = $this->recommendedBundle('DEN-IMP-01', 1);

        $offered = collect($bundle['hospitalOptions']);
        $this->assertGreaterThan(1, $offered->count(), 'A single option is not a choice.');

        // A facility is offered only if it advertises the matching specialty.
        foreach ($offered as $option) {
            $hospital = Hospital::findOrFail($option['refId']);
            $this->assertContains('Dental', $hospital->specialties);
        }

        // One of them is the currently selected hospital.
        $this->assertContains($bundle['hospitalId'], $offered->pluck('refId')->all());
    }

    public function test_choosing_a_hospital_moves_the_treatment_price_with_it(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01', 1);
        $before = $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle');

        $other = collect($before['hospitalOptions'])
            ->firstWhere('refId', '!=', $before['hospitalId']);

        $after = $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'hospital', 'refId' => $other['refId'],
        ])->assertOk()->json('bundle');

        $this->assertSame($other['refId'], $after['hospitalId']);

        // Priced from the facility's own row, not from anything the client sent.
        $treatment = collect($after['lines'])->firstWhere('key', 'treatment');
        $this->assertEqualsWithDelta(
            HospitalProcedure::priceFor($other['refId'], Procedure::where('code', 'DEN-IMP-01')->first()),
            $treatment['unitPriceSgd'],
            0.01,
        );
        $this->assertNotEquals($before['totals']['totalSgd'], $after['totals']['totalSgd']);
    }

    public function test_every_hospital_on_offer_has_a_doctor_qualified_for_the_procedure(): void
    {
        // This walks every procedure × hospital pair, which is more requests
        // than the public rate limit allows in a minute. The limiter is a real
        // protection and stays on for every other test; here it is noise.
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);

        // Assigning an internal-medicine physician to a dental implant would be
        // a silent clinical error, so this is checked for every combination.
        $keywords = [
            'DEN-IMP-01' => 'dental',
            'SCR-EXE-01' => 'screening',
            'OPH-LSK-01' => 'ophthalmology',
            'OPH-CAT-01' => 'ophthalmology',
            'ORT-KNE-01' => 'orthopedic',
            'GEN-ENDO-01' => 'surgery',
        ];

        foreach ($keywords as $code => $keyword) {
            $token = $this->reachRecommendation($code, 1);
            $bundle = $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle');

            foreach ($bundle['hospitalOptions'] as $option) {
                $after = $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
                    'action' => 'hospital', 'refId' => $option['refId'],
                ])->json('bundle');

                $doctorLine = collect($after['lines'])->firstWhere('key', 'doctor_fee');

                $this->assertStringContainsString(
                    $keyword,
                    mb_strtolower($doctorLine['detail']),
                    "{$code} at {$option['label']} was assigned a doctor with the wrong specialty.",
                );

                // And every alternative the patient could pick instead is also
                // qualified — a visible list of options is a list of things we
                // are willing to let them choose.
                foreach ($after['swapOptions']['doctor'] as $alternative) {
                    $this->assertStringContainsString(
                        $keyword,
                        mb_strtolower($alternative['detail']),
                        "{$code} at {$option['label']} offered an unqualified specialist.",
                    );
                }
            }
        }
    }

    public function test_changing_hospital_keeps_the_choices_the_patient_already_made(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01', 1);

        // The patient drops the transfer and upgrades the hotel …
        $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'toggle', 'key' => 'transport', 'included' => false,
        ]);
        $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'swap', 'key' => 'hotel',
            'refId' => 'd38c05a7-9f61-42be-b74c-08e35d1a9762',   // Radisson
        ]);

        $before = $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle');
        $other = collect($before['hospitalOptions'])->firstWhere('refId', '!=', $before['hospitalId']);

        // … then changes hospital.
        $after = $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'hospital', 'refId' => $other['refId'],
        ])->assertOk()->json('bundle');

        $lines = collect($after['lines']);
        $this->assertFalse($lines->firstWhere('key', 'transport')['included'], 'A removal was undone.');
        $this->assertSame(
            'd38c05a7-9f61-42be-b74c-08e35d1a9762',
            $lines->firstWhere('key', 'hotel')['refId'],
            'A hotel choice was undone.',
        );
    }

    public function test_the_advertised_from_price_is_reachable_at_some_hospital(): void
    {
        // Six full conversations in one test, and each turn is a request. That
        // is more than the public limiter allows in a minute — it stays on for
        // every other test, and here it is noise.
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);

        // The treatment chips quote `batamPriceSgd` as "from". A floor above
        // that would be a price no patient can actually get.
        foreach (Procedure::all() as $procedure) {
            $token = $this->reachRecommendation($procedure->code, 1);
            $bundle = $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle');

            $cheapest = collect($bundle['hospitalOptions'])->min('unitPriceSgd');

            $this->assertEqualsWithDelta(
                (float) $procedure->batam_price_sgd,
                $cheapest,
                0.01,
                "{$procedure->code} cannot be had at its advertised from-price anywhere.",
            );
        }
    }

    public function test_the_patient_sets_their_own_number_of_nights(): void
    {
        // The clinical recommendation is a default, not a floor.
        $token = $this->reachRecommendation('DEN-IMP-01', 1, nights: 3);
        $bundle = $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle');

        $this->assertSame(3, $bundle['hotelNights']);
        $this->assertSame(3, collect($bundle['lines'])->firstWhere('key', 'hotel')['quantity']);

        $after = $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'nights', 'nights' => 0,
        ])->assertOk()->json('bundle');

        // Zero nights removes the line entirely rather than billing zero.
        $this->assertNull(collect($after['lines'])->firstWhere('key', 'hotel'));
    }

    /* ------------------------------------------------------------------ */
    /* Pricing                                                             */
    /* ------------------------------------------------------------------ */

    public function test_the_bundle_matches_the_documented_worked_example(): void
    {
        $bundle = $this->recommendedBundle('DEN-IMP-01', 1);

        // docs/02: implant 1450 + consult 38 + ferry 27+29 + hotel 58 + car 48
        // + coordination 35 = 1685, against a 4800 + 180 Singapore basket.
        $this->assertEqualsWithDelta(1685.0, $bundle['totals']['totalSgd'], 0.01);
        $this->assertEqualsWithDelta(4980.0, $bundle['totals']['sgBenchmarkSgd'], 0.01);
        $this->assertEqualsWithDelta(3295.0, $bundle['totals']['savingsSgd'], 0.01);
        $this->assertEqualsWithDelta(66.2, $bundle['totals']['savingsPct'], 0.1);

        // Total is exactly the sum of its lines — no rounding drift.
        $sum = array_sum(array_map(
            fn ($l) => $l['included'] ? $l['quantity'] * $l['unitPriceSgd'] : 0,
            $bundle['lines'],
        ));
        $this->assertEqualsWithDelta($bundle['totals']['totalSgd'], round($sum, 2), 0.01);
    }

    public function test_party_size_multiplies_only_the_ferry_legs(): void
    {
        $solo = $this->recommendedBundle('DEN-IMP-01', 1);
        $pair = $this->recommendedBundle('DEN-IMP-01', 2);

        // Two ferry legs, 27 out and 29 back.
        $this->assertEqualsWithDelta(56.0, $pair['totals']['totalSgd'] - $solo['totals']['totalSgd'], 0.01);
    }

    public function test_a_day_case_is_not_sold_a_hotel_room(): void
    {
        // Health screening has recovery_nights = 0.
        $bundle = $this->recommendedBundle('SCR-EXE-01', 1);

        $this->assertNotContains('hotel', array_column($bundle['lines'], 'key'));
    }

    /* ------------------------------------------------------------------ */
    /* Bundle editing                                                      */
    /* ------------------------------------------------------------------ */

    public function test_removing_an_optional_line_reduces_the_total(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01', 1);

        $response = $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'toggle', 'key' => 'transport', 'included' => false,
        ])->assertOk();

        $this->assertEqualsWithDelta(1637.0, $response->json('bundle.totals.totalSgd'), 0.01);
    }

    public function test_the_treatment_line_cannot_be_removed_even_if_the_client_asks(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01', 1);

        $response = $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'toggle', 'key' => 'treatment', 'included' => false,
        ])->assertOk();

        $treatment = collect($response->json('bundle.lines'))->firstWhere('key', 'treatment');
        $this->assertTrue($treatment['included']);
        $this->assertEqualsWithDelta(1685.0, $response->json('bundle.totals.totalSgd'), 0.01);
    }

    public function test_a_swap_reprices_from_the_catalogue(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01', 1);

        $response = $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'swap',
            'key' => 'hotel',
            'refId' => 'd38c05a7-9f61-42be-b74c-08e35d1a9762',   // Radisson, 84/night
        ])->assertOk();

        $hotel = collect($response->json('bundle.lines'))->firstWhere('key', 'hotel');
        $this->assertEqualsWithDelta(84.0, $hotel['unitPriceSgd'], 0.01);
        // 1685 baseline, swapping the 58/night hotel for the 84/night one.
        $this->assertEqualsWithDelta(1711.0, $response->json('bundle.totals.totalSgd'), 0.01);
    }

    public function test_removing_a_line_never_inflates_the_advertised_saving(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01', 1);

        $before = $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle.totals');

        $after = $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'toggle', 'key' => 'hotel', 'included' => false,
        ])->json('bundle.totals');

        // The Singapore basket is fixed against the procedure (docs/09 D9), so
        // dropping the hotel lowers the price without moving the benchmark.
        $this->assertEqualsWithDelta($before['sgBenchmarkSgd'], $after['sgBenchmarkSgd'], 0.01);
        $this->assertLessThan($before['totalSgd'], $after['totalSgd']);
    }

    /* ------------------------------------------------------------------ */
    /* The gate                                                            */
    /* ------------------------------------------------------------------ */

    public function test_emergency_language_stops_the_flow_immediately(): void
    {
        $token = $this->newChatSession();

        $response = $this->postJson("/api/v1/chat/sessions/{$token}/messages", [
            'body' => 'my father has chest pain and cannot breathe',
        ])->assertOk();

        $this->assertSame('EMERGENCY', $response->json('stage'));

        $last = collect($response->json('messages'))->last();
        $this->assertSame('emergency', $last['ui']['kind']);
        $this->assertSame('995', $last['ui']['contacts']['sg_ambulance']);

        // Logged for operations even though no inquiry exists yet.
        $this->assertDatabaseHas('activity_events', [
            'type' => 'HUMAN_REVIEW_REQUIRED',
            'level' => 'error',
        ]);
    }

    public function test_emergency_detection_survives_a_disabled_threshold(): void
    {
        // The two tunable dials turned all the way down…
        config(['medbridge.gate.confidence_threshold' => 0.01]);
        config(['medbridge.gate.require_doctor_review_for_high_risk' => false]);

        $token = $this->newChatSession();
        $response = $this->postJson("/api/v1/chat/sessions/{$token}/messages", [
            'body' => 'severe pain, i think i need urgent surgery',
        ]);

        // …and the non-configurable rule still fires (docs/09 D7).
        $this->assertSame('EMERGENCY', $response->json('stage'));
    }

    public function test_an_emergency_session_cannot_be_submitted(): void
    {
        $token = $this->newChatSession();
        $this->postJson("/api/v1/chat/sessions/{$token}/messages", ['body' => 'chest pain']);

        $this->postJson("/api/v1/chat/sessions/{$token}/submit", $this->contact())
            ->assertStatus(409);

        $this->assertSame(0, Inquiry::count());
    }

    public function test_a_high_risk_procedure_routes_to_a_doctor(): void
    {
        $this->submitCase('OPH-LSK-01');   // LASIK: requires_doctor_review

        $inquiry = Inquiry::firstOrFail();
        $this->assertSame('DOCTOR_REVIEW_REQUIRED', $inquiry->status);
        $this->assertContains('HIGH_RISK_PROCEDURE', $inquiry->aiExtraction->review_reasons);
        $this->assertDatabaseHas('doctor_reviews', ['inquiry_id' => $inquiry->id, 'decision' => 'PENDING']);
    }

    public function test_a_routine_procedure_parks_at_hospital_review(): void
    {
        $this->submitCase('DEN-IMP-01');

        $inquiry = Inquiry::firstOrFail();
        $this->assertSame('HOSPITAL_REVIEW_REQUIRED', $inquiry->status);
        // It stops here. Nothing continues past this point on its own.
        $this->assertNull($inquiry->itinerary_token);
        $this->assertSame('DRAFT', $inquiry->quote->status);
    }

    public function test_the_threshold_in_force_is_persisted_with_the_decision(): void
    {
        config(['medbridge.gate.confidence_threshold' => 0.42]);
        $this->submitCase('DEN-IMP-01');

        // "Why was this handled that way six months ago" must not depend on
        // today's Settings page.
        $this->assertEqualsWithDelta(0.42, (float) Inquiry::firstOrFail()->aiExtraction->threshold_applied, 0.0001);
    }

    /* ------------------------------------------------------------------ */
    /* Submission                                                          */
    /* ------------------------------------------------------------------ */

    public function test_submission_creates_a_complete_auditable_case(): void
    {
        $this->submitCase('DEN-IMP-01');

        $inquiry = Inquiry::firstOrFail();

        $this->assertMatchesRegularExpression('/^MBP-\d{4}-\d{4}$/', $inquiry->reference);
        $this->assertSame('WEB', $inquiry->channel);
        $this->assertNotNull($inquiry->aiExtraction);
        $this->assertNotNull($inquiry->quote);

        // Every key is a strict UUID v4 — no ordered/COMB values, no integers.
        foreach ([$inquiry->id, $inquiry->patient_id, $inquiry->quote->id] as $key) {
            $this->assertMatchesRegularExpression(self::UUID_V4, $key);
        }

        $types = ActivityEvent::pluck('type')->all();
        foreach (['MESSAGE_RECEIVED', 'AI_EXTRACTION_COMPLETED', 'PRICING_CALCULATED', 'QUOTE_DRAFTED'] as $type) {
            $this->assertContains($type, $types);
        }
    }

    public function test_consent_is_required(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01', 1);

        $this->postJson("/api/v1/chat/sessions/{$token}/submit",
            array_merge($this->contact(), ['consent' => false]))
            ->assertStatus(422);

        $this->assertSame(0, Patient::count());
    }

    public function test_a_session_cannot_be_submitted_twice(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01', 1);

        $this->postJson("/api/v1/chat/sessions/{$token}/submit", $this->contact())->assertCreated();
        $this->postJson("/api/v1/chat/sessions/{$token}/submit", $this->contact())->assertStatus(409);

        $this->assertSame(1, Inquiry::count());
    }

    public function test_an_expired_session_is_a_404_not_a_410(): void
    {
        $token = $this->newChatSession();
        ChatSession::where('token', $token)->update(['expires_at' => now()->subDay()]);

        // A 410 would confirm the token once existed. It gets a 404.
        $this->getJson("/api/v1/chat/sessions/{$token}")->assertNotFound();
    }

    /* ------------------------------------------------------------------ */
    /* Approval — the one door to a patient                                */
    /* ------------------------------------------------------------------ */

    public function test_only_approval_mints_an_itinerary_token(): void
    {
        $this->submitCase('DEN-IMP-01');
        $inquiry = Inquiry::firstOrFail();

        $this->assertNull($inquiry->itinerary_token);

        $this->postJson("/api/v1/inquiries/{$inquiry->id}/quote/approve", [
            'approvedByName' => 'Nadia Putri',
        ])->assertOk();

        $inquiry->refresh();
        $this->assertNotNull($inquiry->itinerary_token);
        $this->assertStringStartsWith('mbp_', $inquiry->itinerary_token);
        // Opaque, not a database key.
        $this->assertDoesNotMatchRegularExpression(self::UUID_V4, $inquiry->itinerary_token);
        $this->assertSame('QUOTE_APPROVED', $inquiry->status);
        $this->assertNotNull($inquiry->token_expires_at);
    }

    public function test_operations_cannot_approve_around_a_pending_doctor_review(): void
    {
        $this->submitCase('OPH-LSK-01');
        $inquiry = Inquiry::firstOrFail();

        $this->postJson("/api/v1/inquiries/{$inquiry->id}/quote/approve", [
            'approvedByName' => 'Nadia Putri',
        ])->assertStatus(409);

        $this->assertNull($inquiry->refresh()->itinerary_token);
    }

    public function test_a_doctor_clearing_a_case_does_not_release_it(): void
    {
        $this->submitCase('OPH-LSK-01');
        $inquiry = Inquiry::firstOrFail();

        // Sign-off is the treating hospital's, addressed by reference — see
        // PartnerReviewController. Operations has no route to clear a case.
        $this->postJson(
            "/api/v1/partners/hospital/{$inquiry->hospital_id}/reviews/{$inquiry->reference}",
            ['decision' => 'CLEARED', 'clinicalNotes' => 'Corneal thickness adequate.'],
        )->assertOk();

        $inquiry->refresh();
        // Cleared hands it back to operations — it does not approve anything.
        $this->assertSame('HOSPITAL_REVIEW_REQUIRED', $inquiry->status);
        $this->assertNull($inquiry->itinerary_token);
    }

    public function test_an_approved_quote_cannot_be_edited(): void
    {
        $this->submitCase('DEN-IMP-01');
        $inquiry = Inquiry::firstOrFail();
        $this->postJson("/api/v1/inquiries/{$inquiry->id}/quote/approve", ['approvedByName' => 'Nadia Putri']);

        $lineItemId = Quote::firstOrFail()->lineItems->first()->id;

        $this->patchJson("/api/v1/inquiries/{$inquiry->id}/quote/line-items/{$lineItemId}", [
            'unitPriceSgd' => 1,
        ])->assertStatus(409);
    }

    /* ------------------------------------------------------------------ */
    /* The patient pass                                                    */
    /* ------------------------------------------------------------------ */

    public function test_the_public_pass_carries_no_uuid_and_no_pii(): void
    {
        $this->submitCase('DEN-IMP-01', ['fullName' => 'Tan Wei Ming', 'phone' => '+6591234412']);
        $inquiry = Inquiry::firstOrFail();
        $this->postJson("/api/v1/inquiries/{$inquiry->id}/quote/approve", ['approvedByName' => 'Nadia Putri']);

        $token = $inquiry->refresh()->itinerary_token;
        $response = $this->getJson("/api/v1/itinerary/{$token}")->assertOk();
        $body = $response->getContent();

        $this->assertSame('Tan', $response->json('patientFirstName'));
        $this->assertStringNotContainsString('Tan Wei Ming', $body);
        $this->assertStringNotContainsString('91234412', $body);
        $this->assertDoesNotMatchRegularExpression(
            '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i',
            $body,
        );
    }

    public function test_an_unapproved_or_unknown_pass_is_a_404(): void
    {
        $this->getJson('/api/v1/itinerary/mbp_thistokenneverexisted')->assertNotFound();
    }

    public function test_the_journey_is_ordered_and_reflects_what_was_removed(): void
    {
        $token = $this->reachRecommendation('DEN-IMP-01', 1);
        $this->postJson("/api/v1/chat/sessions/{$token}/bundle", [
            'action' => 'toggle', 'key' => 'hotel', 'included' => false,
        ]);
        $this->postJson("/api/v1/chat/sessions/{$token}/submit", $this->contact());

        $inquiry = Inquiry::firstOrFail();
        $this->postJson("/api/v1/inquiries/{$inquiry->id}/quote/approve", ['approvedByName' => 'Nadia Putri']);

        $steps = $this->getJson("/api/v1/itinerary/{$inquiry->refresh()->itinerary_token}")->json('steps');

        $this->assertSame(['FERRY_OUT', 'PICKUP', 'HOSPITAL', 'FERRY_RETURN'], array_column($steps, 'kind'));
        $this->assertSame(range(0, count($steps) - 1), array_column($steps, 'order'));
    }

    /* ------------------------------------------------------------------ */
    /* Operations read models                                              */
    /* ------------------------------------------------------------------ */

    public function test_submitted_cases_appear_in_the_dashboard(): void
    {
        $this->submitCase('DEN-IMP-01');

        $this->getJson('/api/v1/dashboard/kpis')
            ->assertOk()
            ->assertJsonPath('singaporeLeads', 1)
            ->assertJsonPath('pendingReviews', 1);

        $this->getJson('/api/v1/inquiries')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.channel', 'WEB');
    }

    public function test_the_inquiry_list_never_leaks_raw_contact_details(): void
    {
        $this->submitCase('DEN-IMP-01', ['phone' => '+6591234412', 'email' => 'weiming@gmail.com']);
        $inquiry = Inquiry::firstOrFail();

        $body = $this->getJson("/api/v1/inquiries/{$inquiry->id}")->getContent();

        $this->assertStringNotContainsString('+6591234412', $body);
        $this->assertStringNotContainsString('weiming@gmail.com', $body);
        $this->assertStringContainsString('phoneMasked', $body);
    }

    /**
     * A real case shows a real name in every list the portal renders.
     *
     * The list payloads used to carry `patientId` and nothing else, and the
     * frontend resolved that to a name against `web/src/mock/seed.ts`. Seeded
     * demo rows have their UUIDs pinned in both worlds so they looked fine;
     * every case actually submitted through the chat did not exist in the mock
     * and rendered as "Unknown patient" across the pipeline, the dashboard and
     * the message list — while the record itself was completely intact.
     *
     * The name has to come from the API, because the API is the only thing that
     * knows it.
     */
    public function test_list_payloads_name_the_patient_they_point_at(): void
    {
        $this->submitCase('DEN-IMP-01', ['fullName' => 'Siti Rahmawati', 'phone' => '+6591234412']);

        $row = $this->getJson('/api/v1/inquiries')->assertOk()->json('0');

        $this->assertSame('Siti Rahmawati', $row['patientName']);
        $this->assertSame('Dental Implant (single tooth, incl. crown)', $row['procedureName']);
        $this->assertNotNull($row['hospitalName']);

        // Masked, exactly as the detail payload does it — never the raw number.
        $this->assertStringNotContainsString('91234412', json_encode($row));
        $this->assertStringContainsString('•', (string) $row['patientPhoneMasked']);

        // The conversation list names the same person.
        $thread = $this->getJson('/api/v1/messages/threads')->assertOk()->json('0');
        $this->assertSame('Siti Rahmawati', $thread['patientName']);
    }

    /**
     * The board and the table show a price and a confidence per row. Both used
     * to be read out of the frontend's offline fixture, so a real case had
     * neither — the row rendered blank while the quote sat in the database.
     * They belong on the payload for the same reason the names above do.
     */
    public function test_list_payloads_carry_the_figures_each_row_displays(): void
    {
        $this->submitCase('DEN-IMP-01');

        $row = $this->getJson('/api/v1/inquiries')->assertOk()->json('0');

        // Numeric, not float: a confidence of exactly 1.0 encodes as `1`.
        $this->assertIsNumeric($row['confidence']);
        $this->assertGreaterThan(0, $row['confidence']);
        $this->assertLessThanOrEqual(1, $row['confidence']);

        $this->assertNotNull($row['totals'], 'A submitted case has a draft quote, so it has totals.');
        $this->assertGreaterThan(0, $row['totals']['totalSgd']);

        // Same arithmetic as the detail payload — one quote, one total.
        $detail = $this->getJson("/api/v1/inquiries/{$row['id']}")->assertOk()->json();
        $lineTotal = collect($detail['quote']['lineItems'])
            ->sum(fn (array $item) => $item['quantity'] * $item['unitPriceSgd']);

        $this->assertEqualsWithDelta($lineTotal, $row['totals']['totalSgd'], 0.01);
    }

    /**
     * An unrecognised channel shows everything rather than nothing.
     *
     * The portal's channel Select uses 'ALL' as its "no filter" sentinel and
     * was sending it verbatim. `where('channel', 'ALL')` matches no row, so the
     * entire pipeline rendered as an empty board — which reads as a quiet day,
     * not as a bad query string. The frontend no longer sends it; this makes
     * the endpoint safe against the next caller that does.
     */
    public function test_an_unrecognised_channel_filter_does_not_empty_the_pipeline(): void
    {
        $this->submitCase('DEN-IMP-01');

        $unfiltered = $this->getJson('/api/v1/inquiries')->assertOk()->json();
        $this->assertNotEmpty($unfiltered);

        $sentinel = $this->getJson('/api/v1/inquiries?channel=ALL')->assertOk()->json();
        $this->assertCount(count($unfiltered), $sentinel);

        // A channel we actually issue still filters.
        $web = $this->getJson('/api/v1/inquiries?channel=WEB')->assertOk()->json();
        $this->assertNotEmpty($web);

        $internal = $this->getJson('/api/v1/inquiries?channel=INTERNAL')->assertOk()->json();
        $this->assertEmpty($internal, 'A chat submission is a WEB case.');
    }

    public function test_the_analytics_funnel_is_monotonically_non_increasing(): void
    {
        $this->submitCase('DEN-IMP-01');

        $funnel = $this->getJson('/api/v1/analytics/summary')->assertOk()->json('funnel');
        $counts = array_column($funnel, 'count');

        foreach (array_slice($counts, 1) as $index => $count) {
            $this->assertLessThanOrEqual($counts[$index], $count, 'A funnel stage rose — that is a data bug.');
        }
    }

    public function test_the_audit_payload_carries_facts_not_prose(): void
    {
        $this->submitCase('DEN-IMP-01');

        $event = collect($this->getJson('/api/v1/activity')->json())
            ->firstWhere('type', 'AI_EXTRACTION_COMPLETED');

        // Structured backend facts, safe to render verbatim in the inspector.
        $this->assertArrayHasKey('confidence', $event['payload']);
        $this->assertArrayHasKey('threshold_applied', $event['payload']);
        $this->assertArrayHasKey('model_version', $event['payload']);
    }

    public function test_the_raw_provider_response_is_never_served(): void
    {
        $this->submitCase('DEN-IMP-01');
        $inquiry = Inquiry::firstOrFail();

        $body = $this->getJson("/api/v1/inquiries/{$inquiry->id}")->getContent();

        $this->assertStringNotContainsString('raw_response', $body);
        $this->assertStringNotContainsString('rawResponse', $body);
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    private function newChatSession(): string
    {
        return $this->postJson('/api/v1/chat/sessions')->json('token');
    }

    /**
     * Put one fixed extraction on the wire.
     *
     * The suite runs with Hermes disabled, which routes everything through the
     * keyword fallback — fine for the flow, useless for anything that depends
     * on a judgement only the model makes. This turns Hermes on and fakes the
     * transport, so the assertions are about what we do with an answer rather
     * than about whether a provider produced it. Nothing touches the network.
     *
     * @param  array<string,mixed>  $extraction  merged over a neutral baseline
     */
    private function fakeExtraction(array $extraction): void
    {
        config(['medbridge.hermes.enabled' => true, 'medbridge.hermes.api_key' => 'test-key']);

        $payload = json_encode(array_merge([
            'procedure_code' => null,
            'travel_date' => null,
            'party_size' => null,
            'budget_sgd' => null,
            'confidence' => 0.0,
            'urgency' => 'NORMAL',
            'symptom_keywords' => [],
            'off_topic' => false,
        ], $extraction));

        Http::fake(['*' => Http::response([
            'choices' => [['finish_reason' => 'stop', 'message' => ['content' => $payload]]],
        ])]);
    }

    private function choose(string $token, string $slot, string|int $value)
    {
        return $this->postJson("/api/v1/chat/sessions/{$token}/choice", [
            'slot' => $slot,
            'value' => $value,
        ])->assertOk();
    }

    /**
     * Walk a session to a recommendation.
     *
     * `$nights` defaults to the procedure's clinical recommendation, matching
     * what a patient who accepts the suggested option would get.
     *
     * `$budget` defaults to 0 — "I'd rather not set one" — which is the
     * baseline every pricing assertion in this file is written against. A
     * budget shapes the starting plan, so a test that does not care about
     * budgets must not accidentally set one.
     */
    private function reachRecommendation(
        string $procedureCode,
        int $partySize,
        ?int $nights = null,
        int $budget = 0,
    ): string {
        $token = $this->newChatSession();
        $this->choose($token, 'procedure_code', $procedureCode);
        $this->choose($token, 'travel_date', now()->addWeeks(3)->toDateString());
        $this->choose($token, 'party_size', $partySize);
        $this->choose($token, 'budget_sgd', $budget);
        $this->choose(
            $token,
            'hotel_nights',
            $nights ?? (int) Procedure::where('code', $procedureCode)->value('recovery_nights'),
        );

        return $token;
    }

    private function recommendedBundle(string $procedureCode, int $partySize): array
    {
        $token = $this->reachRecommendation($procedureCode, $partySize);

        return $this->getJson("/api/v1/chat/sessions/{$token}")->json('bundle');
    }

    private function contact(array $overrides = []): array
    {
        return array_merge([
            'fullName' => 'Tan Wei Ming',
            'phone' => '+6591234412',
            'consent' => true,
        ], $overrides);
    }

    private function submitCase(string $procedureCode, array $contact = []): void
    {
        $token = $this->reachRecommendation($procedureCode, 1);
        $this->postJson("/api/v1/chat/sessions/{$token}/submit", $this->contact($contact))
            ->assertCreated();
    }
}
