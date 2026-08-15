<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityEvent;
use App\Models\AiExtraction;
use App\Models\ChatSession;
use App\Models\DoctorReview;
use App\Models\Hospital;
use App\Models\Inquiry;
use App\Models\Message;
use App\Models\MessageThread;
use App\Models\Patient;
use App\Models\Procedure;
use App\Services\BundleBuilder;
use App\Services\ChatOrchestrator;
use App\Services\ReviewGate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * The public patient chat — the front door of MedBridge Pass.
 *
 * Unauthenticated by design, and anonymous until submit(): a visitor pricing a
 * procedure at 2am leaves behind a procedure code and a date, nothing more.
 *
 * The one thing this controller cannot do, anywhere in it, is release a case to
 * a patient. submit() writes a DRAFT quote and parks the inquiry in a review
 * state. Minting an itinerary token is QuoteController::approve, and a human
 * pressing that button is the only way to reach it (docs/09 D4).
 */
class ChatController extends Controller
{
    public function __construct(
        private readonly ChatOrchestrator $chat,
        private readonly ReviewGate $gate,
        private readonly BundleBuilder $bundles,
    ) {
    }

    /** POST /chat/sessions — begin an anonymous conversation. */
    public function start(Request $request): JsonResponse
    {
        $session = ChatSession::create([
            'token' => ChatSession::newToken(),
            'slots' => [],
            'draft_lines' => [],
            'stage' => ChatSession::STAGE_COLLECTING,
            'ip_hash' => ChatSession::hashIp($request->ip()),
            'expires_at' => now()->addHours((int) config('medbridge.chat_session_ttl_hours')),
        ]);

        // Greet only. The first question waits until the visitor has spoken —
        // see ChatOrchestrator::greet().
        $this->chat->greet($session);

        return response()->json($this->sessionPayload($session->fresh()), 201);
    }

    /** GET /chat/sessions/{token} — resume after a refresh. */
    public function show(string $token): JsonResponse
    {
        return response()->json($this->sessionPayload($this->resolve($token)));
    }

    /** POST /chat/sessions/{token}/messages — the visitor typed something. */
    public function message(Request $request, string $token): JsonResponse
    {
        $session = $this->resolve($token);
        $this->assertOpen($session);

        $data = $request->validate([
            'body' => ['required', 'string', 'min:1', 'max:2000'],
        ]);

        $this->chat->handleMessage($session, trim($data['body']));

        return response()->json($this->sessionPayload($session->fresh()));
    }

    /** POST /chat/sessions/{token}/choice — the visitor tapped a chip. */
    public function choice(Request $request, string $token): JsonResponse
    {
        $session = $this->resolve($token);
        $this->assertOpen($session);

        $data = $request->validate([
            'slot' => ['required', 'string', Rule::in([
                'procedure_code', 'travel_date', 'party_size', 'budget_sgd', 'hotel_nights',
            ])],
            // `present`, not `required`: hotel_nights is legitimately 0 for a
            // day trip, and `required` would reject it as empty.
            'value' => ['present'],
        ]);

        $this->chat->handleChoice($session, $data['slot'], $data['value']);

        return response()->json($this->sessionPayload($session->fresh()));
    }

    /**
     * POST /chat/sessions/{token}/bundle — drop or swap a line.
     *
     * Treatment, the specialist fee and coordination are not removable; the
     * flags on each line are enforced here, not just rendered in the UI.
     */
    public function updateBundle(Request $request, string $token): JsonResponse
    {
        $session = $this->resolve($token);
        $this->assertOpen($session);

        if ($session->stage !== ChatSession::STAGE_RECOMMENDED) {
            abort(409, 'No bundle to edit yet.');
        }

        $data = $request->validate([
            'action' => ['required', Rule::in(['toggle', 'swap', 'hospital', 'nights'])],
            'key' => ['required_unless:action,hospital,nights', 'string', 'max:40'],
            'included' => ['boolean'],
            'refId' => ['nullable', 'uuid'],
            'nights' => ['integer', 'min:0', 'max:14'],
        ]);

        $procedure = Procedure::where('code', $session->slot('procedure_code'))->firstOrFail();
        $lines = $session->draft_lines ?? [];

        /*
         * Changing hospital is not a line-level swap. The treatment price, the
         * specialist and the ferry terminal all move with it — so the bundle is
         * rebuilt, carrying across every choice the patient already made.
         */
        if ($data['action'] === 'hospital') {
            if (empty($data['refId'])) {
                abort(422, 'Choosing a hospital needs a refId.');
            }

            $rebuilt = $this->bundles->rebuildForHospital(
                $procedure,
                $session->slots ?? [],
                $data['refId'],
                $lines,
            );

            $session->draft_lines = $rebuilt['lines'];
            $session->putSlots([
                'hospital_id' => $rebuilt['hospitalId'],
                'doctor_id' => $rebuilt['doctorId'],
                'benchmark_sgd' => $rebuilt['benchmarkSgd'],
            ]);
            $session->save();

            return response()->json(['bundle' => $this->chat->bundlePayload($session)]);
        }

        // Nights change the hotel quantity, so the bundle is re-derived rather
        // than patched — a 0-night stay drops the line entirely.
        if ($data['action'] === 'nights') {
            $session->putSlots(['hotel_nights' => (int) ($data['nights'] ?? 0)]);

            $rebuilt = $this->bundles->rebuildForHospital(
                $procedure,
                $session->slots ?? [],
                (string) $session->slot('hospital_id'),
                $lines,
            );

            $session->draft_lines = $rebuilt['lines'];
            $session->save();

            return response()->json(['bundle' => $this->chat->bundlePayload($session)]);
        }

        if ($data['action'] === 'toggle') {
            $lines = array_map(function (array $line) use ($data) {
                if ($line['key'] !== $data['key']) {
                    return $line;
                }
                if (! ($line['removable'] ?? false)) {
                    return $line;   // server-side enforcement of the flag
                }
                $line['included'] = $data['included'] ?? ! ($line['included'] ?? true);

                return $line;
            }, $lines);
        } else {
            if (empty($data['refId'])) {
                abort(422, 'A swap needs a refId.');
            }
            // Reprices from the catalogue row — the client's price is ignored.
            // The hospital rides along because a hotel's distance is measured
            // to the facility this patient chose, not to "the hospital".
            $lines = $this->bundles->applySwap(
                $lines,
                $data['key'],
                $data['refId'],
                Hospital::find($session->slot('hospital_id')),
            );
        }

        $session->draft_lines = array_values($lines);
        $session->save();

        return response()->json([
            'bundle' => $this->chat->bundlePayload($session),
        ]);
    }

    /**
     * POST /chat/sessions/{token}/submit — the visitor confirms.
     *
     * This is the moment the anonymous session becomes a real case in the
     * database: patient, inquiry, extraction, draft quote, message thread and a
     * full audit trail. It parks in a review state and stops.
     */
    public function submit(Request $request, string $token): JsonResponse
    {
        $session = $this->resolve($token);

        if ($session->stage === ChatSession::STAGE_SUBMITTED) {
            abort(409, 'This request has already been submitted.');
        }
        if ($session->stage === ChatSession::STAGE_EMERGENCY) {
            abort(409, 'This conversation was escalated for urgent care and cannot be submitted here.');
        }
        if ($session->stage !== ChatSession::STAGE_RECOMMENDED) {
            abort(409, 'Finish choosing your treatment before submitting.');
        }

        $data = $request->validate([
            'fullName' => ['required', 'string', 'min:2', 'max:120'],
            'phone' => ['required', 'string', 'min:6', 'max:32'],
            'email' => ['nullable', 'email', 'max:160'],
            'yearOfBirth' => ['nullable', 'integer', 'min:1900', 'max:'.now()->year],
            'preferredChannel' => ['nullable', Rule::in(['WEB', 'INTERNAL'])],
            // PDPA: explicit, logged, and required. See docs/10 compliance.
            'consent' => ['required', 'accepted'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $procedure = Procedure::where('code', $session->slot('procedure_code'))->firstOrFail();
        $lines = $session->draft_lines ?? [];
        $benchmark = (float) $session->slot('benchmark_sgd', 0);
        $totals = $this->bundles->totals($lines, $benchmark);
        $sourceMessage = (string) ($session->slot('source_message') ?: 'Web chat enquiry');
        // Carried into the case so the coordinator picking this up knows what
        // the patient said they could spend — particularly when the honest
        // answer was "this does not fit, let's talk".
        $budget = $this->bundles->budgetStatus($lines, $procedure, $session->slots ?? []);

        $gate = $this->gate->evaluate(
            confidence: (float) $session->confidence,
            procedure: $procedure,
            sourceMessage: $sourceMessage,
            totalSgd: $totals['totalSgd'],
            benchmarkSgd: $benchmark,
        );

        $status = $this->gate->statusFor($gate['reasons']);
        $urgency = (string) $session->slot('urgency', 'NORMAL');

        $inquiry = DB::transaction(function () use (
            $session, $data, $procedure, $lines, $benchmark, $totals, $sourceMessage, $gate, $status, $urgency, $budget
        ) {
            $patient = Patient::create([
                'full_name' => $data['fullName'],
                'phone_e164' => $data['phone'],
                'email' => $data['email'] ?? null,
                'country_code' => 'SG',
                'year_of_birth' => $data['yearOfBirth'] ?? null,
                'preferred_channel' => $data['preferredChannel'] ?? 'WEB',
                'preferred_language' => 'English',
                'consent_given' => true,
                'consent_at' => now(),
            ]);

            $inquiry = Inquiry::create([
                'reference' => Inquiry::nextReference(),
                'patient_id' => $patient->id,
                'hospital_id' => $session->slot('hospital_id'),
                'doctor_id' => $session->slot('doctor_id'),
                'procedure_id' => $procedure->id,
                'status' => $status,
                'priority' => $this->gate->priorityFor($gate['reasons'], $urgency),
                'channel' => 'WEB',
                'source_message' => $sourceMessage,
                'sla_due_at' => now()->addMinutes((int) config('medbridge.sla_minutes')),
            ]);

            AiExtraction::create([
                'inquiry_id' => $inquiry->id,
                // A restatement written by business logic, not a passthrough of
                // anything the model produced.
                'intent_summary' => sprintf(
                    'Patient configured an all-in cross-border bundle for %s, travelling %s with a party of %d.',
                    $procedure->name,
                    $session->slot('travel_date'),
                    (int) $session->slot('party_size', 1),
                ),
                'procedure_id' => $procedure->id,
                'procedure_label' => $procedure->name,
                'confidence' => (float) $session->confidence,
                'urgency' => $urgency,
                'travel_party_size' => (int) $session->slot('party_size', 1),
                'preferred_window' => (string) $session->slot('travel_date'),
                'symptom_keywords' => $session->slot('symptom_keywords', []) ?? [],
                'extracted_entities' => [
                    'origin_country' => 'SG',
                    'destination_city' => 'Batam',
                    'procedure_code' => $procedure->code,
                    'travel_date' => $session->slot('travel_date'),
                    'party_size' => (int) $session->slot('party_size', 1),
                    'wants_ferry' => $this->lineIncluded($lines, 'ferry_out') || $this->lineIncluded($lines, 'ferry_return'),
                    'wants_hotel' => $this->lineIncluded($lines, 'hotel'),
                    'wants_transport' => $this->lineIncluded($lines, 'transport'),
                    'self_configured' => true,
                    // 0 = they declined to set one, which is different from
                    // "we did not ask".
                    'budget_sgd' => (int) $session->slot('budget_sgd', 0),
                    'budget_state' => $budget['state'] ?? 'NOT_SET',
                ],
                'requires_human_review' => $gate['requiresHumanReview'],
                'review_reasons' => $gate['reasons'],
                // Persist the threshold in force at the time, so "why was this
                // handled that way" never depends on today's Settings page.
                'threshold_applied' => $gate['threshold'],
                'model_version' => (string) $session->slot('last_model', 'web-chat-slot-fill'),
                'latency_ms' => 0,
            ]);

            $quote = $this->bundles->persistQuote($inquiry, $lines, $benchmark);

            if (in_array('HIGH_RISK_PROCEDURE', $gate['reasons'], true)) {
                DoctorReview::create([
                    'inquiry_id' => $inquiry->id,
                    'doctor_id' => $inquiry->doctor_id,
                    'decision' => 'PENDING',
                    'clinical_notes' => '',
                    'required_pre_op_tests' => [],
                ]);
            }

            $thread = MessageThread::create([
                'patient_id' => $patient->id,
                'inquiry_id' => $inquiry->id,
                'channel' => 'WEB',
                'subject' => $procedure->name.' — '.$inquiry->reference,
                'unread_count' => 1,
                'last_message_at' => now(),
            ]);

            Message::create([
                'thread_id' => $thread->id,
                'inquiry_id' => $inquiry->id,
                'channel' => 'WEB',
                'direction' => 'INBOUND',
                'body' => $sourceMessage.(($data['notes'] ?? null) ? "\n\nNote from patient: ".$data['notes'] : ''),
                'sender_name' => $patient->full_name,
                'status' => 'RECEIVED',
            ]);

            $this->writeAuditTrail($inquiry, $procedure, $session, $gate, $totals, $quote->id, $budget);

            $session->patient_id = $patient->id;
            $session->inquiry_id = $inquiry->id;
            $session->stage = ChatSession::STAGE_SUBMITTED;
            $session->save();

            return $inquiry;
        });

        $this->chat->say(
            $session,
            sprintf(
                "Thanks %s — your request is with our coordination team. Your reference is %s. "
                ."A coordinator reviews every request personally and will confirm availability and final pricing with you shortly.",
                explode(' ', trim($data['fullName']))[0],
                $inquiry->reference,
            ),
            [
                'kind' => 'submitted',
                'reference' => $inquiry->reference,
                'totals' => $totals,
                'slaDueAt' => $inquiry->sla_due_at->toIso8601String(),
                'requiresDoctorReview' => in_array('HIGH_RISK_PROCEDURE', $gate['reasons'], true),
            ]
        );

        return response()->json($this->sessionPayload($session->fresh()), 201);
    }

    /* ------------------------------------------------------------------ */
    /* Internals                                                           */
    /* ------------------------------------------------------------------ */

    private function writeAuditTrail(
        Inquiry $inquiry,
        Procedure $procedure,
        ChatSession $session,
        array $gate,
        array $totals,
        string $quoteId,
        ?array $budget = null,
    ): void {
        ActivityEvent::record(
            'MESSAGE_RECEIVED', 'PATIENT',
            'Web chat enquiry submitted',
            'A visitor completed the guided chat and submitted a configured bundle.',
            ['channel' => 'WEB', 'reference' => $inquiry->reference, 'self_configured' => true],
            $inquiry,
        );

        ActivityEvent::record(
            'AI_EXTRACTION_COMPLETED', 'AI_AGENT',
            'Intent extraction complete',
            'Slots resolved and validated against the catalogue.',
            [
                'model_version' => (string) $session->slot('last_model', 'web-chat-slot-fill'),
                'extraction_source' => (string) $session->slot('last_source', 'slot-fill'),
                'confidence' => (float) $session->confidence,
                'threshold_applied' => $gate['threshold'],
                'procedure_code' => $procedure->code,
            ],
            $inquiry,
        );

        ActivityEvent::record(
            'TREATMENT_IDENTIFIED', 'AI_AGENT',
            'Treatment identified — '.$procedure->name,
            'Procedure resolved to a catalogue row by code.',
            ['procedure_code' => $procedure->code, 'requires_doctor_review' => (bool) $procedure->requires_doctor_review],
            $inquiry,
        );

        ActivityEvent::record(
            'PRICING_CALCULATED', 'SYSTEM',
            'Bundle priced',
            'Deterministic pricing applied from the catalogue at submission time.',
            [
                'total_sgd' => $totals['totalSgd'],
                'sg_benchmark_sgd' => $totals['sgBenchmarkSgd'],
                'savings_sgd' => $totals['savingsSgd'],
                'savings_pct' => $totals['savingsPct'],
                'idr_per_sgd' => (float) config('medbridge.pricing.idr_per_sgd'),
                // Structured facts, as everywhere in this log — a state and two
                // numbers, never the sentence the patient was shown.
                'budget_sgd' => $budget['budgetSgd'] ?? null,
                'budget_state' => $budget['state'] ?? 'NOT_SET',
                'minimum_viable_sgd' => $budget['minimumViableSgd'] ?? null,
            ],
            $inquiry,
        );

        ActivityEvent::record(
            'QUOTE_DRAFTED', 'SYSTEM',
            'Draft quote created',
            'Patient-configured bundle stored as a DRAFT quote for human review.',
            ['quote_id' => $quoteId, 'status' => 'DRAFT'],
            $inquiry,
        );

        if ($gate['requiresHumanReview']) {
            ActivityEvent::record(
                'HUMAN_REVIEW_REQUIRED', 'SYSTEM',
                'Human review required',
                'The gate stopped this case. It cannot proceed without a person.',
                [
                    'review_reasons' => $gate['reasons'],
                    'threshold_applied' => $gate['threshold'],
                    'resulting_status' => $inquiry->status,
                ],
                $inquiry,
                'warning',
            );
        }
    }

    /** @param list<array<string,mixed>> $lines */
    private function lineIncluded(array $lines, string $key): bool
    {
        foreach ($lines as $line) {
            if ($line['key'] === $key) {
                return (bool) ($line['included'] ?? true);
            }
        }

        return false;
    }

    private function resolve(string $token): ChatSession
    {
        $session = ChatSession::where('token', $token)->first();

        // Same posture as an expired itinerary link: 404, never a 410. Do not
        // confirm that a token ever existed.
        abort_if(! $session || $session->isExpired(), 404, 'This conversation is no longer available.');

        return $session;
    }

    private function assertOpen(ChatSession $session): void
    {
        if ($session->stage === ChatSession::STAGE_SUBMITTED) {
            abort(409, 'This request has already been submitted.');
        }
    }

    /** @return array<string,mixed> */
    private function sessionPayload(ChatSession $session): array
    {
        $messages = $session->messages()->get()->map->toApi()->values()->all();

        return [
            'token' => $session->token,
            'stage' => $session->stage,
            'messages' => $messages,
            'slots' => [
                'procedureCode' => $session->slot('procedure_code'),
                'travelDate' => $session->slot('travel_date'),
                'partySize' => $session->slot('party_size'),
            ],
            'bundle' => $session->stage === ChatSession::STAGE_RECOMMENDED
                ? $this->chat->bundlePayload($session)
                : null,
            'reference' => $session->inquiry_id
                ? Inquiry::whereKey($session->inquiry_id)->value('reference')
                : null,
            'expiresAt' => $session->expires_at->toIso8601String(),
        ];
    }
}
