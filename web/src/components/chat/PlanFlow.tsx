import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Building2,
  Car,
  Check,
  CircleSlash,
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
import { Button } from '@/components/ui/button'
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
 * The plan, one choice at a time, on the page the conversation is already on.
 *
 * Three earlier shapes each failed the same way. Side by side — and later two
 * columns — put the whole plan next to the chat, which asked the patient to
 * read a conversation and evaluate two dozen priced choices at once. A separate
 * page fixed the crowding by taking the conversation away, so every question
 * cost them the plan and arriving read like landing on a second website.
 *
 * So the plan never leaves the chat page, and it never arrives all at once. It
 * is a deck: one card, one decision, the alternatives for that decision and
 * nothing else, and a next button. The running total sits above every card
 * because it is the one number that belongs to all of them.
 *
 * What has NOT changed is who chooses. Every category still lists its real
 * alternatives — hospital, specialist, both ferry legs, hotel, transfer — and
 * we still only pick the default. A card with a single option is not a
 * decision, so it is not a card; nothing choosable is ever skipped.
 *
 * Nothing here was priced by a model. Every figure comes from the catalogue,
 * and every option list is what that catalogue actually contains.
 */

const CATEGORY_ICON: Record<QuoteCategory, typeof Ship> = {
  TREATMENT: Building2,
  DOCTOR_FEE: Stethoscope,
  FERRY: Ship,
  HOTEL: BedDouble,
  TRANSPORT: Car,
  ADMIN: Sparkles,
}

/**
 * What each card asks. The eyebrow names the category, the question is the
 * decision in the patient's own terms — a card headed "Hotel" states a topic;
 * a card headed "Where would you like to stay?" asks for an answer.
 */
const ASK: Record<string, { eyebrow: string; question: string }> = {
  doctor: { eyebrow: 'Specialist', question: 'Who would you like to perform it?' },
  ferry_out: { eyebrow: 'Ferry out', question: 'Which ferry over?' },
  ferry_return: { eyebrow: 'Ferry back', question: 'Which ferry home?' },
  hotel: { eyebrow: 'Hotel', question: 'Where would you like to stay?' },
  transport: { eyebrow: 'Transfer', question: 'How would you like to get around?' },
}

const CATEGORY_LABEL: Record<QuoteCategory, string> = {
  TREATMENT: 'Treatment',
  DOCTOR_FEE: 'Specialist',
  FERRY: 'Ferry',
  HOTEL: 'Hotel',
  TRANSPORT: 'Transfer',
  ADMIN: 'Coordination',
}

/** The short name of a card, used on the button that leads to it. */
const SHORT: Record<string, string> = {
  doctor: 'specialist',
  ferry_out: 'ferry over',
  ferry_return: 'ferry home',
  hotel: 'hotel',
  transport: 'transfer',
}

const TRIP_CATEGORIES: QuoteCategory[] = ['FERRY', 'HOTEL', 'TRANSPORT']

/* -------------------------------------------------------------------------- */
/* The deck                                                                    */
/* -------------------------------------------------------------------------- */

type Card =
  | { kind: 'hospital'; id: string; short: string }
  | { kind: 'nights'; id: string; short: string }
  | { kind: 'line'; id: string; short: string; line: BundleLine }
  | { kind: 'review'; id: string; short: string }

interface PlanFlowProps {
  bundle: ChatBundle
  disabled?: boolean
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
  onToggle,
  onSwap,
  onChooseHospital,
  onSetNights,
  contactForm,
  disclaimer,
}: PlanFlowProps) {
  const [position, setPosition] = useState(0)
  // Which way the next card comes in from. Sliding the wrong way turns "back"
  // into a second "next", which is exactly the cue people read to know they
  // undid something.
  const [direction, setDirection] = useState<1 | -1>(1)

  const cards = buildDeck(bundle)

  /*
   * The deck changes shape under the patient — choosing a day trip removes the
   * hotel card, so the position they are standing on may no longer exist.
   * Clamping is what keeps that from landing them on a blank card.
   */
  const index = Math.min(position, cards.length - 1)
  const card = cards[index]
  const previous = index > 0 ? cards[index - 1] : null
  const next = index < cards.length - 1 ? cards[index + 1] : null

  const go = (to: number) => {
    setDirection(to > index ? 1 : -1)
    setPosition(Math.max(0, Math.min(to, cards.length - 1)))
  }

  /** Jump to the card that owns a priced line — the "change" path from review. */
  const goToLine = (key: string) => {
    const found = cards.findIndex(
      (entry) =>
        (entry.kind === 'line' && entry.line.key === key) ||
        (entry.kind === 'hospital' && key === 'treatment') ||
        (entry.kind === 'nights' && key === 'hotel'),
    )
    if (found >= 0) go(found)
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/*
        The one thing that belongs to every card: what this costs so far, and
        how far through the choices they are.
      */}
      <header className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">
              {bundle.procedure?.name ?? 'Your plan'}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {bundle.partySize === 1 ? 'Just you' : `${bundle.partySize} travellers`}
              {bundle.travelDate &&
                ` · ${new Date(bundle.travelDate).toLocaleDateString('en-SG', {
                  day: 'numeric',
                  month: 'short',
                })}`}
              {bundle.hotelNights > 0 &&
                ` · ${bundle.hotelNights} night${bundle.hotelNights === 1 ? '' : 's'}`}
            </p>
          </div>
          <p className="shrink-0 text-xl font-bold leading-none text-slate-900">
            {formatSgd(bundle.totals.totalSgd)}
          </p>
        </div>

        <Progress cards={cards} index={index} onJump={go} />
      </header>

      {/*
        One card at a time. The key is what replays the slide — React reuses the
        node otherwise, and the deck changes without appearing to move.
      */}
      <div className="min-h-[17rem] overflow-hidden">
        <div
          key={card.id}
          className={cn(
            'animate-in p-4 fade-in duration-300',
            direction > 0 ? 'slide-in-from-right-8' : 'slide-in-from-left-8',
          )}
        >
          {card.kind === 'hospital' && (
            <HospitalCard bundle={bundle} disabled={disabled} onSelect={onChooseHospital} />
          )}

          {card.kind === 'nights' && (
            <NightsCard bundle={bundle} disabled={disabled} onSetNights={onSetNights} />
          )}

          {card.kind === 'line' && (
            <LineCard
              bundle={bundle}
              line={card.line}
              disabled={disabled}
              onSwap={onSwap}
              onToggle={onToggle}
            />
          )}

          {card.kind === 'review' && (
            <ReviewCard
              bundle={bundle}
              onChange={goToLine}
              contactForm={contactForm}
              disclaimer={disclaimer}
            />
          )}
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-slate-200 bg-slate-50/70 px-4 py-3">
        {previous ? (
          <Button variant="outline" onClick={() => go(index - 1)}>
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back</span>
          </Button>
        ) : (
          <span className="text-[11px] text-slate-400">Pick anything you like — nothing is booked yet</span>
        )}

        {next && (
          <Button size="lg" className="ml-auto flex-1 sm:flex-none" onClick={() => go(index + 1)}>
            {next.kind === 'review' ? 'Review your plan' : `Next: your ${next.short}`}
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </footer>
    </section>
  )
}

/**
 * The deck, in the order the trip happens in.
 *
 * A card earns its place by having something to decide. One hospital is not a
 * choice of hospital; a fixed transfer with no alternatives and no way to drop
 * it is not a choice of transfer. Those still appear — priced, in the review
 * breakdown — they just do not stop the patient on the way there.
 */
function buildDeck(bundle: ChatBundle): Card[] {
  const cards: Card[] = []

  const decidable = (line: BundleLine) => {
    const options = line.swapGroup ? (bundle.swapOptions[line.swapGroup] ?? []) : []
    return (line.swappable && options.length > 1) || line.removable
  }

  if (bundle.hospitalOptions.length > 1) {
    cards.push({ kind: 'hospital', id: 'hospital', short: 'hospital' })
  }

  // The specialist follows the hospital, because changing the hospital changes
  // who is available.
  for (const line of bundle.lines) {
    if (line.key !== 'treatment' && line.category === 'DOCTOR_FEE' && decidable(line)) {
      cards.push({ kind: 'line', id: line.key, short: SHORT[line.swapGroup ?? ''] ?? 'specialist', line })
    }
  }

  // Nights are clinical before they are logistical, so they sit with the
  // treatment rather than with the hotel they happen to determine.
  if (bundle.procedure) {
    cards.push({ kind: 'nights', id: 'nights', short: 'stay' })
  }

  for (const line of bundle.lines) {
    if (TRIP_CATEGORIES.includes(line.category) && decidable(line)) {
      cards.push({
        kind: 'line',
        id: line.key,
        short: SHORT[line.swapGroup ?? ''] ?? CATEGORY_LABEL[line.category].toLowerCase(),
        line,
      })
    }
  }

  cards.push({ kind: 'review', id: 'review', short: 'review' })
  return cards
}

/**
 * Where they are in the deck.
 *
 * Dots rather than a bar, and clickable: someone who wants to go straight back
 * to the hospital should not have to press "back" four times. The count is
 * spelled out underneath because eight dots is a texture, not a number.
 */
function Progress({
  cards,
  index,
  onJump,
}: {
  cards: Card[]
  index: number
  onJump: (to: number) => void
}) {
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <div className="flex flex-1 items-center gap-1">
        {cards.map((card, position) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onJump(position)}
            aria-label={`Go to ${card.short}`}
            aria-current={position === index ? 'step' : undefined}
            className="group py-1.5"
          >
            <span
              className={cn(
                'block h-1.5 rounded-full transition-all',
                position === index
                  ? 'w-6 bg-brand-600'
                  : position < index
                    ? 'w-1.5 bg-teal-400 group-hover:bg-teal-500'
                    : 'w-1.5 bg-slate-200 group-hover:bg-slate-300',
              )}
            />
          </button>
        ))}
      </div>

      <p className="tabular shrink-0 text-[11px] font-medium text-slate-400">
        {index + 1} of {cards.length}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* One card                                                                    */
/* -------------------------------------------------------------------------- */

/** The question at the top of a card, and its icon. */
function Ask({
  icon: Icon,
  eyebrow,
  question,
  detail,
}: {
  icon: typeof Ship
  eyebrow: string
  question: string
  detail?: string
}) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{eyebrow}</p>
        <p className="text-sm font-bold leading-snug text-slate-900">{question}</p>
        {detail && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{detail}</p>}
      </div>
    </div>
  )
}

function HospitalCard({
  bundle,
  disabled,
  onSelect,
}: {
  bundle: ChatBundle
  disabled?: boolean
  onSelect: (refId: string) => void
}) {
  return (
    <>
      <Ask
        icon={Hospital}
        eyebrow="Hospital"
        question="Where would you like to be treated?"
        detail="A budget never trims anything on this card."
      />

      <div className="space-y-1.5" role="radiogroup" aria-label="Choose your hospital">
        {bundle.hospitalOptions.map((option) => (
          <OptionRow
            key={option.refId}
            option={option}
            selected={option.refId === bundle.hospitalId}
            disabled={disabled}
            onSelect={() => onSelect(option.refId)}
          />
        ))}
      </div>

      <p className="mt-2.5 px-1 text-[11px] leading-relaxed text-slate-500">
        Changing hospital also updates your specialist and ferry terminal. Everything you have
        already chosen is carried across.
      </p>
    </>
  )
}

/**
 * Nights, as choosable as anything else on the deck.
 *
 * The recommendation is marked but not enforced — it is a clinical figure from
 * the procedure, and a patient who wants a night either side of it is not doing
 * anything wrong.
 */
function NightsCard({
  bundle,
  disabled,
  onSetNights,
}: {
  bundle: ChatBundle
  disabled?: boolean
  onSetNights: (nights: number) => void
}) {
  const recommended = bundle.procedure?.recoveryNights ?? 0

  return (
    <>
      <Ask
        icon={Moon}
        eyebrow="Your stay"
        question="How long in Batam?"
        detail={
          recommended > 0
            ? `${recommended} night${recommended === 1 ? '' : 's'} recommended after this procedure.`
            : 'A day procedure — an overnight stay is optional.'
        }
      />

      <div className="space-y-1.5" role="radiogroup" aria-label="Nights in Batam">
        {[0, 1, 2, 3, 4].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === bundle.hotelNights}
            disabled={disabled}
            onClick={() => onSetNights(value)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-60',
              value === bundle.hotelNights
                ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-200'
                : 'border-slate-200 bg-white hover:border-slate-300',
            )}
          >
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                value === bundle.hotelNights
                  ? 'border-brand-600 bg-brand-600'
                  : 'border-slate-300 bg-white',
              )}
              aria-hidden
            >
              {value === bundle.hotelNights && <Check className="h-3 w-3 text-white" />}
            </span>

            <span className="min-w-0 flex-1 text-xs font-semibold text-slate-800">
              {value === 0 ? 'Day trip — home the same evening' : `${value} night${value === 1 ? '' : 's'}`}
            </span>

            {value === recommended && recommended > 0 && (
              <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
                Recommended
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}

function LineCard({
  bundle,
  line,
  disabled,
  onSwap,
  onToggle,
}: {
  bundle: ChatBundle
  line: BundleLine
  disabled?: boolean
  onSwap: (key: string, refId: string) => void
  onToggle: (key: string, included: boolean) => void
}) {
  const options = line.swapGroup ? (bundle.swapOptions[line.swapGroup] ?? []) : []
  const ask = (line.swapGroup ? ASK[line.swapGroup] : undefined) ?? {
    eyebrow: CATEGORY_LABEL[line.category],
    question: `Which ${CATEGORY_LABEL[line.category].toLowerCase()}?`,
  }

  return (
    <>
      {/* The budget belongs on the trip cards and nowhere near the treatment:
          an amber "over budget" note above a list of hospitals would invite
          exactly the trade we refuse to make (rule 10). */}
      {bundle.budget && TRIP_CATEGORIES.includes(line.category) && (
        <div className="mb-3">
          <BudgetBanner budget={bundle.budget} />
        </div>
      )}

      <Ask icon={CATEGORY_ICON[line.category]} eyebrow={ask.eyebrow} question={ask.question} />

      <div className="space-y-1.5" role="radiogroup" aria-label={ask.question}>
        {line.swappable &&
          options.map((option) => (
            <OptionRow
              key={option.refId}
              option={option}
              selected={line.included && option.refId === line.refId}
              disabled={disabled}
              onSelect={() => {
                // Choosing an option on a line they had dropped is a request to
                // have it back — otherwise the tap selects something invisible.
                if (!line.included) onToggle(line.key, true)
                if (option.refId !== line.refId) onSwap(line.key, option.refId)
              }}
            />
          ))}

        {/*
          Dropping something is a choice, so it is one of the choices — not a
          switch in the corner. Only on lines the API will actually let go of:
          treatment, the specialist fee and coordination have no such row, and
          the server refuses them too (docs/09 D18).
        */}
        {line.removable && (
          <button
            type="button"
            role="radio"
            aria-checked={!line.included}
            disabled={disabled}
            onClick={() => onToggle(line.key, false)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-60',
              !line.included
                ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-200'
                : 'border-dashed border-slate-300 bg-white hover:border-slate-400',
            )}
          >
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                !line.included ? 'border-brand-600 bg-brand-600' : 'border-slate-300 bg-white',
              )}
              aria-hidden
            >
              {!line.included && <Check className="h-3 w-3 text-white" />}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-slate-800">
                I don't need this
              </span>
              <span className="block text-[11px] text-slate-500">
                Leave it out and arrange it yourself
              </span>
            </span>

            <CircleSlash className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>
        )}
      </div>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* The last card                                                               */
/* -------------------------------------------------------------------------- */

function ReviewCard({
  bundle,
  onChange,
  contactForm,
  disclaimer,
}: {
  bundle: ChatBundle
  onChange: (lineKey: string) => void
  contactForm: React.ReactNode
  disclaimer: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <Ask
        icon={Receipt}
        eyebrow="Review"
        question="Check it over, then send"
        detail="Nothing is booked from here. A MedBridge coordinator confirms availability and final pricing with the hospital first."
      />

      {bundle.budget && <BudgetBanner budget={bundle.budget} />}

      <Breakdown bundle={bundle} onChange={onChange} />

      {/*
        Deliberately outside the priced list above. This is travel information
        sitting beside a plan, not part of it — nothing in it is quoted,
        bundled, or counted towards the savings figure.
      */}
      {bundle.nearby && <NearbyPanel data={bundle.nearby} />}

      {contactForm}
      {disclaimer}
    </div>
  )
}

/**
 * The itemised total, and the way back to any of it.
 *
 * Every line carries a "change" that returns to the card it was decided on, so
 * the deck reads in both directions — forwards it asks, backwards it explains.
 * Lines with nothing to decide have no such link and say so by its absence.
 */
function Breakdown({
  bundle,
  onChange,
}: {
  bundle: ChatBundle
  onChange: (lineKey: string) => void
}) {
  const lines = bundle.lines.filter((line) => line.included)

  const changeable = (line: BundleLine) => {
    if (line.category === 'ADMIN') return false
    if (line.key === 'treatment') return bundle.hospitalOptions.length > 1
    const options = line.swapGroup ? (bundle.swapOptions[line.swapGroup] ?? []) : []
    return (line.swappable && options.length > 1) || line.removable
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3.5">
      <ul className="space-y-2">
        {lines.map((line) => (
          <li key={line.key} className="flex items-start justify-between gap-3 text-xs">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-slate-700">{line.label}</span>
              {changeable(line) && (
                <button
                  type="button"
                  onClick={() => onChange(line.key)}
                  className="text-[11px] font-semibold text-brand-700 transition hover:text-brand-800"
                >
                  Change
                </button>
              )}
            </span>
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
        The benchmark is treatment + one specialist consult, fixed against the
        procedure. It deliberately excludes ferry and hotel — a patient treated
        at home would not incur them — and it does not move when lines are
        removed, so the saving can never be inflated by trimming the plan.
        See docs/09 D9.
      */}
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
        Compared with the same treatment plus a specialist consultation in Singapore. Travel and
        accommodation are excluded from that figure.
      </p>
    </section>
  )
}

/**
 * Where the plan stands against the figure they gave us.
 *
 * Green when it fits, amber when it does not — never red. Being over budget is
 * information, not an error, and the patient has done nothing wrong.
 *
 * Every sentence is written by the backend's question bank (D17). The one thing
 * this component insists on adding is the guarantee underneath: whatever the
 * number says, the treatment, the specialist and the recovery nights are not
 * what gets cut.
 */
function BudgetBanner({ budget }: { budget: BudgetStatus }) {
  const fits = budget.fits

  return (
    <section
      className={cn(
        'rounded-xl border p-3',
        fits ? 'border-teal-200 bg-teal-50/70' : 'border-amber-200 bg-amber-50',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
            fits
              ? 'bg-teal-100 text-teal-700 ring-teal-200'
              : 'bg-amber-100 text-amber-800 ring-amber-200',
          )}
        >
          <Wallet className="h-3.5 w-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className={cn('text-xs font-semibold', fits ? 'text-teal-900' : 'text-amber-900')}>
              {fits ? 'Within your budget' : 'Over your budget'}
            </p>
            <p className={cn('tabular text-[11px]', fits ? 'text-teal-700' : 'text-amber-800')}>
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
 * One choosable option.
 *
 * The row itself is the control, so the search link cannot be nested inside it
 * — a link inside a button is invalid, and tapping "Look up" would also select
 * the option. It sits alongside instead.
 */
function OptionRow({
  option,
  selected,
  disabled,
  onSelect,
}: {
  option: BundleSwapOption
  selected: boolean
  disabled?: boolean
  onSelect: () => void
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
