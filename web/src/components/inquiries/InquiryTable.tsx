import { useNavigate } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ChannelBadge } from '@/components/shared/ChannelBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRelative, formatSgd, formatSla } from '@/lib/format'
import { cn } from '@/lib/utils'
import { patientMap } from '@/mock/seed'
import {
  doctorLabel,
  inquiryConfidence,
  inquiryTotals,
  patientLabel,
  procedureLabel,
} from '@/lib/labels'
import { CONFIDENCE_THRESHOLD } from '@/lib/constants'
import type { Inquiry } from '@/types'

export function InquiryTable({
  inquiries,
  loading,
}: {
  inquiries: Inquiry[]
  loading?: boolean
}) {
  const navigate = useNavigate()

  if (loading) {
    return (
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (inquiries.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No inquiries match these filters"
        description="Try clearing the search or selecting a different status."
      />
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50 hover:bg-slate-50">
            <TableHead>Reference</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead>Procedure</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Bundle</TableHead>
            <TableHead className="text-right">Saving</TableHead>
            <TableHead className="text-right">Confidence</TableHead>
            <TableHead>SLA</TableHead>
            <TableHead>Assigned</TableHead>
            <TableHead className="text-right">Updated</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {inquiries.map((inquiry) => {
            const patientName = patientLabel(inquiry, '—')
            const procedureName = procedureLabel(inquiry, 'Unmapped')
            const doctorName = inquiry.doctorName ?? doctorLabel(inquiry, '')
            const phoneMasked =
              inquiry.patientPhoneMasked ?? patientMap.get(inquiry.patientId)?.phoneMasked ?? ''
            const totals = inquiryTotals(inquiry)
            const confidence = inquiryConfidence(inquiry)
            const sla = formatSla(inquiry.slaDueAt)

            return (
              <TableRow
                key={inquiry.id}
                onClick={() => navigate(`/inquiries/${inquiry.id}`)}
                className="cursor-pointer"
              >
                <TableCell className="font-mono text-xs text-slate-500">
                  <div className="flex flex-col gap-1">
                    {inquiry.reference}
                    <ChannelBadge channel={inquiry.channel} />
                  </div>
                </TableCell>

                <TableCell>
                  <p className="whitespace-nowrap font-medium text-slate-900">{patientName}</p>
                  <p className="text-xs text-slate-400">{phoneMasked}</p>
                </TableCell>

                <TableCell>
                  <p className="max-w-[15rem] truncate">{procedureName}</p>
                  {doctorName && (
                    <p className="max-w-[15rem] truncate text-xs text-slate-400">{doctorName}</p>
                  )}
                </TableCell>

                <TableCell>
                  <StatusBadge status={inquiry.status} short />
                </TableCell>

                <TableCell className="tabular whitespace-nowrap text-right font-semibold text-slate-900">
                  {totals ? formatSgd(totals.totalSgd) : '—'}
                </TableCell>

                <TableCell className="tabular whitespace-nowrap text-right font-medium text-teal-600">
                  {totals ? formatSgd(totals.savingsSgd) : '—'}
                </TableCell>

                <TableCell className="text-right">
                  {confidence === null ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <span
                      className={cn(
                        'tabular text-sm font-semibold',
                        confidence >= CONFIDENCE_THRESHOLD
                          ? 'text-emerald-600'
                          : 'text-rose-600',
                      )}
                    >
                      {Math.round(confidence * 100)}%
                    </span>
                  )}
                </TableCell>

                <TableCell
                  className={cn(
                    'tabular whitespace-nowrap text-xs font-medium',
                    sla.overdue ? 'text-rose-600' : sla.urgent ? 'text-amber-600' : 'text-slate-400',
                  )}
                >
                  {sla.label}
                </TableCell>

                <TableCell className="whitespace-nowrap text-xs text-slate-500">
                  {inquiry.assignedToName ?? 'Unassigned'}
                </TableCell>

                <TableCell className="whitespace-nowrap text-right text-xs text-slate-400">
                  {formatRelative(inquiry.updatedAt)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
