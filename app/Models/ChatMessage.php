<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One turn of the visitor conversation.
 *
 * role = PATIENT  → verbatim text the visitor typed.
 * role = SYSTEM   → written by MedBridge from a fixed question bank.
 *
 * Hermes never authors a `body` on this table. It only chooses which question
 * comes next; the words are ours. See docs/01 rule 5.
 */
class ChatMessage extends Model
{
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'ui' => 'array',
    ];

    public const ROLE_PATIENT = 'PATIENT';
    public const ROLE_SYSTEM = 'SYSTEM';

    public function session(): BelongsTo
    {
        return $this->belongsTo(ChatSession::class, 'chat_session_id');
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'role' => $this->role,
            'body' => $this->body,
            'ui' => $this->ui,
            'createdAt' => $this->created_at?->toIso8601String(),
        ];
    }
}
