<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * MedBridge Pass — full schema.
 *
 * KEY RULE: every primary key and every foreign key is a UUID v4, generated in
 * PHP by App\Models\Concerns\HasUuidV4 (Str::uuid() → strict v4). There are no
 * auto-incrementing integer keys anywhere in this system.
 *
 * Two identifiers are deliberately NOT UUIDs:
 *   - inquiries.reference       MBP-2026-0001, a human-readable label, never a key
 *   - inquiries.itinerary_token mbp_…, opaque, so a leaked patient link cannot be
 *                               replayed against the API as a database key
 *
 * Written with the portable schema builder so it runs on MySQL/MariaDB locally
 * and on the documented Postgres target unchanged.
 */
return new class extends Migration
{
    public function up(): void
    {
        /* ---------------------------------------------------------------- */
        /* Catalogue                                                        */
        /* ---------------------------------------------------------------- */

        Schema::create('hospitals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');
            $table->string('district');
            $table->string('address');
            $table->string('accreditation');
            /*
             * There is no `rating` and no `review_count`, on this table or on
             * `doctors`. There used to be: 4.8 with 1,284 reviews, attached to
             * a real, named, findable hospital — and nobody had counted a
             * single one of them. The seeder called them "indicative fixtures",
             * which is a soft word for a review score we invented about a place
             * where people have surgery.
             *
             * It was not decoration either. `orderByDesc('rating')` chose the
             * default facility, and the patient chat drew a gold star next to
             * it, so an invented number was ranking the hospitals someone
             * picked between. Ordering is by procedure price then name now —
             * facts we hold — and the rating question goes to `searchUrl`,
             * where Google answers it with real reviews. Same rule as hotels
             * and places: link to it, never mirror it. D24.
             */
            $table->json('specialties');
            $table->unsignedSmallInteger('minutes_from_terminal');
            $table->string('nearest_terminal');
            // Where it actually is. Every distance in this system is computed
            // from a pair of these at read time — see App\Support\Geo.
            $table->decimal('latitude', 9, 6)->nullable();
            $table->decimal('longitude', 9, 6)->nullable();
            /*
             * There is no google_place_id column, and no Google Maps URL
             * anywhere in this system. Outbound links are a Google SEARCH by
             * name — a coordinate pin drops the patient wherever our centroid
             * says, and a centroid two hundred metres out lands them in the
             * car park next door. Names are robust; pins are brittle. D24.
             */
            /*
             * WHERE THIS ROW CAME FROM. `node/736609690`, an OpenStreetMap
             * element anyone can open and check.
             *
             * This column exists because the first version of this catalogue
             * contained businesses that do not exist — plausible Indonesian
             * names at plausible-looking coordinates that landed in the middle
             * of an industrial estate. "Approximate" was the wrong word for
             * it; the word was invented.
             *
             * A row without provenance is a row someone made up, so the seeder
             * asserts every one of them has it. See docs/09 D26.
             */
            $table->string('osm_ref')->nullable();
            $table->timestamps();
        });

        Schema::create('doctors', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('hospital_id');
            $table->string('full_name');
            $table->string('specialty');
            $table->string('qualifications');
            $table->unsignedSmallInteger('years_experience')->default(0);
            $table->json('languages');
            $table->decimal('consultation_fee_sgd', 10, 2);
            // No `rating` here either — see the note on `hospitals`. A
            // specialist is ordered by whether they are qualified for the
            // procedure, then by experience, then by name.
            $table->timestamps();

            $table->foreign('hospital_id')->references('id')->on('hospitals');
        });

        Schema::create('procedures', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code')->unique();
            $table->string('name');
            $table->string('category');
            $table->text('description');
            $table->decimal('sg_benchmark_sgd', 10, 2);
            $table->decimal('batam_price_sgd', 10, 2);
            $table->unsignedSmallInteger('treatment_days');
            $table->unsignedSmallInteger('recovery_nights');
            // Drives the clinical gate: these always escalate to a doctor.
            $table->boolean('requires_doctor_review')->default(false);
            // Free-text aliases Hermes and the keyword matcher can map onto.
            $table->json('synonyms')->nullable();
            /*
             * What this patient's body will and will not be up to afterwards.
             *
             * Shape: { avoid_categories: [], avoid_tags: [], prefer_tags: [],
             *          note: "" }
             *
             * It filters the "while you're there" suggestions — no beach day
             * after cataract surgery, no chilli crab after a gastroscopy. It is
             * DATA rather than a match arm in PHP because the clinical judgement
             * belongs to whoever curates the catalogue, and because a new
             * procedure must not need a deploy to be safe.
             *
             * It is travel filtering, not medical advice, and the panel says so.
             */
            $table->json('recovery_profile')->nullable();
            $table->timestamps();
        });

        /*
         * Which hospitals perform which procedure, and for how much.
         *
         * A procedure's price is not a global fact — a flagship facility and a
         * district hospital charge differently for the same implant. This table
         * is what makes "choose your hospital" a real decision for the patient
         * rather than a cosmetic one, and it is the reason the patient picks the
         * hospital instead of us picking it for them.
         *
         * A procedure with no rows here falls back to procedures.batam_price_sgd
         * at every hospital that lists the matching specialty.
         */
        Schema::create('hospital_procedure', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('hospital_id');
            $table->uuid('procedure_id');
            $table->decimal('price_sgd', 10, 2);
            $table->boolean('available')->default(true);
            $table->timestamps();

            $table->foreign('hospital_id')->references('id')->on('hospitals')->cascadeOnDelete();
            $table->foreign('procedure_id')->references('id')->on('procedures')->cascadeOnDelete();
            $table->unique(['hospital_id', 'procedure_id']);
        });

        Schema::create('ferry_routes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('operator');
            $table->string('direction'); // SG_TO_BATAM | BATAM_TO_SG
            $table->string('depart_terminal');
            $table->string('arrive_terminal');
            $table->string('departure_time', 5);
            $table->string('arrival_time', 5);
            $table->unsignedSmallInteger('duration_minutes');
            $table->decimal('price_sgd', 10, 2);
            $table->timestamps();
        });

        /*
         * Recovery hotels.
         *
         * There is deliberately NO distance_to_hospital_km column. There used to
         * be, and it was wrong the moment the patient could choose between three
         * hospitals: one scalar cannot describe a hotel's distance to whichever
         * facility they picked, so every option showed the same number whatever
         * they chose. Coordinates + haversine at read time is the fix.
         */
        Schema::create('hotels', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');
            $table->string('district');
            $table->unsignedTinyInteger('star_rating');
            $table->decimal('nightly_rate_sgd', 10, 2);
            $table->decimal('latitude', 9, 6)->nullable();
            $table->decimal('longitude', 9, 6)->nullable();
            // OpenStreetMap element this row was verified against. See hospitals.
            $table->string('osm_ref')->nullable();
            $table->json('amenities');
            $table->boolean('medical_recovery_certified')->default(false);
            $table->timestamps();
        });

        /*
         * Places worth knowing about while you are there — restaurants,
         * beaches, parks, malls, attractions.
         *
         * THESE ARE NOT QUOTE LINES. Nothing in this table is priced, bundled,
         * or counted towards the Singapore savings comparison (D9). A place has
         * a `price_level` band the way a guidebook does, not a `price_sgd`, and
         * that is on purpose: the moment a beach has a number next to it,
         * someone will add it to a total.
         *
         * `tags` is the vocabulary the recovery filter matches on — dietary
         * (halal, vegetarian, soft-diet, spicy), access (wheelchair-accessible,
         * step-free), and exposure (quiet, strenuous, sun-exposed, indoor).
         */
        Schema::create('places', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');
            // RESTAURANT | BEACH | PARK | MALL | ATTRACTION | FESTIVAL
            $table->string('category');
            $table->string('district');
            $table->text('description');
            $table->decimal('latitude', 9, 6)->nullable();
            $table->decimal('longitude', 9, 6)->nullable();
            // OpenStreetMap element this row was verified against. See hospitals.
            // Every seeded place has one — that is what stops this table
            // refilling with convincing fiction.
            $table->string('osm_ref')->nullable();
            /*
             * Where the RECOMMENDATION came from, when a published guide named
             * the place — a Batam food guide, a ferry operator's blog, a travel
             * write-up.
             *
             * Distinct from osm_ref, which only says where the COORDINATE came
             * from. OSM proves a place exists; it says nothing about whether it
             * is worth suggesting to a patient. Where both are present the row
             * is as grounded as this catalogue gets.
             */
            $table->string('guide_url')->nullable();
            // 0 free · 1 inexpensive · 2 moderate · 3 pricey · 4 splurge.
            // A band, never a quoted amount.
            $table->unsignedTinyInteger('price_level')->default(0);
            $table->json('tags');
            $table->timestamps();

            $table->index('category');
        });

        Schema::create('ground_transport', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('type');
            $table->string('provider');
            $table->text('description');
            $table->decimal('price_sgd', 10, 2);
            $table->unsignedSmallInteger('capacity');
            $table->timestamps();
        });

        /* ---------------------------------------------------------------- */
        /* People                                                           */
        /* ---------------------------------------------------------------- */

        Schema::create('staff', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('hospital_id')->nullable();
            $table->string('full_name');
            $table->string('role')->default('OPERATIONS');
            $table->timestamps();
        });

        Schema::create('patients', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('full_name');
            // Raw contact details. NEVER serialised to the client — the API
            // emits phone_masked / email_masked, computed at the serializer.
            $table->string('phone_e164')->nullable();
            $table->string('email')->nullable();
            $table->char('country_code', 2)->default('SG');
            $table->unsignedSmallInteger('year_of_birth')->nullable();
            $table->char('gender', 1)->default('U');
            $table->string('preferred_channel')->default('WEB');
            $table->string('preferred_language')->default('English');
            // PDPA: consent captured at first contact, with what they agreed to.
            $table->boolean('consent_given')->default(false);
            $table->dateTime('consent_at')->nullable();
            $table->timestamps();
        });

        /* ---------------------------------------------------------------- */
        /* Public chat — anonymous until the visitor submits                 */
        /* ---------------------------------------------------------------- */

        Schema::create('chat_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // Opaque, non-UUID, like the itinerary token: it lives in a browser
            // and must not double as a database key.
            $table->string('token')->unique();
            // Slot-filling state: procedure_code, travel_date, party_size, …
            $table->json('slots');
            // The draft bundle the visitor is shaping (line items + flags).
            $table->json('draft_lines')->nullable();
            $table->string('stage')->default('COLLECTING'); // COLLECTING|RECOMMENDED|SUBMITTED|EMERGENCY
            // Highest-confidence extraction seen so far, for the audit trail.
            $table->decimal('confidence', 4, 3)->default(0);
            $table->boolean('emergency_detected')->default(false);
            $table->string('ip_hash', 64)->nullable();
            // Set only once the visitor submits. NULL means zero PII on file.
            $table->uuid('patient_id')->nullable();
            $table->uuid('inquiry_id')->nullable();
            $table->dateTime('expires_at');
            $table->timestamps();

            $table->index('expires_at');
        });

        Schema::create('chat_messages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('chat_session_id');
            // PATIENT = typed by the visitor. SYSTEM = written by MedBridge from
            // a fixed question bank. Hermes never authors a body on this table.
            $table->string('role');
            $table->text('body');
            // Structured attachment the UI renders (chips, date picker, bundle).
            $table->json('ui')->nullable();
            // Transcript order. created_at has second precision, and a turn
            // writes the visitor's echo and our reply in the same second — so
            // ordering by time alone shuffles the conversation. An explicit
            // ordinal (like quote_line_items.sort_order) fixes it. It is a sort
            // column, not a key: the key is still the UUID.
            $table->unsignedInteger('sequence')->default(0);
            $table->timestamps();

            $table->foreign('chat_session_id')->references('id')->on('chat_sessions')->cascadeOnDelete();
            $table->index(['chat_session_id', 'sequence']);
        });

        /* ---------------------------------------------------------------- */
        /* Pipeline                                                          */
        /* ---------------------------------------------------------------- */

        Schema::create('inquiries', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('reference')->unique();       // MBP-2026-0001, not a key
            $table->uuid('patient_id');
            $table->uuid('hospital_id');
            $table->uuid('doctor_id')->nullable();
            $table->uuid('procedure_id')->nullable();
            $table->string('status')->default('NEW_INQUIRY');
            $table->string('priority')->default('NORMAL');
            $table->string('channel')->default('WEB');
            $table->text('source_message');
            $table->uuid('assigned_to')->nullable();
            $table->string('assigned_to_name')->nullable();
            $table->string('itinerary_token')->nullable()->unique(); // opaque, NOT the row id
            $table->dateTime('token_expires_at')->nullable();
            $table->dateTime('sla_due_at');
            $table->timestamps();

            $table->foreign('patient_id')->references('id')->on('patients');
            $table->foreign('hospital_id')->references('id')->on('hospitals');
            $table->foreign('doctor_id')->references('id')->on('doctors');
            $table->foreign('procedure_id')->references('id')->on('procedures');

            $table->index('status');
            $table->index('patient_id');
        });

        Schema::create('ai_extractions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('inquiry_id');
            // Sanitised one-line restatement produced by business logic — this
            // is NOT a passthrough of the model response.
            $table->text('intent_summary');
            $table->uuid('procedure_id')->nullable();
            $table->string('procedure_label')->default('Unmapped request');
            $table->decimal('confidence', 4, 3);
            $table->string('urgency')->default('NORMAL');
            $table->unsignedSmallInteger('travel_party_size')->default(1);
            $table->string('preferred_window')->default('');
            $table->json('symptom_keywords');
            $table->json('extracted_entities');
            // Persist the DECISION, not just the inputs …
            $table->boolean('requires_human_review');
            $table->json('review_reasons');
            // … and the threshold it was taken against, so "why was this
            // auto-quoted six months ago" never depends on today's setting.
            $table->decimal('threshold_applied', 4, 3);
            $table->string('model_version');
            $table->unsignedInteger('latency_ms')->default(0);
            // Verbatim provider response, for audit. Server-side only.
            $table->longText('raw_response')->nullable();
            $table->timestamps();

            $table->foreign('inquiry_id')->references('id')->on('inquiries')->cascadeOnDelete();
            $table->foreign('procedure_id')->references('id')->on('procedures');
        });

        Schema::create('quotes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('inquiry_id');
            $table->string('status')->default('DRAFT');
            $table->decimal('sg_benchmark_sgd', 12, 2);
            // Rate AT QUOTE TIME, so a historical quote reprices identically.
            $table->decimal('idr_per_sgd', 12, 2);
            $table->uuid('approved_by')->nullable();
            $table->string('approved_by_name')->nullable();
            $table->dateTime('approved_at')->nullable();
            $table->dateTime('valid_until');
            $table->text('notes')->default('');
            $table->timestamps();

            $table->foreign('inquiry_id')->references('id')->on('inquiries')->cascadeOnDelete();
        });

        Schema::create('quote_line_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('quote_id');
            $table->string('category');
            $table->string('label');
            $table->string('detail')->default('');
            $table->unsignedInteger('quantity');
            $table->decimal('unit_price_sgd', 10, 2);
            // Points at the catalogue row this line was priced from.
            $table->string('ref_type')->nullable();
            $table->uuid('ref_id')->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            // No subtotal column on purpose: it is quantity × unit_price_sgd.
            // Denormalising it guarantees the two eventually drift.

            $table->foreign('quote_id')->references('id')->on('quotes')->cascadeOnDelete();
        });

        Schema::create('doctor_reviews', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('inquiry_id');
            $table->uuid('doctor_id')->nullable();
            $table->string('decision')->default('PENDING');
            $table->text('clinical_notes')->default('');
            $table->json('required_pre_op_tests');
            $table->dateTime('reviewed_at')->nullable();
            $table->timestamps();

            $table->foreign('inquiry_id')->references('id')->on('inquiries')->cascadeOnDelete();
            $table->foreign('doctor_id')->references('id')->on('doctors');
        });

        /* ---------------------------------------------------------------- */
        /* Audit + messaging                                                 */
        /* ---------------------------------------------------------------- */

        Schema::create('activity_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('inquiry_id')->nullable();
            $table->string('inquiry_reference')->nullable();
            $table->string('type');
            $table->string('actor');
            $table->string('level')->default('info');
            $table->string('title');
            $table->text('description');
            // Structured backend facts only — model version, confidence, entity
            // map, timings. Never model output.
            $table->json('payload');
            $table->unsignedInteger('duration_ms')->nullable();
            // Microsecond precision. A single submission writes six events
            // inside one request, and at second resolution the audit feed
            // renders them in arbitrary order — which is worse than useless in
            // a log whose whole job is establishing what happened when.
            // App\Models\ActivityEvent sets $dateFormat to match.
            $table->timestamps(6);

            $table->foreign('inquiry_id')->references('id')->on('inquiries')->cascadeOnDelete();
            $table->index('created_at');
        });

        Schema::create('message_threads', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('patient_id');
            $table->uuid('inquiry_id')->nullable();
            $table->string('channel')->default('WEB');
            $table->string('subject');
            $table->unsignedInteger('unread_count')->default(0);
            $table->dateTime('last_message_at');
            $table->timestamps();

            $table->foreign('patient_id')->references('id')->on('patients');
            $table->foreign('inquiry_id')->references('id')->on('inquiries')->nullOnDelete();
        });

        Schema::create('messages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('thread_id');
            $table->uuid('inquiry_id')->nullable();
            $table->string('channel')->default('WEB');
            $table->string('direction');
            $table->text('body');
            $table->string('sender_name');
            $table->string('status')->default('RECEIVED');
            // A DRAFT for a human to review, edit or discard. The dispatcher
            // must never read this column.
            $table->text('ai_suggestion')->nullable();
            $table->decimal('ai_suggestion_confidence', 4, 3)->nullable();
            $table->timestamps();

            $table->foreign('thread_id')->references('id')->on('message_threads')->cascadeOnDelete();
            $table->index(['thread_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
        Schema::dropIfExists('message_threads');
        Schema::dropIfExists('activity_events');
        Schema::dropIfExists('doctor_reviews');
        Schema::dropIfExists('quote_line_items');
        Schema::dropIfExists('quotes');
        Schema::dropIfExists('ai_extractions');
        Schema::dropIfExists('inquiries');
        Schema::dropIfExists('chat_messages');
        Schema::dropIfExists('chat_sessions');
        Schema::dropIfExists('patients');
        Schema::dropIfExists('staff');
        Schema::dropIfExists('ground_transport');
        Schema::dropIfExists('places');
        Schema::dropIfExists('hotels');
        Schema::dropIfExists('ferry_routes');
        Schema::dropIfExists('hospital_procedure');
        Schema::dropIfExists('procedures');
        Schema::dropIfExists('doctors');
        Schema::dropIfExists('hospitals');
    }
};
