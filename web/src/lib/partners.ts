import type { BookingStage, PartnerType } from '@/types'

/**
 * How a booking reads to the partner who has to act on it.
 *
 * The wording is the point. "Pending" has to say plainly that the patient has
 * chosen them but nothing is owed yet — a partner who reads a pending row as an
 * invoice will chase us for money, and a partner who cannot see it at all will
 * not hold the slot.
 */
export const BOOKING_STAGE_META: Record<
  BookingStage,
  { label: string; className: string; hint: string }
> = {
  PENDING: {
    label: 'In review',
    className: 'bg-amber-50 text-amber-800 ring-amber-200',
    hint: 'The patient chose you. A MedBridge coordinator is still checking the quote — not yet owed.',
  },
  APPROVED: {
    label: 'Approved',
    className: 'bg-teal-50 text-teal-700 ring-teal-200',
    hint: 'Signed off by a coordinator and sent to the patient.',
  },
  CONFIRMED: {
    label: 'Confirmed',
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    hint: 'The patient accepted their pass and is travelling.',
  },
}

/**
 * Presentation for the four partner types.
 *
 * One place, because the type shows up in a route, a picker, a page header and
 * a sidebar entry, and four copies of "Recovery Hotel" drift within a week.
 */
export const PARTNER_META: Record<
  PartnerType,
  {
    /** URL segment, e.g. /hospital/:id */
    path: string
    singular: string
    plural: string
    /** What this partner supplies, in their own words. */
    supplies: string
    /** Shown on the picker, explaining what they are about to open. */
    blurb: string
    accent: string
  }
> = {
  hospital: {
    path: 'hospital',
    singular: 'Hospital',
    plural: 'Hospitals',
    supplies: 'treatment and specialist care',
    blurb: 'Patients arriving for treatment, the procedures you perform, and your specialists.',
    accent: 'bg-sky-50 text-sky-700 ring-sky-200',
  },
  hotel: {
    path: 'hotel',
    singular: 'Recovery hotel',
    plural: 'Recovery hotels',
    supplies: 'recovery nights',
    blurb: 'Room nights booked through MedBridge, your nightly rate and recovery certification.',
    accent: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  ferry: {
    path: 'ferry',
    singular: 'Ferry crossing',
    plural: 'Ferry operators',
    supplies: 'crossings',
    blurb: 'Seats booked on your crossings, with the schedule and fare we quote against.',
    accent: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  },
  transport: {
    path: 'transport',
    singular: 'Transfer service',
    plural: 'Ground transport',
    supplies: 'transfers',
    blurb: 'Transfers booked, your vehicle types and the price we quote for each loop.',
    accent: 'bg-amber-50 text-amber-800 ring-amber-200',
  },
}

export const PARTNER_TYPES: PartnerType[] = ['hospital', 'hotel', 'ferry', 'transport']
