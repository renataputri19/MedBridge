<?php

namespace App\Services;

use App\Models\Procedure;

/**
 * The human-in-the-loop gate.
 *
 * The backend is authoritative here. web/src/mock/generators.ts carries a copy
 * of this logic, but only so the offline mock behaves like the real thing —
 * production reads `requiresHumanReview` / `reviewReasons` off the wire.
 *
 * Two of the five reasons are tunable from Settings. Three are not, and that is
 * deliberate: a rule with a switch is a rule someone turns off on a busy Monday
 * while optimising throughput (docs/09 D7).
 *
 *   LOW_CONFIDENCE       tunable   — confidence below the threshold
 *   HIGH_RISK_PROCEDURE  tunable   — procedure flagged requires_doctor_review
 *   UNKNOWN_PROCEDURE    FIXED     — nothing in the catalogue matched
 *   EMERGENCY_LANGUAGE   FIXED     — acute-symptom keywords detected
 *   PRICE_OUT_OF_BAND    FIXED     — computed bundle outside the approved band
 */
class ReviewGate
{
    /**
     * @return array{requiresHumanReview:bool, reasons:list<string>, threshold:float}
     */
    public function evaluate(
        float $confidence,
        ?Procedure $procedure,
        string $sourceMessage,
        ?float $totalSgd = null,
        ?float $benchmarkSgd = null,
    ): array {
        $threshold = (float) config('medbridge.gate.confidence_threshold');
        $reasons = [];

        if ($confidence < $threshold) {
            $reasons[] = 'LOW_CONFIDENCE';
        }

        if (! $procedure) {
            $reasons[] = 'UNKNOWN_PROCEDURE';
        }

        if (self::detectEmergencyLanguage($sourceMessage)) {
            $reasons[] = 'EMERGENCY_LANGUAGE';
        }

        if (config('medbridge.gate.require_doctor_review_for_high_risk') && $procedure?->requires_doctor_review) {
            $reasons[] = 'HIGH_RISK_PROCEDURE';
        }

        if ($totalSgd !== null && $benchmarkSgd !== null && $benchmarkSgd > 0) {
            $ratio = $totalSgd / $benchmarkSgd;
            $min = (float) config('medbridge.gate.price_band_min_pct');
            $max = (float) config('medbridge.gate.price_band_max_pct');

            if ($ratio < $min || $ratio > $max) {
                $reasons[] = 'PRICE_OUT_OF_BAND';
            }
        }

        return [
            'requiresHumanReview' => count($reasons) > 0,
            'reasons' => array_values(array_unique($reasons)),
            'threshold' => $threshold,
        ];
    }

    /**
     * Runs in plain PHP, before any model call, so it still fires when the
     * provider is rate-limited or down. On a live chat this is the difference
     * between showing emergency numbers and showing a date picker.
     */
    public static function detectEmergencyLanguage(string $text): bool
    {
        $lower = mb_strtolower($text);

        foreach (config('medbridge.emergency_keywords', []) as $keyword) {
            if (str_contains($lower, mb_strtolower($keyword))) {
                return true;
            }
        }

        return false;
    }

    /**
     * Which pipeline state a gated inquiry lands in.
     *
     * Note what is missing: there is no branch that returns an approved state.
     * The gate can route a case to a human — it can never release one.
     *
     * @param  list<string>  $reasons
     */
    public function statusFor(array $reasons): string
    {
        if (in_array('EMERGENCY_LANGUAGE', $reasons, true) || in_array('UNKNOWN_PROCEDURE', $reasons, true)) {
            return 'HUMAN_TAKEOVER';
        }

        if (in_array('HIGH_RISK_PROCEDURE', $reasons, true)) {
            return 'DOCTOR_REVIEW_REQUIRED';
        }

        return 'HOSPITAL_REVIEW_REQUIRED';
    }

    /** @param list<string> $reasons */
    public function priorityFor(array $reasons, string $urgency): string
    {
        if (in_array('EMERGENCY_LANGUAGE', $reasons, true) || $urgency === 'URGENT') {
            return 'URGENT';
        }

        return $urgency === 'HIGH' ? 'HIGH' : 'NORMAL';
    }
}
