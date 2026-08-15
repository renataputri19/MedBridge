<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityEvent;
use App\Models\Doctor;
use App\Models\DoctorReview;
use App\Models\Hospital;
use App\Models\Inquiry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Clinical sign-off, performed by the hospital that would do the operation.
 *
 * This used to live on the operations portal as `POST inquiries/{id}/doctor-review`,
 * unscoped — any caller could clear any case. That was the wrong building: MedBridge
 * coordinates a trip, it does not employ the surgeon, and deciding whether a patient
 * is suitable for a procedure is the treating facility's judgement to make and its
 * liability to carry. So the endpoint moved here and grew an owner.
 *
 * Scoped by the hospital in the path, and the inquiry must actually be assigned to
 * that hospital — one facility cannot clear a case that another is treating. As
 * everywhere else in this API there is no authentication yet, so that check is an
 * integrity check rather than a security boundary; it stops the wrong id writing to
 * the wrong case, not a determined caller. Pinning a partner's Sanctum token to its
 * own id is the remaining half.
 *
 * This is the FIRST half of the human-in-the-loop chain, and it releases nothing on
 * its own. CLEARED moves the case to HOSPITAL_REVIEW_REQUIRED, where a MedBridge
 * coordinator still has to approve the quote before a patient link exists. A doctor
 * saying "this patient is suitable" and an operator saying "this quote is correct"
 * are different questions, and `QuoteController::approve` remains the only route in
 * the system that can mint an itinerary token.
 */
class PartnerReviewController extends Controller
{
    /**
     * GET /partners/hospital/{id}/reviews
     *
     * Cases at this facility waiting on a clinical decision.
     *
     * Carries no patient contact details and no inquiry UUID — the same rule the
     * bookings list follows. A first name and the operational reference are enough
     * to know who is being discussed; the reference is what a coordinator will
     * quote back on the phone.
     */
    public function index(string $id): JsonResponse
    {
        $hospital = Hospital::whereKey($id)->firstOr(fn () => abort(404, 'Hospital not found.'));

        $rows = Inquiry::with(['patient', 'procedure', 'doctor', 'doctorReview', 'aiExtraction'])
            ->where('hospital_id', $hospital->id)
            ->where('status', 'DOCTOR_REVIEW_REQUIRED')
            ->orderBy('created_at')
            ->get()
            ->map(fn (Inquiry $inquiry) => [
                'reference' => $inquiry->reference,
                'patientFirstName' => strtok((string) ($inquiry->patient?->full_name ?? ''), ' ') ?: '—',
                'procedureName' => $inquiry->procedure?->name ?? 'Awaiting classification',
                'doctorName' => $inquiry->doctor?->full_name,
                'doctorId' => $inquiry->doctor_id,
                // Why the gate is holding it, so the reviewing clinician is not
                // guessing at what they are being asked to look at.
                'reviewReasons' => $inquiry->aiExtraction?->review_reasons ?? [],
                'symptomKeywords' => $inquiry->aiExtraction?->symptom_keywords ?? [],
                'requestedAt' => $inquiry->created_at?->toIso8601String(),
                'decision' => $inquiry->doctorReview?->decision ?? 'PENDING',
            ])
            ->values()
            ->all();

        return response()->json([
            'hospitalId' => $hospital->id,
            'hospitalName' => $hospital->name,
            'pending' => $rows,
        ]);
    }

    /**
     * POST /partners/hospital/{id}/reviews/{reference}
     *
     * Addressed by the human-readable reference rather than the inquiry UUID.
     * A partner never receives our primary keys — the bookings list has always
     * been built that way, and handing one out here just to route a write would
     * undo that for no gain.
     */
    public function store(Request $request, string $id, string $reference): JsonResponse
    {
        $hospital = Hospital::whereKey($id)->firstOr(fn () => abort(404, 'Hospital not found.'));

        // Scoped by treating facility, not just by reference — a hospital may
        // only sign off the cases it is actually treating.
        $inquiry = Inquiry::where('reference', $reference)
            ->where('hospital_id', $hospital->id)
            ->firstOr(fn () => abort(404, 'That case is not being treated at this hospital.'));

        $data = $request->validate([
            'decision' => ['required', Rule::in(['CLEARED', 'NEEDS_CONSULT', 'DECLINED'])],
            'clinicalNotes' => ['required', 'string', 'max:4000'],
            // Only this hospital's own specialists may be named on the review.
            'doctorId' => [
                'nullable', 'uuid',
                Rule::exists('doctors', 'id')->where('hospital_id', $hospital->id),
            ],
            'requiredPreOpTests' => ['nullable', 'array'],
            'requiredPreOpTests.*' => ['string', 'max:120'],
        ]);

        $doctorId = $data['doctorId'] ?? $inquiry->doctor_id;

        // Whoever is named must belong here, including the value we inherited
        // from the inquiry — a hospital swap could have left a stale specialist.
        if ($doctorId && ! Doctor::whereKey($doctorId)->where('hospital_id', $hospital->id)->exists()) {
            $doctorId = null;
        }

        DoctorReview::updateOrCreate(
            ['inquiry_id' => $inquiry->id],
            [
                'doctor_id' => $doctorId,
                'decision' => $data['decision'],
                'clinical_notes' => $data['clinicalNotes'],
                'required_pre_op_tests' => $data['requiredPreOpTests'] ?? [],
                'reviewed_at' => now(),
            ]
        );

        $status = match ($data['decision']) {
            // Cleared clinically, still unapproved commercially.
            'CLEARED' => 'HOSPITAL_REVIEW_REQUIRED',
            'DECLINED' => 'HUMAN_TAKEOVER',
            // A consult request holds the case where it is: still unsuitable to
            // quote, and still the hospital's to decide.
            default => $inquiry->status,
        };

        $inquiry->update(['status' => $status, 'doctor_id' => $doctorId]);

        ActivityEvent::record(
            'DOCTOR_REVIEW_SUBMITTED', 'DOCTOR',
            'Doctor review — '.$data['decision'],
            $data['clinicalNotes'],
            [
                'decision' => $data['decision'],
                'resulting_status' => $status,
                'hospital_id' => $hospital->id,
            ],
            $inquiry,
            $data['decision'] === 'DECLINED' ? 'warning' : 'success',
        );

        return response()->json([
            'reference' => $inquiry->reference,
            'decision' => $data['decision'],
            'status' => $status,
        ]);
    }
}
