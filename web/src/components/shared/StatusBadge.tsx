import { STATUS_META } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { InquiryStatus } from '@/types'

interface StatusBadgeProps {
  status: InquiryStatus
  short?: boolean
  className?: string
  withDot?: boolean
}

/**
 * The single source of truth for how a pipeline state is presented.
 * Operational status is always a badge — never raw enum text.
 */
export function StatusBadge({ status, short, className, withDot = true }: StatusBadgeProps) {
  const meta = STATUS_META[status]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        meta.className,
        className,
      )}
      title={meta.description}
    >
      {withDot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)} />}
      {short ? meta.short : meta.label}
    </span>
  )
}
