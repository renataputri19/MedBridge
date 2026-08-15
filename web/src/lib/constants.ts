import type {
  Channel,
  InquiryStatus,
  PlaceCategory,
  ProcedureCategory,
  QuoteCategory,
} from '@/types'

/*
 * Gate and pricing values below mirror `config/medbridge.php`, which is
 * authoritative. They are deliberately NOT editable from the browser: the gate
 * runs server-side, so a locally-tuned threshold would only change how a
 * confidence score is *rendered* while the real escalation stayed put — a
 * safety indicator reporting a gate the system is not using. Changing these
 * for real means changing the backend env, then this file to match.
 */

/**
 * Human-in-the-loop gate. Any Hermes extraction scoring below this is forced
 * into HOSPITAL_REVIEW_REQUIRED / HUMAN_TAKEOVER — the AI never quotes alone.
 * Mirrors `medbridge.gate.confidence_threshold`.
 */
export const CONFIDENCE_THRESHOLD = 0.75

/** Mirrors `medbridge.gate.require_doctor_review_for_high_risk`. */
export const REQUIRE_DOCTOR_REVIEW_FOR_HIGH_RISK = true

/** Indicative SGD → IDR rate. The backend is the source of truth at quote time. */
export const IDR_PER_SGD = 12_150

/** Flat case-coordination fee. Mirrors `medbridge.pricing.coordination_fee_sgd`. */
export const COORDINATION_FEE_SGD = 35

/** Specialist consult added to the benchmark basket. Mirrors `medbridge.pricing.sg_consult_benchmark_sgd`. */
export const SG_CONSULT_BENCHMARK_SGD = 180

/** Phrases that immediately escalate to a human, regardless of AI confidence. */
export const EMERGENCY_KEYWORDS = [
  'emergency',
  'chest pain',
  'bleeding',
  'unconscious',
  'stroke',
  'accident',
  'severe pain',
  'cannot breathe',
  'ambulance',
  'urgent surgery',
] as const

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
export const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 4000)
export const USE_MOCKS = (import.meta.env.VITE_USE_MOCKS ?? 'true') !== 'false'
export const REALTIME_TRANSPORT = import.meta.env.VITE_REALTIME_TRANSPORT ?? 'mock'
export const SUPPORT_PHONE = import.meta.env.VITE_SUPPORT_PHONE ?? '+65 6000 0000'

/* -------------------------------------------------------------------------- */
/* Status presentation                                                         */
/* -------------------------------------------------------------------------- */

export interface StatusMeta {
  label: string
  short: string
  /** Badge classes. */
  className: string
  /** Solid dot / bar colour for timelines and kanban headers. */
  dot: string
  description: string
  /** Kanban ordering. HUMAN_TAKEOVER sits last as an exception lane. */
  order: number
}

export const STATUS_META: Record<InquiryStatus, StatusMeta> = {
  NEW_INQUIRY: {
    label: 'New Inquiry',
    short: 'New',
    className: 'bg-slate-100 text-slate-700 ring-slate-200',
    dot: 'bg-slate-400',
    description: 'Request submitted from the web chat, not yet parsed.',
    order: 0,
  },
  AI_PROCESSING: {
    label: 'AI Processing',
    short: 'Processing',
    className: 'bg-sky-100 text-sky-800 ring-sky-200',
    dot: 'bg-sky-500',
    description: 'Hermes is extracting intent, procedure and travel needs.',
    order: 1,
  },
  AI_ITINERARY_READY: {
    label: 'AI Itinerary Ready',
    short: 'Itinerary Ready',
    className: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
    dot: 'bg-indigo-500',
    description: 'Draft bundle assembled and waiting to enter review.',
    order: 2,
  },
  HOSPITAL_REVIEW_REQUIRED: {
    label: 'Hospital Review Required',
    short: 'Hospital Review',
    className: 'bg-amber-100 text-amber-900 ring-amber-200',
    dot: 'bg-amber-500',
    description: 'Operations staff must verify pricing and availability.',
    order: 3,
  },
  QUOTE_APPROVED: {
    label: 'Quote Approved',
    short: 'Approved',
    className: 'bg-teal-100 text-teal-800 ring-teal-200',
    dot: 'bg-teal-500',
    description: 'Priced, signed off and ready to send to the patient.',
    order: 5,
  },
  PATIENT_CONFIRMATION_PENDING: {
    label: 'Patient Confirmation Pending',
    short: 'Awaiting Patient',
    className: 'bg-violet-100 text-violet-800 ring-violet-200',
    dot: 'bg-violet-500',
    description: 'Itinerary link delivered, waiting on the patient to confirm.',
    order: 6,
  },
  CONFIRMED_BOOKING: {
    label: 'Confirmed Booking',
    short: 'Confirmed',
    className: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    dot: 'bg-emerald-500',
    description: 'Patient confirmed. Treatment and travel slots are held.',
    order: 7,
  },
  TRAVEL_READY: {
    label: 'Travel Ready',
    short: 'Travel Ready',
    className: 'bg-cyan-100 text-cyan-800 ring-cyan-200',
    dot: 'bg-cyan-500',
    description: 'Ferry, transport and hotel all ticketed. Pass issued.',
    order: 8,
  },
  COMPLETED: {
    label: 'Completed',
    short: 'Completed',
    className: 'bg-green-100 text-green-800 ring-green-200',
    dot: 'bg-green-600',
    description: 'Patient treated and returned to Singapore.',
    order: 9,
  },
  HUMAN_TAKEOVER: {
    label: 'Human Takeover',
    short: 'Takeover',
    className: 'bg-rose-100 text-rose-800 ring-rose-200',
    dot: 'bg-rose-500',
    description: 'AI stood down — emergency language or unknown procedure.',
    order: 10,
  },
}

/** Lanes rendered on the kanban board, in pipeline order. */
export const KANBAN_LANES: InquiryStatus[] = [
  'NEW_INQUIRY',
  'AI_PROCESSING',
  'AI_ITINERARY_READY',
  'HOSPITAL_REVIEW_REQUIRED',
  'QUOTE_APPROVED',
  'PATIENT_CONFIRMATION_PENDING',
  'CONFIRMED_BOOKING',
  'TRAVEL_READY',
  'COMPLETED',
  'HUMAN_TAKEOVER',
]

/** Statuses that count as "needs a human right now". */
export const REVIEW_STATUSES: InquiryStatus[] = [
  'HOSPITAL_REVIEW_REQUIRED',
  'HUMAN_TAKEOVER',
]

export const CLOSED_WON_STATUSES: InquiryStatus[] = [
  'CONFIRMED_BOOKING',
  'TRAVEL_READY',
  'COMPLETED',
]

/* -------------------------------------------------------------------------- */
/* Quote / category presentation                                               */
/* -------------------------------------------------------------------------- */

export const QUOTE_CATEGORY_META: Record<
  QuoteCategory,
  { label: string; className: string; hint: string }
> = {
  TREATMENT: {
    label: 'Treatment',
    className: 'bg-sky-50 text-sky-700 ring-sky-200',
    hint: 'Procedure, theatre, consumables and inpatient stay.',
  },
  DOCTOR_FEE: {
    label: 'Doctor Fee',
    className: 'bg-teal-50 text-teal-700 ring-teal-200',
    hint: 'Specialist consultation and surgeon fee.',
  },
  FERRY: {
    label: 'Ferry',
    className: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    hint: 'Return ferry crossing including seaport taxes.',
  },
  HOTEL: {
    label: 'Hotel',
    className: 'bg-violet-50 text-violet-700 ring-violet-200',
    hint: 'Recovery nights at a partner property.',
  },
  TRANSPORT: {
    label: 'Local Transport',
    className: 'bg-amber-50 text-amber-800 ring-amber-200',
    hint: 'Terminal pick-up, hospital and hotel transfers.',
  },
  ADMIN: {
    label: 'Coordination',
    className: 'bg-slate-100 text-slate-700 ring-slate-200',
    hint: 'MedBridge case management and interpreter support.',
  },
}

export const PROCEDURE_CATEGORY_LABEL: Record<ProcedureCategory, string> = {
  DENTAL: 'Dental',
  SCREENING: 'Health Screening',
  OPHTHALMOLOGY: 'Ophthalmology',
  ORTHOPEDICS: 'Orthopedics',
  GENERAL_SURGERY: 'General Surgery',
}

/**
 * Place categories, as the OPERATIONS PORTAL names them.
 *
 * Deliberately not the same strings the patient sees: `NearbyPanel` says "Eat"
 * and "See", which is right above a list of dinner options and wrong in a
 * catalogue screen where staff are auditing what the recovery filter can pick
 * from. Same enum, two audiences.
 *
 * There is no price here and no amount anywhere near it — a place carries a
 * guidebook band and nothing that can be summed (docs/09 D22).
 */
export const PLACE_CATEGORY_META: Record<
  PlaceCategory,
  { label: string; plural: string; className: string; dot: string }
> = {
  RESTAURANT: {
    label: 'Restaurant',
    plural: 'Restaurants',
    className: 'bg-amber-50 text-amber-800 ring-amber-200',
    dot: 'bg-amber-500',
  },
  MALL: {
    label: 'Mall',
    plural: 'Malls',
    className: 'bg-violet-50 text-violet-700 ring-violet-200',
    dot: 'bg-violet-500',
  },
  PARK: {
    label: 'Park',
    plural: 'Parks',
    className: 'bg-lime-50 text-lime-800 ring-lime-200',
    dot: 'bg-lime-600',
  },
  BEACH: {
    label: 'Beach',
    plural: 'Beaches',
    className: 'bg-sky-50 text-sky-700 ring-sky-200',
    dot: 'bg-sky-500',
  },
  ATTRACTION: {
    label: 'Attraction',
    plural: 'Attractions',
    className: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    dot: 'bg-indigo-500',
  },
  FESTIVAL: {
    label: 'Festival',
    plural: 'Festivals',
    className: 'bg-rose-50 text-rose-700 ring-rose-200',
    dot: 'bg-rose-500',
  },
}

/** Portal display order — most-used first, not alphabetical. */
export const PLACE_CATEGORY_ORDER: PlaceCategory[] = [
  'RESTAURANT',
  'MALL',
  'PARK',
  'BEACH',
  'ATTRACTION',
  'FESTIVAL',
]

export const CHANNEL_META: Record<Channel, { label: string; className: string }> = {
  WEB: { label: 'Web Chat', className: 'bg-sky-50 text-sky-700 ring-sky-200' },
  INTERNAL: { label: 'Internal', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
}

/* -------------------------------------------------------------------------- */
/* Chart tokens                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Categorical palette — FIXED ORDER, assigned by slot and never cycled or
 * re-ordered by rank. Slot 1 is the brand sky, slot 4 the brand teal.
 *
 * Validated with the dataviz six checks in both light (#ffffff) and dark
 * (#0f172a) surfaces: lightness band PASS, chroma floor PASS, adjacent CVD
 * ΔE 21.0 (deutan) PASS, normal-vision floor ΔE 27.1 PASS, contrast ≥ 3:1 PASS
 * on light. Brand sky and brand teal are deliberately NOT adjacent — as a pair
 * they measure ΔE 12.8, below the 15 normal-vision floor.
 *
 * Re-validate before changing a slot:
 *   node scripts/validate_palette.js "<hex,…>" --mode light
 */
export const CHART_CATEGORICAL = [
  '#0284c7', // 1 · sky 600   — brand primary
  '#d97706', // 2 · amber 600
  '#4f46e5', // 3 · indigo 600
  '#0d9488', // 4 · teal 600  — brand secondary
  '#7c3aed', // 5 · violet 600
  '#65a30d', // 6 · lime 600
] as const

/**
 * Ordinal ramp for ordered stages (the conversion funnel). One hue, light→dark,
 * so the reader sees the ordering in the colour. Validated with `--ordinal`:
 * monotone lightness PASS, adjacent ΔL ≥ 0.06 PASS, light-end contrast 2.03:1 PASS.
 */
export const CHART_ORDINAL_SKY = [
  '#4cc2f5',
  '#12a2e0',
  '#0b83c4',
  '#0a67a3',
  '#0c4d7d',
  '#0d3557',
] as const

/**
 * Commission meter — the share of gross booking value MedBridge keeps.
 *
 * A single ratio against a whole is a METER, not a two-slice pie and not a
 * two-hue stacked bar: the track is a lighter step of the SAME ramp, so the
 * reader sees one quantity filling one bar rather than two series competing.
 *
 * The first attempt used teal against a slate grey, which the validator
 * rejected on two counts — slate falls below the chroma floor (it reads as
 * "no data" rather than "partners' share") and the pair measured ΔE 14.8
 * normal-vision, under the 15 floor. Same-ramp fixed both.
 *
 * The fill is CHART_CATEGORICAL slot 4, so commission is the same colour here
 * as anywhere else it is plotted — colour follows the entity, never the rank.
 *
 * Validated on the light surface:
 *   node scripts/validate_palette.js "#14b8a6,#0d9488" --mode light --ordinal
 *   lightness monotone PASS · adjacent ΔL PASS · light-end contrast 2.42:1 PASS
 *   · single hue (2° spread) PASS
 */
export const METER_FILL = '#0d9488' // teal 600 — our commission
export const METER_TRACK = '#14b8a6' // teal 500 — the remainder, paid to partners

/** De-emphasis grey for the context series in an emphasis chart. */
export const CHART_MUTED = '#94a3b8'

/** Hairline, solid, one step off surface. Never dashed. */
export const CHART_GRID = '#e2e8f0'
export const CHART_AXIS = '#94a3b8'
export const CHART_SURFACE = '#ffffff'
