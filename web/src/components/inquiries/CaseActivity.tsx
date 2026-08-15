import { Bot, CircleDot, Stethoscope, User, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { JsonInspector } from '@/components/shared/JsonInspector'
import { useActivity } from '@/hooks/queries'
import { formatDateTime, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ActivityActor, ActivityLevel, UUID } from '@/types'

const ACTOR_ICON: Record<ActivityActor, typeof Bot> = {
  AI_AGENT: Bot,
  SYSTEM: CircleDot,
  STAFF: User,
  PATIENT: Users,
  DOCTOR: Stethoscope,
}

const LEVEL_RING: Record<ActivityLevel, string> = {
  info: 'bg-slate-100 text-slate-500',
  success: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-amber-50 text-amber-600',
  error: 'bg-rose-50 text-rose-600',
}

/**
 * The audit trail for one case.
 *
 * This was a whole route — `/ai-activity` — showing every event in the system
 * behind actor and level filters. Nobody reads an audit trail that way: you
 * read it while looking at the case it belongs to, asking "why did this land
 * in doctor review?". So it moved here, scoped to one inquiry, and the global
 * feed and its filters went away.
 *
 * The inspector shows STRUCTURED backend payloads only — parsed fields and
 * decisions. Never model text, never reasoning.
 */
export function CaseActivity({ inquiryId }: { inquiryId: UUID }) {
  const { data: events, isLoading } = useActivity(200)

  const rows = (events ?? []).filter((event) => event.inquiryId === inquiryId)

  return (
    <Card>
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <CircleDot className="h-4 w-4 text-slate-400" />
          Case Activity
          {rows.length > 0 && (
            <span className="tabular rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              {rows.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-5">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No recorded events for this case yet.
          </p>
        ) : (
          <ol className="relative space-y-1">
            {rows.map((event, index) => {
              const Icon = ACTOR_ICON[event.actor]
              const last = index === rows.length - 1
              const hasPayload =
                event.payload && Object.keys(event.payload as object).length > 0

              return (
                <li key={event.id} className="relative flex gap-3 pb-4">
                  {!last && (
                    <span
                      className="absolute left-4 top-9 h-[calc(100%-1rem)] w-px bg-slate-200"
                      aria-hidden
                    />
                  )}

                  <div
                    className={cn(
                      'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white',
                      LEVEL_RING[event.level],
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                      <span
                        className="ml-auto shrink-0 text-[11px] text-slate-400"
                        title={formatDateTime(event.createdAt)}
                      >
                        {formatRelative(event.createdAt)}
                      </span>
                    </div>

                    <p className="mt-0.5 text-sm leading-snug text-slate-500">
                      {event.description}
                    </p>

                    {event.durationMs !== null && (
                      <span className="tabular mt-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        {event.durationMs}ms
                      </span>
                    )}

                    {hasPayload && (
                      <JsonInspector
                        data={event.payload}
                        label={event.type}
                        className="mt-2"
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
