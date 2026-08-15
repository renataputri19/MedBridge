import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

interface KpiCardProps {
  label: string
  value: string
  /** Signed percentage change vs the named comparison period. */
  delta?: number
  deltaPeriod?: string
  /** False when a rise is bad (e.g. pending reviews). */
  higherIsBetter?: boolean
  icon: LucideIcon
  accent?: 'sky' | 'teal' | 'amber' | 'emerald' | 'violet'
  hint?: string
  loading?: boolean
  /** 12-point series for the sparkline. */
  trend?: number[]
}

const ACCENTS = {
  sky: { bg: 'bg-sky-50', fg: 'text-sky-600', spark: '#0284c7' },
  teal: { bg: 'bg-teal-50', fg: 'text-teal-600', spark: '#0d9488' },
  amber: { bg: 'bg-amber-50', fg: 'text-amber-600', spark: '#d97706' },
  emerald: { bg: 'bg-emerald-50', fg: 'text-emerald-600', spark: '#059669' },
  violet: { bg: 'bg-violet-50', fg: 'text-violet-600', spark: '#7c3aed' },
} as const

/**
 * Stat tile — label · value · delta · sparkline.
 *
 * The value uses proportional figures (not tabular): equal-width digits make a
 * large standalone number look loose.
 */
export function KpiCard({
  label,
  value,
  delta,
  deltaPeriod = 'vs last week',
  higherIsBetter = true,
  icon: Icon,
  accent = 'sky',
  hint,
  loading,
  trend,
}: KpiCardProps) {
  const palette = ACCENTS[accent]
  const good = delta === undefined ? true : higherIsBetter ? delta >= 0 : delta <= 0
  const Arrow = (delta ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight

  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            palette.bg,
          )}
        >
          <Icon className={cn('h-4 w-4', palette.fg)} />
        </div>
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-9 w-28" />
      ) : (
        <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {delta !== undefined && !loading && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold',
              good ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
            )}
          >
            <Arrow className="h-3 w-3" />
            {Math.abs(delta)}%
          </span>
        )}
        <span className="truncate text-xs text-slate-400">{deltaPeriod}</span>
      </div>

      {/*
        The hint sits on its own line rather than replacing the comparison
        period, because the two answer different questions: "vs last week" says
        what the arrow is measured against, the hint says what the number
        actually counts. Collapsing them meant every tile carrying an
        explanation silently lost the basis for its own delta.
      */}
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-slate-400">{hint}</p>}

      {trend && trend.length > 1 && <Sparkline points={trend} color={palette.spark} />}
    </div>
  )
}

/** 12-point sparkline: de-emphasised path with the current point in the accent. */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  const width = 120
  const height = 28
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1

  const coords = points.map((value, index) => {
    const x = (index / (points.length - 1)) * width
    const y = height - ((value - min) / span) * (height - 4) - 2
    return [x, y] as const
  })

  const path = coords
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')

  const [lastX, lastY] = coords.at(-1)!

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-3 h-7 w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={path} fill="none" stroke="#cbd5e1" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {/* 2px surface ring keeps the end-dot legible where it meets the line. */}
      <circle cx={lastX} cy={lastY} r={4} fill={color} stroke="#ffffff" strokeWidth={2} />
    </svg>
  )
}
