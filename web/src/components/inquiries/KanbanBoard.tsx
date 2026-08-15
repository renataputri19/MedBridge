import { KANBAN_LANES, STATUS_META } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { Inquiry } from '@/types'
import { InquiryCard } from './InquiryCard'
import { Skeleton } from '@/components/ui/skeleton'

interface KanbanBoardProps {
  inquiries: Inquiry[]
  loading?: boolean
}

/** Horizontal pipeline board — one lane per status, in pipeline order. */
export function KanbanBoard({ inquiries, loading }: KanbanBoardProps) {
  if (loading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="w-72 shrink-0 space-y-3">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="scrollbar-thin flex gap-4 overflow-x-auto pb-4">
      {KANBAN_LANES.map((status) => {
        const meta = STATUS_META[status]
        const lane = inquiries.filter((inquiry) => inquiry.status === status)

        return (
          <section
            key={status}
            className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/70 p-2"
            aria-label={meta.label}
          >
            <header className="flex items-center gap-2 px-2 py-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />
              <h3 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-slate-600">
                {meta.short}
              </h3>
              <span className="tabular rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-500 shadow-sm">
                {lane.length}
              </span>
            </header>

            <div className="flex-1 space-y-2 px-0.5 pb-1">
              {lane.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-[11px] text-slate-400">
                  Empty
                </p>
              ) : (
                lane.map((inquiry) => (
                  <InquiryCard key={inquiry.id} inquiry={inquiry} />
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
