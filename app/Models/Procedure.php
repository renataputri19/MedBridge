<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;

class Procedure extends Model
{
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'synonyms' => 'array',
        'recovery_profile' => 'array',
        'sg_benchmark_sgd' => 'float',
        'batam_price_sgd' => 'float',
        'requires_doctor_review' => 'boolean',
    ];

    /**
     * What the patient should and should not be doing afterwards.
     *
     * Always returns the full shape so callers never have to null-check four
     * keys. An empty profile means "no travel restrictions we know of", which
     * is a different statement from "safe to do anything" — the panel is
     * labelled as travel information, not clinical clearance.
     *
     * @return array{avoid_categories:list<string>, avoid_tags:list<string>, prefer_tags:list<string>, note:string}
     */
    public function recoveryProfile(): array
    {
        $profile = $this->recovery_profile ?? [];

        return [
            'avoid_categories' => array_values((array) ($profile['avoid_categories'] ?? [])),
            'avoid_tags' => array_values((array) ($profile['avoid_tags'] ?? [])),
            'prefer_tags' => array_values((array) ($profile['prefer_tags'] ?? [])),
            'note' => (string) ($profile['note'] ?? ''),
        ];
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'category' => $this->category,
            'description' => $this->description,
            'sgBenchmarkSgd' => (float) $this->sg_benchmark_sgd,
            'batamPriceSgd' => (float) $this->batam_price_sgd,
            'treatmentDays' => (int) $this->treatment_days,
            'recoveryNights' => (int) $this->recovery_nights,
            'requiresDoctorReview' => (bool) $this->requires_doctor_review,
        ];
    }
}
