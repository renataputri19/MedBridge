import { Link } from 'react-router-dom'
import {
  ExternalLink,
  Info,
  Landmark,
  MapPin,
  PartyPopper,
  ShoppingBag,
  TreePalm,
  UtensilsCrossed,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { usePlaces } from '@/hooks/queries'
import { PLACE_CATEGORY_META, PLACE_CATEGORY_ORDER } from '@/lib/constants'
import type { PlaceCategory } from '@/types'

const PLACE_ICON: Record<PlaceCategory, LucideIcon> = {
  RESTAURANT: UtensilsCrossed,
  MALL: ShoppingBag,
  PARK: TreePalm,
  BEACH: Waves,
  ATTRACTION: Landmark,
  FESTIVAL: PartyPopper,
}

/**
 * Places & wisata — the unpriced half of the pass.
 *
 * This page used to be "Hotels & Transport" and carried four tabs: hotel rates,
 * ferry fares, transfer prices and places. The first three were PARTNER-OWNED
 * numbers being edited by MedBridge staff, which is both the wrong authority
 * and, in the hospital case, was silently editing a field the quote did not
 * read. Each moved into the portal of the partner who actually sets it.
 *
 * Places stayed because there is nowhere for them to go: no supplier owns a
 * public park, and these rows are suggestions that never carry a price at all.
 */
export default function Logistics() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Places & Wisata"
        description="Somewhere to eat, walk or look at between appointments — the unpriced half of the pass."
      />

      <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600">
        <Info className="mt-px h-4 w-4 shrink-0 text-slate-400" />
        <span>
          Looking for hotel rates, ferry fares or transfer prices? Each partner now maintains
          their own in their portal —{' '}
          <Link to="/hotel" className="font-medium text-brand-700 hover:underline">
            hotels
          </Link>
          ,{' '}
          <Link to="/ferry" className="font-medium text-brand-700 hover:underline">
            ferries
          </Link>{' '}
          and{' '}
          <Link to="/transport" className="font-medium text-brand-700 hover:underline">
            ground transport
          </Link>
          .
        </span>
      </p>

      <PlacesPanel />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * READ-ONLY, AND THERE IS NO "EDIT" BUTTON ON THIS PAGE.
 *
 * Every other catalogue screen edits a price, because every other row has one.
 * A place has a guidebook band and no amount, and that is the property that
 * keeps it out of `draft_lines`, out of the total, and out of the Singapore
 * savings comparison (docs/09 D22). A number staff could type here would be a
 * number someone eventually adds up.
 *
 * What staff DO need from this screen is to see what the recovery filter is
 * choosing between, and to be able to check that a row is a real business —
 * hence the tags and the OpenStreetMap provenance link on every card.
 */
function PlacesPanel() {
  const { data: places, isLoading } = usePlaces()

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    )
  }

  const rows = places ?? []

  // Grouped rather than listed flat: the thing worth seeing at a glance is the
  // BALANCE of the catalogue. Nine restaurants and one park is a "while you're
  // there" panel that always suggests dinner.
  const grouped = PLACE_CATEGORY_ORDER.map((category) => ({
    category,
    items: rows.filter((place) => place.category === category),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        <Info className="mt-px h-4 w-4 shrink-0 text-slate-400" />
        <span>
          <span className="font-semibold text-slate-700">Suggestions, not inventory. </span>
          None of these is priced, booked or arranged by MedBridge, and none is a partner. They
          never enter a quote — patients see them in a separate panel, filtered by the
          procedure&apos;s recovery profile, so nobody is offered a beach two days after cataract
          surgery.
        </span>
      </p>

      {grouped.map(({ category, items }) => {
        const meta = PLACE_CATEGORY_META[category]
        const Icon = PLACE_ICON[category]

        return (
          <section key={category}>
            <div className="mb-2.5 flex items-center gap-2">
              <Icon className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-800">{meta.plural}</h3>
              <span className="tabular rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
                {items.length}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((place) => (
                <Card key={place.id}>
                  <CardContent className="space-y-2.5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900">{place.name}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                          <MapPin className="h-3 w-3" />
                          {place.district}
                        </p>
                      </div>
                      {/*
                        A band, never an amount — the same thing a guidebook
                        means by "$$", and deliberately not summable.
                      */}
                      <span className="tabular shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
                        {place.priceBand}
                      </span>
                    </div>

                    <p className="text-xs leading-relaxed text-slate-500">{place.description}</p>

                    {/*
                      The vocabulary the recovery filter matches on. Showing it
                      is what lets staff answer "why did a cataract patient
                      never see this?" without reading PlaceSuggester.
                    */}
                    <div className="flex flex-wrap gap-1">
                      {place.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2.5 text-[11px]">
                      <Badge variant="neutral" size="sm" className={meta.className}>
                        {meta.label}
                      </Badge>

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

                      {/*
                        The provenance trail. This catalogue once contained
                        businesses that did not exist, and nothing downstream
                        could tell. An openable OSM element is the check.
                      */}
                      {place.sourceUrl && (
                        <a
                          href={place.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="ml-auto inline-flex items-center gap-0.5 text-slate-400 hover:text-slate-600 hover:underline"
                        >
                          Verify on OSM
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
