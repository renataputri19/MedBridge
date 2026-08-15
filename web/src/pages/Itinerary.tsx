import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  Check,
  Download,
  Link2Off,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react'
import { JourneyTimeline } from '@/components/itinerary/JourneyTimeline'
import { SavingsCallout } from '@/components/shared/SavingsCallout'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfirmItinerary, useItinerary } from '@/hooks/queries'
import { SUPPORT_PHONE } from '@/lib/constants'
import { formatDate, formatIdr, formatSgd } from '@/lib/format'

export default function Itinerary() {
  const { token } = useParams<{ token: string }>()
  const { data: itinerary, isLoading, isError } = useItinerary(token)
  const confirmBooking = useConfirmItinerary(token)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100">
        <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-8">
          <Skeleton className="h-52 w-full rounded-3xl" />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20.5rem]">
            <div className="space-y-6">
              <Skeleton className="h-48 w-full rounded-2xl" />
              <Skeleton className="h-96 w-full rounded-2xl" />
            </div>
            <Skeleton className="hidden h-72 w-full rounded-2xl lg:block" />
          </div>
        </div>
      </div>
    )
  }

  if (isError || !itinerary) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-3xl bg-white p-2 shadow-xl ring-1 ring-slate-900/5">
          <EmptyState
            icon={Link2Off}
            title="This pass link is no longer valid"
            description="Your itinerary link may have expired, or the booking was updated. Message the MedBridge care team and we'll send you a fresh one."
            action={
              <Button asChild>
                <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`}>
                  <MessageCircle className="h-4 w-4" />
                  Contact care team
                </a>
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const alreadyConfirmed = ['CONFIRMED_BOOKING', 'TRAVEL_READY', 'COMPLETED'].includes(
    itinerary.status,
  )

  const confirm = () =>
    confirmBooking.mutate(undefined, {
      onSuccess: () =>
        toast.success('Booking confirmed', {
          description: 'Your coordinator will be in touch with your final schedule.',
        }),
      onError: () =>
        toast.error('We could not confirm just now', {
          description: 'Please call the support line and we will finish it for you.',
        }),
    })

  /*
   * The primary action, rendered twice: in the desktop sidebar and in the
   * mobile sticky bar. Once confirmed it stops being a button — a disabled
   * green slab reads as "broken", a stated fact reads as done.
   */
  const primaryAction = alreadyConfirmed ? (
    <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
      <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <Check className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-emerald-900">Booking confirmed</p>
        <p className="mt-0.5 text-xs leading-relaxed text-emerald-800">
          Your coordinator will send the final schedule before you travel.
        </p>
      </div>
    </div>
  ) : (
    <Button
      size="lg"
      variant="success"
      className="w-full"
      disabled={confirmBooking.isPending}
      onClick={confirm}
    >
      <BadgeCheck className="h-4 w-4" />
      Confirm my booking
    </Button>
  )

  const secondaryActions = (
    <div className="grid grid-cols-2 gap-2.5">
      <Button asChild variant="outline">
        <a href={`tel:${itinerary.supportPhone.replace(/\s/g, '')}`}>
          <Phone className="h-4 w-4" />
          Call hospital
        </a>
      </Button>
      {/*
        Print-to-PDF rather than a generated file download: the browser's
        own "Save as PDF" works everywhere, including in-app browsers.
      */}
      <Button variant="outline" onClick={() => window.print()}>
        <Download className="h-4 w-4" />
        Save as PDF
      </Button>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-100 pb-32 lg:pb-0 print:bg-white print:pb-0">
      <div className="mx-auto w-full max-w-5xl sm:px-6 sm:py-10 print:p-0">
        <article className="overflow-hidden bg-white ring-1 ring-slate-900/5 sm:rounded-3xl sm:shadow-xl print:ring-0">
          {/* ---- Hero ---- */}
          <header className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-500 to-teal-500 px-6 pb-10 pt-8 text-white sm:px-10 sm:pb-12 sm:pt-10">
            <div className="absolute inset-0 opacity-15" aria-hidden>
              <div className="grid-bg h-full w-full" />
            </div>
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/15 blur-3xl"
              aria-hidden
            />

            <div className="relative">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                    <Stethoscope className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold leading-tight">MedBridge Pass</p>
                    <p className="text-xs leading-tight text-white/75">
                      Seamless cross-border care
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-white/20 px-3 py-1.5 font-mono text-xs font-semibold tracking-tight backdrop-blur">
                  {itinerary.reference}
                </span>
              </div>

              <div className="mt-8 max-w-2xl sm:mt-10">
                <h1 className="text-3xl font-extrabold leading-[1.15] tracking-tight sm:text-4xl">
                  Hi {itinerary.patientFirstName}, your care journey is ready.
                </h1>
                <p className="mt-3 text-base font-medium text-white/90 sm:text-lg">
                  {itinerary.procedureName}
                </p>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur sm:text-sm">
                  <CalendarDays className="h-4 w-4 text-white/80" />
                  {itinerary.travelWindow}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur sm:text-sm">
                  <Building2 className="h-4 w-4 text-white/80" />
                  Batam, Indonesia
                </span>
              </div>
            </div>
          </header>

          <div className="grid gap-8 p-4 sm:p-8 lg:grid-cols-[minmax(0,1fr)_20.5rem] lg:items-start lg:gap-10 lg:p-10">
            {/* ---- Main column ---- */}
            <div className="min-w-0 space-y-8 sm:space-y-10">
              {/* ---- Cost ---- */}
              <section aria-labelledby="cost-heading">
                <h2 id="cost-heading" className="sr-only">
                  Cost comparison
                </h2>
                <SavingsCallout
                  size="hero"
                  singaporeSgd={itinerary.singaporeBenchmarkSgd}
                  medbridgeSgd={itinerary.totalSgd}
                  savingsSgd={itinerary.savingsSgd}
                  savingsPct={itinerary.savingsPct}
                  totalIdr={itinerary.totalIdr}
                />

                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <h3 className="text-base font-bold tracking-tight text-slate-900">
                    What's included
                  </h3>

                  <ul className="mt-3 divide-y divide-slate-100">
                    {itinerary.costLines.map((line) => (
                      <li key={line.label} className="flex items-start justify-between gap-4 py-3.5">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold leading-snug text-slate-900">
                            {line.label}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-500">
                            {line.detail}
                          </p>
                        </div>
                        <span className="tabular shrink-0 text-sm font-semibold text-slate-900">
                          {formatSgd(line.priceSgd)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 flex items-baseline justify-between gap-4 rounded-xl bg-slate-900 px-4 py-3.5 text-white">
                    <span className="text-sm font-semibold">Total</span>
                    <div className="text-right">
                      <p className="tabular text-2xl font-extrabold leading-none tracking-tight">
                        {formatSgd(itinerary.totalSgd)}
                      </p>
                      <p className="tabular mt-1.5 text-xs text-white/60">
                        ≈ {formatIdr(itinerary.totalIdr)}
                      </p>
                    </div>
                  </div>

                  <p className="mt-4 text-xs leading-relaxed text-slate-500">
                    Quoted in SGD. The Singapore benchmark is an indicative private-hospital price
                    for the same treatment plus a specialist consultation. Final costs may vary if
                    your treatment plan changes after examination.
                  </p>
                </div>
              </section>

              {/* ---- Journey ---- */}
              <section aria-labelledby="journey-heading">
                <div className="mb-5">
                  <h2
                    id="journey-heading"
                    className="text-lg font-bold tracking-tight text-slate-900"
                  >
                    Your care journey
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Ferry out to ferry home — {itinerary.steps.length} steps, all arranged for you.
                  </p>
                </div>
                <JourneyTimeline steps={itinerary.steps} />
              </section>
            </div>

            {/* ---- Sidebar ---- */}
            <aside className="space-y-4 lg:sticky lg:top-10">
              {/* Desktop actions — mobile gets the sticky bar instead. */}
              <div className="hidden space-y-2.5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:block print:hidden">
                {primaryAction}
                {secondaryActions}
              </div>

              {/* ---- Care team ---- */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                  Your care team
                </h2>

                <div className="mt-4 space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug text-slate-900">
                        {itinerary.hospitalName}
                      </p>
                      <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {itinerary.hospitalAddress}
                      </p>
                    </div>
                  </div>

                  {itinerary.doctorName && (
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                        <Stethoscope className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-snug text-slate-900">
                          {itinerary.doctorName}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{itinerary.doctorSpecialty}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                      <Phone className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <a
                        href={`tel:${itinerary.supportPhone.replace(/\s/g, '')}`}
                        className="tabular text-sm font-semibold text-slate-900 hover:text-brand-700"
                      >
                        {itinerary.supportPhone}
                      </a>
                      <p className="mt-1 text-xs text-slate-500">24/7 MedBridge support line</p>
                    </div>
                  </div>
                </div>
              </section>

              {/* ---- Assurances ---- */}
              <section className="rounded-2xl border border-teal-200 bg-teal-50 p-5">
                <p className="flex items-center gap-2 text-sm font-bold text-teal-900">
                  <ShieldCheck className="h-4 w-4" />
                  Reviewed by our clinical team
                </p>
                <p className="mt-2 text-xs leading-relaxed text-teal-800">
                  This itinerary was prepared with hospital staff and approved by a doctor before
                  it reached you. It is a treatment and travel plan, not medical advice — your
                  specialist will confirm everything at your consultation.
                </p>
                <p className="mt-3 border-t border-teal-200/70 pt-3 text-xs font-medium text-teal-700">
                  Valid until {formatDate(itinerary.validUntil)}.
                </p>
              </section>

              <p className="px-1 text-center text-xs leading-relaxed text-slate-400">
                Pass issued {formatDate(itinerary.issuedAt)}
                <br className="hidden sm:block" /> This is a private link. Please don't share it.
              </p>
            </aside>
          </div>
        </article>
      </div>

      {/* ---- Sticky CTAs (mobile only) ---- */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 pb-4 pt-3 backdrop-blur lg:hidden print:hidden">
        <div className="mx-auto max-w-lg space-y-2.5">
          {primaryAction}
          {secondaryActions}
        </div>
      </div>
    </div>
  )
}
