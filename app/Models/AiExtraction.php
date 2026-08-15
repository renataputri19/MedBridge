<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiExtraction extends Model
{
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'confidence' => 'float',
        'threshold_applied' => 'float',
        'symptom_keywords' => 'array',
        'extracted_entities' => 'array',
        'review_reasons' => 'array',
        'requires_human_review' => 'boolean',
    ];

    /**
     * The verbatim provider response is kept for audit and must never be
     * serialised to a client. toApi() omits it; $hidden is the backstop.
     */
    protected $hidden = ['raw_response'];

    public function inquiry(): BelongsTo
    {
        return $this->belongsTo(Inquiry::class);
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'inquiryId' => $this->inquiry_id,
            'intentSummary' => $this->intent_summary,
            'procedureId' => $this->procedure_id,
            'procedureLabel' => $this->procedure_label,
            'confidence' => (float) $this->confidence,
            'urgency' => $this->urgency,
            'travelPartySize' => (int) $this->travel_party_size,
            'preferredWindow' => $this->preferred_window,
            'symptomKeywords' => $this->symptom_keywords ?? [],
            'extractedEntities' => (object) ($this->extracted_entities ?? []),
            'requiresHumanReview' => (bool) $this->requires_human_review,
            'reviewReasons' => $this->review_reasons ?? [],
            'modelVersion' => $this->model_version,
            'latencyMs' => (int) $this->latency_ms,
            'createdAt' => $this->created_at?->toIso8601String(),
        ];
    }
}
