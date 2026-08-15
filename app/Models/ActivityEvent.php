<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The audit log.
 *
 * `payload` holds STRUCTURED BACKEND FACTS — model version, confidence, the
 * entity map, timings, gate decisions. It is rendered verbatim in the debug
 * inspector on /ai-activity, so it must never contain model prose.
 */
class ActivityEvent extends Model
{
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'payload' => 'array',
    ];

    /**
     * Microsecond timestamps. Several events are written inside one request, so
     * second resolution would let the feed order them arbitrarily. The column
     * is declared timestamps(6) to match.
     */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    public function inquiry(): BelongsTo
    {
        return $this->belongsTo(Inquiry::class);
    }

    public static function record(
        string $type,
        string $actor,
        string $title,
        string $description,
        array $payload = [],
        ?Inquiry $inquiry = null,
        string $level = 'info',
        ?int $durationMs = null,
    ): self {
        return static::create([
            'inquiry_id' => $inquiry?->id,
            'inquiry_reference' => $inquiry?->reference,
            'type' => $type,
            'actor' => $actor,
            'level' => $level,
            'title' => $title,
            'description' => $description,
            'payload' => $payload,
            'duration_ms' => $durationMs,
        ]);
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'inquiryId' => $this->inquiry_id,
            'inquiryReference' => $this->inquiry_reference,
            'type' => $this->type,
            'actor' => $this->actor,
            'level' => $this->level,
            'title' => $this->title,
            'description' => $this->description,
            'payload' => (object) ($this->payload ?? []),
            'durationMs' => $this->duration_ms !== null ? (int) $this->duration_ms : null,
            'createdAt' => $this->created_at?->toIso8601String(),
        ];
    }
}
