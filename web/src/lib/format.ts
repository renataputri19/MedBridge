import { IDR_PER_SGD } from './constants'

/*
 * SGD is written "S$", everywhere, in every formatter.
 *
 * `Intl` with `style: 'currency'` renders SGD as a bare "$" under the en-SG
 * locale — correct for a reader already in Singapore, ambiguous for a product
 * whose whole proposition is comparing Singapore prices against Indonesian
 * ones on the same screen. The codebase already said "S$" by hand in the quote
 * builder, the partner rate inputs and the settings copy; the formatters
 * disagreed with all of them, and `formatCompactSgd` disagreed with itself —
 * one branch "$1,724", the other "S$12.5K".
 *
 * So the symbol is prefixed here rather than delegated, and the sign is placed
 * outside it so a negative reads "-S$40" and never "S$-40".
 */
const decimal0 = new Intl.NumberFormat('en-SG', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const decimal2 = new Intl.NumberFormat('en-SG', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const withSymbol = (value: number, digits: Intl.NumberFormat): string =>
  `${value < 0 ? '-' : ''}S$${digits.format(Math.abs(value))}`

const sgd = { format: (value: number) => withSymbol(value, decimal0) }
const sgdPrecise = { format: (value: number) => withSymbol(value, decimal2) }

const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const compact = new Intl.NumberFormat('en-SG', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatSgd(value: number, precise = false): string {
  return precise ? sgdPrecise.format(value) : sgd.format(value)
}

export function formatIdr(value: number): string {
  return idr.format(value)
}

/**
 * Money for a stat tile: readable at a glance, never misleading.
 *
 * Compact notation is only an improvement once a number is long. Applied
 * unconditionally it did the opposite at the low end — S$225.52 rendered as
 * "S$225.5", which reads as a truncation bug rather than a rounded figure, and
 * S$1,724 became "S$1.7K", hiding the precision a dashboard at this scale
 * actually has.
 *
 * So: whole dollars below the threshold, compact above it, where compact
 * genuinely earns the space it saves.
 */
const COMPACT_FROM_SGD = 10_000

export function formatCompactSgd(value: number): string {
  return Math.abs(value) < COMPACT_FROM_SGD
    ? sgd.format(value)
    : `${value < 0 ? '-' : ''}S$${compact.format(Math.abs(value))}`
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-SG').format(value)
}

export function sgdToIdr(value: number, rate = IDR_PER_SGD): number {
  return Math.round(value * rate)
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`
}

export function formatDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

const dateTime = new Intl.DateTimeFormat('en-SG', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const dateOnly = new Intl.DateTimeFormat('en-SG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

const timeOnly = new Intl.DateTimeFormat('en-SG', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso))
}

export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso))
}

export function formatTime(iso: string): string {
  return timeOnly.format(new Date(iso))
}

/** "3m ago", "2h ago", "Yesterday" — used by feeds and message lists. */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diffSec = Math.round((Date.now() - then) / 1000)

  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`

  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`

  const diffDay = Math.round(diffHr / 24)
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 7) return `${diffDay}d ago`

  return formatDate(iso)
}

/** Countdown against an SLA target. Negative values read as overdue. */
export function formatSla(iso: string): { label: string; overdue: boolean; urgent: boolean } {
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000)
  const overdue = diffMin < 0
  const abs = Math.abs(diffMin)

  const label =
    abs < 60
      ? `${abs}m`
      : abs < 1440
        ? `${Math.floor(abs / 60)}h ${abs % 60}m`
        : `${Math.floor(abs / 1440)}d`

  return {
    label: overdue ? `${label} overdue` : `${label} left`,
    overdue,
    urgent: !overdue && diffMin < 60,
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** Title-cases a SCREAMING_SNAKE enum for display. */
export function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
