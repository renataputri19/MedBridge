<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * An anonymous visitor conversation.
 *
 * Holds slot-filling state and a draft bundle. It carries NO personally
 * identifying information until the visitor submits — someone pricing a
 * procedure at 2am leaves behind a procedure code and a date, nothing more.
 */
class ChatSession extends Model
{
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'slots' => 'array',
        'draft_lines' => 'array',
        'confidence' => 'float',
        'emergency_detected' => 'boolean',
        'expires_at' => 'datetime',
    ];

    public const STAGE_COLLECTING = 'COLLECTING';
    public const STAGE_RECOMMENDED = 'RECOMMENDED';
    public const STAGE_SUBMITTED = 'SUBMITTED';
    public const STAGE_EMERGENCY = 'EMERGENCY';

    public function messages(): HasMany
    {
        return $this->hasMany(ChatMessage::class)->orderBy('sequence');
    }

    /**
     * Opaque, URL-safe, deliberately NOT a UUID — it lives in a browser and
     * must never be replayable against the API as a database key.
     */
    public static function newToken(): string
    {
        $alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
        $out = '';
        for ($i = 0; $i < 24; $i++) {
            $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }

        return 'mbs_'.$out;
    }

    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    public function slot(string $key, $default = null)
    {
        return data_get($this->slots ?? [], $key, $default);
    }

    public function putSlots(array $values): void
    {
        $this->slots = array_merge($this->slots ?? [], $values);
    }

    public static function hashIp(?string $ip): ?string
    {
        return $ip ? hash('sha256', $ip.Str::of(config('app.key'))) : null;
    }
}
