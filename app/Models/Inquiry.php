<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Inquiry extends Model
{
    use HasUuidV4;

    protected $table = 'inquiries';

    protected $guarded = [];

    protected $casts = [
        'sla_due_at' => 'datetime',
        'token_expires_at' => 'datetime',
    ];

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function hospital(): BelongsTo
    {
        return $this->belongsTo(Hospital::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function procedure(): BelongsTo
    {
        return $this->belongsTo(Procedure::class);
    }

    public function aiExtraction(): HasOne
    {
        return $this->hasOne(AiExtraction::class);
    }

    public function quote(): HasOne
    {
        return $this->hasOne(Quote::class);
    }

    public function doctorReview(): HasOne
    {
        return $this->hasOne(DoctorReview::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(ActivityEvent::class);
    }

    /**
     * Human-readable operational label (MBP-2026-0001). Indexed and unique, but
     * never a foreign key and never a substitute for the UUID.
     */
    public static function nextReference(): string
    {
        $year = now()->year;
        $prefix = "MBP-{$year}-";

        $last = static::where('reference', 'like', $prefix.'%')
            ->orderByDesc('reference')
            ->value('reference');

        $n = $last ? ((int) substr($last, strlen($prefix))) + 1 : 1;

        return $prefix.str_pad((string) $n, 4, '0', STR_PAD_LEFT);
    }

    /**
     * Opaque patient token: `mbp_` + 24 chars from a 32-char alphabet.
     * Generated separately from the row id so a leaked itinerary link grants
     * exactly one thing — read access to that itinerary. See docs/09 D5.
     */
    public static function newItineraryToken(): string
    {
        $alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
        $out = '';
        for ($i = 0; $i < 24; $i++) {
            $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }

        return 'mbp_'.$out;
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'reference' => $this->reference,
            'patientId' => $this->patient_id,
            'hospitalId' => $this->hospital_id,
            'doctorId' => $this->doctor_id,
            'procedureId' => $this->procedure_id,

            /*
             * DISPLAY LABELS, denormalised on purpose.
             *
             * A list row shows a patient's name, and the id alone cannot
             * produce one. The portal used to resolve these client-side against
             * `web/src/mock/seed.ts`, which works only for seeded demo rows
             * whose UUIDs are pinned in both worlds — every REAL case submitted
             * through the chat rendered as "Unknown patient", because its
             * patient was created in the database and has no mock counterpart.
             *
             * Names, not contact details: `phoneMasked`/`emailMasked` stay on
             * the detail payload behind `patient`. This adds nothing the
             * operations portal was not already displaying.
             */
            'patientName' => $this->patient?->full_name,
            // Already masked by the same accessor the detail payload uses, and
            // already rendered on the pipeline table. Never the raw number.
            'patientPhoneMasked' => $this->patient
                ? Patient::maskPhone($this->patient->phone_e164)
                : null,
            'procedureName' => $this->procedure?->name,
            'hospitalName' => $this->hospital?->name,
            'doctorName' => $this->doctor?->full_name,
            /*
             * The two numbers every pipeline row shows, for exactly the same
             * reason the display labels above are here.
             *
             * The board and the table used to read these out of `mock/db.ts` —
             * the offline fixture — so a real case submitted through the chat
             * rendered with no price and no confidence badge while its quote
             * and extraction sat in the database. Names had already been moved
             * onto this payload; these had not, and they failed identically.
             *
             * Both are null when the case has no quote or no extraction yet,
             * which the UI renders as an em dash — an honest "not yet", not a
             * misleading zero.
             */
            'confidence' => $this->aiExtraction ? (float) $this->aiExtraction->confidence : null,
            'totals' => $this->quote?->totals(),

            'status' => $this->status,
            'priority' => $this->priority,
            'channel' => $this->channel,
            'sourceMessage' => $this->source_message,
            'assignedToName' => $this->assigned_to_name,
            'itineraryToken' => $this->itinerary_token,
            'slaDueAt' => $this->sla_due_at?->toIso8601String(),
            'createdAt' => $this->created_at?->toIso8601String(),
            'updatedAt' => $this->updated_at?->toIso8601String(),
        ];
    }

    /** The inquiry joined with everything the operations UI needs at once. */
    public function toApiDetail(): array
    {
        $this->loadMissing([
            'patient', 'hospital', 'doctor', 'procedure',
            'aiExtraction', 'quote.lineItems', 'doctorReview',
        ]);

        return array_merge($this->toApi(), [
            'patient' => $this->patient?->toApi(),
            'hospital' => $this->hospital?->toApi(),
            'doctor' => $this->doctor?->toApi(),
            'procedure' => $this->procedure?->toApi(),
            'aiExtraction' => $this->aiExtraction?->toApi(),
            'quote' => $this->quote?->toApi(),
            'doctorReview' => $this->doctorReview?->toApi(),
        ]);
    }
}
