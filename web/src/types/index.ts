/**
 * MedBridge Pass — domain model.
 *
 * DATABASE KEY RULE: every entity is keyed by a UUID (v4). There are no
 * auto-incrementing integer identifiers anywhere in this system. `UUID` is a
 * branded-ish alias kept as `string` so it serialises cleanly over REST, but
 * every id/foreign key field is typed with it to make violations obvious.
 */
export type UUID = string

/** ISO-8601 timestamp string, always UTC from the backend. */
export type ISODateTime = string

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                    */
/* -------------------------------------------------------------------------- */

export const INQUIRY_STATUSES = [
  'NEW_INQUIRY',
  'AI_PROCESSING',
  'AI_ITINERARY_READY',
  'HOSPITAL_REVIEW_REQUIRED',
  'DOCTOR_REVIEW_REQUIRED',
  'QUOTE_APPROVED',
  'PATIENT_CONFIRMATION_PENDING',
  'CONFIRMED_BOOKING',
  'TRAVEL_READY',
  'COMPLETED',
  'HUMAN_TAKEOVER',
] as const

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number]

/**
 * How a case reached us.
 *
 * WEB is the front door: the guided chat at `/`. INTERNAL covers notes and
 * cases opened by staff on a patient's behalf.
 */
export type Channel = 'WEB' | 'INTERNAL'

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

/* -------------------------------------------------------------------------- */
/* Directory entities                                                          */
/* -------------------------------------------------------------------------- */

export interface Patient {
  id: UUID
  fullName: string
  /** Masked at the API boundary — the raw number never leaves the backend. */
  phoneMasked: string
  emailMasked: string
  countryCode: 'SG'
  yearOfBirth: number
  gender: 'M' | 'F' | 'U'
  preferredChannel: Channel
  preferredLanguage: string
  createdAt: ISODateTime
}

/**
 * A point on the map.
 *
 * Coordinates are stored; DISTANCES ARE NOT. How far a hotel is from "the
 * hospital" depends entirely on which hospital the patient chose, so it is
 * computed from a pair of these — see `lib/geo.ts` and `App\Support\Geo`.
 */
export interface GeoPoint {
  latitude: number | null
  longitude: number | null
  /**
   * A Google SEARCH for this place, by name — never a map pin.
   *
   * A coordinate link lands the patient exactly where our stored centroid
   * says, which for a building outline is a couple of hundred metres out and
   * sometimes in the wrong car park. Google resolves the name, and shows the
   * live rating, reviews and directions we deliberately do not store.
   */
  searchUrl: string | null
  /**
   * Openable proof this place exists — the OpenStreetMap element the row was
   * verified against, e.g. `https://www.openstreetmap.org/way/575205306`.
   *
   * It is a provenance trail for whoever reviews the catalogue, not a patient
   * feature, and it exists because the catalogue once contained businesses that
   * did not: invented names at invented coordinates that nothing in the system
   * could distinguish from real ones. See docs/09 D26.
   */
  sourceUrl: string | null
}

export interface Hospital extends GeoPoint {
  id: UUID
  name: string
  district: string
  address: string
  accreditation: string
  /*
   * No `rating` and no `reviewCount`. They were here, described as
   * "MedBridge's own accreditation-based score — not a Google rating", which
   * did not survive contact with the seeder: the values were 4.8 with 1,284
   * reviews, invented, on a real hospital. `searchUrl` goes to somewhere that
   * has the real ones.
   */
  specialties: string[]
  minutesFromTerminal: number
  nearestTerminal: string
}

export interface Doctor {
  id: UUID
  hospitalId: UUID
  fullName: string
  specialty: string
  qualifications: string
  yearsExperience: number
  languages: string[]
  consultationFeeSgd: number
}

export type ProcedureCategory =
  | 'DENTAL'
  | 'SCREENING'
  | 'OPHTHALMOLOGY'
  | 'ORTHOPEDICS'
  | 'GENERAL_SURGERY'

export interface Procedure {
  id: UUID
  code: string
  name: string
  category: ProcedureCategory
  description: string
  /** Singapore private-hospital benchmark, SGD. */
  sgBenchmarkSgd: number
  /** Batam partner-hospital price, SGD. */
  batamPriceSgd: number
  /** Clinical days on site (excluding travel). */
  treatmentDays: number
  /** Hotel nights recommended for recovery. */
  recoveryNights: number
  /** Procedures that always escalate to a doctor before quoting. */
  requiresDoctorReview: boolean
}

export type FerryDirection = 'SG_TO_BATAM' | 'BATAM_TO_SG'

export interface FerryRoute {
  id: UUID
  operator: string
  direction: FerryDirection
  departTerminal: string
  arriveTerminal: string
  /** Local departure time, HH:mm. */
  departureTime: string
  arrivalTime: string
  durationMinutes: number
  priceSgd: number
}

/**
 * A recovery hotel.
 *
 * Note the absent distance field. It used to be `distanceToHospitalKm`, a
 * single number rendered identically whichever of the three hospitals the
 * patient picked — and therefore wrong for two of them. Distance now comes
 * from the bundle payload, measured to the hospital they actually chose.
 */
export interface Hotel extends GeoPoint {
  id: UUID
  name: string
  district: string
  starRating: number
  nightlyRateSgd: number
  amenities: string[]
  medicalRecoveryCertified: boolean
}

export type PlaceCategory = 'RESTAURANT' | 'BEACH' | 'PARK' | 'MALL' | 'ATTRACTION' | 'FESTIVAL'

/**
 * Somewhere to eat, walk or look at while you are there.
 *
 * A SUGGESTION, NEVER A QUOTE LINE. There is no `priceSgd` on this type and
 * there must never be one: places do not enter the bundle, the total, or the
 * Singapore savings comparison. `priceBand` is a guidebook hint ("$$"), which
 * is deliberately not a number anyone can add up.
 */
export interface Place {
  id: UUID
  name: string
  category: PlaceCategory
  district: string
  description: string
  /** 0 free · 1 inexpensive · 2 moderate · 3 pricey · 4 splurge. */
  priceLevel: number
  priceBand: string
  /** Dietary, access and exposure tags the recovery filter matches on. */
  tags: string[]
  searchUrl: string | null
  /** The OpenStreetMap element this place was verified against. */
  sourceUrl: string | null
  /** A published guide that named this place, where one did. */
  guideUrl: string | null
}

export type TransportType = 'PRIVATE_CAR' | 'AMBULANCE' | 'SHUTTLE' | 'WHEELCHAIR_VAN'

export interface GroundTransport {
  id: UUID
  type: TransportType
  provider: string
  description: string
  /** Price for the full round-trip terminal ↔ hospital ↔ hotel loop. */
  priceSgd: number
  capacity: number
}

/* -------------------------------------------------------------------------- */
/* AI layer (backend-owned — the frontend only ever sees this structured form)  */
/* -------------------------------------------------------------------------- */

export type ReviewReason =
  | 'LOW_CONFIDENCE'
  | 'UNKNOWN_PROCEDURE'
  | 'EMERGENCY_LANGUAGE'
  | 'HIGH_RISK_PROCEDURE'
  | 'PRICE_OUT_OF_BAND'

export interface AiExtraction {
  id: UUID
  inquiryId: UUID
  /** Short, sanitised summary of what the patient asked for. Never raw model output. */
  intentSummary: string
  procedureId: UUID | null
  procedureLabel: string
  /** 0–1. Below CONFIDENCE_THRESHOLD forces HUMAN_REVIEW_REQUIRED. */
  confidence: number
  urgency: Priority
  travelPartySize: number
  preferredWindow: string
  symptomKeywords: string[]
  extractedEntities: Record<string, string | number | boolean | null>
  /** Human-in-the-loop gate. */
  requiresHumanReview: boolean
  reviewReasons: ReviewReason[]
  modelVersion: string
  latencyMs: number
  createdAt: ISODateTime
}

/* -------------------------------------------------------------------------- */
/* Quoting                                                                     */
/* -------------------------------------------------------------------------- */

export type QuoteCategory =
  | 'TREATMENT'
  | 'DOCTOR_FEE'
  | 'FERRY'
  | 'HOTEL'
  | 'TRANSPORT'
  | 'ADMIN'

export interface QuoteLineItem {
  id: UUID
  quoteId: UUID
  category: QuoteCategory
  label: string
  detail: string
  quantity: number
  unitPriceSgd: number
  /** Reference to the catalogue row this line was priced from. */
  refType: 'procedure' | 'doctor' | 'ferry' | 'hotel' | 'transport' | null
  refId: UUID | null
}

export type QuoteStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXPIRED'

export interface Quote {
  id: UUID
  inquiryId: UUID
  status: QuoteStatus
  lineItems: QuoteLineItem[]
  /** Singapore equivalent basket used for the savings headline. */
  sgBenchmarkSgd: number
  idrPerSgd: number
  approvedByName: string | null
  approvedAt: ISODateTime | null
  validUntil: ISODateTime
  notes: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface QuoteTotals {
  totalSgd: number
  totalIdr: number
  sgBenchmarkSgd: number
  savingsSgd: number
  savingsPct: number
}

/* -------------------------------------------------------------------------- */
/* Doctor review                                                               */
/* -------------------------------------------------------------------------- */

export type DoctorReviewDecision = 'PENDING' | 'CLEARED' | 'NEEDS_CONSULT' | 'DECLINED'

export interface DoctorReview {
  id: UUID
  inquiryId: UUID
  doctorId: UUID | null
  decision: DoctorReviewDecision
  clinicalNotes: string
  requiredPreOpTests: string[]
  reviewedAt: ISODateTime | null
}

/* -------------------------------------------------------------------------- */
/* Inquiry                                                                     */
/* -------------------------------------------------------------------------- */

export interface Inquiry {
  id: UUID
  /** Human-readable operational reference, e.g. MBP-2026-0142. Not a key. */
  reference: string
  patientId: UUID
  hospitalId: UUID
  doctorId: UUID | null
  procedureId: UUID | null

  /*
   * Display labels resolved by the backend.
   *
   * A list row needs a name, and an id cannot produce one. These used to be
   * looked up client-side in `mock/seed.ts`, which only ever worked for seeded
   * demo rows — a real patient created by the chat has no mock counterpart and
   * rendered as "Unknown patient" everywhere.
   *
   * Optional because the offline mock still supplies rows without them; every
   * consumer falls back to the local map in that case.
   */
  patientName?: string | null
  /** Masked at the API boundary, exactly as on the detail payload. */
  patientPhoneMasked?: string | null
  procedureName?: string | null
  hospitalName?: string | null
  doctorName?: string | null

  /*
   * The two figures a pipeline row displays, resolved by the backend for the
   * same reason the labels above are.
   *
   * `null` means the case genuinely has no extraction or no quote yet and must
   * render as an em dash. `undefined` means an offline mock row that never
   * carried them — consumers fall back to the local map in that case only.
   */
  confidence?: number | null
  totals?: QuoteTotals | null

  status: InquiryStatus
  priority: Priority
  channel: Channel
  /** Verbatim first message from the patient. */
  sourceMessage: string
  assignedToName: string | null
  /** Opaque token for the public patient route. Never a database UUID. */
  itineraryToken: string | null
  slaDueAt: ISODateTime
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/** Inquiry joined with the rows the operations UI always needs alongside it. */
export interface InquiryDetail extends Inquiry {
  patient: Patient
  hospital: Hospital
  doctor: Doctor | null
  procedure: Procedure | null
  aiExtraction: AiExtraction | null
  quote: Quote | null
  doctorReview: DoctorReview | null
}

/* -------------------------------------------------------------------------- */
/* Activity + messaging                                                        */
/* -------------------------------------------------------------------------- */

export type ActivityActor = 'AI_AGENT' | 'SYSTEM' | 'STAFF' | 'PATIENT' | 'DOCTOR'
export type ActivityLevel = 'info' | 'success' | 'warning' | 'error'

export type ActivityType =
  | 'MESSAGE_RECEIVED'
  | 'AI_EXTRACTION_STARTED'
  | 'AI_EXTRACTION_COMPLETED'
  | 'TREATMENT_IDENTIFIED'
  | 'PRICING_CALCULATED'
  | 'TRAVEL_CALCULATED'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'DOCTOR_REVIEW_SUBMITTED'
  | 'QUOTE_DRAFTED'
  | 'QUOTE_APPROVED'
  | 'ITINERARY_ISSUED'
  | 'PATIENT_CONFIRMED'
  | 'STATUS_CHANGED'
  | 'MESSAGE_SENT'
  /** A partner edited catalogue data shared with other facilities. */
  | 'CATALOGUE_UPDATED'

export interface ActivityEvent {
  id: UUID
  inquiryId: UUID | null
  inquiryReference: string | null
  type: ActivityType
  actor: ActivityActor
  level: ActivityLevel
  title: string
  description: string
  /** Structured backend payload, rendered in the JSON debug inspector. */
  payload: Record<string, unknown>
  durationMs: number | null
  createdAt: ISODateTime
}

export type MessageDirection = 'INBOUND' | 'OUTBOUND'
export type MessageStatus = 'RECEIVED' | 'DRAFT' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'

export interface Message {
  id: UUID
  threadId: UUID
  inquiryId: UUID | null
  channel: Channel
  direction: MessageDirection
  body: string
  senderName: string
  status: MessageStatus
  /** Pre-drafted reply from Hermes. Staff must review/edit before it is sent. */
  aiSuggestion: string | null
  aiSuggestionConfidence: number | null
  createdAt: ISODateTime
}

export interface MessageThread {
  id: UUID
  patientId: UUID
  /** Backend-resolved display name; see the note on `Inquiry.patientName`. */
  patientName?: string | null
  inquiryId: UUID | null
  channel: Channel
  subject: string
  unreadCount: number
  lastMessageAt: ISODateTime
  messages: Message[]
}

/* -------------------------------------------------------------------------- */
/* Dashboard + analytics                                                       */
/* -------------------------------------------------------------------------- */

export interface DashboardKpis {
  singaporeLeads: number
  singaporeLeadsDelta: number
  aiItineraries: number
  aiItinerariesDelta: number
  pendingReviews: number
  pendingReviewsDelta: number
  confirmedBookings: number
  confirmedBookingsDelta: number
  totalSavingsSgd: number
  totalSavingsDelta: number
}

export interface FunnelStage {
  stage: string
  count: number
}

export interface TreatmentDistribution {
  procedureId: UUID
  name: string
  category: ProcedureCategory
  count: number
  revenueSgd: number
}

export interface PriceComparisonRow {
  procedureId: UUID
  name: string
  singaporeSgd: number
  medbridgeSgd: number
  savingsSgd: number
  savingsPct: number
}

export interface VolumeTrendPoint {
  date: string
  inquiries: number
  confirmed: number
  savingsSgd: number
}

export interface AnalyticsSummary {
  funnel: FunnelStage[]
  treatments: TreatmentDistribution[]
  priceComparison: PriceComparisonRow[]
  trend: VolumeTrendPoint[]
  conversionRate: number
  avgResponseMinutes: number
  aiAutomationRate: number
  avgSavingsPct: number
}

/* -------------------------------------------------------------------------- */
/* Partner portals                                                             */
/* -------------------------------------------------------------------------- */

/** The four kinds of supplier MedBridge sells on behalf of. */
export type PartnerType = 'hospital' | 'hotel' | 'ferry' | 'transport'

/**
 * How firm a booking is, from the supplier's side.
 *
 * PENDING is the one that matters: the patient has chosen this partner and the
 * case is still with a coordinator. The partner should expect them — and must
 * not be told they are owed for it yet.
 */
export type BookingStage = 'PENDING' | 'APPROVED' | 'CONFIRMED'

/** One row in the partner picker — stands in for a login screen. */
export interface PartnerSummary {
  id: UUID
  name: string
  district: string
  bookingCount: number
  pendingCount: number
  /** What MedBridge would owe this partner. Approved work only, never our margin. */
  supplierSgd: number
  /** Quoted but not yet signed off. Expected, deliberately not owed. */
  pipelineSgd: number
}

/**
 * One booking on a partner's ledger.
 *
 * Note what a partner does NOT get: no patient id, no phone, no email, no full
 * name, and no sight of MedBridge's commission. They get the operational
 * reference and a first name — enough to expect someone at a desk.
 */
export interface PartnerBooking {
  reference: string
  patientFirstName: string
  status: InquiryStatus
  stage: BookingStage
  /** The patient accepted their pass. Not the same as having paid. */
  committed: boolean
  label: string
  detail: string
  quantity: number
  /** Owed. Zero while the booking is still PENDING. */
  supplierSgd: number
  /** The line's value regardless of stage — what it becomes worth if approved. */
  expectedSgd: number
  travelDate: ISODateTime | null
}

/**
 * One procedure as its hospital maintains it.
 *
 * `priceSgd` and `available` are THIS hospital's. Everything from
 * `sgBenchmarkSgd` down is one shared row across every facility performing the
 * procedure — editing it changes what the others sell, which is why the UI
 * warns before saving and the backend writes an audit event.
 */
export interface PartnerProcedureRow {
  procedureId: UUID
  code: string
  name: string
  category: ProcedureCategory
  priceSgd: number
  available: boolean
  hasOwnPrice: boolean
  sgBenchmarkSgd: number
  treatmentDays: number
  recoveryNights: number
  requiresDoctorReview: boolean
}

export interface PartnerDoctorRow {
  doctorId: UUID
  name: string
  specialty: string
  qualifications: string
  yearsExperience: number
  consultationFeeSgd: number
}

/** Type-specific rates and capabilities, as MedBridge holds them. */
export interface PartnerCatalogue {
  // Hospital
  accreditation?: string
  specialties?: string[]
  nearestTerminal?: string
  minutesFromTerminal?: number
  procedures?: PartnerProcedureRow[]
  doctors?: PartnerDoctorRow[]
  // Hotel
  starRating?: number
  nightlyRateSgd?: number
  medicalRecoveryCertified?: boolean
  amenities?: string[]
  // Ferry
  operator?: string
  direction?: FerryDirection
  departTerminal?: string
  arriveTerminal?: string
  departureTime?: string
  arrivalTime?: string
  durationMinutes?: number
  // Transport
  provider?: string
  vehicleType?: TransportType
  description?: string
  capacity?: number
  // Ferry + transport
  priceSgd?: number
}

export interface PartnerPortal extends PartnerSummary {
  type: PartnerType
  committedCount: number
  bookings: PartnerBooking[]
  catalogue: PartnerCatalogue
  disclaimer: string
}

/**
 * The marketplace's own numbers.
 *
 * EVERY FIGURE IS AN ENTITLEMENT, NOT CASH. There is no payments table in this
 * system, so `commissionSgd` is what MedBridge would earn if the approved trips
 * happen — `basis` carries that sentence and the UI is required to show it.
 */
export interface SaasSummary {
  basis: string
  /** Quoted, still with a human. Kept out of every earnings figure below. */
  pendingQuotes: number
  pipelineGrossSgd: number
  pipelineCommissionSgd: number
  approvedQuotes: number
  committedQuotes: number
  patients: number
  committedPatients: number
  grossBookingSgd: number
  commissionSgd: number
  supplierPayoutSgd: number
  committedGrossSgd: number
  committedCommissionSgd: number
  takeRatePct: number
  averageBookingSgd: number
  commissionByCategory: { category: QuoteCategory; commissionSgd: number; ratePct: number }[]
  takeRates: { category: QuoteCategory; ratePct: number }[]
}

/* -------------------------------------------------------------------------- */
/* Patient-facing itinerary (token-scoped, no UUIDs or PII in the payload)     */
/* -------------------------------------------------------------------------- */

export type ItineraryStepKind = 'FERRY_OUT' | 'PICKUP' | 'HOSPITAL' | 'HOTEL' | 'FERRY_RETURN'

export interface ItineraryStep {
  kind: ItineraryStepKind
  order: number
  title: string
  subtitle: string
  /** Friendly day label, e.g. "Day 1 · Tue 24 Feb". */
  dayLabel: string
  timeLabel: string
  location: string
  details: string[]
  priceSgd: number | null
}

export interface ItineraryCostLine {
  label: string
  detail: string
  priceSgd: number
}

export interface PatientItinerary {
  token: string
  reference: string
  /** First name only — the public payload carries no full PII. */
  patientFirstName: string
  status: InquiryStatus
  hospitalName: string
  hospitalAddress: string
  doctorName: string | null
  doctorSpecialty: string | null
  procedureName: string
  travelWindow: string
  steps: ItineraryStep[]
  costLines: ItineraryCostLine[]
  totalSgd: number
  totalIdr: number
  singaporeBenchmarkSgd: number
  savingsSgd: number
  savingsPct: number
  validUntil: ISODateTime
  supportPhone: string
  issuedAt: ISODateTime
}

/* -------------------------------------------------------------------------- */
/* Patient web chat (public, session-token scoped)                            */
/* -------------------------------------------------------------------------- */

export type ChatStage = 'COLLECTING' | 'RECOMMENDED' | 'SUBMITTED' | 'EMERGENCY'

/** PATIENT is what the visitor typed. SYSTEM is written by MedBridge. */
export type ChatRole = 'PATIENT' | 'SYSTEM'

export interface ChatChoiceOption {
  value: string | number
  label: string
  detail?: string
  meta?: {
    fromSgd: number
    singaporeSgd: number
    treatmentDays: number
    recoveryNights: number
  }
}

/**
 * A line in the visitor's draft bundle.
 *
 * `removable` / `swappable` are enforced by the backend as well as rendered —
 * treatment, the specialist fee and coordination cannot be dropped.
 */
export interface BundleLine {
  key: string
  category: QuoteCategory
  label: string
  detail: string
  quantity: number
  unitPriceSgd: number
  refType: 'procedure' | 'doctor' | 'ferry' | 'hotel' | 'transport' | null
  refId: UUID | null
  removable: boolean
  swappable: boolean
  swapGroup: string | null
  included: boolean
}

export interface BundleSwapOption {
  refId: UUID
  label: string
  detail: string
  unitPriceSgd: number
  /**
   * Hotels only: kilometres to the hospital THIS patient chose, recomputed
   * when they change hospital. Absent on categories where it is meaningless.
   */
  distanceKm?: number | null
  searchUrl?: string | null
}

/**
 * A hospital the patient can choose, with that facility's own price.
 *
 * Hospital is a bundle-level choice rather than a line-level swap: changing it
 * moves the treatment price, the specialist and the ferry terminal together.
 */
export type HospitalOption = BundleSwapOption

/**
 * Where the plan stands against the budget the visitor gave us.
 *
 * Null on the bundle when they declined to set one — an absent budget is not a
 * budget of zero, and someone who said "I'd rather not" must not be nagged.
 *
 * `state` is the honest answer, in four flavours:
 *   WITHIN          it fits
 *   TRIMMABLE       over, but reachable by dropping or downgrading extras
 *   TRAVEL_OVER     the treatment fits; the trip around it does not
 *   BELOW_TREATMENT the treatment alone costs more than the budget
 *
 * In none of them does the treatment, the specialist, or the clinically
 * recommended recovery stay get reduced to close the gap.
 */
export interface BudgetStatus {
  budgetSgd: number
  totalSgd: number
  state: 'WITHIN' | 'TRIMMABLE' | 'TRAVEL_OVER' | 'BELOW_TREATMENT'
  fits: boolean
  /** Treatment + specialist + coordination at the lowest-priced facility. */
  essentialsSgd: number
  /** The cheapest complete trip we would actually put a patient on. */
  minimumViableSgd: number
  overBySgd: number
  /** Written by the backend question bank. No model authors this. */
  message: string
  protected: string
}

/** One suggestion in the "while you're there" panel. */
export interface NearbyPlace extends Place {
  fromHotelKm: number | null
  fromHospitalKm: number | null
}

/**
 * Travel information that sits deliberately OUTSIDE the priced bundle.
 *
 * Filtered by the procedure's recovery profile — no beach day two days after
 * cataract surgery — and sourced entirely from the `places` table. Nothing
 * here is priced, bundled, or counted towards the savings figure.
 */
export interface NearbyPanel {
  anchor: 'hotel' | 'hospital'
  anchorName: string
  recoveryNote: string
  places: NearbyPlace[]
  disclaimer: string
}

export interface BundleTotals {
  totalSgd: number
  totalIdr: number
  sgBenchmarkSgd: number
  savingsSgd: number
  savingsPct: number
}

export interface ChatBundle {
  kind: 'bundle'
  procedure: {
    code: string
    name: string
    treatmentDays: number
    recoveryNights: number
    requiresDoctorReview: boolean
  } | null
  travelDate: string | null
  partySize: number
  hotelNights: number
  lines: BundleLine[]
  totals: BundleTotals
  hospitalId: UUID | null
  hospitalOptions: HospitalOption[]
  swapOptions: Record<string, BundleSwapOption[]>
  /** Null when the visitor declined to set a budget. */
  budget: BudgetStatus | null
  /** Suggestions — never line items, never in `totals`. */
  nearby: NearbyPanel | null
  disclaimer: string
}

/**
 * The structured attachment on a system turn.
 *
 * NOTE: every `body` and every `prompt` the visitor reads is authored by the
 * backend's question bank, never by a model. Hermes only decides which of these
 * comes next — see docs/01 rule 5.
 */
export type ChatUi =
  | {
      kind: 'intro'
      /** Example openers. Tapping one posts it as the visitor's own message. */
      quickReplies: { label: string; message: string }[]
      /** The full catalogue, revealed on demand rather than shown up front. */
      browse: ChatChoiceOption[]
    }
  /**
   * The visitor asked about something this assistant is not for. Carries the
   * same openers as the intro so the conversation has an obvious way back;
   * `browse` and `supportPhone` appear only on a repeat, when a person has
   * become the better answer than another nudge.
   */
  | {
      kind: 'scope'
      quickReplies: { label: string; message: string }[]
      browse?: ChatChoiceOption[]
      supportPhone?: string
    }
  | { kind: 'text'; slot: string; prompt: string }
  | { kind: 'choice'; slot: string; prompt: string; options: ChatChoiceOption[] }
  | {
      kind: 'date'
      slot: string
      prompt: string
      min: string
      max: string
      suggestions: { value: string; label: string }[]
    }
  | ChatBundle
  | { kind: 'emergency'; contacts: Record<string, string>; supportPhone: string }
  | {
      kind: 'submitted'
      reference: string
      totals: BundleTotals
      slaDueAt: ISODateTime
      requiresDoctorReview: boolean
    }

export interface ChatMessage {
  id: UUID
  role: ChatRole
  body: string
  ui: ChatUi | null
  createdAt: ISODateTime
}

export interface ChatSession {
  /** Opaque `mbs_…` token. Deliberately not a UUID — it lives in a browser. */
  token: string
  stage: ChatStage
  messages: ChatMessage[]
  slots: {
    procedureCode: string | null
    travelDate: string | null
    partySize: number | null
  }
  bundle: ChatBundle | null
  reference: string | null
  expiresAt: ISODateTime
}

export interface ChatSubmission {
  fullName: string
  phone: string
  email?: string
  yearOfBirth?: number
  consent: boolean
  notes?: string
}

/* -------------------------------------------------------------------------- */
/* Directory aggregates (list views)                                           */
/* -------------------------------------------------------------------------- */

/** A patient plus their case history — powers /patients. */
export interface PatientSummary {
  patient: Patient
  caseCount: number
  activeCaseCount: number
  completedCaseCount: number
  /** Lifetime SGD saved across approved quotes. */
  lifetimeSavingsSgd: number
  lifetimeValueSgd: number
  lastContactAt: ISODateTime | null
  latestStatus: InquiryStatus | null
  latestInquiryId: UUID | null
  procedures: string[]
}

/** A doctor plus their caseload — powers /doctors. */
export interface DoctorSummary {
  doctor: Doctor
  hospitalName: string
  assignedCaseCount: number
  pendingReviewCount: number
  clearedCount: number
  /** Cases completed end-to-end with this doctor. */
  completedCount: number
}

/** A quote flattened with its inquiry context — powers /quotes. */
export interface QuoteSummary {
  quoteId: UUID
  inquiryId: UUID
  reference: string
  patientName: string
  procedureName: string
  hospitalName: string
  status: QuoteStatus
  inquiryStatus: InquiryStatus
  totalSgd: number
  totalIdr: number
  sgBenchmarkSgd: number
  savingsSgd: number
  savingsPct: number
  lineItemCount: number
  approvedByName: string | null
  approvedAt: ISODateTime | null
  validUntil: ISODateTime
  /** Present only once a human approved and a pass was issued. */
  itineraryToken: string | null
  createdAt: ISODateTime
}

/* -------------------------------------------------------------------------- */
/* Transport envelope                                                          */
/* -------------------------------------------------------------------------- */

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  perPage: number
}

/** Every realtime frame the backend pushes over SSE/WebSocket. */
export type RealtimeEvent =
  | { type: 'activity'; payload: ActivityEvent }
  | { type: 'inquiry.updated'; payload: Inquiry }
  | { type: 'inquiry.created'; payload: Inquiry }
  | { type: 'message.received'; payload: Message }
  | { type: 'kpis.updated'; payload: DashboardKpis }
  | { type: 'demo.stage'; payload: { stage: string; progress: number; inquiryId: UUID } }
