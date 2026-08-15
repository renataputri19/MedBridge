<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Quote extends Model
{
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'sg_benchmark_sgd' => 'float',
        'idr_per_sgd' => 'float',
        'approved_at' => 'datetime',
        'valid_until' => 'datetime',
    ];

    public function inquiry(): BelongsTo
    {
        return $this->belongsTo(Inquiry::class);
    }

    public function lineItems(): HasMany
    {
        return $this->hasMany(QuoteLineItem::class)->orderBy('sort_order');
    }

    public function totalSgd(): float
    {
        return round($this->lineItems->sum(fn (QuoteLineItem $i) => $i->quantity * $i->unit_price_sgd), 2);
    }

    public function totals(): array
    {
        $total = $this->totalSgd();
        $benchmark = (float) $this->sg_benchmark_sgd;
        $savings = $benchmark - $total;

        return [
            'totalSgd' => $total,
            'totalIdr' => (int) round($total * (float) $this->idr_per_sgd),
            'sgBenchmarkSgd' => $benchmark,
            'savingsSgd' => $savings,
            'savingsPct' => $benchmark > 0 ? ($savings / $benchmark) * 100 : 0.0,
        ];
    }

    public function toApi(): array
    {
        $this->loadMissing('lineItems');

        return [
            'id' => $this->id,
            'inquiryId' => $this->inquiry_id,
            'status' => $this->status,
            'lineItems' => $this->lineItems->map->toApi()->values()->all(),
            'sgBenchmarkSgd' => (float) $this->sg_benchmark_sgd,
            'idrPerSgd' => (float) $this->idr_per_sgd,
            'approvedByName' => $this->approved_by_name,
            'approvedAt' => $this->approved_at?->toIso8601String(),
            'validUntil' => $this->valid_until?->toIso8601String(),
            'notes' => $this->notes ?? '',
            'createdAt' => $this->created_at?->toIso8601String(),
            'updatedAt' => $this->updated_at?->toIso8601String(),
        ];
    }
}
