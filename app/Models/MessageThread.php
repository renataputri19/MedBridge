<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class MessageThread extends Model
{
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'last_message_at' => 'datetime',
    ];

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class, 'thread_id')->orderBy('created_at');
    }

    public function toApi(): array
    {
        $this->loadMissing('messages', 'patient');

        return [
            'id' => $this->id,
            'patientId' => $this->patient_id,
            // The name to put on the conversation. Resolving this client-side
            // against the offline mock made every real patient "Unknown".
            'patientName' => $this->patient?->full_name,
            'inquiryId' => $this->inquiry_id,
            'channel' => $this->channel,
            'subject' => $this->subject,
            'unreadCount' => (int) $this->unread_count,
            'lastMessageAt' => $this->last_message_at?->toIso8601String(),
            'messages' => $this->messages->map->toApi()->values()->all(),
        ];
    }
}
