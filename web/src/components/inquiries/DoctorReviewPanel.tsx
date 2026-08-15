import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, ClipboardList, Loader2, Stethoscope, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSubmitDoctorReview } from '@/hooks/queries'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CONFIDENCE_THRESHOLD } from '@/lib/constants'
import type { DoctorReviewDecision, InquiryDetail, ReviewReason } from '@/types'

const DECISIONS: { value: DoctorReviewDecision; label: string; hint: string }[] = [
  {
    value: 'CLEARED',
    label: 'Cleared for treatment',
    hint: 'Patient is suitable — release the quote to operations.',
  },
  {
    value: 'NEEDS_CONSULT',
    label: 'Needs pre-treatment consult',
    hint: 'Book a teleconsult or request records before quoting.',
  },
  {
    value: 'DECLINED',
    label: 'Declined',
    hint: 'Not suitable for the cross-border pathway. Escalates to human takeover.',
  },
]

/**
 * Clinical sign-off panel.
 *
 * The second half of the human-in-the-loop chain: a doctor, not the AI, decides
 * whether a patient is suitable for the cross-border pathway.
 */
/** Lowercased, punctuation-free, single-spaced — for comparing labels by meaning. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Symptoms the patient actually described, as opposed to the procedure name.
 *
 * A visitor who picks "Cataract Surgery" from a list gets it echoed back as a
 * symptom keyword, so the raw list frequently restates the procedure and
 * nothing else. Containment rather than equality, because the keyword is the
 * plain name while the label carries the catalogue qualifier ("Cataract
 * Surgery (per eye, phaco + IOL)").
 *
 * These sat in the AI panel, which was a poor home: the person who needs to
 * know what the patient reported feeling is the doctor deciding whether the
 * cross-border pathway suits them.
 */
function reportedSymptoms(detail: InquiryDetail): string[] {
  const extraction = detail.aiExtraction
  if (!extraction) return []

  const label = normalise(extraction.procedureLabel)

  return extraction.symptomKeywords.filter((keyword) => {
    const candidate = normalise(keyword)
    return candidate !== '' && !label.includes(candidate) && !candidate.includes(label)
  })
}

/**
 * Why the gate is holding this case.
 *
 * The confidence score sits inside the LOW_CONFIDENCE line rather than in a
 * meter of its own: a percentage is worth reading next to the threshold it
 * failed, and says very little anywhere else.
 */
function reasonCopy(reason: ReviewReason, detail: InquiryDetail): string {
  switch (reason) {
    case 'LOW_CONFIDENCE': {
      const pct = Math.round((detail.aiExtraction?.confidence ?? 0) * 100)
      return `Extraction scored ${pct}%, under the ${Math.round(
        CONFIDENCE_THRESHOLD * 100,
      )}% auto-quote threshold.`
    }
    case 'UNKNOWN_PROCEDURE':
      return 'The request did not map to a catalogue procedure.'
    case 'EMERGENCY_LANGUAGE':
      return 'Emergency or acute-symptom language was detected.'
    case 'HIGH_RISK_PROCEDURE':
      return `${detail.procedure?.name ?? 'This procedure'} always requires clinical sign-off.`
    case 'PRICE_OUT_OF_BAND':
      return 'Calculated price fell outside the approved band.'
  }
}

/**
 * The gate's reasons, or the procedure flag on its own when no extraction ran.
 * An inquiry with no extraction still escalates on a high-risk procedure, and
 * silence there would read as "nothing is holding this".
 */
function gateReasons(detail: InquiryDetail): ReviewReason[] {
  const extraction = detail.aiExtraction

  if (extraction?.requiresHumanReview && extraction.reviewReasons.length > 0) {
    return extraction.reviewReasons
  }

  return detail.procedure?.requiresDoctorReview ? ['HIGH_RISK_PROCEDURE'] : []
}

export function DoctorReviewPanel({ detail }: { detail: InquiryDetail }) {
  const review = detail.doctorReview
  const symptoms = reportedSymptoms(detail)
  const reasons = gateReasons(detail)
  const submitted = Boolean(review?.reviewedAt) && review?.decision !== 'PENDING'

  const [decision, setDecision] = useState<DoctorReviewDecision>(
    review?.decision && review.decision !== 'PENDING' ? review.decision : 'CLEARED',
  )
  const [notes, setNotes] = useState(review?.clinicalNotes ?? '')

  const submit = useSubmitDoctorReview(detail.id)

  const handleSubmit = () => {
    submit.mutate(
      { decision, clinicalNotes: notes.trim(), doctorId: detail.doctorId },
      {
        onSuccess: () => {
          toast.success('Clinical review recorded', {
            description:
              decision === 'CLEARED'
                ? 'Case released to operations for quoting.'
                : decision === 'DECLINED'
                  ? 'Case moved to Human Takeover.'
                  : 'Consult requested before quoting.',
          })
        },
        onError: () => toast.error('Could not record the review. Please retry.'),
      },
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 border-b border-slate-100">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-slate-400" />
            Doctor Review Panel
          </CardTitle>
          {detail.doctor ? (
            <p className="mt-1 text-sm text-slate-500">
              {detail.doctor.fullName} · {detail.doctor.specialty}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">No specialist assigned yet.</p>
          )}
        </div>
        <Badge
          variant={
            !submitted
              ? 'warning'
              : review?.decision === 'CLEARED'
                ? 'success'
                : review?.decision === 'DECLINED'
                  ? 'destructive'
                  : 'neutral'
          }
        >
          {submitted ? review!.decision.replace('_', ' ') : 'Pending'}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4 pt-5">
        {/*
          Why the case is held, in the panel where it gets released. This used
          to be a whole card of its own above the quote — the only part of it
          worth keeping was this list, and the person who needs it is whoever is
          about to sign the case off, so it lives here instead of adding a
          section to the page.
        */}
        {reasons.length > 0 && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
            <p className="font-semibold">
              Held for review before any quote reaches the patient.
            </p>
            <ul className="mt-1 space-y-0.5">
              {reasons.map((reason) => (
                <li key={reason}>• {reasonCopy(reason, detail)}</li>
              ))}
            </ul>
          </div>
        )}

        {symptoms.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Symptoms the patient described
            </p>
            <div className="flex flex-wrap gap-1.5">
              {symptoms.map((symptom) => (
                <Badge key={symptom} variant="neutral" size="sm">
                  {symptom}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {review && review.requiredPreOpTests.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <ClipboardList className="h-3 w-3" />
              Required pre-op tests
            </p>
            <ul className="space-y-1">
              {review.requiredPreOpTests.map((test) => (
                <li key={test} className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                  {test}
                </li>
              ))}
            </ul>
          </div>
        )}

        {submitted ? (
          <div
            className={cn(
              'rounded-lg border p-3',
              review!.decision === 'CLEARED'
                ? 'border-emerald-200 bg-emerald-50'
                : review!.decision === 'DECLINED'
                  ? 'border-rose-200 bg-rose-50'
                  : 'border-slate-200 bg-slate-50',
            )}
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {review!.decision === 'CLEARED' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : review!.decision === 'DECLINED' ? (
                <XCircle className="h-4 w-4 text-rose-600" />
              ) : (
                <ClipboardList className="h-4 w-4 text-slate-500" />
              )}
              {DECISIONS.find((d) => d.value === review!.decision)?.label ?? review!.decision}
            </p>
            {review!.clinicalNotes && (
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {review!.clinicalNotes}
              </p>
            )}
            <p className="mt-2 text-[11px] text-slate-400">
              Recorded {formatDateTime(review!.reviewedAt!)}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="decision">Clinical decision</Label>
              <Select
                value={decision}
                onValueChange={(value) => setDecision(value as DoctorReviewDecision)}
              >
                <SelectTrigger id="decision">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DECISIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">
                {DECISIONS.find((d) => d.value === decision)?.hint}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="clinical-notes">Clinical notes</Label>
              <Textarea
                id="clinical-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                placeholder="Records reviewed, contraindications considered, pathway suitability…"
              />
            </div>

            <Button
              onClick={handleSubmit}
              disabled={submit.isPending || !notes.trim()}
              className="w-full"
            >
              {submit.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Submit clinical review
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
