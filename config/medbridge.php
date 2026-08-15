<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Hermes — the AI agent
    |--------------------------------------------------------------------------
    |
    | Hermes is a ROLE, not a model. It runs entirely server-side: the browser
    | bundle has no model SDK, no provider endpoint and no key. Hermes is only
    | ever asked to return structured JSON — slot values and a confidence score.
    | It never authors a sentence the patient reads, and it never emits a UUID
    | (it returns catalogue *codes*, which PHP resolves to keys).
    |
    | The backing provider is env-only. Any OpenAI-compatible /chat/completions
    | endpoint works; today that is Google Gemini, whose compatibility layer
    | lives at generativelanguage.googleapis.com/v1beta/openai. OpenRouter is a
    | one-line swap back (base_url + model + key) if the free quota runs out.
    |
    */

    'hermes' => [
        'enabled' => env('HERMES_ENABLED', true),

        'base_url' => env('HERMES_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai'),
        'api_key' => env('HERMES_API_KEY'),

        // Chosen on measured latency — the visitor waits on this call. See .env.
        'model' => env('HERMES_MODEL', 'gemini-3.5-flash'),
        'fallback_model' => env('HERMES_FALLBACK_MODEL', 'gemini-3.5-flash-lite'),

        'context_length' => (int) env('HERMES_CONTEXT_LENGTH', 65536),

        // Gemini 2.5 models think before they answer, and those thinking tokens
        // are billed against max_tokens. A budget sized for the JSON alone gets
        // spent on reasoning and returns an empty message — which reads exactly
        // like a broken model. Leave headroom.
        'max_tokens' => (int) env('HERMES_MAX_TOKENS', 2048),
        'temperature' => (float) env('HERMES_TEMPERATURE', 0.1),
        'timeout' => (int) env('HERMES_TIMEOUT', 25),

        // Optional, Gemini only: "none" | "low" | "medium" | "high". Sent only
        // when set, because providers that do not know the field reject it.
        'reasoning_effort' => env('HERMES_REASONING_EFFORT') ?: null,

        // OpenRouter attribution headers (optional, improves rate limits).
        // Ignored unless base_url points at OpenRouter.
        'referer' => env('HERMES_REFERER', env('APP_URL', 'http://medbridge.test')),
        'title' => env('HERMES_TITLE', 'MedBridge Pass'),

        // Persist the verbatim provider response for audit. Server-side only —
        // it is never serialised into any API response. See docs/01 rule 5.
        'log_raw_response' => env('HERMES_LOG_RAW', true),
    ],

    /*
    |--------------------------------------------------------------------------
    | Human-in-the-loop gate
    |--------------------------------------------------------------------------
    |
    | Mirrors evaluateReviewGate() in web/src/mock/generators.ts. The backend is
    | authoritative; the frontend copy exists only for the offline mock.
    |
    | confidence_threshold and require_doctor_review_for_high_risk are tunable.
    | Emergency language, unknown procedures and the human-approval requirement
    | are NOT — a setting that can be turned off will be turned off. See D7.
    |
    */

    'gate' => [
        'confidence_threshold' => (float) env('MEDBRIDGE_CONFIDENCE_THRESHOLD', 0.75),
        'require_doctor_review_for_high_risk' => (bool) env('MEDBRIDGE_HIGH_RISK_REVIEW', true),

        // A computed bundle outside this band of the Singapore benchmark
        // escalates as PRICE_OUT_OF_BAND.
        'price_band_min_pct' => 0.05,
        'price_band_max_pct' => 0.95,
    ],

    'emergency_keywords' => [
        'emergency',
        'chest pain',
        'bleeding',
        'unconscious',
        'stroke',
        'accident',
        'severe pain',
        'cannot breathe',
        "can't breathe",
        'ambulance',
        'urgent surgery',
    ],

    /*
    |--------------------------------------------------------------------------
    | Pricing
    |--------------------------------------------------------------------------
    */

    'pricing' => [
        'idr_per_sgd' => (float) env('MEDBRIDGE_IDR_PER_SGD', 12150),
        'coordination_fee_sgd' => (float) env('MEDBRIDGE_COORDINATION_FEE', 35),

        // The Singapore benchmark basket is treatment + a specialist consult.
        // It deliberately EXCLUDES travel and hotel: a Singapore patient treated
        // locally would not incur them, and including them would inflate the
        // savings headline. See docs/09 D9.
        'sg_consult_benchmark_sgd' => (float) env('MEDBRIDGE_SG_CONSULT_BENCHMARK', 180),

        'quote_valid_days' => 14,
    ],

    /*
    |--------------------------------------------------------------------------
    | Commission — what MedBridge earns on a bundle
    |--------------------------------------------------------------------------
    |
    | MedBridge is a marketplace: the patient pays for a trip, the suppliers are
    | paid for their part of it, and MedBridge takes a rate on each line.
    |
    | THIS IS A RATE ON A QUOTE, NOT A PAYMENT RECORD. There is no payments
    | table, no settlement and no reconciliation in this system yet, so every
    | figure derived from these rates is an ENTITLEMENT — what we would earn if
    | the trip is taken — and the SaaS dashboard has to say so rather than
    | implying money has moved.
    |
    | The rate differs by line because our role differs by line. Coordination is
    | ours outright: it is the fee for the work MedBridge itself does, so it is
    | not a cut of somebody else's revenue. Ferries take the smallest rate
    | because a ticket is close to a pass-through and the operator sets a public
    | fare we cannot mark up far.
    |
    | Changing a rate changes NEW reporting only — it is applied to line items at
    | read time and nothing is written back, so a historical quote's own prices
    | are never touched (docs/09 D8).
    |
    */

    'commission' => [
        'take_rate' => [
            'TREATMENT' => (float) env('MEDBRIDGE_TAKE_TREATMENT', 0.12),
            'DOCTOR_FEE' => (float) env('MEDBRIDGE_TAKE_DOCTOR', 0.10),
            'HOTEL' => (float) env('MEDBRIDGE_TAKE_HOTEL', 0.08),
            'FERRY' => (float) env('MEDBRIDGE_TAKE_FERRY', 0.05),
            'TRANSPORT' => (float) env('MEDBRIDGE_TAKE_TRANSPORT', 0.08),
            // Our own fee, not a cut of a supplier's line.
            'ADMIN' => (float) env('MEDBRIDGE_TAKE_ADMIN', 1.00),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Operations
    |--------------------------------------------------------------------------
    */

    'sla_minutes' => (int) env('MEDBRIDGE_SLA_MINUTES', 90),

    // Public chat sessions are anonymous and hold no PII until the visitor
    // submits. They expire so abandoned drafts do not accumulate.
    'chat_session_ttl_hours' => (int) env('MEDBRIDGE_CHAT_TTL_HOURS', 48),

    // Itinerary tokens minted by human approval.
    'itinerary_token_ttl_days' => (int) env('MEDBRIDGE_TOKEN_TTL_DAYS', 30),

    'support_phone' => env('MEDBRIDGE_SUPPORT_PHONE', '+65 6000 0000'),

    /*
    |--------------------------------------------------------------------------
    | Emergency numbers surfaced when the gate detects acute language
    |--------------------------------------------------------------------------
    */

    'emergency_contacts' => [
        'sg_ambulance' => '995',
        'sg_non_emergency' => '1777',
    ],
];
