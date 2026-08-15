import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Building2,
  Car,
  Check,
  ChevronDown,
  ExternalLink,
  Hospital,
  Moon,
  Receipt,
  ShieldCheck,
  Ship,
  Sparkles,
  Stethoscope,
  Wallet,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { NearbyPanel } from '@/components/chat/NearbyPanel'
import { cn } from '@/lib/utils'
import { formatKm } from '@/lib/geo'
import { formatSgd } from '@/lib/format'
import type {
  BudgetStatus,
  BundleLine,
  BundleSwapOption,
  ChatBundle,
  QuoteCategory,
} from '@/types'

/**
 * The plan, as a page of its own.
 *
 * The chat and the plan used to share a screen, side by side, which meant the
 * patient was reading a conversation and evaluating two dozen priced choices at
 * the same time. They are two different jobs. So the chat collects, and when
 * there is something to decide the page hands over to this: one centred column,
 * three steps, and only the choices belonging to the current step on screen.
 *
 * What has NOT changed is who chooses. Every category still lists its real
 * alternatives — hospital, specialist, both ferry legs, hotel, transfer — and
 * we still only pick the default. Steps change how many arrive at once, never
 * whether they arrive.
 *
 * Nothing here was priced by a model. Every figure comes from the catalogue,
 * and every option list is what that catalogue actually contains.
 */

const STEPS = [
  {
    id: 'treatment',
    label: 'Treatment',
    title: 'What you came for',
    body: 'Where your treatment happens and who performs it. A budget never trims anything on this step.',
    next: 'Continue to your trip',
  },
  {
    id: 'trip',
    label: 'Trip',
    title: 'Getting there and staying',
    body: 'Ferries, your hotel and transfers. Drop anything you do not need — the total updates as you go.',
    next: 'Continue to review',
  },
  {
    id: 'review',
    label: 'Review',
    title: 'Check it over, then send',
    body: 'Nothing is booked from here. A MedBridge coordinator confirms availability and final pricing with the hospital first.',
    next: null,
  },
] as const

export type PlanStep = (typeof STEPS)[number]['id']

const CATEGORY_ICON: Record<QuoteCategory, typeof Ship> = {
  TREATMENT: Building2,
  DOCTOR_FEE: Stethoscope,
  FERRY: Ship,
  HOTEL: BedDouble,
  TRANSPORT: Car,
  ADMIN: Sparkles,
}

/**
 * The eyebrow above each row — what *kind* of thing this is, so the bold line
 * underneath is free to be the patient's actual choice ("Batam Fast 09:20")
 * rather than a category name they already know.
 */
const ROW_LABEL: Record<string, string> = {
  doctor: 'Specialist',
  ferry_out: 'Ferry out',
  ferry_return: 'Ferry back',
  hotel: 'Hotel',
  transport: 'Transfer',
}

const CATEGORY_LABEL: Record<QuoteCategory, string> = {
  TREATMENT: 'Treatment',
  DOCTOR_FEE: 'Specialist',
  FERRY: 'Ferry',
  HOTEL: 'Hotel',
  TRANSPORT: 'Transfer',
  ADMIN: 'Coordination',
}

/** What the "choose your …" list is called once a row is open. */
const GROUP_LABEL: Record<string, string> = {
  doctor: 'Choose your specialist',
  ferry_out: 'Choose your outbound ferry',
  ferry_return: 'Choose your return ferry',
  hotel: 'Choose your hotel',
  transport: 'Choose your transfer',
}

/** The accordion key for the hospital row, which is not a `lines` entry. */
const HOSPITAL_ROW = 'hospital'

const TRIP_CATEGORIES: QuoteCategory[] = ['FERRY', 'HOTEL', 'TRANSPORT']

interface PlanFlowProps {
  bundle: ChatBundle
  disabled?: boolean
  onBackToChat: () => void
  onToggle: (key: string, included: boolean) => void
  onSwap: (key: string, refId: string) => void
  onChooseHospital: (refId: string) => void
  onSetNights: (nights: number) => void
  /** The submission form. Owned by the page, because the page owns the API call. */
  contactForm: React.ReactNode
  disclaimer: React.ReactNode
}

export function PlanFlow({
  bundle,
  disabled,
  onBackToChat,
  onToggle,
  onSwap,
  onChooseHospital,
  onSetNights,
  contactForm,
  disclaimer,
}: PlanFlowProps) {
  const [step, setStep] = useState<PlanStep>('treatment')

  const index = STEPS.findIndex((entry) => entry.id === step)
  const current = STEPS[index]
  const previous = index > 0 ? STEPS[index - 1] : null

  const go = (next: PlanStep) => {
    setStep(next)
    // A step is a new page as far as the reader is concerned, so it starts at
    // the top rather than halfway down wherever the last one was scrolled to.
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const shared = { bundle, disabled, onToggle, onSwap }

  return (
    <>
      <div className="mx-auto w-full max-w-2xl px-4 pt-5">
        <button
          type="button"
          onClick={onBackToChat}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to chat
        </button>

        <h1 className="mt-2.5 text-xl font-bold leading-tight tracking-tight text-slate-900">
          {bundle.procedure?.name ?? 'Your plan'}
        </h1>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {bundle.travelDate && (
            <Badge variant="neutral" size="sm">
              {new Date(bundle.travelDate).toLocaleDateString('en-SG', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Badge>
          )}
          <Badge variant="neutral" size="sm">
            {bundle.partySize === 1 ? 'Just you' : `${bundle.partySize} travellers`}
          </Badge>
          <Badge variant="neutral" size="sm">
            {bundle.hotelNights === 0
              ? 'Day trip'
              : `${bundle.hotelNights} night${bundle.hotelNights === 1 ? '' : 's'}`}
          </Badge>
          <Badge variant="secondary" size="sm">
            Save {formatSgd(bundle.totals.savingsSgd)} ({bundle.totals.savingsPct.toFixed(0)}%)
          </Badge>
        </div>
      </div>

      {/*
        Steps and the running total, pinned under the site header. Full bleed
        rather than the width of the column — a bar that stops where the cards
        stop reads as a floating slab instead of page chrome. The title above is
        allowed to scroll away; the number being decided against is not.
      */}
      <div className="sticky top-[3.75rem] z-30 mt-3 border-y border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-2">
          <Stepper step={step} onStepChange={go} />
          <p className="ml-auto shrink-0 text-lg font-bold leading-none text-slate-900">
            {formatSgd(bundle.totals.totalSgd)}
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-4">
        <div className="px-1">
          <h2 className="text-sm font-bold text-slate-900">{current.title}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{current.body}</p>
        </div>

        {step === 'treatment' && (
          <TreatmentStep
            {...shared}
            onChooseHospital={onChooseHospital}
            onSetNights={onSetNights}
          />
        )}

        {step === 'trip' && <TripStep {...shared} />}

        {step === 'review' && (
          <ReviewStep bundle={bundle} contactForm={contactForm} disclaimer={disclaimer} />
        )}
      </div>

      {current.next ? (
        <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-3">
            {previous && (
              <Button variant="outline" onClick={() => go(previous.id)}>
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">{previous.label}</span>
              </Button>
            )}
            <Button size="lg" className="flex-1" onClick={() => go(STEPS[index + 1].id)}>
              {current.next}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        previous && (
          <div className="mx-auto flex w-full max-w-2xl justify-center px-4 pb-8">
            <button
              type="button"
              onClick={() => go(previous.id)}
              className="flex items-center gap-1.5 py-2 text-xs font-medium text-slate-500 transition hover:text-brand-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to your {previous.label.toLowerCase()}
            </button>
          </div>
        )
      )}
    </>
  )
}

/** Freely clickable — no step is gated behind another. */
function Stepper({
  step,
  onStepChange,
}: {
  step: PlanStep
  onStepChange: (step: PlanStep) => void
}) {
  const index = STEPS.findIndex((entry) => entry.id === step)

  return (
    <nav className="flex min-w-0 items-center gap-1" aria-label="Plan steps">
      {STEPS.map((entry, position) => {
        const active = entry.id === step
        const done = position < index

        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onStepChange(entry.id)}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
              active ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100',
            )}
          >
            <span
              className={cn(
                'tabular flex h-4 w-4 items-center justify-center rounded-full text-[10px]',
                active
                  ? 'bg-white/25 text-white'
                  : done
                    ? 'bg-teal-100 text-teal-700'
                    : 'bg-slate-200 text-slate-500',
              )}
            >
              {done ? <Check className="h-2.5 w-2.5" /> : position + 1}
            </span>
            {entry.label}
          </button>
        )
      })}
    </nav>
  )
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                       */
/* -------------------------------------------------------------------------- */

interface StepProps {
  bundle: ChatBundle
  disabled?: boolean
  onToggle: (key: string, included: boolean) => void
  onSwap: (key: string, refId: string) => void
}

function TreatmentStep({
  bundle,
  disabled,
  onToggle,
  onSwap,
  onChooseHospital,
  onSetNights,
}: StepProps & {
  onChooseHospital: (refId: string) => void
  onSetNights: (nights: number) => void
}) {
  /*
   * One open row at a time, hospital first. Seeing one list open teaches that
   * the other rows do the same — a column of collapsed rows with no worked
   * example reads as a receipt rather than a set of choices.
   */
  const [openRow, setOpenRow] = useState<string | null>(HOSPITAL_ROW)
  const toggleRow = (key: string) => setOpenRow((current) => (current === key ? null : key))

  const chosenHospital = bundle.hospitalOptions.find((option) => option.refId === bundle.hospitalId)
  const treatmentLine = bundle.lines.find((line) => line.key === 'treatment')
  const clinical = bundle.lines.filter(
    (line) => line.key !== 'treatment' && line.category === 'DOCTOR_FEE',
  )

  return (
    <Rows>
      {bundle.hospitalOptions.length > 0 && (
        <ChoiceRow
          icon={Hospital}
          eyebrow="Hospital"
          title={chosenHospital?.label ?? 'Choose your hospital'}
          detail={treatmentLine?.label ?? 'Treatment price is per facility'}
          priceSgd={treatmentLine ? treatmentLine.quantity * treatmentLine.unitPriceSgd : null}
          note="Changing hospital also updates your specialist and ferry terminal. Everything you have already chosen is carried across."
          optionsHeading="Choose your hospital"
          options={bundle.hospitalOptions}
          selectedRefId={bundle.hospitalId}
          open={openRow === HOSPITAL_ROW}
          onToggleOpen={() => toggleRow(HOSPITAL_ROW)}
          onSelect={onChooseHospital}
          disabled={disabled}
        />
      )}

      {clinical.map((line) => (
        <LineRow
          key={line.key}
          line={line}
          options={line.swapGroup ? (bundle.swapOptions[line.swapGroup] ?? []) : []}
          open={openRow === line.key}
          onToggleOpen={() => toggleRow(line.key)}
          disabled={disabled}
          onToggle={onToggle}
          onSwap={onSwap}
        />
      ))}

      {bundle.procedure && (
        <NightsRow
          nights={bundle.hotelNights}
          recommended={bundle.procedure.recoveryNights}
          disabled={disabled}
          onSetNights={onSetNights}
        />
      )}
    </Rows>
  )
}

function TripStep({ bundle, disabled, onToggle, onSwap }: StepProps) {
  const travel = bundle.lines.filter((line) => TRIP_CATEGORIES.includes(line.category))
  const [openRow, setOpenRow] = useState<string | null>(travel[0]?.key ?? null)
  const toggleRow = (key: string) => setOpenRow((current) => (current === key ? null : key))

  return (
    <>
      {/*
        The budget belongs on this step and not the last one. It is the trip it
        is allowed to trade down, never the treatment (rule 10) — putting an
        amber "over budget" banner above a list of hospitals would invite
        precisely the trade we refuse to make.
      */}
      {bundle.budget && <BudgetBanner budget={bundle.budget} />}

      <Rows>
        {travel.map((line) => (
          <LineRow
            key={line.key}
            line={line}
            options={line.swapGroup ? (bundle.swapOptions[line.swapGroup] ?? []) : []}
            open={openRow === line.key}
            onToggleOpen={() => toggleRow(line.key)}
            disabled={disabled}
            onToggle={onToggle}
            onSwap={onSwap}
          />
        ))}
      </Rows>

      {/*
        Deliberately last, and deliberately outside the priced rows above. This
        is travel information sitting beside a plan, not part of it — nothing in
        it is quoted, bundled, or counted towards the savings figure.
      */}
      {bundle.nearby && (
        <div className="pt-1">
          <NearbyPanel data={bundle.nearby} />
        </div>
      )}
    </>
  )
}

function ReviewStep({
  bundle,
  contactForm,
  disclaimer,
}: {
  bundle: ChatBundle
  contactForm: React.ReactNode
  disclaimer: React.ReactNode
}) {
  return (
    <>
      {bundle.budget && <BudgetBanner budget={bundle.budget} />}
      <Breakdown bundle={bundle} defaultOpen />
      {contactForm}
      {disclaimer}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared surfaces                                                             */
/* -------------------------------------------------------------------------- */

/** Rows in one card, divided by hairlines rather than separately elevated. */
function Rows({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {children}
    </div>
  )
}

/**
 * The itemised total.
 *
 * Open by default on the review step, where "what am I paying for" is the whole
 * question, and collapsible because the D9 note explaining what the Singapore
 * benchmark does and does not include has to travel with the figure it
 * qualifies rather than float loose on the page.
 */
function Breakdown({ bundle, defaultOpen = false }: { bundle: ChatBundle; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const lines = bundle.lines.filter((line) => line.included)

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-slate-50"
      >
        <Receipt className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="flex-1 text-sm font-semibold text-slate-700">Price breakdown</span>
        <span className="tabular text-[11px] text-slate-400">{lines.length} items</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4">
          <ul className="space-y-1.5">
            {lines.map((line) => (
              <li key={line.key} className="flex items-start justify-between gap-3 text-xs">
                <span className="min-w-0 flex-1 truncate text-slate-600">{line.label}</span>
                <span className="tabular shrink-0 font-medium text-slate-800">
                  {formatSgd(line.quantity * line.unitPriceSgd)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-200 pt-3">
            <span className="text-sm font-semibold text-slate-700">Your total</span>
            {/* Proportional figures: a large standalone value, not a column. */}
            <span className="text-2xl font-bold leading-none text-slate-900">
              {formatSgd(bundle.totals.totalSgd)}
            </span>
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-500">Singapore equivalent</span>
            <span className="tabular text-slate-400 line-through">
              {formatSgd(bundle.totals.sgBenchmarkSgd)}
            </span>
          </div>

          <p className="mt-2 rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800">
            Estimated saving {formatSgd(bundle.totals.savingsSgd)} (
            {bundle.totals.savingsPct.toFixed(0)}%)
          </p>

          {/*
            The benchmark is treatment + one specialist consult, fixed against
            the procedure. It deliberately excludes ferry and hotel — a patient
            treated at home would not incur them — and it does not move when
            lines are removed, so the saving can never be inflated by trimming
            the plan. See docs/09 D9.
          */}
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
            Compared with the same treatment plus a specialist consultation in Singapore. Travel
            and accommodation are excluded from that figure.
          </p>
        </div>
      )}
    </section>
  )
}

/**
 * Where the plan stands against the figure they gave us.
 *
 * Green when it fits, amber when it does not — never red. Being over budget is
 * information, not an error, and the patient has done nothing wrong.
 *
 * Every sentence is written by the backend's question bank (D17). The one
 * thing this component insists on adding is the guarantee underneath: whatever
 * the number says, the treatment, the specialist and the recovery nights are
 * not what gets cut.
 */
function BudgetBanner({ budget }: { budget: BudgetStatus }) {
  const fits = budget.fits

  return (
    <section
      className={cn(
        'rounded-2xl border p-3.5 shadow-sm',
        fits ? 'border-teal-200 bg-teal-50/70' : 'border-amber-200 bg-amber-50',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
            fits
              ? 'bg-teal-100 text-teal-700 ring-teal-200'
              : 'bg-amber-100 text-amber-800 ring-amber-200',
          )}
        >
          <Wallet className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className={cn('text-sm font-semibold', fits ? 'text-teal-900' : 'text-amber-900')}>
              {fits ? 'Within your budget' : 'Over your budget'}
            </p>
            <p className={cn('tabular text-xs', fits ? 'text-teal-700' : 'text-amber-800')}>
              {formatSgd(budget.totalSgd)} of {formatSgd(budget.budgetSgd)}
            </p>
          </div>

          <p
            className={cn(
              'mt-1 text-[11px] leading-relaxed',
              fits ? 'text-teal-800' : 'text-amber-900',
            )}
          >
            {budget.message}
          </p>

          {!fits && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-white/70 p-2 text-[11px] leading-relaxed text-amber-900">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
              {budget.protected}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * Five small chips, so this row stays open — collapsing a control that is
 * already smaller than its own summary would be ceremony for its own sake.
 */
function NightsRow({
  nights,
  recommended,
  disabled,
  onSetNights,
}: {
  nights: number
  recommended: number
  disabled?: boolean
  onSetNights: (nights: number) => void
}) {
  return (
    <div className="flex items-start gap-3 p-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200">
        <Moon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          Nights in Batam
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {recommended > 0
            ? `${recommended} recommended for this procedure`
            : 'Day procedure — an overnight stay is optional'}
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {[0, 1, 2, 3, 4].map((value) => (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() => onSetNights(value)}
              className={cn(
                'tabular rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-60',
                value === nights
                  ? 'border-brand-300 bg-brand-50 text-brand-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
              )}
            >
              {value === 0 ? 'Day trip' : value}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* One line of the plan                                                        */
/* -------------------------------------------------------------------------- */

function LineRow({
  line,
  options,
  open,
  onToggleOpen,
  disabled,
  onToggle,
  onSwap,
}: {
  line: BundleLine
  options: BundleSwapOption[]
  open: boolean
  onToggleOpen: () => void
  disabled?: boolean
  onToggle: (key: string, included: boolean) => void
  onSwap: (key: string, refId: string) => void
}) {
  const swappable = line.included && line.swappable && options.length > 1

  return (
    <ChoiceRow
      icon={CATEGORY_ICON[line.category]}
      eyebrow={(line.swapGroup && ROW_LABEL[line.swapGroup]) ?? CATEGORY_LABEL[line.category]}
      title={line.label}
      detail={line.detail}
      priceSgd={line.quantity * line.unitPriceSgd}
      unitNote={
        line.quantity > 1 ? `${formatSgd(line.unitPriceSgd)} × ${line.quantity}` : undefined
      }
      optionsHeading={line.swapGroup ? GROUP_LABEL[line.swapGroup] : undefined}
      options={swappable ? options : []}
      selectedRefId={line.refId}
      open={open}
      onToggleOpen={onToggleOpen}
      onSelect={(refId) => onSwap(line.key, refId)}
      disabled={disabled}
      included={line.included}
      /*
        Only optional lines get a switch. Treatment, the specialist fee and
        coordination have none — and the API refuses to drop them too, so this
        is a rule rather than a hidden control (docs/09 D18).
      */
      onIncludedChange={line.removable ? (value) => onToggle(line.key, value) : undefined}
    />
  )
}

/**
 * A row that names what was chosen, and opens to show what else it could be.
 *
 * The collapsed state carries the chosen option, its price and the number of
 * alternatives. That count is the point: it is what keeps this an advertised
 * choice rather than a value hidden behind a "change" link (D20).
 *
 * The switch is a sibling of the expand button, never inside it — a control
 * nested in a button is invalid, and toggling "include this" would also open a
 * list the patient did not ask for.
 */
function ChoiceRow<T extends BundleSwapOption>({
  icon: Icon,
  eyebrow,
  title,
  detail,
  note,
  unitNote,
  priceSgd,
  options,
  optionsHeading,
  selectedRefId,
  open,
  onToggleOpen,
  onSelect,
  disabled,
  included = true,
  onIncludedChange,
  renderTrailing,
}: {
  icon: typeof Ship
  eyebrow: string
  title: string
  detail?: string
  /** Consequences of changing this row — shown only while it is open. */
  note?: string
  unitNote?: string
  priceSgd: number | null
  options: T[]
  optionsHeading?: string
  selectedRefId: string | null
  open: boolean
  onToggleOpen: () => void
  onSelect: (refId: string) => void
  disabled?: boolean
  included?: boolean
  /** Present only on removable lines — its absence is what hides the switch. */
  onIncludedChange?: (included: boolean) => void
  renderTrailing?: (option: T) => React.ReactNode
}) {
  const expandable = options.length > 1
  const isOpen = open && expandable

  return (
    <div className={cn('transition', !included && 'bg-slate-50/60')}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={expandable ? onToggleOpen : undefined}
          aria-expanded={expandable ? isOpen : undefined}
          disabled={!expandable}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 text-left transition',
            expandable ? 'hover:bg-slate-50' : 'cursor-default',
            !onIncludedChange && 'pr-3',
          )}
        >
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
              included
                ? 'bg-slate-100 text-slate-600 ring-slate-200'
                : 'bg-slate-100 text-slate-300 ring-slate-200',
            )}
          >
            <Icon className="h-4 w-4" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {eyebrow}
            </span>
            <span
              className={cn(
                'block truncate text-sm font-semibold leading-snug',
                included ? 'text-slate-800' : 'text-slate-400',
              )}
            >
              {title}
            </span>
            {detail && <span className="block truncate text-[11px] text-slate-500">{detail}</span>}
          </span>

          <span className="flex shrink-0 flex-col items-end gap-0.5 pl-1">
            {priceSgd !== null && (
              <span
                className={cn(
                  'tabular text-sm font-semibold',
                  included ? 'text-slate-900' : 'text-slate-400',
                )}
              >
                {formatSgd(priceSgd)}
              </span>
            )}
            {unitNote && <span className="tabular text-[11px] text-slate-400">{unitNote}</span>}

            {/*
              The affordance that keeps this an advertised choice: how many
              other things the patient may actually pick here.
            */}
            {expandable ? (
              <span className="flex items-center gap-0.5 text-[11px] font-medium text-brand-700">
                {options.length} options
                <ChevronDown className={cn('h-3 w-3 transition', isOpen && 'rotate-180')} />
              </span>
            ) : (
              !onIncludedChange && <span className="text-[11px] text-slate-400">Included</span>
            )}
          </span>
        </button>

        {onIncludedChange && (
          <div className="flex shrink-0 items-center px-3">
            <Switch
              checked={included}
              disabled={disabled}
              onCheckedChange={onIncludedChange}
              aria-label={`Include ${title}`}
            />
          </div>
        )}
      </div>

      {isOpen && (
        <div className="border-t border-slate-100 bg-slate-50/60 p-3">
          {optionsHeading && (
            <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {optionsHeading}
            </p>
          )}

          <div className="space-y-1.5" role="radiogroup" aria-label={optionsHeading ?? eyebrow}>
            {options.map((option) => (
              <OptionRow
                key={option.refId}
                option={option}
                selected={option.refId === selectedRefId}
                disabled={disabled}
                onSelect={() => onSelect(option.refId)}
                trailing={renderTrailing?.(option)}
              />
            ))}
          </div>

          {note && <p className="px-1 pt-2 text-[11px] leading-relaxed text-slate-500">{note}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * One choosable option.
 *
 * The row itself is the control, so the map link cannot be nested inside it —
 * a link inside a button is invalid, and tapping "Look up" would also select the
 * option. It sits alongside instead.
 */
function OptionRow({
  option,
  selected,
  disabled,
  onSelect,
  trailing,
}: {
  option: BundleSwapOption
  selected: boolean
  disabled?: boolean
  onSelect: () => void
  trailing?: React.ReactNode
}) {
  const distance = formatKm(option.distanceKm)

  return (
    <div
      className={cn(
        'flex items-start gap-1 rounded-xl border transition',
        selected
          ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-200'
          : 'border-slate-200 bg-white hover:border-slate-300',
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-xl px-3 py-2.5 text-left disabled:opacity-60"
      >
        <span
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
            selected ? 'border-brand-600 bg-brand-600' : 'border-slate-300 bg-white',
          )}
          aria-hidden
        >
          {selected && <Check className="h-3 w-3 text-white" />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-slate-800">
            {option.label}
          </span>
          <span className="block truncate text-[11px] text-slate-500">{option.detail}</span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="tabular text-xs font-semibold text-slate-700">
            {formatSgd(option.unitPriceSgd)}
          </span>
          {trailing}
          {/*
            Distance to the hospital THIS patient chose, recomputed when they
            change hospital. It used to be one stored number, identical for
            every hospital on the list.
          */}
          {distance && <span className="tabular text-[11px] text-slate-400">{distance}</span>}
        </span>
      </button>

      {/*
        A Google SEARCH for the name, not a map pin. Our rating is one number
        from one source; this sends them to read what everyone else said. And a
        pin would land wherever our stored coordinate says, which for a building
        centroid is a couple of hundred metres out — often the wrong car park.
      */}
      {option.searchUrl && (
        <a
          href={option.searchUrl}
          target="_blank"
          rel="noreferrer noopener"
          title={`Look up ${option.label} on Google`}
          className="mr-1.5 mt-2.5 flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-400 transition hover:bg-white hover:text-brand-700"
        >
          Look up
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}
                                                                                                                                                                                                                                                                                                                         