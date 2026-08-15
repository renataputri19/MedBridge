<?php

namespace Tests\Feature;

use App\Models\Doctor;
use App\Models\HospitalProcedure;
use App\Models\Hotel;
use App\Models\Inquiry;
use App\Models\Procedure;
use App\Models\Quote;
use App\Services\Commission;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Partner portals and the marketplace's own numbers.
 *
 * Two properties matter here and both are easy to lose:
 *
 *  1. A partner sees only its own rows. Cross-tenant leakage in a marketplace
 *     is a commercial injury with our name on it, not a cosmetic bug.
 *
 *  2. Our margin is not the partner's business, and an entitlement is not cash.
 *     Both are wording as much as arithmetic, so both are asserted.
 */
class PartnerPortalTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(\Database\Seeders\CatalogueSeeder::class);
    }

    /* ------------------------------------------------------------------ */

    public function test_the_picker_lists_every_partner_of_a_type(): void
    {
        foreach (['hospital' => 3, 'hotel' => 4, 'ferry' => 6, 'transport' => 4] as $type => $expected) {
            $rows = $this->getJson("/api/v1/partners/{$type}")->assertOk()->json();

            $this->assertCount($expected, $rows, "The {$type} picker is missing rows.");
            $this->assertArrayHasKey('name', $rows[0]);
            $this->assertArrayHasKey('bookingCount', $rows[0]);
        }
    }

    public function test_an_unknown_partner_type_is_a_404(): void
    {
        $this->getJson('/api/v1/partners/restaurant')->assertNotFound();
    }

    public function test_a_partner_never_sees_our_commission(): void
    {
        $hotel = Hotel::firstOrFail();
        $payload = $this->getJson("/api/v1/partners/hotel/{$hotel->id}")->assertOk()->json();

        // What they are owed, yes. What we keep on top of it, never.
        $this->assertArrayHasKey('supplierSgd', $payload);
        foreach (['commissionSgd', 'takeRatePct', 'grossBookingSgd'] as $ours) {
            $this->assertArrayNotHasKey($ours, $payload);
        }

        $body = json_encode($payload);
        $this->assertStringNotContainsString('commission', strtolower((string) $body));
    }

    public function test_a_partner_sees_no_patient_contact_details(): void
    {
        $hotel = Hotel::firstOrFail();
        $body = $this->getJson("/api/v1/partners/hotel/{$hotel->id}")->assertOk()->getContent();

        foreach (['phone', 'email', 'phoneMasked', 'patientId'] as $leak) {
            $this->assertStringNotContainsString($leak, $body);
        }
    }

    public function test_a_partners_ledger_carries_only_its_own_lines(): void
    {
        // Two hotels, and whatever lands on one must not land on the other.
        $hotels = Hotel::orderBy('name')->take(2)->get();

        foreach ($hotels as $hotel) {
            $payload = $this->getJson("/api/v1/partners/hotel/{$hotel->id}")->assertOk()->json();

            foreach ($payload['bookings'] as $booking) {
                // Every line on this ledger is one this hotel supplies, which
                // means it is priced at this hotel's rate.
                $this->assertStringContainsString(
                    'night',
                    strtolower($booking['label'].' '.$booking['detail']),
                    'A non-hotel line appeared on a hotel ledger.',
                );
            }
        }
    }

    public function test_a_hospital_ledger_holds_clinical_lines_and_nothing_else(): void
    {
        $hospitals = $this->getJson('/api/v1/partners/hospital')->assertOk()->json();
        $payload = $this->getJson("/api/v1/partners/hospital/{$hospitals[0]['id']}")->assertOk()->json();

        // Its own rates come through, so it can check what we quote on its behalf.
        $this->assertArrayHasKey('procedures', $payload['catalogue']);
        $this->assertArrayHasKey('doctors', $payload['catalogue']);
        $this->assertNotEmpty($payload['catalogue']['specialties']);

        // A ferry crossing is another partner's revenue and must never appear.
        foreach ($payload['bookings'] as $booking) {
            $this->assertStringNotContainsString('ferry', strtolower($booking['label']));
            $this->assertStringNotContainsString('hotel', strtolower($booking['label']));
        }
    }

    public function test_the_portal_says_the_amount_is_not_a_payment(): void
    {
        $hotel = Hotel::firstOrFail();
        $disclaimer = $this->getJson("/api/v1/partners/hotel/{$hotel->id}")
            ->assertOk()->json('disclaimer');

        $this->assertStringContainsString('not a settled payment', $disclaimer);
    }

    /* ------------------------------------------------------------------ */
    /* The marketplace's own numbers                                       */
    /* ------------------------------------------------------------------ */

    public function test_the_saas_summary_says_it_is_not_cash(): void
    {
        $summary = $this->getJson('/api/v1/saas/summary')->assertOk()->json();

        $this->assertStringContainsString('No payment has been recorded', $summary['basis']);
    }

    public function test_commission_and_payout_reconcile_to_gross(): void
    {
        $summary = $this->getJson('/api/v1/saas/summary')->assertOk()->json();

        // The identity that has to hold no matter what the rates are.
        $this->assertEqualsWithDelta(
            $summary['grossBookingSgd'],
            $summary['commissionSgd'] + $summary['supplierPayoutSgd'],
            0.05,
            'Commission plus payout must equal gross, or money is being invented.',
        );
    }

    public function test_a_draft_quote_is_not_revenue(): void
    {
        // Nothing is approved in a bare catalogue seed, so nothing counts.
        $this->assertSame(0, Quote::where('status', 'APPROVED')->count());

        $summary = $this->getJson('/api/v1/saas/summary')->assertOk()->json();

        $this->assertSame(0, $summary['approvedQuotes']);
        $this->assertEqualsWithDelta(0.0, $summary['grossBookingSgd'], 0.001);
        $this->assertEqualsWithDelta(0.0, $summary['commissionSgd'], 0.001);
    }

    public function test_coordination_is_ours_outright_and_a_ferry_is_mostly_not(): void
    {
        // The rate table encodes what our role is on each line. Coordination is
        // work MedBridge does; a ferry ticket is close to a pass-through.
        $this->assertSame(1.0, Commission::rateFor('ADMIN'));
        $this->assertLessThan(0.10, Commission::rateFor('FERRY'));
        $this->assertSame(0.0, Commission::rateFor('NOT_A_CATEGORY'));
    }

    /* ------------------------------------------------------------------ */
    /* Attribution, with a booking that actually exists                    */
    /* ------------------------------------------------------------------ */

    public function test_a_booking_lands_on_exactly_the_partners_that_supplied_it(): void
    {
        [$hotel, $hospital, $ferry] = $this->approvedBooking();

        $hotelLedger = $this->getJson("/api/v1/partners/hotel/{$hotel->id}")->assertOk()->json();
        $hospitalLedger = $this->getJson("/api/v1/partners/hospital/{$hospital->id}")->assertOk()->json();
        $ferryLedger = $this->getJson("/api/v1/partners/ferry/{$ferry->id}")->assertOk()->json();

        // Each partner sees its own single line…
        $this->assertSame(1, $hotelLedger['bookingCount']);
        $this->assertSame(1, $ferryLedger['bookingCount']);
        $this->assertSame(1, $hospitalLedger['bookingCount']);

        // …and the treatment is the hospital's, not the hotel's.
        $this->assertStringContainsString('Dental', $hospitalLedger['bookings'][0]['label']);
        $this->assertStringContainsString('night', strtolower($hotelLedger['bookings'][0]['label']));

        // The OTHER hotel supplied nothing and must show nothing.
        $otherHotel = Hotel::where('id', '!=', $hotel->id)->firstOrFail();
        $this->assertSame(
            0,
            $this->getJson("/api/v1/partners/hotel/{$otherHotel->id}")->assertOk()->json('bookingCount'),
            'A booking leaked onto a hotel that had nothing to do with it.',
        );

        // First name only — enough to expect someone at a desk.
        $this->assertSame('Siti', $hotelLedger['bookings'][0]['patientFirstName']);
    }

    public function test_the_partner_is_owed_the_line_minus_our_rate(): void
    {
        [$hotel] = $this->approvedBooking();

        $ledger = $this->getJson("/api/v1/partners/hotel/{$hotel->id}")->assertOk()->json();

        // Hotel line is 2 nights at S$100 = S$200, and our hotel rate is 8%.
        $this->assertEqualsWithDelta(200 * (1 - Commission::rateFor('HOTEL')), $ledger['supplierSgd'], 0.01);

        // And the marketplace booked the other 8% of it.
        $summary = $this->getJson('/api/v1/saas/summary')->assertOk()->json();
        $this->assertGreaterThan(0, $summary['commissionSgd']);
        $this->assertSame(1, $summary['approvedQuotes']);
        $this->assertSame(1, $summary['patients']);
    }

    /**
     * One approved quote: treatment at a hospital, two hotel nights, a ferry.
     *
     * Built directly rather than through the chat, because what is under test
     * is attribution of line items to partners — not the conversation that
     * produced them, which PatientChatTest already covers end to end.
     *
     * @return array{0: Hotel, 1: \App\Models\Hospital, 2: \App\Models\FerryRoute}
     */
    private function approvedBooking(): array
    {
        $hospital = \App\Models\Hospital::orderBy('name')->firstOrFail();
        $hotel = Hotel::orderBy('name')->firstOrFail();
        $ferry = \App\Models\FerryRoute::orderBy('operator')->firstOrFail();
        $procedure = \App\Models\Procedure::where('code', 'DEN-IMP-01')->firstOrFail();

        $patient = \App\Models\Patient::create([
            'full_name' => 'Siti Rahmawati',
            'phone_e164' => '+6591234412',
            'consent_given' => true,
        ]);

        $inquiry = Inquiry::create([
            'reference' => 'MBP-2026-9001',
            'patient_id' => $patient->id,
            'hospital_id' => $hospital->id,
            'procedure_id' => $procedure->id,
            'status' => 'CONFIRMED_BOOKING',
            'source_message' => 'Dental implant please.',
            'sla_due_at' => now()->addHours(2),
        ]);

        $quote = Quote::create([
            'inquiry_id' => $inquiry->id,
            'status' => 'APPROVED',
            'sg_benchmark_sgd' => 4800,
            'idr_per_sgd' => 12150,
            'approved_by_name' => 'Nadia Putri',
            'approved_at' => now(),
            'valid_until' => now()->addDays(14),
        ]);

        foreach ([
            ['category' => 'TREATMENT', 'label' => 'Dental Implant (single tooth)', 'quantity' => 1, 'unit_price_sgd' => 1450, 'ref_type' => 'procedure', 'ref_id' => $procedure->id],
            ['category' => 'HOTEL', 'label' => 'Recovery hotel · 2 nights', 'quantity' => 2, 'unit_price_sgd' => 100, 'ref_type' => 'hotel', 'ref_id' => $hotel->id],
            ['category' => 'FERRY', 'label' => 'Ferry crossing', 'quantity' => 1, 'unit_price_sgd' => 29, 'ref_type' => 'ferry', 'ref_id' => $ferry->id],
        ] as $index => $line) {
            $quote->lineItems()->create($line + ['sort_order' => $index]);
        }

        return [$hotel, $hospital, $ferry];
    }

    /**
     * A patient who has chosen a partner is visible to them immediately.
     *
     * This is the bug that made every partner portal read zero: the ledgers
     * counted approved quotes only, so a patient who had picked a hotel in the
     * chat and was sitting in hospital review was invisible to that hotel. The
     * partner could not hold the room, and the marketplace looked idle while it
     * was in fact busy.
     *
     * The fix is not to count drafts as revenue — it is to show them as
     * pending and owe nothing for them.
     */
    public function test_a_pending_booking_is_visible_but_not_owed(): void
    {
        [$hotel] = $this->pendingBooking();

        $ledger = $this->getJson("/api/v1/partners/hotel/{$hotel->id}")->assertOk()->json();

        // Visible…
        $this->assertSame(1, $ledger['bookingCount']);
        $this->assertSame(1, $ledger['pendingCount']);
        $this->assertSame('PENDING', $ledger['bookings'][0]['stage']);

        // …and owed nothing, while still showing what it would be worth.
        $this->assertEqualsWithDelta(0.0, $ledger['supplierSgd'], 0.001);
        $this->assertEqualsWithDelta(0.0, $ledger['bookings'][0]['supplierSgd'], 0.001);
        $this->assertGreaterThan(0, $ledger['pipelineSgd']);
        $this->assertGreaterThan(0, $ledger['bookings'][0]['expectedSgd']);

        // The disclaimer has to carry the distinction, not just the numbers.
        $this->assertStringContainsString('not owed to you yet', $ledger['disclaimer']);
    }

    public function test_a_pending_quote_is_pipeline_and_never_revenue(): void
    {
        $this->pendingBooking();

        $summary = $this->getJson('/api/v1/saas/summary')->assertOk()->json();

        // Reported, so the dashboard does not read "nothing is happening"…
        $this->assertSame(1, $summary['pendingQuotes']);
        $this->assertGreaterThan(0, $summary['pipelineGrossSgd']);
        $this->assertGreaterThan(0, $summary['pipelineCommissionSgd']);

        // …but strictly outside every earnings figure.
        $this->assertSame(0, $summary['approvedQuotes']);
        $this->assertEqualsWithDelta(0.0, $summary['grossBookingSgd'], 0.001);
        $this->assertEqualsWithDelta(0.0, $summary['commissionSgd'], 0.001);
    }

    /** The same booking as `approvedBooking()`, left in review. */
    private function pendingBooking(): array
    {
        [$hotel, $hospital, $ferry] = $this->approvedBooking();

        $quote = Quote::firstOrFail();
        $quote->update(['status' => 'DRAFT', 'approved_at' => null, 'approved_by_name' => null]);
        $quote->inquiry->update(['status' => 'HOSPITAL_REVIEW_REQUIRED']);

        return [$hotel, $hospital, $ferry];
    }

    /**
     * A hospital can withdraw a procedure, and we stop selling it.
     *
     * `hospital_procedure.available` is the only lever a facility has over what
     * MedBridge offers on its behalf — theatre closed, surgeon on leave, list
     * full. It was written by the seeder and read by nothing, so a hospital
     * could switch a procedure off and still be recommended for it.
     */
    public function test_a_hospital_can_withdraw_a_procedure_from_the_recommendation(): void
    {
        $procedure = \App\Models\Procedure::where('code', 'DEN-IMP-01')->firstOrFail();
        $builder = app(\App\Services\BundleBuilder::class);

        $before = $builder->hospitalsFor($procedure)->pluck('id')->all();
        $this->assertContains('e91437ac-05d6-4b28-a9f1-73c26b8e5904', $before, 'Elisabeth should offer dental.');

        \App\Models\HospitalProcedure::where('hospital_id', 'e91437ac-05d6-4b28-a9f1-73c26b8e5904')
            ->where('procedure_id', $procedure->id)
            ->update(['available' => false]);

        $after = $builder->hospitalsFor($procedure)->pluck('id')->all();
        $this->assertNotContains(
            'e91437ac-05d6-4b28-a9f1-73c26b8e5904',
            $after,
            'A withdrawn procedure is still being offered at that hospital.',
        );

        // The others are untouched — one facility withdrawing is not an outage.
        $this->assertNotEmpty($after);
    }

    /* ------------------------------------------------------------------ */
    /* Partner self-service                                                */
    /* ------------------------------------------------------------------ */

    /**
     * A hospital sets its own price, and it is the price we actually charge.
     *
     * This is the bug the split was meant to close. "Treatments & Pricing" in
     * the central portal edited `procedures.batam_price_sgd`, while
     * `HospitalProcedure::priceFor()` prefers the pivot row — so for every
     * facility that actually performs the procedure, saving a new price changed
     * nothing at all and said it had worked.
     */
    public function test_a_hospitals_price_edit_changes_what_it_actually_charges(): void
    {
        $hospital = \App\Models\Hospital::whereKey('e91437ac-05d6-4b28-a9f1-73c26b8e5904')->firstOrFail();
        $procedure = Procedure::where('code', 'DEN-IMP-01')->firstOrFail();

        $this->patchJson("/api/v1/partners/hospital/{$hospital->id}/procedures/{$procedure->id}", [
            'priceSgd' => 1610,
        ])->assertOk()->assertJsonPath('priceSgd', 1610);

        // The number the bundle is built from moved with it.
        $this->assertSame(1610.0, HospitalProcedure::priceFor($hospital->id, $procedure));

        // And nobody else's price moved.
        $this->assertSame(
            1668.0,
            HospitalProcedure::priceFor('c47a9e21-3b58-4d0f-9e63-8a15c7b04f2d', $procedure),
            'One hospital repricing changed another hospital.',
        );
    }

    public function test_a_hospital_can_switch_a_procedure_off_from_its_portal(): void
    {
        $hospital = \App\Models\Hospital::whereKey('e91437ac-05d6-4b28-a9f1-73c26b8e5904')->firstOrFail();
        $procedure = Procedure::where('code', 'DEN-IMP-01')->firstOrFail();

        $this->patchJson("/api/v1/partners/hospital/{$hospital->id}/procedures/{$procedure->id}", [
            'available' => false,
        ])->assertOk()->assertJsonPath('available', false);

        $offered = app(\App\Services\BundleBuilder::class)->hospitalsFor($procedure)->pluck('id')->all();
        $this->assertNotContains($hospital->id, $offered);
    }

    public function test_a_hospital_cannot_edit_another_hospitals_doctor(): void
    {
        // Elisabeth's id, with a doctor employed by RSBP.
        $elisabeth = 'e91437ac-05d6-4b28-a9f1-73c26b8e5904';
        $rsbpDoctor = Doctor::where('hospital_id', 'c47a9e21-3b58-4d0f-9e63-8a15c7b04f2d')->firstOrFail();
        $feeBefore = (float) $rsbpDoctor->consultation_fee_sgd;

        $this->patchJson("/api/v1/partners/hospital/{$elisabeth}/doctors/{$rsbpDoctor->id}", [
            'consultationFeeSgd' => 1,
        ])->assertNotFound();

        $this->assertSame($feeBefore, (float) $rsbpDoctor->fresh()->consultation_fee_sgd);
    }

    /**
     * Editing a shared field is allowed, and it is announced.
     *
     * The Singapore benchmark is the denominator of the savings figure the
     * whole product is sold on. Partner self-service means a facility can move
     * it, which makes itself look cheaper without changing a price any patient
     * pays — so the change lands in the audit feed, naming who did it.
     */
    public function test_editing_a_shared_field_is_written_to_the_audit_feed(): void
    {
        $hospital = \App\Models\Hospital::whereKey('e91437ac-05d6-4b28-a9f1-73c26b8e5904')->firstOrFail();
        $procedure = Procedure::where('code', 'DEN-IMP-01')->firstOrFail();

        $this->patchJson("/api/v1/partners/hospital/{$hospital->id}/procedures/{$procedure->id}", [
            'sgBenchmarkSgd' => 6400,
        ])->assertOk()->assertJsonPath('sgBenchmarkSgd', 6400);

        $event = \App\Models\ActivityEvent::where('type', 'CATALOGUE_UPDATED')->latest()->firstOrFail();

        $this->assertStringContainsString($hospital->name, $event->title);
        $this->assertSame(4800.0, (float) $event->payload['changed']['sgBenchmarkSgd']['from']);
        $this->assertSame(6400.0, (float) $event->payload['changed']['sgBenchmarkSgd']['to']);

        // It really is shared — the other facilities see the new benchmark too.
        $this->assertSame(6400.0, (float) $procedure->fresh()->sg_benchmark_sgd);
    }

    public function test_a_partner_price_edit_leaves_existing_quotes_alone(): void
    {
        [$hotel] = $this->approvedBooking();

        $before = $this->getJson("/api/v1/partners/hotel/{$hotel->id}")->assertOk()->json('supplierSgd');

        $this->patchJson("/api/v1/partners/hotel/{$hotel->id}/rate", ['nightlyRateSgd' => 999])
            ->assertOk();

        // Quotes already drafted keep the rate they were priced with (D8) —
        // the line item stores its own price and nothing reaches back for it.
        $after = $this->getJson("/api/v1/partners/hotel/{$hotel->id}")->assertOk()->json('supplierSgd');
        $this->assertEqualsWithDelta($before, $after, 0.01);
    }

    public function test_committed_is_reported_separately_from_approved(): void
    {
        $summary = $this->getJson('/api/v1/saas/summary')->assertOk()->json();

        // "Approved" is an offer; "committed" is a patient saying yes. The
        // dashboard has to be able to tell them apart, because only one of
        // them is close to being money.
        foreach (['approvedQuotes', 'committedQuotes', 'patients', 'committedPatients'] as $key) {
            $this->assertArrayHasKey($key, $summary);
        }

        $this->assertLessThanOrEqual($summary['approvedQuotes'], $summary['committedQuotes']);
        $this->assertLessThanOrEqual($summary['patients'], $summary['committedPatients']);
    }

    /* ------------------------------------------------------------------ */
    /* Clinical sign-off                                                   */
    /* ------------------------------------------------------------------ */

    /**
     * A case awaiting clinical sign-off, at a named hospital.
     *
     * @return array{0: \App\Models\Hospital, 1: Inquiry}
     */
    private function caseAwaitingSignOff(string $hospitalId = 'e91437ac-05d6-4b28-a9f1-73c26b8e5904'): array
    {
        $hospital = \App\Models\Hospital::whereKey($hospitalId)->firstOrFail();
        $procedure = Procedure::where('code', 'OPH-CAT-01')->firstOrFail();

        $patient = \App\Models\Patient::create([
            'full_name' => 'Aisyah Kamil',
            'phone_e164' => '+6591230000',
            'consent_given' => true,
        ]);

        $inquiry = Inquiry::create([
            'reference' => 'MBP-2026-9500',
            'patient_id' => $patient->id,
            'hospital_id' => $hospital->id,
            'procedure_id' => $procedure->id,
            'status' => 'DOCTOR_REVIEW_REQUIRED',
            'source_message' => 'Cataract surgery please.',
            'sla_due_at' => now()->addHours(2),
        ]);

        Quote::create([
            'inquiry_id' => $inquiry->id,
            'status' => 'DRAFT',
            'sg_benchmark_sgd' => 7180,
            'idr_per_sgd' => 12150,
            'valid_until' => now()->addDays(14),
        ])->lineItems()->create([
            'category' => 'TREATMENT',
            'label' => 'Cataract Surgery',
            'quantity' => 1,
            'unit_price_sgd' => 1850,
            'sort_order' => 0,
        ]);

        return [$hospital, $inquiry];
    }

    public function test_a_hospital_sees_only_its_own_cases_awaiting_sign_off(): void
    {
        [$hospital] = $this->caseAwaitingSignOff();
        $other = \App\Models\Hospital::whereKeyNot($hospital->id)->firstOrFail();

        $mine = $this->getJson("/api/v1/partners/hospital/{$hospital->id}/reviews")
            ->assertOk()->json('pending');
        $theirs = $this->getJson("/api/v1/partners/hospital/{$other->id}/reviews")
            ->assertOk()->json('pending');

        $this->assertCount(1, $mine);
        $this->assertSame('MBP-2026-9500', $mine[0]['reference']);
        $this->assertEmpty($theirs, "Another hospital can see this facility's caseload.");
    }

    public function test_the_review_queue_carries_no_uuid_and_no_contact_details(): void
    {
        [$hospital, $inquiry] = $this->caseAwaitingSignOff();

        $row = $this->getJson("/api/v1/partners/hospital/{$hospital->id}/reviews")
            ->assertOk()->json('pending.0');

        // First name only, and never our primary key.
        $this->assertSame('Aisyah', $row['patientFirstName']);
        $this->assertArrayNotHasKey('id', $row);
        $this->assertArrayNotHasKey('inquiryId', $row);
        $this->assertArrayNotHasKey('patientId', $row);

        $encoded = json_encode($row);
        $this->assertStringNotContainsString($inquiry->id, $encoded);
        $this->assertStringNotContainsString('+6591230000', $encoded);
        $this->assertStringNotContainsString('Kamil', $encoded);
    }

    public function test_a_hospital_cannot_sign_off_another_hospitals_case(): void
    {
        [$hospital, $inquiry] = $this->caseAwaitingSignOff();
        $other = \App\Models\Hospital::whereKeyNot($hospital->id)->firstOrFail();

        $this->postJson("/api/v1/partners/hospital/{$other->id}/reviews/{$inquiry->reference}", [
            'decision' => 'CLEARED',
            'clinicalNotes' => 'Looks fine to me.',
        ])->assertNotFound();

        $this->assertSame('DOCTOR_REVIEW_REQUIRED', $inquiry->fresh()->status);
    }

    public function test_a_hospital_cannot_name_another_hospitals_doctor(): void
    {
        [$hospital, $inquiry] = $this->caseAwaitingSignOff();
        $foreign = Doctor::where('hospital_id', '!=', $hospital->id)->firstOrFail();

        $this->postJson("/api/v1/partners/hospital/{$hospital->id}/reviews/{$inquiry->reference}", [
            'decision' => 'CLEARED',
            'clinicalNotes' => 'Suitable for day surgery.',
            'doctorId' => $foreign->id,
        ])->assertStatus(422);
    }

    /**
     * The whole point of the move: sign-off unblocks approval, and nothing else.
     */
    public function test_clearing_a_case_unblocks_approval_without_performing_it(): void
    {
        [$hospital, $inquiry] = $this->caseAwaitingSignOff();
        $quote = $inquiry->quote()->firstOrFail();

        // Blocked before the hospital has looked at it.
        $this->postJson("/api/v1/inquiries/{$inquiry->id}/quote/approve", ['approvedByName' => 'Nadia Putri'])
            ->assertStatus(409);

        $this->postJson("/api/v1/partners/hospital/{$hospital->id}/reviews/{$inquiry->reference}", [
            'decision' => 'CLEARED',
            'clinicalNotes' => 'Fit for day surgery. No contraindications.',
        ])->assertOk()->assertJsonPath('status', 'HOSPITAL_REVIEW_REQUIRED');

        // Cleared clinically — but still no patient link until operations act.
        $this->assertSame('HOSPITAL_REVIEW_REQUIRED', $inquiry->fresh()->status);
        $this->assertSame('DRAFT', $quote->fresh()->status);
        $this->assertNull($inquiry->fresh()->itinerary_token);

        $this->postJson("/api/v1/inquiries/{$inquiry->id}/quote/approve", ['approvedByName' => 'Nadia Putri'])
            ->assertOk();

        $this->assertSame('APPROVED', $quote->fresh()->status);
    }

    public function test_a_declined_case_escalates_and_stays_unapprovable(): void
    {
        [$hospital, $inquiry] = $this->caseAwaitingSignOff();

        $this->postJson("/api/v1/partners/hospital/{$hospital->id}/reviews/{$inquiry->reference}", [
            'decision' => 'DECLINED',
            'clinicalNotes' => 'Uncontrolled hypertension — not suitable for travel.',
        ])->assertOk();

        $this->assertSame('HUMAN_TAKEOVER', $inquiry->fresh()->status);
        $this->assertNull($inquiry->fresh()->itinerary_token);
    }

    public function test_a_consult_request_holds_the_case_where_it_is(): void
    {
        [$hospital, $inquiry] = $this->caseAwaitingSignOff();

        $this->postJson("/api/v1/partners/hospital/{$hospital->id}/reviews/{$inquiry->reference}", [
            'decision' => 'NEEDS_CONSULT',
            'clinicalNotes' => 'Request recent HbA1c before scheduling.',
            'requiredPreOpTests' => ['HbA1c', 'ECG'],
        ])->assertOk();

        // Still the hospital's to decide, and still not quotable.
        $this->assertSame('DOCTOR_REVIEW_REQUIRED', $inquiry->fresh()->status);
        $this->postJson("/api/v1/inquiries/{$inquiry->id}/quote/approve", ['approvedByName' => 'Nadia Putri'])
            ->assertStatus(409);
    }

    /**
     * Operations no longer has a route to clear a case on the hospital's behalf.
     *
     * Leaving the old unscoped endpoint in place would have made the move
     * cosmetic: the ops UI would be gone while any caller could still sign off
     * any case at any facility.
     */
    public function test_operations_can_no_longer_clear_a_case_itself(): void
    {
        [, $inquiry] = $this->caseAwaitingSignOff();

        $this->postJson("/api/v1/inquiries/{$inquiry->id}/doctor-review", [
            'decision' => 'CLEARED',
            'clinicalNotes' => 'Cleared by operations.',
        ])->assertNotFound();

        $this->assertSame('DOCTOR_REVIEW_REQUIRED', $inquiry->fresh()->status);
    }

    public function test_a_clinical_decision_requires_notes(): void
    {
        [$hospital, $inquiry] = $this->caseAwaitingSignOff();

        $this->postJson("/api/v1/partners/hospital/{$hospital->id}/reviews/{$inquiry->reference}", [
            'decision' => 'CLEARED',
        ])->assertStatus(422);

        $this->assertSame('DOCTOR_REVIEW_REQUIRED', $inquiry->fresh()->status);
    }
}
