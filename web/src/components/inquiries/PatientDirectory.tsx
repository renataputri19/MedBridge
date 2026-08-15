import { Link } from 'react-router-dom'
import { ArrowRight, UserRound } from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { usePatientSummaries } from '@/hooks/queries'
import { formatRelative, formatSgd } from '@/lib/format'
import { initials } from '@/lib/utils'

/**
 * The people behind the pipeline.
 *
 * This was its own route, its own sidebar row and its own KPI band. It is the
 * same set of rows the board already shows, grouped by person instead of by
 * status — so it is a view of the pipeline, not a separate destination, and it
 * lives here as a tab.
 */
export function PatientDirectory({ search }: { search: string }) {
  const { data, isLoading } = usePatientSummaries()

  const query = search.trim().toLowerCase()
  const rows = query
    ? (data ?? []).filter(
        (row) =>
          row.patient.fullName.toLowerCase().includes(query) ||
          row.procedures.some((procedure) => procedure.toLowerCase().includes(query)),
      )
    : (data ?? [])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={UserRound}
        title={query ? 'No matching patients' : 'No patients yet'}
        description={
          query
            ? 'Try a different name or procedure.'
            : 'A patient record is created the first time someone submits a plan from the chat.'
        }
      />
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Patient</TableHead>
            <TableHead>Treatments</TableHead>
            <TableHead>Latest status</TableHead>
            <TableHead className="text-right">Cases</TableHead>
            <TableHead className="text-right">Lifetime value</TableHead>
            <TableHead className="text-right">Saved vs SG</TableHead>
            <TableHead className="text-right">Last contact</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.patient.id}>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{initials(row.patient.fullName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {row.patient.fullName}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {row.patient.phoneMasked}
                    </p>
                  </div>
                </div>
              </TableCell>

              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {row.procedures.length === 0 ? (
                    <span className="text-xs text-slate-400">—</span>
                  ) : (
                    row.procedures.map((procedure) => (
                      <Badge key={procedure} variant="secondary" size="sm">
                        {procedure}
                      </Badge>
                    ))
                  )}
                </div>
              </TableCell>

              <TableCell>
                {row.latestStatus ? <StatusBadge status={row.latestStatus} /> : '—'}
              </TableCell>

              <TableCell className="tabular text-right text-sm text-slate-600">
                {row.activeCaseCount} active / {row.caseCount}
              </TableCell>

              <TableCell className="tabular text-right text-sm font-medium text-slate-900">
                {formatSgd(row.lifetimeValueSgd)}
              </TableCell>

              <TableCell className="tabular text-right text-sm font-medium text-emerald-600">
                {formatSgd(row.lifetimeSavingsSgd)}
              </TableCell>

              <TableCell className="text-right text-xs text-slate-400">
                {row.lastContactAt ? formatRelative(row.lastContactAt) : '—'}
              </TableCell>

              <TableCell className="text-right">
                {row.latestInquiryId && (
                  <Button asChild variant="ghost" size="sm">
                    <Link to={`/inquiries/${row.latestInquiryId}`}>
                      Case
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
