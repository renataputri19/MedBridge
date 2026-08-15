<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What a given hospital charges for a given procedure.
 *
 * The existence of this table is what lets the patient choose their hospital
 * rather than having one chosen for them: three facilities, three prices, one
 * decision that is theirs to make.
 */
class HospitalProcedure extends Model
{
    use HasUuidV4;

    protected $table = 'hospital_procedure';

    protected $guarded = [];

    protected $casts = [
        'price_sgd' => 'float',
        'available' => 'boolean',
    ];

    public function hospital(): BelongsTo
    {
        return $this->belongsTo(Hospital::class);
    }

    public function procedure(): BelongsTo
    {
        return $this->belongsTo(Procedure::class);
    }

    /**
     * Price for a procedure at a hospital, falling back to the catalogue base
     * when no facility-specific row exists.
     */
    public static function priceFor(string $hospitalId, Procedure $procedure): float
    {
        $row = static::where('hospital_id', $hospitalId)
            ->where('procedure_id', $procedure->id)
            ->first();

        return (float) ($row?->price_sgd ?? $procedure->batam_price_sgd);
    }
}
