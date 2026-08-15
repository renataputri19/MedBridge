import { BedDouble, Car, Ship, Stethoscope, type LucideIcon } from 'lucide-react'
import { formatSgd } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ItineraryStep, ItineraryStepKind } from '@/types'

const STEP_ICON: Record<ItineraryStepKind, LucideIcon> = {
  FERRY_OUT: Ship,
  PICKUP: Car,
  HOSPITAL: Stethoscope,
  HOTEL: BedDouble,
  FERRY_RETURN: Ship,
}

const STEP_ACCENT: Record<ItineraryStepKind, string> = {
  FERRY_OUT: 'bg-sky-500',
  PICKUP: 'bg-amber-500',
  HOSPITAL: 'bg-teal-600',
  HOTEL: 'bg-violet-500',
  FERRY_RETURN: 'bg-sky-600',
}

/** Step-by-step care journey, ferry out through ferry home. */
export function JourneyTimeline({ steps }: { steps: ItineraryStep[] }) {
  return (
    <ol className="relative">
      {steps.map((step, index) => {
        const Icon = STEP_ICON[step.kind]
        const last = index === steps.length - 1

        return (
          <li key={`${step.kind}-${step.order}`} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Connector */}
            {!last && (
              <span
                className="absolute left-[1.3125rem] top-12 h-[calc(100%-2.25rem)] w-px bg-slate-200"
                aria-hidden
              />
            )}

            <div className="relative z-10 flex flex-col items-center">
              <div
                className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ring-4 ring-white',
                  STEP_ACCENT[step.kind],
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <span className="tabular mt-2 text-xs font-bold text-slate-400">
                {String(step.order).padStart(2, '0')}
              </span>
            </div>

            <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-base font-bold tracking-tight text-slate-900">{step.title}</h3>
                {step.priceSgd !== null && step.priceSgd > 0 && (
                  <span className="tabular shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {formatSgd(step.priceSgd)}
                  </span>
                )}
              </div>

              <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.subtitle}</p>

              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-slate-500">
                <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                  {step.dayLabel}
                </span>
                <span className="tabular rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-600">
                  {step.timeLabel}
                </span>
                <span className="truncate">{step.location}</span>
              </div>

              {step.details.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  {step.details.map((detail) => (
                    <li
                      key={detail}
                      className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600"
                    >
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                      {detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
