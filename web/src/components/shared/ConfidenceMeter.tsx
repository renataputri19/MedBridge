import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { CONFIDENCE_THRESHOLD } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface ConfidenceMeterProps {
  /** 0–1 as returned by the backend. */
  value: number
  className?: string
  showThresholdNote?: boolean
}

/**
 * Renders the AI confidence score against the human-in-the-loop threshold.
 * Anything below the threshold reads as an escalation, not a result.
 */
export function ConfidenceMeter({
  value,
  className,
  showThresholdNote = true,
}: ConfidenceMeterProps) {
  const pct = Math.round(value * 100)
  const threshold = Math.round(CONFIDENCE_THRESHOLD * 100)
  const passes = value >= CONFIDENCE_THRESHOLD

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          AI Confidence
        </span>
        <span
          className={cn(
            'tabular text-lg font-bold',
            passes ? 'text-emerald-600' : 'text-rose-600',
          )}
        >
          {pct}%
        </span>
      </div>

      <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            passes ? 'bg-emerald-500' : 'bg-rose-500',
          )}
          style={{ width: `${pct}%` }}
        />
        {/* Threshold marker sits on top of the fill so the gate is always visible. */}
        <div
          className="absolute inset-y-0 w-0.5 bg-slate-900/70"
          style={{ left: `${threshold}%` }}
          aria-hidden
        />
      </div>

      {showThresholdNote && (
        <p
          className={cn(
            'flex items-start gap-1.5 text-xs',
            passes ? 'text-slate-500' : 'text-rose-600',
          )}
        >
          {passes ? (
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" />
          ) : (
            <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          )}
          <span>
            {passes
              ? `Above the ${threshold}% auto-quote threshold.`
              : `Below the ${threshold}% threshold — human review is mandatory.`}
          </span>
        </p>
      )}
    </div>
  )
}
