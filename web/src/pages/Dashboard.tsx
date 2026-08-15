import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, ClipboardCheck, Inbox, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { CommissionPanel } from '@/components/dashboard/CommissionPanel'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
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
import { useInquiries, useSaasSummary } from '@/hooks/queries'
import { REVIEW_STATUSES } from '@/lib/constants'
import {
  formatCompactSgd,
  formatNumber,
  formatPercent,
  formatRelative,
  formatSgd,
} from '@/lib/format'
import { inquiryTotals, patientLabel, procedureLabel } from '@/lib/labels'

const RECENT_LIMIT = 8

/**
 * The whole business on one screen: four numbers and the latest cases.
 *
 * This page used to stack six bands — a revenue strip, four KPI tiles, a
 * partner network grid, an attention band, a pipeline strip and a catalogue
 * coverage matrix — over a dataset of a handful of rows. That is a lot of
 * apparatus to say "one case came in". A dashboard that needs scrolling to
 * report a quiet day is not reporting anything.
 *
 * So: what needs a human, what is waiting on a patient, who is travelling,
 * what it is worth — then the actual cases, each one click from here.
 */
export default function Dashboard() {
  const { data: summary, isLoading: summaryLoading } = useSaasSummary()
  const { data: inquiries, isLoading: inquiriesLoading } = useInquiries()

  const rows = inquiries ?? []
  const needsReview = rows.filter((row) => REVIEW_STATUSES.includes(row.status)).length
  const recent = rows.slice(0, RECENT_LIMIT)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Cases moving through MedBridge, and what they are worth."
        actions={
          <Button asChild>
            <Link to="/inquiries">
              Open pipeline
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Needs review"
          value={inquiriesLoading ? '—' : formatNumber(needsReview)}
          icon={ClipboardCheck}
          accent="amber"
          loading={inquiriesLoading}
          deltaPeriod="Waiting on a human"
          hint="Cases the gate stopped. Nothing reaches a patient until one of these is signed off."
        />
        <KpiCard
          label="Open cases"
          value={inquiriesLoading ? '—' : formatNumber(rows.length)}
          icon={Inbox}
          accent="sky"
          loading={inquiriesLoading}
          deltaPeriod="Across every status"
        />
        <KpiCard
          label="Confirmed patients"
          value={summary ? formatNumber(summary.committedPatients) : '—'}
          icon={BadgeCheck}
          accent="emerald"
          loading={summaryLoading}
          deltaPeriod="Accepted their pass"
          hint="No payment is recorded or settled in this system."
        />
        {/*
          The tile leads with what MedBridge earns, not with what flows through
          it. Gross is the bigger number but it is mostly other people's money —
          reading it as "our revenue" overstates the business by a factor of
          seven. The gross sits underneath as the basis for the rate.
        */}
        <KpiCard
          label="MedBridge commission"
          value={summary ? formatCompactSgd(summary.commissionSgd) : '—'}
          icon={Wallet}
          accent="teal"
          loading={summaryLoading}
          deltaPeriod={summary ? `${formatPercent(summary.takeRatePct, 1)} take rate` : 'Take rate'}
          hint={
            summary
              ? `From ${formatCompactSgd(summary.grossBookingSgd)} of approved bookings. ${formatCompactSgd(summary.supplierPayoutSgd)} goes to partners.`
              : undefined
          }
        />
      </div>

      <CommissionPanel summary={summary} loading={summaryLoading} />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-slate-100">
          <CardTitle>Recent cases</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/inquiries">
              View all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {inquiriesLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No cases yet"
              description="A case appears here the moment a visitor submits their plan from the patient chat."
              action={
                <Button asChild variant="outline">
                  <Link to="/">Open the patient chat</Link>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Procedure</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Opened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((row) => {
                  const totals = inquiryTotals(row)

                  return (
                    <TableRow key={row.id} className="cursor-pointer">
                      <TableCell>
                        <Link
                          to={`/inquiries/${row.id}`}
                          className="font-mono text-xs font-medium text-brand-600 hover:underline"
                        >
                          {row.reference}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium text-slate-900">
                        {patientLabel(row)}
                      </TableCell>
                      <TableCell className="text-slate-500">
                        {procedureLabel(row, 'Awaiting classification')}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      {/* An em dash, never a zero — a case with no quote yet is
                          not a case worth nothing. */}
                      <TableCell className="tabular text-right font-medium text-slate-900">
                        {totals ? formatSgd(totals.totalSgd) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs text-slate-400">
                        {formatRelative(row.createdAt)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
