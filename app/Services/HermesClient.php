<?php

namespace App\Services;

use App\Models\Procedure;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Hermes — the MedBridge AI agent.
 *
 * Hermes is a ROLE. Today it is backed by Google Gemini through its
 * OpenAI-compatible chat-completions endpoint; the role is what the rest of the
 * system depends on, not the provider or the model id. Any OpenAI-compatible
 * endpoint (OpenRouter, a local server) is a base_url + model + key change in
 * .env, with no code edit here.
 *
 * Its entire job is INTENT EXTRACTION: turn a sentence a visitor typed into
 * structured slot values plus a confidence score. It does not diagnose, does
 * not price, does not decide, and — critically — never writes a word the
 * visitor reads. The question bank in ChatOrchestrator owns all patient-facing
 * prose (docs/01 rule 5).
 *
 * Two invariants worth stating plainly, because breaking either is silent:
 *
 *  1. Hermes NEVER emits a UUID. It returns catalogue *codes* (DEN-IMP-01) and
 *     PHP resolves them to keys. A model asked for a UUID will happily invent a
 *     well-formed one, and since every foreign key in this system is a UUID,
 *     a hallucinated key is a broken reference that looks completely valid.
 *
 *  2. Failure is never fatal to the visitor. Rate limits, timeouts, malformed
 *     JSON and a missing API key all degrade to confidence 0.0 with no
 *     procedure matched — which the gate reads as UNKNOWN_PROCEDURE and routes
 *     to a human. A dead model must degrade to "a person handles it", never to
 *     a dropped patient.
 */
class HermesClient
{
    /**
     * What each slot's question is asking for, in words the model can bind a
     * bare answer to.
     *
     * This is EXTRACTION CONTEXT, not patient-facing prose — none of it is ever
     * rendered. The question bank in ChatOrchestrator still owns every sentence
     * the visitor reads (rule 6).
     */
    private const PENDING_SLOT_HINT = [
        'procedure_code' => 'which treatment they are looking for',
        'travel_date' => 'when they would like to travel',
        'party_size' => 'how many people are travelling in total, including the patient',
        'budget_sgd' => 'roughly what they want to keep the whole trip under, in Singapore dollars',
        'hotel_nights' => 'how many nights they want to stay in Batam, where 0 means a day trip',
    ];

    /**
     * Extract slot values from one visitor message.
     *
     * @param  array<string,mixed>  $currentSlots  what is already known
     * @param  string|null  $pendingSlot  the slot the assistant just asked about
     * @return array<string,mixed>
     */
    public function extract(string $message, array $currentSlots = [], ?string $pendingSlot = null): array
    {
        $started = microtime(true);
        $procedures = Procedure::orderBy('name')->get();

        if (! config('medbridge.hermes.enabled') || ! config('medbridge.hermes.api_key')) {
            return $this->keywordFallback($message, $procedures, $started, 'no-credentials', $pendingSlot);
        }

        foreach ($this->modelChain() as $model) {
            $response = $this->callModel($model, $message, $currentSlots, $procedures, $pendingSlot);

            if ($response !== null) {
                $parsed = $this->parseResponse($response['content'], $procedures);

                if ($parsed !== null) {
                    return array_merge($parsed, [
                        'model_version' => $model,
                        'latency_ms' => (int) round((microtime(true) - $started) * 1000),
                        'raw' => config('medbridge.hermes.log_raw_response') ? $response['content'] : null,
                        'source' => 'model',
                    ]);
                }

                // Reached the model but could not read the answer. Free-tier
                // open models do not reliably honour a JSON schema, so this is
                // an expected path, not an exception — try the next model.
                Log::warning('[Hermes] unparseable response', [
                    'model' => $model,
                    'excerpt' => mb_substr($response['content'], 0, 400),
                ]);
            }
        }

        return $this->keywordFallback($message, $procedures, $started, 'model-unavailable', $pendingSlot);
    }

    /** @return list<string> */
    private function modelChain(): array
    {
        return array_values(array_filter([
            config('medbridge.hermes.model'),
            config('medbridge.hermes.fallback_model'),
        ]));
    }

    /**
     * One chat-completions call. Returns null on any transport-level failure so
     * the caller can move down the chain.
     *
     * @return array{content:string}|null
     */
    private function callModel(string $model, string $message, array $slots, $procedures, ?string $pendingSlot = null): ?array
    {
        $baseUrl = rtrim(config('medbridge.hermes.base_url'), '/');

        $payload = [
            'model' => $model,
            'temperature' => config('medbridge.hermes.temperature'),
            'max_tokens' => config('medbridge.hermes.max_tokens'),
            // Requested, but not relied upon — see parseResponse().
            'response_format' => ['type' => 'json_object'],
            'messages' => [
                ['role' => 'system', 'content' => $this->systemPrompt($procedures)],
                ['role' => 'user', 'content' => $this->userPrompt($message, $slots, $pendingSlot)],
            ],
        ];

        if ($effort = config('medbridge.hermes.reasoning_effort')) {
            $payload['reasoning_effort'] = $effort;
        }

        try {
            $response = Http::withHeaders(array_filter([
                'Authorization' => 'Bearer '.config('medbridge.hermes.api_key'),
                'Content-Type' => 'application/json',
                // Attribution is an OpenRouter feature. Gemini rejects nothing
                // here today, but sending a site header to an unrelated
                // provider is noise at best.
                'HTTP-Referer' => str_contains($baseUrl, 'openrouter.ai') ? config('medbridge.hermes.referer') : null,
                'X-Title' => str_contains($baseUrl, 'openrouter.ai') ? config('medbridge.hermes.title') : null,
            ]))
                ->timeout(config('medbridge.hermes.timeout'))
                ->post($baseUrl.'/chat/completions', $payload);

            if (! $response->successful()) {
                Log::warning('[Hermes] provider error', [
                    'model' => $model,
                    'status' => $response->status(),
                    'body' => mb_substr($response->body(), 0, 300),
                ]);

                return null;
            }

            $content = data_get($response->json(), 'choices.0.message.content');

            if (! is_string($content) || $content === '') {
                // Usually means the answer was truncated before any text was
                // emitted — on Gemini, thinking tokens eating the whole
                // max_tokens budget. Worth naming, it is not a transport fault.
                Log::warning('[Hermes] empty completion', [
                    'model' => $model,
                    'finish_reason' => data_get($response->json(), 'choices.0.finish_reason'),
                ]);

                return null;
            }

            return ['content' => $content];
        } catch (\Throwable $e) {
            Log::warning('[Hermes] transport failure', ['model' => $model, 'error' => $e->getMessage()]);

            return null;
        }
    }

    private function systemPrompt($procedures): string
    {
        $catalogue = $procedures
            ->map(fn (Procedure $p) => sprintf(
                '- %s = %s (also called: %s)',
                $p->code,
                $p->name,
                implode(', ', $p->synonyms ?? []) ?: 'n/a'
            ))
            ->implode("\n");

        $today = now()->toDateString();

        return <<<PROMPT
        You are an intent-extraction component inside a medical-travel booking system.
        You do NOT talk to the patient. You do NOT give medical advice, diagnoses,
        opinions or reassurance. You return JSON and nothing else.

        Your only task: read the visitor's message and fill in whatever slots you can.

        Today's date is {$today}. The visitor travels from Singapore to Batam, Indonesia.

        Available treatments — you MUST use one of these exact codes, or null:
        {$catalogue}

        Return a single JSON object with exactly these keys:
        {
          "procedure_code": string|null,   // an exact code from the list above, else null
          "travel_date": string|null,      // ISO YYYY-MM-DD, resolved against today's date
          "party_size": integer|null,      // total people travelling, including the patient
          "budget_sgd": integer|null,      // total trip budget in SGD, ONLY if the visitor named one
          "budget_declined": boolean,      // true ONLY if they said they do not want to set a budget
          "hotel_nights": integer|null,    // nights staying in Batam; 0 is a real answer meaning a day trip
          "confidence": number,            // 0.0-1.0, how sure you are of procedure_code
          "urgency": "LOW"|"NORMAL"|"HIGH"|"URGENT",
          "symptom_keywords": string[],    // short clinical phrases the visitor used
          "off_topic": boolean             // true if unrelated to medical travel
        }

        Rules:
        - Never invent a procedure code. If nothing in the list clearly matches, use null and set confidence below 0.5.
        - Never output a UUID, an id, or a price. budget_sgd is the visitor's own figure, never yours:
          do not estimate what a procedure costs, and do not fill it from anything except a number they stated.
        - Only fill a slot the visitor actually expressed. Do not guess a date or a party size.
        - hotel_nights: 0 means a deliberate day trip and IS an answer. Use null when they did not
          state a number of nights at all. The same distinction applies to budget: use budget_declined
          for "I'd rather not", never budget_sgd 0.
        - THE PENDING QUESTION, when the user message names one, is the strongest signal you have.
          A bare or one-word reply ("2", "just me", "next friday", "no budget") is the answer to THAT
          question: fill that slot and leave every other slot null. Do not read "2" as a party size
          because the schema has one — read it as an answer to what was actually asked.
        - When a question is pending and the message could be an answer to it, off_topic is false.
        - If the visitor describes acute symptoms or an emergency, set urgency "URGENT".
        - Output raw JSON only. No markdown, no code fences, no commentary.
        PROMPT;
    }

    private function userPrompt(string $message, array $slots, ?string $pendingSlot = null): string
    {
        $known = json_encode(array_filter([
            'procedure_code' => $slots['procedure_code'] ?? null,
            'travel_date' => $slots['travel_date'] ?? null,
            'party_size' => $slots['party_size'] ?? null,
            'budget_sgd' => $slots['budget_sgd'] ?? null,
            'hotel_nights' => $slots['hotel_nights'] ?? null,
        ], fn ($v) => $v !== null), JSON_PRETTY_PRINT);

        /*
         * Without this the model reads "2" with no idea whether that is two
         * travellers or two nights, and the schema is wide enough that it can
         * confidently answer the wrong one. Naming the question turns a bare
         * reply from a guess into an unambiguous extraction.
         */
        $pending = $pendingSlot !== null && isset(self::PENDING_SLOT_HINT[$pendingSlot])
            ? sprintf(
                'The assistant has just asked the visitor %s. Their message is almost certainly the '
                .'answer to that question, so bind a bare or short reply to the "%s" slot and leave '
                .'the others null.',
                self::PENDING_SLOT_HINT[$pendingSlot],
                $pendingSlot,
            )
            : 'No question is pending — the visitor is speaking freely, so fill whatever they express.';

        return "Pending question:\n{$pending}\n\n"
            ."Already known (do not contradict unless the visitor corrects it):\n{$known}\n\n"
            ."Visitor message:\n\"\"\"\n{$message}\n\"\"\"";
    }

    /**
     * Defensive parse.
     *
     * Free open-weight models wrap JSON in prose or code fences often enough
     * that a bare json_decode is not good enough. Everything here is validated
     * against the catalogue and the calendar — a value we cannot verify becomes
     * null, which escalates, rather than a plausible-looking wrong answer.
     *
     * @return array<string,mixed>|null
     */
    private function parseResponse(string $content, $procedures): ?array
    {
        $json = $this->extractJsonObject($content);
        if ($json === null) {
            return null;
        }

        $data = json_decode($json, true);
        if (! is_array($data)) {
            return null;
        }

        // A code the catalogue does not contain is a hallucination — drop it.
        $code = is_string($data['procedure_code'] ?? null) ? trim($data['procedure_code']) : null;
        $validCodes = $procedures->pluck('code')->all();
        if ($code !== null && ! in_array($code, $validCodes, true)) {
            Log::info('[Hermes] discarded unknown procedure code', ['code' => $code]);
            $code = null;
        }

        $confidence = is_numeric($data['confidence'] ?? null) ? (float) $data['confidence'] : 0.0;
        // No procedure means no confidence, whatever the model claimed.
        if ($code === null) {
            $confidence = min($confidence, 0.4);
        }

        /*
         * An explicit "I'd rather not" is a real answer, and that answer is
         * zero. It rides on its own boolean rather than on budget_sgd 0 so a
         * model that returns 0 for "they did not say" still cannot put words in
         * the visitor's mouth — the decline has to be stated deliberately.
         */
        $budget = $this->normaliseBudget($data['budget_sgd'] ?? null);
        if ($budget === null && ($data['budget_declined'] ?? false) === true) {
            $budget = 0;
        }

        return [
            'slots' => array_filter([
                'procedure_code' => $code,
                'travel_date' => $this->normaliseDate($data['travel_date'] ?? null),
                'party_size' => $this->normalisePartySize($data['party_size'] ?? null),
                'budget_sgd' => $budget,
                'hotel_nights' => $this->normaliseHotelNights($data['hotel_nights'] ?? null),
            ], fn ($v) => $v !== null),
            'confidence' => max(0.0, min(1.0, $confidence)),
            'urgency' => in_array($data['urgency'] ?? null, ['LOW', 'NORMAL', 'HIGH', 'URGENT'], true)
                ? $data['urgency']
                : 'NORMAL',
            'symptom_keywords' => array_values(array_filter(
                array_map('strval', (array) ($data['symptom_keywords'] ?? [])),
                fn ($s) => $s !== '' && mb_strlen($s) < 60
            )),
            'off_topic' => (bool) ($data['off_topic'] ?? false),
        ];
    }

    /**
     * Pull one complete JSON object out of a response that may be fenced,
     * prefixed with prose, or missing its closing brace.
     *
     * That last case is not hypothetical: Gemini's OpenAI-compatibility layer
     * returns json_object content with the final "}" absent, while reporting
     * finish_reason "stop" — a complete answer that no JSON parser will accept.
     *
     * So this walks the structure rather than reaching for the last "}", which
     * also stops trailing prose from extending the match, and closes anything
     * still open at the end. A repaired object earns no trust for it: it goes
     * through exactly the same catalogue and calendar validation as any other,
     * and a repair that produces nonsense simply fails to decode and escalates.
     */
    private function extractJsonObject(string $content): ?string
    {
        $content = trim($content);
        $content = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', $content) ?? $content;

        $start = strpos($content, '{');
        if ($start === false) {
            return null;
        }

        $stack = [];
        $inString = false;
        $escaped = false;

        for ($i = $start, $length = strlen($content); $i < $length; $i++) {
            $char = $content[$i];

            if ($inString) {
                if ($escaped) {
                    $escaped = false;
                } elseif ($char === '\\') {
                    $escaped = true;
                } elseif ($char === '"') {
                    $inString = false;
                }

                continue;
            }

            if ($char === '"') {
                $inString = true;
            } elseif ($char === '{' || $char === '[') {
                $stack[] = $char === '{' ? '}' : ']';
            } elseif ($char === '}' || $char === ']') {
                // A bracket closing the wrong shape means we are not reading
                // JSON at all. Better to escalate than to guess.
                if (array_pop($stack) !== $char) {
                    return null;
                }

                if ($stack === []) {
                    return substr($content, $start, $i - $start + 1);
                }
            }
        }

        // Ran out of input mid-object — close what is still open.
        $repaired = rtrim(substr($content, $start));
        if ($inString) {
            $repaired .= '"';
        }
        $repaired = rtrim($repaired, ',').implode('', array_reverse($stack));

        Log::info('[Hermes] closed an unterminated JSON object', ['brackets' => count($stack)]);

        return $repaired;
    }

    /** Accept only a real, future, near-term date. Anything else is null. */
    private function normaliseDate($value): ?string
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        try {
            $date = \Carbon\Carbon::parse(trim($value))->startOfDay();
        } catch (\Throwable) {
            return null;
        }

        if ($date->isBefore(now()->startOfDay()) || $date->isAfter(now()->addMonths(12))) {
            return null;
        }

        return $date->toDateString();
    }

    /**
     * A budget the visitor stated, in SGD.
     *
     * Zero is rejected rather than accepted as "no budget": on this slot 0 is a
     * deliberate answer the visitor taps, and a model returning 0 for "they
     * didn't say" would silently put words in their mouth. Only a real figure
     * gets through, and anything absurd is dropped so the question is asked
     * properly instead.
     */
    private function normaliseBudget($value): ?int
    {
        if (! is_numeric($value)) {
            return null;
        }
        $n = (int) $value;

        return ($n >= 100 && $n <= 50000) ? $n : null;
    }

    private function normalisePartySize($value): ?int
    {
        if (! is_numeric($value)) {
            return null;
        }
        $n = (int) $value;

        return ($n >= 1 && $n <= 8) ? $n : null;
    }

    /**
     * Nights in Batam.
     *
     * Zero is accepted here, unlike on budget, because a day trip is the answer
     * a great many visitors give and there is no other way to express it. The
     * "did they actually say this" guard is JSON null, which the prompt names
     * explicitly.
     */
    private function normaliseHotelNights($value): ?int
    {
        if (! is_numeric($value)) {
            return null;
        }
        $n = (int) $value;

        return ($n >= 0 && $n <= 14) ? $n : null;
    }

    /**
     * Deterministic matcher used when Hermes is unreachable or unconfigured.
     *
     * This is not a second AI — it is a synonym lookup, and it reports low
     * confidence on purpose so the gate escalates rather than quietly quoting
     * on a keyword hit.
     *
     * @return array<string,mixed>
     */
    private function keywordFallback(string $message, $procedures, float $started, string $reason, ?string $pendingSlot = null): array
    {
        $lower = mb_strtolower($message);
        $matched = null;

        foreach ($procedures as $procedure) {
            $needles = array_merge([$procedure->name], $procedure->synonyms ?? []);
            foreach ($needles as $needle) {
                if ($needle && str_contains($lower, mb_strtolower($needle))) {
                    $matched = $procedure;
                    break 2;
                }
            }
        }

        $slots = array_filter([
            'procedure_code' => $matched?->code,
            // Only when nothing was asked — with a question pending, the literal
            // reading below owns the answer and a stray digit must not also land
            // here as a party size.
            'party_size' => $pendingSlot === null
                ? $this->normalisePartySize($this->guessPartySize($lower))
                : null,
        ], fn ($v) => $v !== null);

        /*
         * With a question on screen, a short literal reply is unambiguous
         * without a model at all. Reading it here is what stops a rate-limited
         * free tier from trapping the visitor in the same question forever.
         *
         * This is not a second AI. It accepts only what it can read exactly,
         * and anything it cannot leaves the slot null so the question is simply
         * asked again.
         */
        if ($pendingSlot !== null) {
            $literal = $this->literalAnswer($pendingSlot, $lower);
            if ($literal !== null) {
                $slots[$pendingSlot] = $literal;
            }
        }

        return [
            'slots' => $slots,
            // Deliberately below the 0.75 default gate: a keyword hit is a hint,
            // not an extraction, and must never clear the bar on its own.
            'confidence' => $matched ? 0.55 : 0.0,
            'urgency' => 'NORMAL',
            'symptom_keywords' => [],
            'off_topic' => false,
            'model_version' => 'keyword-fallback',
            'latency_ms' => (int) round((microtime(true) - $started) * 1000),
            'raw' => null,
            'source' => $reason,
        ];
    }

    /**
     * The visitor's reply read literally, against the one slot that was asked
     * about. Returns null for anything it cannot read with certainty.
     */
    private function literalAnswer(string $slot, string $lower): int|string|null
    {
        $lower = trim($lower);
        $bare = preg_match('/^\d{1,5}$/', $lower) ? (int) $lower : null;

        return match ($slot) {
            'party_size' => $this->normalisePartySize($this->guessPartySize($lower) ?? $bare),

            'hotel_nights' => $this->normaliseHotelNights(match (true) {
                (bool) preg_match('/\bday ?trip\b|\bno hotel\b|\bsame day\b/', $lower) => 0,
                (bool) preg_match('/\b(\d{1,2})\s*nights?\b/', $lower, $m) => (int) $m[1],
                default => $bare,
            }),

            'budget_sgd' => match (true) {
                // "I'd rather not" is an answer, and the answer is zero.
                (bool) preg_match('/\brather not\b|\bno budget\b|\bnot sure\b|\bno limit\b|\bskip\b/', $lower) => 0,
                (bool) preg_match('/(\d[\d,]{2,6})/', str_replace(' ', '', $lower), $m)
                    => $this->normaliseBudget((int) str_replace(',', '', $m[1])),
                default => null,
            },

            // Left to the model on purpose: "2" is a plausible day-of-month and
            // a plausible everything else, and a wrong travel date is worse than
            // asking again. The date picker is already one tap away.
            default => null,
        };
    }

    private function guessPartySize(string $lower): ?int
    {
        $words = ['one' => 1, 'two' => 2, 'three' => 3, 'four' => 4, 'alone' => 1, 'myself' => 1, 'by myself' => 1];
        foreach ($words as $word => $n) {
            if (str_contains($lower, $word)) {
                return $n;
            }
        }
        if (preg_match('/\b(\d)\s*(people|persons|pax|of us|travellers|travelers)\b/', $lower, $m)) {
            return (int) $m[1];
        }

        return null;
    }
}
