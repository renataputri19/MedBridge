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
import type { DoctorReviewDecision, InquiryDetail } from '@/types'

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
export function DoctorReviewPanel({ detail }: { detail: InquiryDetail }) {
  const review = detail.doctorReview
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
        {detail.procedure?.requiresDoctorReview && (
          <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
            <span className="font-semibold">{detail.procedure.name}</span> is flagged as
            requiring clinical sign-off before any quote is released.
          </p>
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
