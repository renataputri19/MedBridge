<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;

class FerryRoute extends Model
{
    use HasUuidV4;

    protected $table = 'ferry_routes';

    protected $guarded = [];

    protected $casts = [
        'price_sgd' => 'float',
    ];

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'operator' => $this->operator,
            'direction' => $this->direction,
            'departTerminal' => $this->depart_terminal,
            'arriveTerminal' => $this->arrive_terminal,
            'departureTime' => $this->departure_time,
            'arrivalTime' => $this->arrival_time,
            'durationMinutes' => (int) $this->duration_minutes,
            'priceSgd' => (float) $this->price_sgd,
        ];
    }
}
