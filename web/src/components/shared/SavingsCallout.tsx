import { TrendingDown } from 'lucide-react'
import { formatIdr, formatSgd } from '@/lib/format'
import { cn } from '@/lib/utils'

interface SavingsCalloutProps {
  singaporeSgd: number
  medbridgeSgd: number
  savingsSgd: number
  savingsPct: number
  totalIdr?: number
  /** Larger treatment for the patient-facing itinerary. */
  size?: 'default' | 'hero'
  className?: string
}

/**
 * The commercial headline: Singapore benchmark vs the MedBridge bundle.
 * Used on both the operations quote builder and the patient itinerary.
 */
export function SavingsCallout({
  singaporeSgd,
  medbridgeSgd,
  savingsSgd,
  savingsPct,
  totalIdr,
  size = 'default',
  className,
}: SavingsCalloutProps) {
  const hero = size === 'hero'

  return (
    <div
      className={cn(
        'overflow-hidden border border-teal-200 bg-gradient-to-br from-teal-50 via-white to-brand-50',
        hero ? 'rounded-2xl shadow-sm' : 'rounded-xl',
        className,
      )}
    >
      <div className="grid grid-cols-2 divide-x divide-slate-200">
        <div className={cn('p-4', hero && 'p-5 sm:p-6')}>
          <p
            className={cn(
              'font-semibold uppercase tracking-wide text-slate-500',
              hero ? 'text-xs' : 'text-[11px]',
            )}
          >
            Singapore Benchmark
          </p>
          <p
            className={cn(
              'tabular font-bold text-slate-400 line-through decoration-slate-300 decoration-2',
              hero ? 'mt-2 text-2xl sm:text-3xl' : 'mt-1 text-xl',
            )}
          >
            {formatSgd(singaporeSgd)}
          </p>
          <p
            className={cn(
              'leading-relaxed text-slate-400',
              hero ? 'mt-2 text-xs' : 'mt-1 text-[11px] leading-snug',
            )}
          >
            Private hospital, treatment + specialist consultation
          </p>
        </div>

        <div className={cn('bg-white/70 p-4', hero && 'p-5 sm:p-6')}>
          <p
            className={cn(
              'font-semibold uppercase tracking-wide text-teal-700',
              hero ? 'text-xs' : 'text-[11px]',
            )}
          >
            MedBridge Pass
          </p>
          <p
            className={cn(
              'tabular font-extrabold tracking-tight text-slate-900',
              hero ? 'mt-2 text-3xl sm:text-4xl' : 'mt-1 text-2xl',
            )}
          >
            {formatSgd(medbridgeSgd)}
          </p>
          <p
            className={cn(
              'leading-relaxed text-slate-500',
              hero ? 'mt-2 text-xs' : 'mt-1 text-[11px] leading-snug',
            )}
          >
            {totalIdr ? formatIdr(totalIdr) : 'Treatment, ferry, transport & hotel'}
          </p>
        </div>
      </div>

      <div
        className={cn(
          'flex items-center justify-between gap-3 border-t border-teal-200 bg-teal-600 text-white',
          hero ? 'px-5 py-4 sm:px-6' : 'px-4 py-3',
        )}
      >
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 shrink-0" />
          <span className="text-sm font-semibold">Total saving</span>
        </div>
        <div className="flex items-baseline gap-2.5">
          <span
            className={cn('tabular font-extrabold tracking-tight', hero ? 'text-2xl' : 'text-xl')}
          >
            {formatSgd(savingsSgd)}
          </span>
          <span className="tabular rounded-full bg-white/25 px-2.5 py-0.5 text-xs font-bold">
            −{savingsPct.toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  )
}
