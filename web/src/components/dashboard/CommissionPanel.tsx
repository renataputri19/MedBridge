import { Info, PieChart } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { METER_FILL, METER_TRACK, QUOTE_CATEGORY_META } from '@/lib/constants'
import { formatPercent, formatSgd } from '@/lib/format'
import type { SaasSummary } from '@/types'

/**
 * Where the money comes from.
 *
 * The dashboard reported a gross booking figure and left the reader to work out
 * what MedBridge actually keeps. This answers it in the order the question gets
 * asked: what share do we take, of how much, and which lines produce it.
 *
 * The share is a METER — one quantity filling one bar against a lighter step of
 * the same ramp — because it is a single ratio against a whole, not two series
 * competing for attention. Per-category commission is plotted; the rate beside
 * it is NOT, because a percentage and an amount are different scales and
 * plotting both against one axis is the classic dual-axis lie.
 *
 * Every figure here is entitlement from approved quotes. Nothing in MedBridge
 * records a payment, and the basis line says so rather than leaving a number
 * under a money heading to be read as an invoice.
 */
export function CommissionPanel({
  summary,
  loading,
}: {
  summary: SaasSummary | undefined
  loading?: boolean
}) {
  if (loading || !summary) {
    return (
      <Card>
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Where the money comes from</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <Skeleton className="h-16 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    )
  }

  const { grossBookingSgd, commissionSgd, supplierPayoutSgd, takeRatePct } = summary

  // Guard the geometry, not just the display: a zero gross would otherwise
  // divide to NaN and render a bar of width "NaN%".
  const sharePct = grossBookingSgd > 0 ? (commissionSgd / grossBookingSgd) * 100 : 0

  const topCommission = Math.max(
    ...summary.commissionByCategory.map((row) => row.commissionSgd),
    0,
  )

  return (
    <Card>
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <PieChart className="h-4 w-4 text-slate-400" />
          Where the money comes from
        </CardTitle>
        <p className="text-sm text-slate-500">
          What MedBridge keeps out of every trip it books, and which lines produce it.
        </p>
      </CardHeader>

      <CardContent className="space-y-6 pt-5">
        {/* ---- The headline ratio ---------------------------------------- */}
        <div>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              {/*
                Slate ink, not teal. The meter below carries the identity — a
                value wearing its series colour is the thing that makes a
                dashboard read as decoration.
              */}
              <p className="text-5xl font-bold leading-none tracking-tight text-slate-900">
                {formatPercent(takeRatePct, 1)}
              </p>
              <p className="mt-1.5 text-sm text-slate-500">
                blended take rate across every approved quote
              </p>
            </div>

            <div className="text-right">
              <p className="tabular text-xl font-semibold text-slate-900">
                {formatSgd(commissionSgd, true)}
              </p>
              <p className="text-xs text-slate-500">
                of {formatSgd(grossBookingSgd, true)} booked
              </p>
            </div>
          </div>

          {/*
            The meter. Fill and track are two steps of one teal ramp, so the
            eye reads a single bar filling up rather than two rival colours.
            A 2px surface gap separates them; both ends are rounded 4px.
          */}
          <div
            className="mt-4 flex h-3 w-full gap-[2px] overflow-hidden rounded"
            role="img"
            aria-label={`MedBridge keeps ${formatPercent(takeRatePct, 1)} of gross booking value: ${formatSgd(commissionSgd, true)} commission, ${formatSgd(supplierPayoutSgd, true)} paid to partners.`}
          >
            <div
              className="h-full rounded-l"
              style={{ width: `${sharePct}%`, minWidth: 4, background: METER_FILL }}
            />
            <div className="h-full flex-1 rounded-r" style={{ background: METER_TRACK }} />
          </div>

          {/*
            Legend AND direct labels — two parts, so identity is never carried
            by colour alone.
          */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
            <span className="flex items-center gap-1.5 text-xs text-slate-600">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: METER_FILL }}
                aria-hidden
              />
              MedBridge commission
              <span className="tabular font-semibold text-slate-900">
                {formatSgd(commissionSgd, true)}
              </span>
            </span>

            <span className="flex items-center gap-1.5 text-xs text-slate-600">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: METER_TRACK }}
                aria-hidden
              />
              Paid to partners
              <span className="tabular font-semibold text-slate-900">
                {formatSgd(supplierPayoutSgd, true)}
              </span>
            </span>
          </div>
        </div>

        {/* ---- Which lines produce it ------------------------------------ */}
        <div>
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Commission by line
          </p>

          {summary.commissionByCategory.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
              No approved quotes yet, so nothing has been earned to break down.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {summary.commissionByCategory.map((row) => {
                const meta = QUOTE_CATEGORY_META[row.category]
                // Bars are scaled to the largest line, not to the total — with
                // six lines summing to 100% every bar would otherwise be a
                // sliver and the comparison would be unreadable.
                const width = topCommission > 0 ? (row.commissionSgd / topCommission) * 100 : 0

                return (
                  <li key={row.category}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-medium text-slate-700">{meta.label}</span>
                      <span className="flex shrink-0 items-baseline gap-2">
                        <span className="tabular text-xs text-slate-500">
                          {formatPercent(row.ratePct)} rate
                        </span>
                        <span className="tabular w-20 text-right font-semibold text-slate-900">
                          {formatSgd(row.commissionSgd, true)}
                        </span>
                      </span>
                    </div>

                    <div
                      className="mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-100"
                      title={`${meta.label}: ${formatSgd(row.commissionSgd, true)} at a ${formatPercent(row.ratePct)} rate — ${meta.hint}`}
                    >
                      <div
                        className="h-full rounded"
                        style={{ width: `${width}%`, minWidth: width > 0 ? 4 : 0, background: METER_FILL }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* ---- What the numbers are, and are not -------------------------- */}
        <div className="space-y-2 border-t border-slate-100 pt-4">
          {summary.pendingQuotes > 0 && (
            <p className="text-xs text-slate-500">
              <span className="font-semibold text-slate-700">
                {formatSgd(summary.pipelineCommissionSgd, true)}
              </span>{' '}
              more sits in {summary.pendingQuotes} quote
              {summary.pendingQuotes === 1 ? '' : 's'} still awaiting approval, and is
              deliberately excluded from every figure above.
            </p>
          )}

          {/*
            Coordination bills at 100% because it is our own fee, not a share of
            a supplier's line. Left unsaid, that row reads as a 100% markup on
            somebody else's work.
          */}
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-400">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              Coordination is charged at 100% because it is MedBridge&apos;s own fee, not a
              cut of a partner&apos;s line. {summary.basis}
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
