import { useState } from 'react'
import {
  ChevronDown,
  ExternalLink,
  Info,
  Landmark,
  MapPin,
  PartyPopper,
  ShoppingBag,
  TreePalm,
  UtensilsCrossed,
  Waves,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatKm } from '@/lib/geo'
import type { NearbyPanel as NearbyPanelData, NearbyPlace, PlaceCategory } from '@/types'

const CATEGORY_ICON: Record<PlaceCategory, typeof MapPin> = {
  RESTAURANT: UtensilsCrossed,
  BEACH: Waves,
  PARK: TreePalm,
  MALL: ShoppingBag,
  ATTRACTION: Landmark,
  FESTIVAL: PartyPopper,
}

const CATEGORY_LABEL: Record<PlaceCategory, string> = {
  RESTAURANT: 'Eat',
  BEACH: 'Beach',
  PARK: 'Park',
  MALL: 'Mall',
  ATTRACTION: 'See',
  FESTIVAL: 'Festival',
}

/**
 * "While you're there" — travel information, deliberately outside the plan.
 *
 * THIS PANEL HAS NO PRICES AND NO TOTAL, and that is a design constraint
 * rather than an omission. Places are suggestions; the moment one carries an
 * amount, someone adds it to the bundle, and the savings figure the whole
 * pitch rests on (D9) stops meaning what it says. `priceBand` is a guidebook
 * hint — "$$" — which cannot be summed.
 *
 * Two other things it must keep doing:
 *
 *  - Every name comes from the `places` table, never from a model. Asking an
 *    LLM for restaurant recommendations is precisely the invented-content path
 *    rule 5 exists to close.
 *
 *  - It says out loud that this is travel information, not clinical advice,
 *    and that none of these businesses is a MedBridge partner. Real names on a
 *    real map make both easy to assume, so neither is left to inference.
 *
 * Collapsed by default. Nothing in here is a decision the patient has to make
 * to get treated, so it must not compete with the ones that are — and being
 * folded away is itself another way of saying this is not part of the plan.
 */
export function NearbyPanel({ data }: { data: NearbyPanelData }) {
  const [open, setOpen] = useState(false)

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-slate-50"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200">
          <MapPin className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">While you're there</p>
          <p className="truncate text-[11px] text-slate-500">
            {data.places.length} places near {data.anchorName} · not part of your quote
          </p>
        </div>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="border-t border-slate-100">
          {/*
            The recovery note explains WHY the list looks the way it does.
            Filtering silently would leave a cataract patient wondering where
            the beaches went; saying it turns a hidden rule into an explanation.
          */}
          {data.recoveryNote && (
            <p className="mx-3 mt-3 flex items-start gap-2 rounded-xl bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-600">
              <Info className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>
                <span className="font-semibold text-slate-700">Chosen around your recovery: </span>
                {data.recoveryNote}
              </span>
            </p>
          )}

          <ul className="space-y-1.5 p-3">
            {data.places.map((place) => (
              <PlaceRow key={place.id} place={place} anchor={data.anchor} />
            ))}
          </ul>

          <p className="border-t border-slate-100 px-4 py-3 text-[11px] leading-relaxed text-slate-400">
            {data.disclaimer}
          </p>
        </div>
      )}
    </section>
  )
}

function PlaceRow({ place, anchor }: { place: NearbyPlace; anchor: 'hotel' | 'hospital' }) {
  const Icon = CATEGORY_ICON[place.category] ?? MapPin
  const distance = formatKm(anchor === 'hotel' ? place.fromHotelKm : place.fromHospitalKm)

  return (
    <li className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        <Icon className="h-3.5 w-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-xs font-semibold text-slate-800">{place.name}</p>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
            {CATEGORY_LABEL[place.category] ?? place.category}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{place.description}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
          {distance && <span className="tabular">{distance} away</span>}
          {/*
            A band, never an amount — this is what a guidebook means by "$$",
            and it is deliberately not a number anyone can add to a total.
          */}
          <span className="tabular">{place.priceBand}</span>
          {place.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className={cn(
                'rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500',
              )}
            >
              {tag}
            </span>
          ))}
          {/* A Google search by name — Google resolves the business, its
              rating and its reviews far better than a pin at our coordinate. */}
          {place.searchUrl && (
            <a
              href={place.searchUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 font-medium text-brand-700 hover:underline"
            >
              Look up
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      </div>
    </li>
  )
}
