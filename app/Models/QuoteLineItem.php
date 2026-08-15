<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class QuoteLineItem extends Model
{
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'unit_price_sgd' => 'float',
        'quantity' => 'integer',
    ];

    public function quote(): BelongsTo
    {
        return $this->belongsTo(Quote::class);
    }

    /** Computed, never stored — a subtotal column would drift from its inputs. */
    public function subtotalSgd(): float
    {
        return round($this->quantity * $this->unit_price_sgd, 2);
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'quoteId' => $this->quote_id,
            'category' => $this->category,
            'label' => $this->label,
            'detail' => $this->detail ?? '',
            'quantity' => (int) $this->quantity,
            'unitPriceSgd' => (float) $this->unit_price_sgd,
            'refType' => $this->ref_type,
            'refId' => $this->ref_id,
        ];
    }
}
