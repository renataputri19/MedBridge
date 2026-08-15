import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  Hourglass,
  Loader2,
  Info,
  Pencil,
  ToggleLeft,
  Stethoscope,
  ToggleRight,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  usePartner,
  useReviewQueue,
  useSubmitReview,
  useUpdatePartnerDoctor,
  useUpdatePartnerProcedure,
  useUpdatePartnerRate,
} from '@/hooks/queries'
import { BOOKING_STAGE_META, PARTNER_META } from '@/lib/partners'
import { formatDate, formatSgd } from '@/lib/format'
import { cn } from '@/lib/utils'
import type {
  PartnerCatalogue,
  PartnerDoctorRow,
  PartnerProcedureRow,
  PartnerReviewRow,
  PartnerType,
  ReviewReason,
  DoctorReviewDecision,
  UUID,
} from '@/types'

/**
 * One partner's view of MedBridge.
 *
 * Three questions, in the order a partner asks them: who is coming to me, what
 * am I owed, and what are my rates.
 *
 * WHAT IS ABSENT IS THE DESIGN. There is no commission figure, no other
 * partner's volume, and no patient contact detail on this page, because the
 * backend does not send any of them (see PartnerController). If one appears
 * here it is because someone widened the payload, and that is the thing to
 * revert.
 */
export default function PartnerPortal({ type }: { type: PartnerType }) {
  const { id } = useParams<{ id: string }>()
  const meta = PARTNER_META[type]
  const { data: portal, isLoading, isError } = usePartner(type, id)

  if (isError) {
    return (
      <div className="space-y-5">
        <BackLink type={type} />
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm font-medium text-slate-700">Could not load this portal</p>
            <p className="mt-1 text-xs text-slate-500">
              Either the partner does not exist or the API is unreachable.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isLoading || !portal) {
    return (
      <div className="space-y-5">
        <BackLink type={type} />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <BackLink type={type} />

      <PageHeader
        title={portal.name}
        description={`${meta.singular} · ${portal.district} — your ${meta.supplies} booked through MedBridge.`}
      />

      {/* ---- What am I owed, and for how many people ---------------------- */}
      {/* The same tile the operations dashboard uses — one stat presentation
          for the whole app, rather than a second one that drifts from it. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={CalendarCheck}
          accent="sky"
          label="Bookings"
          value={String(portal.bookingCount)}
          deltaPeriod="At any stage"
          hint="Every quote that includes your service."
        />
        <KpiCard
          icon={Hourglass}
          accent="amber"
          label="In review"
          value={String(portal.pendingCount)}
          deltaPeriod="Still with a coordinator"
          hint={`Patients who chose you — worth ${formatSgd(portal.pipelineSgd)} if approved.`}
        />
        <KpiCard
          icon={Users}
          accent="emerald"
          label="Confirmed by patient"
          value={String(portal.committedCount)}
          deltaPeriod="Accepted their pass"
          hint="These patients are travelling."
        />
        <KpiCard
          icon={Wallet}
          accent="teal"
          label="Due to you"
          value={formatSgd(portal.supplierSgd)}
          deltaPeriod="Approved work only"
          hint="Rows still in review are not counted here."
        />
      </div>

      {/*
        The disclaimer is not fine print here. A number under a "Due to you"
        heading is read as an invoice, and there is no payment record behind it.
      */}
      <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        <Info className="mt-px h-4 w-4 shrink-0 text-slate-400" />
        <span>{portal.disclaimer}</span>
      </p>

      {/* ---- Who is coming ------------------------------------------------ */}
      <Card>
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Patients booked with you</CardTitle>
          <p className="text-sm text-slate-500">
            First names only. MedBridge coordinates all patient contact.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {portal.bookings.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-500">
              No bookings yet. They appear here once a coordinator approves a quote that
              includes your {meta.supplies}.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead>Reference</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {portal.bookings.map((booking) => (
                  <TableRow key={`${booking.reference}-${booking.label}`}>
                    <TableCell className="font-mono text-xs text-slate-500">
                      {booking.reference}
                      {booking.travelDate && (
                        <p className="text-[11px] text-slate-400">
                          {formatDate(booking.travelDate)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium text-slate-900">
                      {booking.patientFirstName}
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[18rem] truncate">{booking.label}</p>
                      {booking.detail && (
                        <p className="max-w-[18rem] truncate text-xs text-slate-400">
                          {booking.detail}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                          BOOKING_STAGE_META[booking.stage].className,
                        )}
                        title={BOOKING_STAGE_META[booking.stage].hint}
                      >
                        {BOOKING_STAGE_META[booking.stage].label}
                      </span>
                    </TableCell>
                    {/*
                      A pending row shows its value greyed and labelled, never
                      as a bold figure in the owed column — the amount is real,
                      but it is not yours until a coordinator approves it.
                    */}
                    <TableCell className="tabular whitespace-nowrap text-right">
                      {booking.stage === 'PENDING' ? (
                        <span className="text-slate-400">
                          {formatSgd(booking.expectedSgd)}
                          <span className="ml-1 text-[10px]">if approved</span>
                        </span>
                      ) : (
                        <span className="font-semibold text-slate-900">
                          {formatSgd(booking.supplierSgd)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ---- Cases waiting on my clinical judgement ------------------------ */}
      {type === 'hospital' && <ClinicalSignOff hospitalId={portal.id} />}

      {/* ---- My rates, which I maintain ----------------------------------- */}
      {type === 'hospital' ? (
        <>
          <HospitalProcedures hospitalId={portal.id} rows={portal.catalogue.procedures ?? []} />
          <HospitalDoctors hospitalId={portal.id} rows={portal.catalogue.doctors ?? []} />
        </>
      ) : (
        <SingleRatePanel type={type} id={portal.id} catalogue={portal.catalogue} />
      )}

      <Card>
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Your details on file</CardTitle>
          <p className="text-sm text-slate-500">
            Descriptive information MedBridge holds about you. To correct any of it, speak to
            your coordinator.
          </p>
        </CardHeader>
        <CardContent className="pt-5">
          <CatalogueGrid catalogue={portal.catalogue} />
        </CardContent>
      </Card>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Clinical sign-off                                                           */
/* -------------------------------------------------------------------------- */

const REASON_COPY: Record<ReviewReason, string> = {
  LOW_CONFIDENCE: 'The request was not understood confidently.',
  UNKNOWN_PROCEDURE: 'The request did not match a listed procedure.',
  EMERGENCY_LANGUAGE: 'The patient used emergency or acute-symptom language.',
  HIGH_RISK_PROCEDURE: 'This procedure always requires clinical sign-off.',
  PRICE_OUT_OF_BAND: 'The quoted price fell outside the expected band.',
}

const DECISIONS: { value: DoctorReviewDecision; label: string; hint: string }[] = [
  {
    value: 'CLEARED',
    label: 'Suitable for treatment',
    hint: 'Hands the case back to a MedBridge coordinator to finalise the quote.',
  },
  {
    value: 'NEEDS_CONSULT',
    label: 'Needs a consult first',
    hint: 'Keeps the case with you. Nothing is quoted until you decide.',
  },
  {
    value: 'DECLINED',
    label: 'Not suitable',
    hint: 'The case is escalated to a MedBridge coordinator to speak to the patient.',
  },
]

/**
 * Cases this facility must decide on before MedBridge can quote them.
 *
 * This is the half of the human-in-the-loop chain that belongs to the hospital.
 * It moved here from the operations portal, where it was both misplaced and
 * unscoped — MedBridge does not employ the surgeon, and judging whether a
 * patient is suitable for a procedure is the treating facility's call.
 *
 * Clearing a case releases nothing on its own: it hands the case back to a
 * coordinator, who still has to approve the quote before any patient sees a
 * link. That sentence is on screen, because a button that reads like final
 * approval will be pressed like one.
 */
function ClinicalSignOff({ hospitalId }: { hospitalId: UUID }) {
  const { data: queue, isLoading } = useReviewQueue(hospitalId)
  const [openRef, setOpenRef] = useState<string | null>(null)

  const pending = queue?.pending ?? []

  return (
    <Card>
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-slate-400" />
          Waiting for your clinical sign-off
          {pending.length > 0 && (
            <span className="tabular rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              {pending.length}
            </span>
          )}
        </CardTitle>
        <p className="text-sm text-slate-500">
          Patients who chose you and cannot be quoted until a clinician here decides they are
          suitable. Your decision does not send anything to the patient — a MedBridge coordinator
          approves the quote afterwards.
        </p>
      </CardHeader>

      <CardContent className="pt-5">
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : pending.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            Nothing is waiting on you.
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((row) => (
              <ReviewRow
                key={row.reference}
                hospitalId={hospitalId}
                row={row}
                open={openRef === row.reference}
                onToggle={() => setOpenRef(openRef === row.reference ? null : row.reference)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function ReviewRow({
  hospitalId,
  row,
  open,
  onToggle,
}: {
  hospitalId: UUID
  row: PartnerReviewRow
  open: boolean
  onToggle: () => void
}) {
  const [decision, setDecision] = useState<DoctorReviewDecision>('CLEARED')
  const [notes, setNotes] = useState('')

  const submit = useSubmitReview(hospitalId)

  const send = () => {
    submit.mutate(
      {
        reference: row.reference,
        decision,
        clinicalNotes: notes.trim(),
        doctorId: row.doctorId,
      },
      {
        onSuccess: () => {
          toast.success('Clinical decision recorded', {
            description:
              decision === 'CLEARED'
                ? 'Sent back to a MedBridge coordinator to finalise the quote.'
                : decision === 'DECLINED'
                  ? 'A coordinator will contact the patient.'
                  : 'The case stays with you until the consult is done.',
          })
        },
        onError: () => toast.error('Could not record the decision. Please retry.'),
      },
    )
  }

  return (
    <li className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">
            {row.patientFirstName} · {row.procedureName}
          </p>
          <p className="font-mono text-[11px] text-slate-400">
            {row.reference}
            {row.doctorName && ` · ${row.doctorName}`}
          </p>
        </div>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-100 p-3">
          {row.reviewReasons.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="font-semibold">Why this needs you</p>
              <ul className="mt-1 space-y-0.5">
                {row.reviewReasons.map((reason) => (
                  <li key={reason}>• {REASON_COPY[reason]}</li>
                ))}
              </ul>
            </div>
          )}

          {row.symptomKeywords.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Symptoms the patient described
              </p>
              <div className="flex flex-wrap gap-1.5">
                {row.symptomKeywords.map((symptom) => (
                  <Badge key={symptom} variant="neutral" size="sm">
                    {symptom}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={`decision-${row.reference}`}>Clinical decision</Label>
            <Select
              value={decision}
              onValueChange={(value) => setDecision(value as DoctorReviewDecision)}
            >
              <SelectTrigger id={`decision-${row.reference}`}>
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
            <Label htmlFor={`notes-${row.reference}`}>Clinical notes</Label>
            <Textarea
              id={`notes-${row.reference}`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Records reviewed, contraindications considered, pathway suitability…"
            />
          </div>

          <Button
            onClick={send}
            disabled={submit.isPending || !notes.trim()}
            size="sm"
            className="w-full"
          >
            {submit.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            Record decision
          </Button>
        </div>
      )}
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Self-service                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The hospital's own price list.
 *
 * `priceSgd` and `available` are this facility's alone. The columns to their
 * right are ONE SHARED ROW across every hospital performing the procedure, and
 * that has to be visible before someone edits one — an invisible shared field
 * is how a facility changes a competitor's listing while believing it is
 * editing its own.
 */
function HospitalProcedures({
  hospitalId,
  rows,
}: {
  hospitalId: UUID
  rows: PartnerProcedureRow[]
}) {
  const update = useUpdatePartnerProcedure(hospitalId)
  // Two independently editable fields per row: the price this facility owns,
  // and the benchmark it shares with the other two.
  const [editing, setEditing] = useState<{ id: UUID; field: 'price' | 'benchmark' } | null>(null)
  const [draft, setDraft] = useState(0)

  if (rows.length === 0) {
    return null
  }

  const isEditing = (id: UUID, field: 'price' | 'benchmark') =>
    editing?.id === id && editing.field === field

  return (
    <Card>
      <CardHeader className="border-b border-slate-100">
        <CardTitle>Your procedures &amp; prices</CardTitle>
        <p className="text-sm text-slate-500">
          What MedBridge quotes for you. Price changes apply to new quotes only — a bundle
          already sent keeps the price it was built with.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead>Procedure</TableHead>
              <TableHead className="text-right">Your price</TableHead>
              <TableHead className="text-center">Offered</TableHead>
              <TableHead className="text-right">
                SG benchmark
                <span className="ml-1 font-normal normal-case text-amber-700">shared</span>
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const editingPrice = isEditing(row.procedureId, 'price')
              const editingBenchmark = isEditing(row.procedureId, 'benchmark')

              return (
                <TableRow key={row.procedureId}>
                  <TableCell>
                    <p className="font-medium text-slate-900">{row.name}</p>
                    <p className="font-mono text-[11px] text-slate-400">{row.code}</p>
                  </TableCell>

                  <TableCell className="text-right">
                    {editingPrice ? (
                      <RateInput
                        id={`proc-${row.procedureId}`}
                        label="Your price"
                        value={draft}
                        onChange={setDraft}
                        className="ml-auto"
                      />
                    ) : (
                      <span className="tabular font-semibold text-slate-900">
                        {formatSgd(row.priceSgd)}
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="text-center">
                    {/*
                      The one lever a facility has over what we sell for it.
                      Switching this off removes the hospital from the patient's
                      options for this procedure immediately.
                    */}
                    <Button
                      variant={row.available ? 'ghost' : 'outline'}
                      size="sm"
                      onClick={() =>
                        update.mutate(
                          {
                            procedureId: row.procedureId,
                            patch: { available: !row.available },
                          },
                          {
                            onSuccess: () =>
                              toast.success(
                                row.available
                                  ? `${row.name} withdrawn — patients will no longer be offered it here`
                                  : `${row.name} is offered again`,
                              ),
                          },
                        )
                      }
                    >
                      {row.available ? (
                        <>
                          <ToggleRight className="h-4 w-4 text-emerald-600" />
                          On
                        </>
                      ) : (
                        <>
                          <ToggleLeft className="h-4 w-4 text-slate-400" />
                          Off
                        </>
                      )}
                    </Button>
                  </TableCell>

                  {/*
                    Editable, and amber wherever it is touched. This single
                    number is the denominator of the savings figure shown to
                    every patient, for every facility — so the warning lives at
                    the point of edit rather than in a footnote nobody reads
                    while typing.
                  */}
                  <TableCell className="text-right">
                    {editingBenchmark ? (
                      <div className="flex items-center justify-end gap-1">
                        <RateInput
                          id={`bench-${row.procedureId}`}
                          label="Singapore benchmark"
                          value={draft}
                          onChange={setDraft}
                        />
                        <Button variant="ghost" size="icon-sm" onClick={() => setEditing(null)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="success"
                          disabled={draft <= 0 || update.isPending}
                          onClick={() =>
                            update.mutate(
                              { procedureId: row.procedureId, patch: { sgBenchmarkSgd: draft } },
                              {
                                onSuccess: () => {
                                  setEditing(null)
                                  toast.warning('Shared benchmark changed', {
                                    description:
                                      'This applies to every facility performing this procedure, and it moves the savings figure patients are shown. The change has been logged.',
                                  })
                                },
                                onError: () => toast.error('Could not save that benchmark.'),
                              },
                            )
                          }
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(row.sgBenchmarkSgd)
                          setEditing({ id: row.procedureId, field: 'benchmark' })
                        }}
                        className="tabular inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-500 hover:bg-amber-50 hover:text-amber-900"
                        title="Shared with every facility performing this procedure"
                      >
                        {formatSgd(row.sgBenchmarkSgd)}
                        <Pencil className="h-3 w-3 opacity-50" />
                      </button>
                    )}
                  </TableCell>

                  <TableCell className="text-right">
                    {editingPrice ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => setEditing(null)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="success"
                          disabled={draft <= 0 || update.isPending}
                          onClick={() =>
                            update.mutate(
                              { procedureId: row.procedureId, patch: { priceSgd: draft } },
                              {
                                onSuccess: () => {
                                  setEditing(null)
                                  toast.success(`${row.name} repriced`)
                                },
                                onError: () => toast.error('Could not save that price.'),
                              },
                            )
                          }
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          setDraft(row.priceSgd)
                          setEditing({ id: row.procedureId, field: 'price' })
                        }}
                        aria-label={`Edit price for ${row.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>

      <p className="flex items-start gap-2 border-t border-slate-100 px-6 py-3 text-[11px] leading-relaxed text-amber-800">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span>
          <span className="font-semibold">The Singapore benchmark is shared. </span>
          Your price is yours alone, but the benchmark is one figure for every facility
          performing this procedure — and it is what each patient&apos;s savings is measured
          against. Editing it changes what the other hospitals show too, and every change is
          recorded in the MedBridge activity log.
        </span>
      </p>
    </Card>
  )
}

/** Consultation fees, scoped to the doctors this hospital employs. */
function HospitalDoctors({ hospitalId, rows }: { hospitalId: UUID; rows: PartnerDoctorRow[] }) {
  const update = useUpdatePartnerDoctor(hospitalId)
  const [editingId, setEditingId] = useState<UUID | null>(null)
  const [draft, setDraft] = useState(0)

  if (rows.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader className="border-b border-slate-100">
        <CardTitle>Your specialists</CardTitle>
        <p className="text-sm text-slate-500">
          Only doctors you employ. Their specialty decides which procedures they can be
          recommended for.
        </p>
      </CardHeader>
      <CardContent className="pt-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map((doctor) => {
            const editing = editingId === doctor.doctorId

            return (
              <div key={doctor.doctorId} className="rounded-lg border border-slate-200 p-3.5">
                <p className="text-sm font-semibold text-slate-900">{doctor.name}</p>
                <p className="text-xs text-slate-500">{doctor.specialty}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">{doctor.qualifications}</p>

                <div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-100 pt-2.5">
                  <div>
                    <p className="text-[11px] text-slate-400">Consultation fee</p>
                    {editing ? (
                      <RateInput
                        id={`doc-${doctor.doctorId}`}
                        label="Consultation fee"
                        value={draft}
                        onChange={setDraft}
                      />
                    ) : (
                      <p className="tabular text-base font-bold text-slate-900">
                        {formatSgd(doctor.consultationFeeSgd)}
                      </p>
                    )}
                  </div>

                  {editing ? (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditingId(null)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="success"
                        disabled={draft <= 0 || update.isPending}
                        onClick={() =>
                          update.mutate(
                            { doctorId: doctor.doctorId, patch: { consultationFeeSgd: draft } },
                            {
                              onSuccess: () => {
                                setEditingId(null)
                                toast.success(`${doctor.name} fee updated`)
                              },
                              onError: () => toast.error('Could not save that fee.'),
                            },
                          )
                        }
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDraft(doctor.consultationFeeSgd)
                        setEditingId(doctor.doctorId)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit fee
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

/** Hotels, ferries and transfer providers each own exactly one number. */
function SingleRatePanel({
  type,
  id,
  catalogue,
}: {
  type: PartnerType
  id: UUID
  catalogue: PartnerCatalogue
}) {
  const update = useUpdatePartnerRate(type, id)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(0)

  const current =
    type === 'hotel' ? (catalogue.nightlyRateSgd ?? 0) : (catalogue.priceSgd ?? 0)

  const label =
    type === 'hotel' ? 'Nightly rate' : type === 'ferry' ? 'Fare per seat' : 'Price per loop'

  return (
    <Card>
      <CardHeader className="border-b border-slate-100">
        <CardTitle>Your rate</CardTitle>
        <p className="text-sm text-slate-500">
          What MedBridge quotes for you. Changes apply to new quotes only — a bundle already
          sent keeps the rate it was built with.
        </p>
      </CardHeader>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] text-slate-400">{label}</p>
            {editing ? (
              <RateInput id={`rate-${id}`} label={label} value={draft} onChange={setDraft} />
            ) : (
              <p className="tabular text-2xl font-bold text-slate-900">{formatSgd(current)}</p>
            )}
          </div>

          {editing ? (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button
                size="sm"
                variant="success"
                disabled={draft <= 0 || update.isPending}
                onClick={() =>
                  update.mutate(draft, {
                    onSuccess: () => {
                      setEditing(false)
                      toast.success('Rate updated')
                    },
                    onError: () => toast.error('Could not save that rate.'),
                  })
                }
              >
                <Check className="h-3.5 w-3.5" />
                Save
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(current)
                setEditing(true)
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit rate
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** Shared numeric input, matching the one the ops catalogue used. */
function RateInput({
  id,
  label,
  value,
  onChange,
  className,
}: {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  className?: string
}) {
  return (
    <div className={cn('relative w-28', className)}>
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
        S$
      </span>
      <Input
        id={id}
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value)))}
        className="tabular h-9 pl-7 pr-2 text-right text-sm"
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function BackLink({ type }: { type: PartnerType }) {
  const meta = PARTNER_META[type]

  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link to={`/${meta.path}`}>
        <ArrowLeft className="h-3.5 w-3.5" />
        All {meta.plural.toLowerCase()}
      </Link>
    </Button>
  )
}

/**
 * Renders whatever the backend chose to send for this partner type.
 *
 * Generic on purpose: a hospital's catalogue is procedures and doctors, a
 * ferry's is a schedule, and hard-coding four layouts here would mean the
 * frontend and `PartnerController::catalogue()` had to be edited in lockstep
 * forever.
 */
function CatalogueGrid({ catalogue }: { catalogue: PartnerCatalogue }) {
  // The editable fields have their own panels above; this is the descriptive
  // remainder, so they are filtered out rather than rendered twice.
  const EDITED_ELSEWHERE = ['procedures', 'doctors', 'nightlyRateSgd', 'priceSgd']

  const entries = Object.entries(catalogue as Record<string, unknown>).filter(
    ([key]) => !EDITED_ELSEWHERE.includes(key),
  )

  return (
    <div className="space-y-5">
      {/* Scalars first — the at-a-glance facts. */}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {entries
          .filter(([, value]) => !Array.isArray(value))
          .map(([key, value]) => (
            <div key={key}>
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                {humanise(key)}
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">
                {formatValue(key, value)}
              </dd>
            </div>
          ))}
      </dl>

      {entries
        .filter(([, value]) => Array.isArray(value) && (value as unknown[]).length > 0)
        .map(([key, value]) => (
          <div key={key}>
            <p className="mb-2 text-xs font-semibold text-slate-700">{humanise(key)}</p>
            <div className="flex flex-wrap gap-1.5">
              {(value as unknown[]).map((item, index) => (
                <span
                  key={index}
                  className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600"
                >
                  {describe(item)}
                </span>
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (char) => char.toUpperCase())
    .replace(/ Sgd$/i, ' (SGD)')
    .trim()
}

function formatValue(key: string, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' && /sgd$/i.test(key)) return formatSgd(value)
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

/** One entry in a list — a procedure with its price, or a plain tag. */
function describe(item: unknown): string {
  if (item === null || typeof item !== 'object') return String(item)

  const row = item as Record<string, unknown>
  const name = String(row.name ?? '')
  const price = typeof row.priceSgd === 'number' ? row.priceSgd : null
  const fee = typeof row.consultationFeeSgd === 'number' ? row.consultationFeeSgd : null
  const amount = price ?? fee

  return amount !== null ? `${name} · ${formatSgd(amount)}` : name
}
