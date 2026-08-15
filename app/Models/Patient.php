<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Patient extends Model
{
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'consent_given' => 'boolean',
        'consent_at' => 'datetime',
    ];

    /**
     * Raw contact columns never leave the backend. Hiding them here is a
     * backstop — toApi() is the contract, this stops an accidental ->toJson().
     */
    protected $hidden = ['phone_e164', 'email'];

    public function inquiries(): HasMany
    {
        return $this->hasMany(Inquiry::class);
    }

    /** Mask down to country code + last 3 digits. */
    public static function maskPhone(?string $raw): string
    {
        if (! $raw) {
            return '—';
        }
        $digits = preg_replace('/\D/', '', $raw);
        if (strlen($digits) < 5) {
            return '•••';
        }

        return '+'.substr($digits, 0, 2).' •••• '.substr($digits, -3);
    }

    public static function maskEmail(?string $raw): string
    {
        if (! $raw || ! str_contains($raw, '@')) {
            return '—';
        }
        [$local, $domain] = explode('@', $raw, 2);
        $head = substr($local, 0, 2);

        return $head.str_repeat('•', max(strlen($local) - 2, 2)).'@'.$domain;
    }

    public function firstName(): string
    {
        return explode(' ', trim($this->full_name))[0] ?: 'there';
    }

    /**
     * PII BOUNDARY: masking happens here, at the serializer, never on the
     * client. phone_e164 and email must not appear in any response.
     */
    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'fullName' => $this->full_name,
            'phoneMasked' => self::maskPhone($this->phone_e164),
            'emailMasked' => self::maskEmail($this->email),
            'countryCode' => $this->country_code,
            'yearOfBirth' => (int) $this->year_of_birth,
            'gender' => $this->gender,
            'preferredChannel' => $this->preferred_channel,
            'preferredLanguage' => $this->preferred_language,
            'createdAt' => $this->created_at?->toIso8601String(),
        ];
    }
}
