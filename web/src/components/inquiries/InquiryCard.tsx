import { Link } from 'react-router-dom'
import { AlertTriangle, Clock, Sparkles, Stethoscope } from 'lucide-react'
import { ChannelBadge } from '@/components/shared/ChannelBadge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { CONFIDENCE_THRESHOLD } from '@/lib/constants'
import { formatSgd, formatSla } from '@/lib/format'
import { cn, initials } from '@/lib/utils'
import {
  doctorLabel,
  inquiryConfidence,
  inquiryTotals,
  patientLabel,
  procedureLabel,
} from '@/lib/labels'
import type { Inquiry } from '@/types'

interface InquiryCardProps {
  inquiry: Inquiry
}

export function InquiryCard({ inquiry }: InquiryCardProps) {
  const patientName = patientLabel(inquiry)
  const procedureName = procedureLabel(inquiry, 'Awaiting classification')
  const doctorName = inquiry.doctorName ?? doctorLabel(inquiry, '')
  const totals = inquiryTotals(inquiry)
  const confidence = inquiryConfidence(inquiry)
  const sla = formatSla(inquiry.slaDueAt)

  return (
    <Link
      to={`/inquiries/${inquiry.id}`}
      className="block rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[11px] font-medium text-slate-400">
          {inquiry.reference}
        </span>
        <ChannelBadge channel={inquiry.channel} />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="text-[10px]">{initials(patientName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{patientName}</p>
          <p className="truncate text-xs text-slate-500">{procedureName}</p>
        </div>
      </div>

      {(totals || doctorName) && (
        <div className="mt-2.5 space-y-1 border-t border-slate-100 pt-2.5">
          {totals && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-slate-400">Bundle</span>
              <span className="tabular text-sm font-bold text-slate-900">
                {formatSgd(totals.totalSgd)}
              </span>
            </div>
          )}
          {totals && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-slate-400">Saves</span>
              <span className="tabular text-xs font-semibold text-teal-600">
                {formatSgd(totals.savingsSgd)} · {totals.savingsPct.toFixed(0)}%
              </span>
            </div>
          )}
          {doctorName && (
            <p className="flex items-center gap-1 truncate text-[11px] text-slate-500">
              <Stethoscope className="h-3 w-3 shrink-0 text-slate-400" />
              {doctorName}
            </p>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-2.5">
        {confidence !== null && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold',
              confidence >= CONFIDENCE_THRESHOLD
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-rose-50 text-rose-700',
            )}
          >
            {confidence >= CONFIDENCE_THRESHOLD ? (
              <Sparkles className="h-2.5 w-2.5" />
            ) : (
              <AlertTriangle className="h-2.5 w-2.5" />
            )}
            {Math.round(confidence * 100)}%
          </span>
        )}

        <span
          className={cn(
            'tabular inline-flex items-center gap-1 text-[10px] font-medium',
            sla.overdue ? 'text-rose-600' : sla.urgent ? 'text-amber-600' : 'text-slate-400',
          )}
        >
          <Clock className="h-2.5 w-2.5" />
          {sla.label}
        </span>

        {inquiry.assignedToName && (
          <span className="ml-auto truncate text-[10px] text-slate-400">
            {inquiry.assignedToName}
          </span>
        )}
      </div>
    </Link>
  )
}
