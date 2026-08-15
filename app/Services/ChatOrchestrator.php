<?php

namespace App\Services;

use App\Models\ActivityEvent;
use App\Models\ChatMessage;
use App\Models\ChatSession;
use App\Models\Hospital;
use App\Models\Hotel;
use App\Models\Procedure;
use Illuminate\Support\Carbon;

/**
 * The visitor conversation.
 *
 * THE CENTRAL DESIGN RULE OF THIS CLASS: Hermes fills slots, MedBridge writes
 * the words. The model chooses which question comes next by telling us what it
 * managed to extract; every sentence the visitor reads comes from the question
 * bank below. Nothing a model generated is ever rendered.
 *
 * That is what keeps docs/01 rule 5 true in a chat interface, and it buys three
 * things for free: no invented medical advice, no invented prices, and a
 * conversation that can be translated by swapping this file's strings.
 *
 * It also means most turns cost nothing. A visitor who taps chips never reaches
 * the provider at all — which matters on a rate-limited free tier.
 */
class ChatOrchestrator
{
    /**
     * Slots that must be filled before a bundle can be recommended, in order.
     *
     * `budget_sgd` sits after party size because the number only means anything
     * once we know how many people it has to cover, and before nights because
     * nights are the first thing money buys. It is asked, not assumed, and
     * "I'd rather not" is a first-class answer.
     */
    private const REQUIRED_SLOTS = ['procedure_code', 'travel_date', 'party_size', 'budget_sgd', 'hotel_nights'];

    public function __construct(
        private readonly HermesClient $hermes,
        private readonly BundleBuilder $bundles,
        private readonly PlaceSuggester $places,
    ) {
    }

    /* ------------------------------------------------------------------ */
    /* Entry points                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * The opening turn.
     *
     * Deliberately does NOT ask the first question. A wall of six treatment
     * cards before the visitor has said anything reads as a form, not a
     * conversation — and it buries the one line explaining what this is.
     *
     * Instead: a short greeting, a few example openers they can tap (which post
     * as their own message, so the conversation genuinely starts with them),
     * and the full catalogue tucked behind a "browse" affordance for anyone who
     * would rather pick than type.
     */
    public function greet(ChatSession $session): ChatMessage
    {
        return $this->say(
            $session,
            "Hi — I'm the MedBridge care assistant. Tell me what treatment you're after in Batam "
            ."and I'll build the whole trip around it: hospital, ferry, hotel and transfers.",
            [
                'kind' => 'intro',
                'quickReplies' => $this->openerChips(),
                // The whole catalogue, revealed on demand rather than up front.
                'browse' => $this->questionFor($session, 'procedure_code')['options'],
            ]
        );
    }

    /**
     * A few things the visitor might say, offered as taps.
     *
     * Phrasings, not labels: tapping one sends it as the visitor's own message
     * through the normal extraction path, so the conversation genuinely starts
     * with them.
     *
     * @return list<array{label:string,message:string}>
     */
    private function openerChips(): array
    {
        return Procedure::orderByDesc('sg_benchmark_sgd')
            ->take(4)
            ->get()
            ->map(fn (Procedure $p) => [
                'label' => $this->shortName($p),
                // A topic rather than a sentence: treatment names do not take an
                // article cleanly ("a LASIK Refractive Surgery"), and this is
                // how people type into a chat box anyway.
                'message' => $this->shortName($p).' in Batam',
            ])
            ->values()
            ->all();
    }

    /** "Dental Implant (single tooth, incl. crown)" → "Dental Implant". */
    private function shortName(Procedure $procedure): string
    {
        return trim(explode('(', $procedure->name)[0]);
    }

    /**
     * A message the visitor typed.
     *
     * Order matters here. The emergency check runs first, in plain PHP, before
     * any network call — so it still fires when the provider is down.
     */
    public function handleMessage(ChatSession $session, string $text): ChatMessage
    {
        $this->say($session, $text, null, ChatMessage::ROLE_PATIENT);

        if (ReviewGate::detectEmergencyLanguage($text)) {
            return $this->escalateEmergency($session, $text);
        }

        $result = $this->hermes->extract($text, $session->slots ?? [], $this->pendingSlot($session));

        // Answered before anything is written down, so a question about football
        // never becomes the inquiry's source message or a symptom keyword.
        if ($this->isOffTopic($result)) {
            return $this->deflect($session);
        }

        // Keep the strongest signal we have seen: a later "yes please" should
        // not overwrite the confidence of the message that named the procedure.
        $session->confidence = max((float) $session->confidence, (float) $result['confidence']);
        $session->putSlots(array_merge($result['slots'], [
            'urgency' => $result['urgency'],
            'symptom_keywords' => array_values(array_unique(array_merge(
                $session->slot('symptom_keywords', []) ?? [],
                $result['symptom_keywords']
            ))),
            // The first thing they typed is what operations reads as the
            // inquiry's source message, so keep it verbatim.
            'source_message' => $session->slot('source_message') ?: $text,
            'last_model' => $result['model_version'],
            'last_source' => $result['source'],
        ]));
        $session->save();

        if ($result['urgency'] === 'URGENT') {
            return $this->escalateEmergency($session, $text);
        }

        return $this->advance($session);
    }

    /**
     * A chip tap or date pick. No model call — the visitor stated the value
     * directly, so there is nothing to infer and nothing to be unsure about.
     */
    public function handleChoice(ChatSession $session, string $slot, mixed $value): ChatMessage
    {
        $normalised = $this->normaliseSlot($slot, $value);

        if ($normalised === null) {
            return $this->say($session, "I didn't quite catch that — could you pick one of the options?", $this->questionFor($session, $slot));
        }

        $label = $this->labelForChoice($slot, $normalised);
        $this->say($session, $label, null, ChatMessage::ROLE_PATIENT);

        $session->putSlots([$slot => $normalised]);

        // A tapped procedure is a stated fact, not an inference. Confidence is
        // 1.0 by construction — which is why the web channel produces cleaner
        // extractions than any messaging channel ever will.
        if ($slot === 'procedure_code') {
            $session->confidence = 1.0;
            if (! $session->slot('source_message')) {
                $session->putSlots(['source_message' => 'Selected from the treatment list: '.$label]);
            }
        }

        $session->save();

        return $this->advance($session);
    }

    /* ------------------------------------------------------------------ */
    /* The state machine                                                   */
    /* ------------------------------------------------------------------ */

    /** Ask for the next missing slot, or present the bundle when all are in. */
    public function advance(ChatSession $session): ChatMessage
    {
        $slot = $this->pendingSlot($session);

        if ($slot !== null) {
            $question = $this->questionFor($session, $slot);

            return $this->say($session, $question['prompt'], $question);
        }

        return $this->presentBundle($session);
    }

    /**
     * The slot the visitor is currently being asked about, or null once the
     * plan can be built.
     *
     * This is the same walk `advance()` does, which is exactly why it is the
     * right answer: the first unfilled required slot IS the question on screen.
     *
     * It exists because extraction needs it. A visitor who types "2" at the
     * nights question is not ambiguous to a human and must not be ambiguous to
     * the model either — without this the reply has no anchor, and the schema
     * is wide enough that a bare number can be filed against the wrong slot.
     */
    private function pendingSlot(ChatSession $session): ?string
    {
        foreach (self::REQUIRED_SLOTS as $slot) {
            if ($session->slot($slot) === null) {
                return $slot;
            }
        }

        return null;
    }

    /** Build (or rebuild) the recommendation and show it. */
    public function presentBundle(ChatSession $session): ChatMessage
    {
        $procedure = Procedure::where('code', $session->slot('procedure_code'))->first();

        if (! $procedure) {
            // The catalogue changed under us, or a bad code got stored.
            $session->putSlots(['procedure_code' => null]);
            $session->save();

            return $this->advance($session);
        }

        $recommendation = $this->bundles->recommend($procedure, $session->slots ?? []);

        $session->draft_lines = $recommendation['lines'];
        $session->putSlots([
            'hospital_id' => $recommendation['hospitalId'],
            'doctor_id' => $recommendation['doctorId'],
            'benchmark_sgd' => $recommendation['benchmarkSgd'],
        ]);
        $session->stage = ChatSession::STAGE_RECOMMENDED;
        $session->save();

        return $this->say(
            $session,
            sprintf(
                "Here's your estimate for %s, travelling %s. Remove anything you don't need, or swap a hotel, ferry or transfer — the total updates as you go.",
                $procedure->name,
                Carbon::parse($session->slot('travel_date'))->format('j M Y')
            ),
            $this->bundlePayload($session)
        );
    }

    /**
     * The bundle card the UI renders.
     *
     * @return array<string,mixed>
     */
    public function bundlePayload(ChatSession $session): array
    {
        $procedure = Procedure::where('code', $session->slot('procedure_code'))->first();
        $lines = $session->draft_lines ?? [];
        $benchmark = (float) $session->slot('benchmark_sgd', 0);

        $budget = $procedure
            ? $this->bundles->budgetStatus($lines, $procedure, $session->slots ?? [])
            : null;

        return [
            'kind' => 'bundle',
            'procedure' => $procedure ? [
                'code' => $procedure->code,
                'name' => $procedure->name,
                'treatmentDays' => (int) $procedure->treatment_days,
                'recoveryNights' => (int) $procedure->recovery_nights,
                'requiresDoctorReview' => (bool) $procedure->requires_doctor_review,
            ] : null,
            'travelDate' => $session->slot('travel_date'),
            'partySize' => (int) $session->slot('party_size', 1),
            'hotelNights' => (int) $session->slot('hotel_nights', 0),
            'lines' => $lines,
            'totals' => $this->bundles->totals($lines, $benchmark),
            // The hospital is a bundle-level choice, not a line-level swap:
            // changing it moves the treatment price, the specialist and the
            // ferry terminal together.
            'hospitalId' => $session->slot('hospital_id'),
            'hospitalOptions' => $procedure ? $this->bundles->hospitalOptions($procedure) : [],
            'swapOptions' => $this->bundles->swapOptions($session->slot('hospital_id'), $procedure),
            // Present only when the visitor set a figure. Null means they
            // declined, and a declined budget must not become a nag.
            'budget' => $budget,
            /*
             * Suggestions, not line items. This sits OUTSIDE `lines` and
             * outside `totals` by construction — nothing in it can move a
             * price, and the savings comparison never sees it (docs/09 D22).
             */
            'nearby' => $procedure ? $this->nearby($session, $procedure, $lines, $budget) : null,
            // Said plainly, and repeated in the UI: nothing here is booked, and
            // no availability has been checked. See docs/09 D4.
            'disclaimer' => 'This is an estimate, not a booking. A MedBridge coordinator confirms '
                .'availability and pricing before anything is reserved.',
        ];
    }

    /**
     * The "while you're there" panel.
     *
     * Anchored on the hotel they are actually staying in — and only when that
     * line is still in the plan. A patient who dropped the hotel is doing this
     * as a day trip, so dinner near a hotel they are not sleeping at is noise;
     * the hospital becomes the anchor instead.
     *
     * @param  list<array<string,mixed>>  $lines
     * @param  array<string,mixed>|null  $budget
     * @return array<string,mixed>|null
     */
    private function nearby(ChatSession $session, Procedure $procedure, array $lines, ?array $budget): ?array
    {
        $hotelLine = collect($lines)->first(
            fn (array $line) => $line['key'] === 'hotel' && ($line['included'] ?? true),
        );

        return $this->places->suggest(
            procedure: $procedure,
            hospital: Hospital::find($session->slot('hospital_id')),
            hotel: $hotelLine ? Hotel::find($hotelLine['refId'] ?? null) : null,
            // A plan already over budget should not open with a splurge.
            tightBudget: $budget !== null && ! $budget['fits'],
        );
    }

    /* ------------------------------------------------------------------ */
    /* Out of scope                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Was that message about something else entirely?
     *
     * Deliberately conservative — three conditions, all of them required:
     *
     *  1. Hermes said so. The keyword fallback always reports false, so an
     *     unreachable provider can never deflect anybody: a visitor talking to
     *     a degraded system still gets the normal flow and a human at the end.
     *  2. Nothing at all was extracted. "Cataract surgery — and who won the
     *     game?" is answered as a cataract enquiry, not swatted away.
     *  3. Nothing read as urgent. Acute language outranks every other reading
     *     of a message, always.
     *
     * A false positive costs the visitor one rephrase. The alternative — six
     * treatment cards shown to someone who asked about a politician — reads as
     * a system that is not listening, which is worse.
     *
     * @param  array<string,mixed>  $result
     */
    private function isOffTopic(array $result): bool
    {
        return ($result['off_topic'] ?? false) === true
            && ($result['slots'] ?? []) === []
            && in_array($result['urgency'] ?? 'NORMAL', ['LOW', 'NORMAL'], true);
    }

    /**
     * Say what this assistant is for, and hand the conversation back.
     *
     * MedBridge writes these words, not Hermes (rule 6) — the model's entire
     * contribution is the boolean. It answers no general question, because an
     * assistant that will happily discuss politics beside a page of medical
     * prices is one whose medical answers a visitor has no reason to trust.
     *
     * The reply escalates rather than repeating: the first is a light nudge
     * with a few openers, and a second in the same session adds the catalogue
     * and a phone number — at that point the visitor is not finding what they
     * came for, and a person is the better answer than a third nudge.
     */
    private function deflect(ChatSession $session): ChatMessage
    {
        $seen = (int) $session->slot('off_topic_count', 0) + 1;
        $session->putSlots(['off_topic_count' => $seen]);
        $session->save();

        $persistent = $seen >= 2;

        return $this->say(
            $session,
            $persistent
                ? "That's outside what I can help with, sorry. I only plan treatment trips to Batam — "
                    .'pick a treatment below, or call the team if you would rather speak to someone.'
                : "I can only help with planning treatment trips to Batam — the procedure, the ferry, "
                    .'the hotel and the transfers. What treatment are you looking into?',
            array_filter([
                'kind' => 'scope',
                'quickReplies' => $this->openerChips(),
                'browse' => $persistent ? $this->questionFor($session, 'procedure_code')['options'] : null,
                'supportPhone' => $persistent ? config('medbridge.support_phone') : null,
            ], fn ($v) => $v !== null)
        );
    }

    /* ------------------------------------------------------------------ */
    /* Emergencies                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * On a messaging channel an emergency sits in a queue. In a live chat the
     * person is looking at the screen right now, and the worst possible next
     * thing to show them is a date picker. So we tear the wizard down.
     */
    private function escalateEmergency(ChatSession $session, string $text): ChatMessage
    {
        $session->stage = ChatSession::STAGE_EMERGENCY;
        $session->emergency_detected = true;
        $session->putSlots(['source_message' => $session->slot('source_message') ?: $text]);
        $session->save();

        ActivityEvent::record(
            type: 'HUMAN_REVIEW_REQUIRED',
            actor: 'SYSTEM',
            title: 'Emergency language detected in web chat',
            description: 'A visitor used acute-symptom language. The self-serve flow was stopped and emergency guidance shown.',
            payload: [
                'channel' => 'WEB',
                'stage' => 'CHAT',
                'gate_reason' => 'EMERGENCY_LANGUAGE',
                'configurable' => false,
                'session_token_prefix' => substr($session->token, 0, 8),
            ],
            level: 'error',
        );

        return $this->say(
            $session,
            'It sounds like this may need urgent medical attention. Please do not wait for a cross-border quote — '
            .'call emergency services or go to your nearest A&E now.',
            [
                'kind' => 'emergency',
                'contacts' => config('medbridge.emergency_contacts'),
                'supportPhone' => config('medbridge.support_phone'),
            ]
        );
    }

    /* ------------------------------------------------------------------ */
    /* The question bank — every sentence the visitor reads lives here      */
    /* ------------------------------------------------------------------ */

    /** @return array<string,mixed> */
    public function questionFor(ChatSession $session, string $slot): array
    {
        return match ($slot) {
            'procedure_code' => [
                'kind' => 'choice',
                'slot' => 'procedure_code',
                'prompt' => $session->slot('procedure_code') === null && $session->messages()->count() > 1
                    ? "I couldn't match that to a treatment we cover yet. Which of these is closest?"
                    : 'Which treatment are you looking for?',
                'options' => Procedure::orderBy('name')->get()->map(fn (Procedure $p) => [
                    'value' => $p->code,
                    'label' => $p->name,
                    'detail' => $p->description,
                    'meta' => [
                        'fromSgd' => (float) $p->batam_price_sgd,
                        'singaporeSgd' => (float) $p->sg_benchmark_sgd,
                        'treatmentDays' => (int) $p->treatment_days,
                        'recoveryNights' => (int) $p->recovery_nights,
                    ],
                ])->values()->all(),
            ],

            'travel_date' => [
                'kind' => 'date',
                'slot' => 'travel_date',
                'prompt' => 'When would you like to travel?',
                'min' => now()->addDay()->toDateString(),
                'max' => now()->addMonths(12)->toDateString(),
                'suggestions' => [
                    ['value' => now()->addWeeks(2)->toDateString(), 'label' => 'In 2 weeks'],
                    ['value' => now()->addMonth()->toDateString(), 'label' => 'In a month'],
                    ['value' => now()->addMonths(2)->toDateString(), 'label' => 'In 2 months'],
                ],
            ],

            'party_size' => [
                'kind' => 'choice',
                'slot' => 'party_size',
                'prompt' => 'How many people are travelling, including you?',
                'options' => [
                    ['value' => 1, 'label' => 'Just me'],
                    ['value' => 2, 'label' => '2 people'],
                    ['value' => 3, 'label' => '3 people'],
                    ['value' => 4, 'label' => '4 people'],
                ],
            ],

            'budget_sgd' => $this->budgetQuestion($session),

            // The clinical recommendation is a default, not a floor. Someone
            // with family in Batam may want none at all, and someone nervous
            // about a long day may want an extra.
            'hotel_nights' => $this->hotelNightsQuestion($session),

            default => [
                'kind' => 'text',
                'slot' => $slot,
                'prompt' => 'Could you tell me a bit more?',
            ],
        };
    }

    /**
     * Budget, anchored on what this trip actually costs.
     *
     * The bands are derived from the cheapest complete plan for THIS procedure
     * rather than being three round numbers picked in advance. A generic
     * "under S$1,500" chip offered to someone pricing a knee arthroscopy is an
     * invitation to a disappointment we could have seen coming — every option
     * on this list is a budget we can actually meet.
     *
     * A visitor who types a figure of their own is not held to that list. Any
     * number is accepted, and one below what the treatment costs gets an honest
     * answer rather than a quietly shortened plan — see BundleBuilder::budgetStatus.
     *
     * @return array<string,mixed>
     */
    private function budgetQuestion(ChatSession $session): array
    {
        $procedure = Procedure::where('code', $session->slot('procedure_code'))->first();

        $minimum = $procedure
            ? $this->bundles->minimumViableSgd($procedure, $session->slots ?? [])
            : 1000.0;

        $bands = [
            ['value' => $this->niceCeil($minimum * 1.05), 'detail' => 'Enough for the plan we would suggest'],
            ['value' => $this->niceCeil($minimum * 1.35), 'detail' => 'A little room to trade up'],
            ['value' => $this->niceCeil($minimum * 1.90), 'detail' => 'Comfortable on every line'],
        ];

        $options = array_map(fn (array $band) => [
            'value' => $band['value'],
            'label' => 'Up to S$'.number_format($band['value']),
            'detail' => $band['detail'],
        ], $bands);

        // Zero is "no fixed budget", not "no money". It is a real answer and
        // the flow must not treat it as a missing one.
        $options[] = [
            'value' => 0,
            'label' => "I'd rather not set one",
            'detail' => 'Show me everything and I will decide',
        ];

        return [
            'kind' => 'choice',
            'slot' => 'budget_sgd',
            'prompt' => 'Roughly what would you like to keep the whole trip under? '
                .'It shapes your ferry, hotel and transfers — never your treatment or your specialist.',
            'options' => $options,
        ];
    }

    /** Round a derived figure up to something a person would actually say. */
    private function niceCeil(float $value): int
    {
        $step = match (true) {
            $value < 1000 => 50,
            $value < 5000 => 100,
            default => 250,
        };

        return (int) (ceil($value / $step) * $step);
    }

    /**
     * Hotel nights, anchored on the clinical recommendation.
     *
     * The recommended figure is labelled as such so the patient knows what they
     * are departing from when they choose something else.
     *
     * @return array<string,mixed>
     */
    private function hotelNightsQuestion(ChatSession $session): array
    {
        $procedure = Procedure::where('code', $session->slot('procedure_code'))->first();
        $recommended = (int) ($procedure?->recovery_nights ?? 1);

        $values = array_values(array_unique([0, $recommended, $recommended + 1, $recommended + 2]));
        sort($values);

        return [
            'kind' => 'choice',
            'slot' => 'hotel_nights',
            'prompt' => $recommended > 0
                ? "How many nights would you like in Batam? We recommend {$recommended} for recovery — choose 0 for a day trip."
                : 'How many nights would you like in Batam? This is a day procedure, so 0 is fine.',
            'options' => array_map(fn (int $n) => [
                'value' => $n,
                'label' => match (true) {
                    $n === 0 => 'Day trip — no hotel',
                    $n === 1 => '1 night',
                    default => "{$n} nights",
                },
                'detail' => $n === $recommended && $n > 0 ? 'Recommended for this procedure' : null,
            ], $values),
        ];
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    public function say(
        ChatSession $session,
        string $body,
        ?array $ui = null,
        string $role = ChatMessage::ROLE_SYSTEM,
    ): ChatMessage {
        return ChatMessage::create([
            'chat_session_id' => $session->id,
            'role' => $role,
            'body' => $body,
            'ui' => $ui,
            'sequence' => (int) ChatMessage::where('chat_session_id', $session->id)->max('sequence') + 1,
        ]);
    }

    private function normaliseSlot(string $slot, mixed $value): mixed
    {
        return match ($slot) {
            'procedure_code' => Procedure::where('code', $value)->exists() ? (string) $value : null,

            'travel_date' => $this->normaliseDate($value),

            'party_size' => (is_numeric($value) && (int) $value >= 1 && (int) $value <= 8)
                ? (int) $value
                : null,

            'hotel_nights' => (is_numeric($value) && (int) $value >= 0 && (int) $value <= 14)
                ? (int) $value
                : null,

            // 0 means "no fixed budget" — a stated preference, not a blank.
            // Anything up to S$50k is accepted, including figures well below
            // what the treatment costs: that case gets an honest warning, not
            // a rejected input.
            'budget_sgd' => (is_numeric($value) && (int) $value >= 0 && (int) $value <= 50000)
                ? (int) $value
                : null,

            default => null,
        };
    }

    private function normaliseDate(mixed $value): ?string
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        try {
            $date = Carbon::parse($value)->startOfDay();
        } catch (\Throwable) {
            return null;
        }

        return $date->isBefore(now()->startOfDay()) || $date->isAfter(now()->addMonths(12))
            ? null
            : $date->toDateString();
    }

    /** Echo the visitor's tap back into the transcript in their own voice. */
    private function labelForChoice(string $slot, mixed $value): string
    {
        return match ($slot) {
            'procedure_code' => Procedure::where('code', $value)->value('name') ?? (string) $value,
            'travel_date' => Carbon::parse($value)->format('j M Y'),
            'party_size' => $value === 1 ? 'Just me' : "{$value} people",
            'budget_sgd' => $value === 0
                ? "I'd rather not set a budget"
                : 'Up to S$'.number_format((int) $value),
            'hotel_nights' => match (true) {
                $value === 0 => 'Day trip — no hotel',
                $value === 1 => '1 night',
                default => "{$value} nights",
            },
            default => (string) $value,
        };
    }
}
