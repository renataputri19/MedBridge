<?php

namespace App\Models;

use App\Models\Concerns\HasCoordinates;
use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Hospital extends Model
{
    use HasCoordinates;
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'specialties' => 'array',
        'latitude' => 'float',
        'longitude' => 'float',
    ];

    public function doctors(): HasMany
    {
        return $this->hasMany(Doctor::class);
    }

    /**
     * What this facility performs, and what it charges.
     *
     * The pivot carries the price because the same procedure costs different
     * amounts at the three hospitals — that difference is the thing that makes
     * the patient's choice of hospital a real one.
     */
    public function procedures(): BelongsToMany
    {
        return $this->belongsToMany(Procedure::class, 'hospital_procedure')
            ->withPivot(['price_sgd', 'available'])
            ->withTimestamps();
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'district' => $this->district,
            'address' => $this->address,
            'accreditation' => $this->accreditation,
            'specialties' => $this->specialties,
            'minutesFromTerminal' => (int) $this->minutes_from_terminal,
            'nearestTerminal' => $this->nearest_terminal,
            'latitude' => $this->latitude !== null ? (float) $this->latitude : null,
            'longitude' => $this->longitude !== null ? (float) $this->longitude : null,
            // A Google search by name, not a map pin. Google resolves the
            // business and shows the live rating and reviews; we store, mirror
            // and invent none of it.
            'searchUrl' => $this->searchUrl(),
            'sourceUrl' => $this->sourceUrl(),
        ];
    }
}
