<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Doctor extends Model
{
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'languages' => 'array',
        'consultation_fee_sgd' => 'float',
        'rating' => 'float',
    ];

    public function hospital(): BelongsTo
    {
        return $this->belongsTo(Hospital::class);
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'hospitalId' => $this->hospital_id,
            'fullName' => $this->full_name,
            'specialty' => $this->specialty,
            'qualifications' => $this->qualifications,
            'yearsExperience' => (int) $this->years_experience,
            'languages' => $this->languages,
            'consultationFeeSgd' => (float) $this->consultation_fee_sgd,
            'rating' => (float) $this->rating,
        ];
    }
}
