<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityEvent;
use App\Models\Doctor;
use App\Models\FerryRoute;
use App\Models\GroundTransport;
use App\Models\Hospital;
use App\Models\HospitalProcedure;
use App\Models\Hotel;
use App\Models\Procedure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Partner self-service: a supplier maintaining its own catalogue.
 *
 * Every write here is SCOPED TO ONE PARTNER by the id in the path, and each
 * handler re-checks that the row it is about to change actually belongs to that
 * partner. A hotel id in the URL must not be able to move a different hotel's
 * rate, and a doctor is only editable by the hospital that employs them.
 *
 * As everywhere else in this API there is no authentication yet, so that check
 * is an integrity check rather than a security boundary — it stops a wrong id
 * corrupting the wrong row, not a determined caller. Wrapping these routes in
 * auth:sanctum with a token pinned to the partner id is the remaining half.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO KINDS OF FIELD LIVE BEHIND THESE ENDPOINTS, AND THEY BEHAVE DIFFERENTLY.
 *
 * PARTNER-SCOPED — `hospital_procedure.price_sgd` and `.available`, a hotel's
 * nightly rate, a ferry fare, a transfer price, a doctor's consultation fee.
 * Changing one affects that partner and nobody else.
 *
 * SHARED — a procedure's name, its Singapore benchmark, its clinical days and
 * recovery nights. These live on `procedures` and are the SAME ROW for all
 * three hospitals, so an edit by one facility changes what the other two sell.
 * The API says so in its response (`sharedFields`), the UI warns before saving,
 * and every change is written to the activity feed.
 *
 * The Singapore benchmark deserves the loudest of those warnings: it is the
 * denominator of the savings figure the entire product is sold on (docs/09 D9).
 * Raising it makes a facility look cheaper without changing a single price a
 * patient pays. It is editable here because the marketplace chose partner
 * self-service; the audit trail is what keeps that decision reversible.
 * ─────────────────────────────────────────────────────────────────────────────
 */
class PartnerCatalogueController extends Controller
{
    /** Fields that are one row for everybody, not per-partner. */
    private const SHARED_PROCEDURE_FIELDS = [
        'sgBenchmarkSgd' => 'sg_benchmark_sgd',
        'treatmentDays' => 'treatment_days',
        'recoveryNights' => 'recovery_nights',
    ];

    /**
     * PATCH /partners/hospital/{id}/procedures/{procedureId}
     *
     * Price and availability are this hospital's own. The clinical definition
     * is shared, and saving it is announced.
     */
    public function updateHospitalProcedure(Request $request, string $id, string $procedureId): JsonResponse
    {
        $hospital = Hospital::whereKey($id)->firstOr(fn () => abort(404, 'Hospital not found.'));
        $procedure = Procedure::whereKey($procedureId)->firstOr(fn () => abort(404, 'Procedure not found.'));

        $data = $request->validate([
            // Mine.
            'priceSgd' => ['nullable', 'numeric', 'min:0'],
            'available' => ['nullable', 'boolean'],
            // Everyone's.
            'sgBenchmarkSgd' => ['nullable', 'numeric', 'min:0'],
            'treatmentDays' => ['nullable', 'integer', 'min:0', 'max:30'],
            'recoveryNights' => ['nullable', 'integer', 'min:0', 'max:30'],
        ]);

        if (array_key_exists('priceSgd', $data) || array_key_exists('available', $data)) {
            $row = HospitalProcedure::firstOrNew([
                'hospital_id' => $hospital->id,
                'procedure_id' => $procedure->id,
            ]);

            // A row that never existed inherits the catalogue base rather than
            // defaulting to zero — a free implant is not a sensible fallback.
            $row->price_sgd = $data['priceSgd'] ?? $row->price_sgd ?? $procedure->batam_price_sgd;
            $row->available = $data['available'] ?? $row->available ?? true;
            $row->save();
        }

        $sharedChanges = $this->applyShared($procedure, $data);

        if ($sharedChanges !== []) {
            ActivityEvent::record(
                'CATALOGUE_UPDATED',
                'STAFF',
                $hospital->name.' changed shared details on '.$procedure->name,
                'A field shared by every facility performing this procedure was edited from a partner portal.',
                [
                    'hospital_id' => $hospital->id,
                    'procedure_id' => $procedure->id,
                    'changed' => $sharedChanges,
                    'affects' => 'all facilities offering this procedure',
                ],
            );
        }

        return response()->json($this->procedureRow($hospital, $procedure->fresh()));
    }

    /** PATCH /partners/hospital/{id}/doctors/{doctorId} */
    public function updateDoctor(Request $request, string $id, string $doctorId): JsonResponse
    {
        $hospital = Hospital::whereKey($id)->firstOr(fn () => abort(404, 'Hospital not found.'));

        // Scoped by employer, not just by key — a hospital may only edit its own.
        $doctor = Doctor::whereKey($doctorId)->where('hospital_id', $hospital->id)
            ->firstOr(fn () => abort(404, 'That doctor does not work at this hospital.'));

        $data = $request->validate([
            'consultationFeeSgd' => ['nullable', 'numeric', 'min:0'],
            'yearsExperience' => ['nullable', 'integer', 'min:0', 'max:70'],
        ]);

        $doctor->update(array_filter([
            'consultation_fee_sgd' => $data['consultationFeeSgd'] ?? null,
            'years_experience' => $data['yearsExperience'] ?? null,
        ], fn ($value) => $value !== null));

        return response()->json($doctor->fresh()->toApi());
    }

    /** PATCH /partners/hotel/{id} */
    public function updateHotel(Request $request, string $id): JsonResponse
    {
        $hotel = Hotel::whereKey($id)->firstOr(fn () => abort(404, 'Hotel not found.'));

        $data = $request->validate([
            'nightlyRateSgd' => ['required', 'numeric', 'min:0'],
        ]);

        $hotel->update(['nightly_rate_sgd' => $data['nightlyRateSgd']]);

        return response()->json($hotel->fresh()->toApi());
    }

    /** PATCH /partners/ferry/{id} */
    public function updateFerry(Request $request, string $id): JsonResponse
    {
        $ferry = FerryRoute::whereKey($id)->firstOr(fn () => abort(404, 'Ferry route not found.'));

        $data = $request->validate(['priceSgd' => ['required', 'numeric', 'min:0']]);
        $ferry->update(['price_sgd' => $data['priceSgd']]);

        return response()->json($ferry->fresh()->toApi());
    }

    /** PATCH /partners/transport/{id} */
    public function updateTransport(Request $request, string $id): JsonResponse
    {
        $transport = GroundTransport::whereKey($id)
            ->firstOr(fn () => abort(404, 'Transport option not found.'));

        $data = $request->validate(['priceSgd' => ['required', 'numeric', 'min:0']]);
        $transport->update(['price_sgd' => $data['priceSgd']]);

        return response()->json($transport->fresh()->toApi());
    }

    /* ------------------------------------------------------------------ */

    /**
     * Applies the shared fields and reports which actually moved.
     *
     * @return array<string, array{from: mixed, to: mixed}>
     */
    private function applyShared(Procedure $procedure, array $data): array
    {
        $changes = [];

        foreach (self::SHARED_PROCEDURE_FIELDS as $input => $column) {
            if (! array_key_exists($input, $data) || $data[$input] === null) {
                continue;
            }

            $before = $procedure->{$column};
            $after = $data[$input];

            if ((float) $before === (float) $after) {
                continue;
            }

            $procedure->{$column} = $after;
            $changes[$input] = ['from' => $before, 'to' => $after];
        }

        if ($changes !== []) {
            $procedure->save();
        }

        return $changes;
    }

    /** One row as the hospital portal renders it. */
    private function procedureRow(Hospital $hospital, Procedure $procedure): array
    {
        $row = HospitalProcedure::where('hospital_id', $hospital->id)
            ->where('procedure_id', $procedure->id)
            ->first();

        return [
            'procedureId' => $procedure->id,
            'code' => $procedure->code,
            'name' => $procedure->name,
            'category' => $procedure->category,

            // Mine to set.
            'priceSgd' => (float) ($row?->price_sgd ?? $procedure->batam_price_sgd),
            'available' => (bool) ($row?->available ?? true),
            'hasOwnPrice' => $row !== null,

            // Shared with every other facility performing this procedure.
            'sgBenchmarkSgd' => (float) $procedure->sg_benchmark_sgd,
            'treatmentDays' => (int) $procedure->treatment_days,
            'recoveryNights' => (int) $procedure->recovery_nights,
            'requiresDoctorReview' => (bool) $procedure->requires_doctor_review,

            // So the UI never has to guess which warning to show.
            'sharedFields' => array_keys(self::SHARED_PROCEDURE_FIELDS),
        ];
    }
}
