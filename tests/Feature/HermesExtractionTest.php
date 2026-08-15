<?php

namespace Tests\Feature;

use App\Models\ChatSession;
use App\Models\Procedure;
use App\Services\HermesClient;
use Database\Seeders\CatalogueSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * How Hermes behaves when the provider misbehaves.
 *
 * Hermes talks to whatever OpenAI-compatible endpoint .env points at, and free
 * tiers return malformed, fenced, chatty and truncated JSON as a matter of
 * routine. None of that may reach a patient as an error, and none of it may
 * reach the database as a fabricated fact.
 *
 * Every test here fakes the transport. Nothing touches the network.
 */
class HermesExtractionTest extends TestCase
{
    use RefreshDatabase;

    private const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/*';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(CatalogueSeeder::class);

        /*
         * Several tests here walk a whole conversation to reach the question
         * they care about, which is five requests each — enough of this class
         * back to back and the public 40/min limiter starts answering instead
         * of the controller, so the suite fails somewhere unrelated to whatever
         * was actually changed. The limiter is a real protection; it is
         * disabled per test class, never globally.
         */
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);

        config([
            'medbridge.hermes.enabled' => true,
            'medbridge.hermes.api_key' => 'test-key',
            'medbridge.hermes.base_url' => 'https://generativelanguage.googleapis.com/v1beta/openai',
            'medbridge.hermes.model' => 'gemini-3.5-flash',
            'medbridge.hermes.fallback_model' => 'gemini-3.5-flash-lite',
        ]);
    }

    /** Build a provider response carrying $content as the completion. */
    private function completion(string $content): array
    {
        return [
            'choices' => [
                ['finish_reason' => 'stop', 'message' => ['role' => 'assistant', 'content' => $content]],
            ],
        ];
    }

    /* ------------------------------------------------------------------ */
    /* Malformed but recoverable output                                    */
    /* ------------------------------------------------------------------ */

    /**
     * Gemini's OpenAI-compatibility layer returns json_object content with the
     * final brace missing, while reporting finish_reason "stop". Discarding a
     * complete extraction over one absent character sent every visitor to a
     * human for no reason.
     *
     * @test
     */
    public function it_reads_an_object_whose_closing_brace_the_provider_dropped(): void
    {
        Http::fake([self::ENDPOINT => Http::response($this->completion(<<<'JSON'
        {
          "procedure_code": "DEN-IMP-01",
          "travel_date": null,
          "party_size": 2,
          "confidence": 0.95,
          "urgency": "NORMAL",
          "symptom_keywords": ["dental implant"],
          "off_topic": false
        JSON))]);

        $result = app(HermesClient::class)->extract('I need a dental implant, 2 of us');

        $this->assertSame('model', $result['source']);
        $this->assertSame('DEN-IMP-01', $result['slots']['procedure_code']);
        $this->assertSame(2, $result['slots']['party_size']);
        $this->assertSame(0.95, $result['confidence']);
    }

    /** @test */
    public function it_reads_an_object_wrapped_in_fences_and_commentary(): void
    {
        Http::fake([self::ENDPOINT => Http::response($this->completion(
            "Sure! Here is the extraction:\n```json\n".
            '{"procedure_code":"DEN-IMP-01","confidence":0.9,"urgency":"NORMAL","symptom_keywords":[],"off_topic":false}'.
            "\n```\nLet me know if you need anything else."
        ))]);

        $result = app(HermesClient::class)->extract('dental implant please');

        $this->assertSame('model', $result['source']);
        $this->assertSame('DEN-IMP-01', $result['slots']['procedure_code']);
    }

    /**
     * The walker stops at the object's own closing brace, so prose that happens
     * to contain a brace afterwards cannot extend the match.
     *
     * @test
     */
    public function it_stops_at_the_end_of_the_object_not_at_the_last_brace_in_the_response(): void
    {
        Http::fake([self::ENDPOINT => Http::response($this->completion(
            '{"procedure_code":"DEN-IMP-01","confidence":0.9,"urgency":"NORMAL","symptom_keywords":[],"off_topic":false}'.
            "\n\nNote: the schema was {procedure_code, confidence}."
        ))]);

        $result = app(HermesClient::class)->extract('dental implant please');

        $this->assertSame('model', $result['source']);
        $this->assertSame('DEN-IMP-01', $result['slots']['procedure_code']);
    }

    /* ------------------------------------------------------------------ */
    /* Output that must NOT be trusted                                     */
    /* ------------------------------------------------------------------ */

    /**
     * A repaired object gets no special standing — a code the catalogue does
     * not contain is dropped whether the JSON arrived whole or was closed here.
     *
     * @test
     */
    public function a_repaired_object_still_loses_a_hallucinated_procedure_code(): void
    {
        Http::fake([self::ENDPOINT => Http::response($this->completion(
            '{"procedure_code":"CARDIAC-TRANSPLANT-99","confidence":0.99,"urgency":"NORMAL","symptom_keywords":[],"off_topic":false'
        ))]);

        $result = app(HermesClient::class)->extract('I need a heart transplant');

        $this->assertArrayNotHasKey('procedure_code', $result['slots']);
        // No procedure means no confidence, whatever the model claimed — and
        // 0.4 is below the 0.75 gate, so this escalates.
        $this->assertLessThanOrEqual(0.4, $result['confidence']);
    }

    /** @test */
    public function output_that_is_not_json_at_all_falls_through_to_a_human(): void
    {
        Http::fake([self::ENDPOINT => Http::response($this->completion(
            'I am sorry, I cannot help with medical questions.'
        ))]);

        $result = app(HermesClient::class)->extract('I need a dental implant');

        $this->assertSame('model-unavailable', $result['source']);
        $this->assertSame('keyword-fallback', $result['model_version']);
    }

    /* ------------------------------------------------------------------ */
    /* Provider failure                                                    */
    /* ------------------------------------------------------------------ */

    /** @test */
    public function a_provider_error_degrades_to_the_keyword_fallback_not_an_exception(): void
    {
        Http::fake([self::ENDPOINT => Http::response(['error' => ['code' => 429]], 429)]);

        $result = app(HermesClient::class)->extract('I need a dental implant');

        $this->assertSame('model-unavailable', $result['source']);
        $this->assertSame('keyword-fallback', $result['model_version']);
        // A keyword hit is a hint, not an extraction: it must stay under the gate.
        $this->assertLessThan(config('medbridge.gate.confidence_threshold'), $result['confidence']);
    }

    /**
     * An empty completion is a real Gemini failure mode — thinking tokens can
     * consume the whole max_tokens budget. It must move down the chain rather
     * than be read as an answer.
     *
     * @test
     */
    public function an_empty_completion_moves_on_to_the_fallback_model(): void
    {
        Http::fakeSequence()
            ->push($this->completion(''))
            ->push($this->completion(
                '{"procedure_code":"DEN-IMP-01","confidence":0.9,"urgency":"NORMAL","symptom_keywords":[],"off_topic":false}'
            ));

        $result = app(HermesClient::class)->extract('I need a dental implant');

        $this->assertSame('model', $result['source']);
        $this->assertSame('gemini-3.5-flash-lite', $result['model_version']);
    }

    /* ------------------------------------------------------------------ */
    /* What leaves the building                                            */
    /* ------------------------------------------------------------------ */

    /**
     * The provider is addressed as an OpenAI-compatible endpoint and the key
     * travels as a bearer token — not as a query parameter, where it would be
     * logged by every proxy in between.
     *
     * @test
     */
    public function the_request_carries_the_key_as_a_header_and_never_in_the_url(): void
    {
        Http::fake([self::ENDPOINT => Http::response($this->completion(
            '{"procedure_code":null,"confidence":0.1,"urgency":"NORMAL","symptom_keywords":[],"off_topic":false}'
        ))]);

        app(HermesClient::class)->extract('hello');

        Http::assertSent(function (Request $request) {
            $this->assertStringNotContainsString('test-key', $request->url());
            $this->assertSame('Bearer test-key', $request->header('Authorization')[0]);

            // OpenRouter attribution is meaningless to Gemini and is not sent.
            $this->assertSame([], $request->header('HTTP-Referer'));
            $this->assertSame([], $request->header('X-Title'));

            return str_ends_with($request->url(), '/chat/completions');
        });
    }

    /* ------------------------------------------------------------------ */
    /* Answering the question that is actually on screen                    */
    /* ------------------------------------------------------------------ */

    /**
     * The bug this suite was extended for.
     *
     * A visitor asked "how many nights?" who typed "2" was asked again, and
     * again, forever. `hotel_nights` was simply not in the extraction contract:
     * the schema never mentioned it and parseResponse never returned it, so no
     * sentence the visitor could type was capable of filling the slot, and
     * `advance()` found it null every time.
     *
     * @test
     */
    public function a_typed_answer_fills_the_slot_the_assistant_just_asked_about(): void
    {
        Http::fake([self::ENDPOINT => Http::response($this->completion(
            '{"procedure_code":null,"travel_date":null,"party_size":null,"budget_sgd":null,'
            .'"budget_declined":false,"hotel_nights":2,"confidence":0.2,"urgency":"NORMAL",'
            .'"symptom_keywords":[],"off_topic":false}'
        ))]);

        $token = $this->sessionAwaitingNights();

        $this->postJson("/api/v1/chat/sessions/{$token}/messages", ['body' => '2'])
            ->assertOk()
            // Not the nights question a second time.
            ->assertJsonPath('stage', 'RECOMMENDED');

        $this->assertSame(2, ChatSession::where('token', $token)->first()->slot('hotel_nights'));
    }

    /**
     * The model cannot read "2" correctly if it is never told what was asked,
     * so the pending question travels with the message.
     *
     * @test
     */
    public function the_pending_question_is_sent_to_the_provider(): void
    {
        Http::fake([self::ENDPOINT => Http::response($this->completion(
            '{"procedure_code":null,"hotel_nights":2,"confidence":0.1,"urgency":"NORMAL","symptom_keywords":[],"off_topic":false}'
        ))]);

        app(HermesClient::class)->extract('2', [], 'hotel_nights');

        Http::assertSent(function (Request $request) {
            $user = collect($request->data()['messages'])->firstWhere('role', 'user')['content'];

            $this->assertStringContainsString('hotel_nights', $user);
            $this->assertStringContainsString('nights they want to stay in Batam', $user);

            return true;
        });
    }

    /**
     * Zero on the budget slot means "I'd rather not", which is a real answer —
     * but it rides on its own boolean so that a model returning 0 for "they did
     * not say" still cannot put words in the visitor's mouth.
     *
     * @test
     */
    public function an_explicit_decline_is_recorded_as_a_zero_budget(): void
    {
        Http::fake([self::ENDPOINT => Http::response($this->completion(
            '{"procedure_code":null,"budget_sgd":null,"budget_declined":true,"confidence":0.1,'
            .'"urgency":"NORMAL","symptom_keywords":[],"off_topic":false}'
        ))]);

        $result = app(HermesClient::class)->extract("I'd rather not set one", [], 'budget_sgd');

        $this->assertSame(0, $result['slots']['budget_sgd']);
    }

    /** A budget of 0 with no decline is still silence, not an answer. @test */
    public function a_bare_zero_budget_is_not_mistaken_for_a_decline(): void
    {
        Http::fake([self::ENDPOINT => Http::response($this->completion(
            '{"procedure_code":null,"budget_sgd":0,"budget_declined":false,"confidence":0.1,'
            .'"urgency":"NORMAL","symptom_keywords":[],"off_topic":false}'
        ))]);

        $result = app(HermesClient::class)->extract('hmm', [], 'budget_sgd');

        $this->assertArrayNotHasKey('budget_sgd', $result['slots']);
    }

    /**
     * A free tier that has run out must not trap the visitor in the same
     * question. With a question pending, a short literal reply is unambiguous
     * without a model at all.
     *
     * @test
     */
    public function a_short_answer_still_lands_when_the_model_is_unavailable(): void
    {
        config(['medbridge.hermes.enabled' => false]);

        $client = app(HermesClient::class);

        $this->assertSame(2, $client->extract('2', [], 'hotel_nights')['slots']['hotel_nights']);
        $this->assertSame(0, $client->extract('day trip', [], 'hotel_nights')['slots']['hotel_nights']);
        $this->assertSame(3, $client->extract('3 nights please', [], 'hotel_nights')['slots']['hotel_nights']);
        $this->assertSame(0, $client->extract("I'd rather not", [], 'budget_sgd')['slots']['budget_sgd']);
        $this->assertSame(2500, $client->extract('about 2,500', [], 'budget_sgd')['slots']['budget_sgd']);
    }

    /**
     * The failure mode that would be worse than the loop: a bare number filed
     * against whichever numeric slot the schema happens to offer first.
     *
     * @test
     */
    public function a_bare_number_never_lands_in_a_slot_that_was_not_asked_about(): void
    {
        config(['medbridge.hermes.enabled' => false]);

        $result = app(HermesClient::class)->extract('2', ['party_size' => 1], 'hotel_nights');

        $this->assertSame(2, $result['slots']['hotel_nights']);
        $this->assertArrayNotHasKey('party_size', $result['slots']);
    }

    /** Walk a session to the point where nights is the outstanding question. */
    private function sessionAwaitingNights(): string
    {
        $token = $this->postJson('/api/v1/chat/sessions')->assertCreated()->json('token');

        $answers = [
            ['procedure_code', Procedure::orderBy('name')->value('code')],
            ['travel_date', now()->addWeeks(2)->toDateString()],
            ['party_size', 1],
            ['budget_sgd', 0],
        ];

        foreach ($answers as [$slot, $value]) {
            $this->postJson("/api/v1/chat/sessions/{$token}/choice", [
                'slot' => $slot,
                'value' => $value,
            ])->assertOk();
        }

        $this->assertNull(ChatSession::where('token', $token)->first()->slot('hotel_nights'));

        return $token;
    }
}
