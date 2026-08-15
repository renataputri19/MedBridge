<?php

namespace App\Models;

use App\Models\Concerns\HasCoordinates;
use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;

/**
 * A recovery hotel.
 *
 * Note the absence of a distance column. How far this hotel is from "the
 * hospital" is not a property of the hotel — it depends entirely on which of
 * the three hospitals the patient chose, so it is computed against that choice
 * via `distanceKmTo()`.
 */
class Hotel extends Model
{
    use HasCoordinates;
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'amenities' => 'array',
        'nightly_rate_sgd' => 'float',
        'latitude' => 'float',
        'longitude' => 'float',
        'medical_recovery_certified' => 'boolean',
    ];

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'district' => $this->district,
            'starRating' => (int) $this->star_rating,
            'nightlyRateSgd' => (float) $this->nightly_rate_sgd,
            'latitude' => $this->latitude !== null ? (float) $this->latitude : null,
            'longitude' => $this->longitude !== null ? (float) $this->longitude : null,
            'searchUrl' => $this->searchUrl(),
            'sourceUrl' => $this->sourceUrl(),
            'amenities' => $this->amenities,
            'medicalRecoveryCertified' => (bool) $this->medical_recovery_certified,
        ];
    }
}
