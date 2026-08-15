<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Message extends Model
{
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'ai_suggestion_confidence' => 'float',
    ];

    public function thread(): BelongsTo
    {
        return $this->belongsTo(MessageThread::class, 'thread_id');
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'threadId' => $this->thread_id,
            'inquiryId' => $this->inquiry_id,
            'channel' => $this->channel,
            'direction' => $this->direction,
            'body' => $this->body,
            'senderName' => $this->sender_name,
            'status' => $this->status,
            // A draft for a human to review, edit or discard. The send endpoint
            // takes a `body` parameter and never reads this column.
            'aiSuggestion' => $this->ai_suggestion,
            'aiSuggestionConfidence' => $this->ai_suggestion_confidence !== null
                ? (float) $this->ai_suggestion_confidence
                : null,
            'createdAt' => $this->created_at?->toIso8601String(),
        ];
    }
}
