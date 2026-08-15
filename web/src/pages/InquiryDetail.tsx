import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Clock, ExternalLink, FileWarning, Hospital, MapPin } from 'lucide-react'
import { PatientPanel } from '@/components/inquiries/PatientPanel'
import { DoctorReviewPanel } from '@/components/inquiries/DoctorReviewPanel'
import { QuoteBuilder } from '@/components/inquiries/QuoteBuilder'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ChannelBadge } from '@/components/shared/ChannelBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { useInquiry } from '@/hooks/queries'
import { formatDate, formatDateTime, formatSla } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * `preferred_window` is a date from the web chat ("2026-10-15") but free text
 * from anywhere else ("Next 2–4 weeks"). Format what parses; pass through what
 * does not, rather than rendering "Invalid Date" at a coordinator.
 */
function travelWindow(value: string): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  return /^\d{4}-\d{2}-\d{2}/.test(trimmed) && !Number.isNaN(Date.parse(trimmed))
    ? formatDate(trimmed)
    : trimmed
}

export default function InquiryDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: detail, isLoading, isError } = useInquiry(id)

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-1" />
          <Skeleton className="h-96 lg:col-span-2" />
        </div>
      </div>
    )
  }

  if (isError || !detail) {
    return (
      <EmptyState
        icon={FileWarning}
        title="Inquiry not found"
        description="This case may have been reassigned or removed."
        action={
          <Button asChild variant="outline">
            <Link to="/inquiries">Back to pipeline</Link>
          </Button>
        }
      />
    )
  }

  const sla = formatSla(detail.slaDueAt)
  const extraction = detail.aiExtraction

  const summary = [
    detail.patient.fullName,
    detail.procedure?.name ?? 'Awaiting classification',
    extraction ? travelWindow(extraction.preferredWindow) : null,
    extraction
      ? `${extraction.travelPartySize} traveller${extraction.travelPartySize === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-3 border-b border-slate-200 pb-5">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/inquiries">
            <ArrowLeft className="h-4 w-4" />
            Back to pipeline
          </Link>
        </Button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-lg font-bold text-slate-900">{detail.reference}</h1>
              <StatusBadge status={detail.status} />
              <ChannelBadge channel={detail.channel} />
              {detail.priority === 'URGENT' && <Badge variant="destructive">Urgent</Badge>}
            </div>
            {/*
              The trip facts moved up here from the extraction card. When the
              patient travels and how many of them are travelling are the two
              things a coordinator needs before touching anything else, and they
              were buried in a panel whose other contents were duplicates.
            */}
            <p className="mt-1 text-sm text-slate-500">{summary.join(' · ')}</p>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            <span
              className={cn(
                'tabular inline-flex items-center gap-1.5 text-sm font-semibold',
                sla.overdue ? 'text-rose-600' : sla.urgent ? 'text-amber-600' : 'text-slate-500',
              )}
            >
              <Clock className="h-4 w-4" />
              {sla.label}
            </span>
            <span className="text-xs text-slate-400">
              Opened {formatDateTime(detail.createdAt)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left rail */}
        <div className="space-y-6 lg:col-span-1">
          <PatientPanel detail={detail} />

          {/* Facility */}
          <Card>
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="flex items-center gap-2">
                <Hospital className="h-4 w-4 text-slate-400" />
                Treating Facility
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-5">
              <div>
                <p className="text-sm font-semibold text-slate-900">{detail.hospital.name}</p>
                <p className="mt-0.5 flex items-start gap-1.5 text-xs text-slate-500">
                  <MapPin className="mt-px h-3 w-3 shrink-0" />
                  {detail.hospital.address}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" size="sm">
                  {detail.hospital.accreditation}
                </Badge>
                {detail.hospital.searchUrl && (
                  <a
                    href={detail.hospital.searchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Reviews on Google
                  </a>
                )}
              </div>

              <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
                <span className="font-medium">{detail.hospital.minutesFromTerminal} min</span> from{' '}
                {detail.hospital.nearestTerminal}
              </div>

              {detail.doctor && (
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-sm font-semibold text-slate-900">{detail.doctor.fullName}</p>
                  <p className="text-xs text-slate-500">{detail.doctor.specialty}</p>
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    {detail.doctor.qualifications}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {detail.doctor.yearsExperience} yrs · Speaks{' '}
                    {detail.doctor.languages.join(', ')}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6 lg:col-span-2">
          <QuoteBuilder detail={detail} />
          <DoctorReviewPanel detail={detail} />
        </div>
      </div>
    </div>
  )
}
