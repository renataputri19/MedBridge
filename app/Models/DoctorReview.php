<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DoctorReview extends Model
{
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'required_pre_op_tests' => 'array',
        'reviewed_at' => 'datetime',
    ];

    public function inquiry(): BelongsTo
    {
        return $this->belongsTo(Inquiry::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'inquiryId' => $this->inquiry_id,
            'doctorId' => $this->doctor_id,
            'decision' => $this->decision,
            'clinicalNotes' => $this->clinical_notes ?? '',
            'requiredPreOpTests' => $this->required_pre_op_tests ?? [],
            'reviewedAt' => $this->reviewed_at?->toIso8601String(),
        ];
    }
}
