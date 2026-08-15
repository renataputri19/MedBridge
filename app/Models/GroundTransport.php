<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;

class GroundTransport extends Model
{
    use HasUuidV4;

    protected $table = 'ground_transport';

    protected $guarded = [];

    protected $casts = [
        'price_sgd' => 'float',
    ];

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            'provider' => $this->provider,
            'description' => $this->description,
            'priceSgd' => (float) $this->price_sgd,
            'capacity' => (int) $this->capacity,
        ];
    }
}
