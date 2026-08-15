/**
 * Deterministic mock generators.
 *
 * These build the same shapes the real backend returns, so the UI is identical
 * whether it is reading from PostgreSQL or from this offline fallback layer.
 * All identifiers are UUID v4; the patient-facing token is a separate opaque
 * string so no database key is ever exposed in a URL.
 */
import {
  CONFIDENCE_THRESHOLD,
  COORDINATION_FEE_SGD,
  EMERGENCY_KEYWORDS,
  IDR_PER_SGD,
  REQUIRE_DOCTOR_REVIEW_FOR_HIGH_RISK,
  SG_CONSULT_BENCHMARK_SGD,
} from '@/lib/constants'
import { formatKm, haversineKm } from '@/lib/geo'
import { itineraryToken, sum, uuid } from '@/lib/utils'
import { sgdToIdr } from '@/lib/format'
import type {
  ActivityEvent,
  ActivityType,
  AiExtraction,
  DoctorReview,
  Inquiry,
  InquiryStatus,
  ItineraryCostLine,
  ItineraryStep,
  Message,
  MessageThread,
  PatientItinerary,
  Priority,
  Procedure,
  Quote,
  QuoteLineItem,
  QuoteTotals,
  ReviewReason,
  UUID,
} from '@/types'
import {
  DOCTOR_IDS,
  FERRY_IDS,
  HOSPITAL_IDS,
  HOTEL_IDS,
  PATIENT_IDS,
  PROCEDURE_IDS,
  STAFF_NAMES,
  TRANSPORT_IDS,
  doctorMap,
  ferryMap,
  hospitalMap,
  hotelMap,
  patientMap,
  procedureMap,
  transportMap,
} from './seed'

/*
 * Pricing inputs come from the runtime config so the Settings page can change
 * them live. Read at call time — never captured at module load.
 */

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const minutesAhead = (n: number) => new Date(Date.now() + n * 60_000).toISOString()
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

let referenceCounter = 1
export function nextReference(): string {
  return `MBP-${new Date().getFullYear()}-${String(referenceCounter++).padStart(4, '0')}`
}

/* -------------------------------------------------------------------------- */
/* Quote construction                                                          */
/* -------------------------------------------------------------------------- */

export interface QuoteInput {
  inquiryId: UUID
  procedureId: UUID
  doctorId: UUID | null
  hotelId?: UUID
  ferryOutId?: UUID
  ferryReturnId?: UUID
  transportId?: UUID
  partySize?: number
  /** Overrides the procedure's default recovery nights. */
  hotelNights?: number
  status?: Quote['status']
}

/**
 * Itemises a full cross-border bundle: treatment, doctor fee, both ferry legs,
 * recovery hotel, ground transport and coordination.
 */
export function buildQuote(input: QuoteInput): Quote {
  const {
    inquiryId,
    procedureId,
    doctorId,
    hotelId = HOTEL_IDS.harrisBatamCentre,
    ferryOutId = FERRY_IDS.batamFastOut,
    ferryReturnId = FERRY_IDS.batamFastReturn,
    transportId = TRANSPORT_IDS.privateCar,
    partySize = 1,
    status = 'DRAFT',
  } = input

  const procedure = procedureMap.get(procedureId)!
  const doctor = doctorId ? doctorMap.get(doctorId) : null
  const hotel = hotelMap.get(hotelId)!
  const ferryOut = ferryMap.get(ferryOutId)!
  const ferryReturn = ferryMap.get(ferryReturnId)!
  const transport = transportMap.get(transportId)!
  const nights = input.hotelNights ?? procedure.recoveryNights

  const quoteId = uuid()
  const line = (
    data: Omit<QuoteLineItem, 'id' | 'quoteId'>,
  ): QuoteLineItem => ({ id: uuid(), quoteId, ...data })

  const lineItems: QuoteLineItem[] = [
    line({
      category: 'TREATMENT',
      label: procedure.name,
      detail: `${procedure.code} · ${procedure.treatmentDays} clinical day(s)`,
      quantity: 1,
      unitPriceSgd: procedure.batamPriceSgd,
      refType: 'procedure',
      refId: procedure.id,
    }),
    line({
      category: 'DOCTOR_FEE',
      label: doctor ? `Specialist consultation — ${doctor.fullName}` : 'Specialist consultation',
      detail: doctor ? doctor.specialty : 'Assigned on confirmation',
      quantity: 1,
      unitPriceSgd: doctor?.consultationFeeSgd ?? 50,
      refType: doctor ? 'doctor' : null,
      refId: doctor?.id ?? null,
    }),
    line({
      category: 'FERRY',
      label: `Ferry — ${ferryOut.departTerminal.split(',')[0]} → ${ferryOut.arriveTerminal.replace(' Ferry Terminal', '')}`,
      detail: `${ferryOut.operator} · ${ferryOut.departureTime} · ${ferryOut.durationMinutes} min`,
      quantity: partySize,
      unitPriceSgd: ferryOut.priceSgd,
      refType: 'ferry',
      refId: ferryOut.id,
    }),
    line({
      category: 'FERRY',
      label: `Ferry — ${ferryReturn.departTerminal.replace(' Ferry Terminal', '')} → Singapore`,
      detail: `${ferryReturn.operator} · ${ferryReturn.departureTime} · ${ferryReturn.durationMinutes} min`,
      quantity: partySize,
      unitPriceSgd: ferryReturn.priceSgd,
      refType: 'ferry',
      refId: ferryReturn.id,
    }),
    line({
      category: 'TRANSPORT',
      label: `Local transport — ${transport.provider}`,
      detail: transport.description.split('.')[0],
      quantity: 1,
      unitPriceSgd: transport.priceSgd,
      refType: 'transport',
      refId: transport.id,
    }),
    line({
      category: 'ADMIN',
      label: 'MedBridge case coordination',
      detail: 'Interpreter, appointment scheduling and 24/7 support line',
      quantity: 1,
      unitPriceSgd: COORDINATION_FEE_SGD,
      refType: null,
      refId: null,
    }),
  ]

  // Recovery hotel is only quoted when the procedure needs overnight recovery.
  if (nights > 0) {
    lineItems.splice(4, 0, {
      id: uuid(),
      quoteId,
      category: 'HOTEL',
      label: `Recovery stay — ${hotel.name}`,
      // No distance here: this builder has no hospital in scope, and a
      // distance to an unspecified hospital is exactly the falsehood the
      // stored `distanceToHospitalKm` scalar used to tell. District instead.
      detail: `${hotel.starRating}★ · ${hotel.district}${
        hotel.medicalRecoveryCertified ? ' · recovery-certified' : ''
      }`,
      quantity: nights,
      unitPriceSgd: hotel.nightlyRateSgd,
      refType: 'hotel',
      refId: hotel.id,
    })
  }

  const now = new Date().toISOString()

  return {
    id: quoteId,
    inquiryId,
    status,
    lineItems,
    sgBenchmarkSgd: procedure.sgBenchmarkSgd + SG_CONSULT_BENCHMARK_SGD,
    idrPerSgd: IDR_PER_SGD,
    approvedByName: null,
    approvedAt: null,
    validUntil: daysAhead(14),
    notes: '',
    createdAt: now,
    updatedAt: now,
  }
}

export function lineTotal(item: QuoteLineItem): number {
  return item.quantity * item.unitPriceSgd
}

export function computeTotals(quote: Quote): QuoteTotals {
  const totalSgd = sum(quote.lineItems.map(lineTotal))
  const savingsSgd = quote.sgBenchmarkSgd - totalSgd
  return {
    totalSgd,
    totalIdr: sgdToIdr(totalSgd, quote.idrPerSgd),
    sgBenchmarkSgd: quote.sgBenchmarkSgd,
    savingsSgd,
    savingsPct: quote.sgBenchmarkSgd > 0 ? (savingsSgd / quote.sgBenchmarkSgd) * 100 : 0,
  }
}

/* -------------------------------------------------------------------------- */
/* AI extraction                                                               */
/* -------------------------------------------------------------------------- */

export function detectEmergencyLanguage(text: string): boolean {
  const lower = text.toLowerCase()
  return EMERGENCY_KEYWORDS.some((keyword) => lower.includes(keyword))
}

/**
 * Mirrors the backend's human-in-the-loop gate. The frontend re-derives this
 * only for the offline mock — in production the backend is authoritative and
 * ships `requiresHumanReview` / `reviewReasons` on the wire.
 */
export function evaluateReviewGate(params: {
  confidence: number
  procedureId: UUID | null
  sourceMessage: string
  procedure?: Procedure | null
}): { requiresHumanReview: boolean; reviewReasons: ReviewReason[] } {
  const reasons: ReviewReason[] = []

  if (params.confidence < CONFIDENCE_THRESHOLD) reasons.push('LOW_CONFIDENCE')
  if (!params.procedureId) reasons.push('UNKNOWN_PROCEDURE')
  if (detectEmergencyLanguage(params.sourceMessage)) reasons.push('EMERGENCY_LANGUAGE')
  if (REQUIRE_DOCTOR_REVIEW_FOR_HIGH_RISK && params.procedure?.requiresDoctorReview) {
    reasons.push('HIGH_RISK_PROCEDURE')
  }

  return { requiresHumanReview: reasons.length > 0, reviewReasons: reasons }
}

export function buildExtraction(params: {
  inquiryId: UUID
  procedureId: UUID | null
  sourceMessage: string
  confidence: number
  urgency?: Priority
  partySize?: number
  window?: string
  symptoms?: string[]
  createdAt?: string
}): AiExtraction {
  const procedure = params.procedureId ? procedureMap.get(params.procedureId) : null
  const gate = evaluateReviewGate({
    confidence: params.confidence,
    procedureId: params.procedureId,
    sourceMessage: params.sourceMessage,
    procedure,
  })

  return {
    id: uuid(),
    inquiryId: params.inquiryId,
    intentSummary: procedure
      ? `Patient is requesting ${procedure.name.toLowerCase()} with an all-in cross-border cost including travel and accommodation.`
      : 'Patient intent could not be mapped to a catalogue procedure with sufficient confidence.',
    procedureId: params.procedureId,
    procedureLabel: procedure?.name ?? 'Unmapped request',
    confidence: params.confidence,
    urgency: params.urgency ?? 'NORMAL',
    travelPartySize: params.partySize ?? 1,
    preferredWindow: params.window ?? 'Next 2–4 weeks',
    symptomKeywords: params.symptoms ?? [],
    extractedEntities: {
      origin_country: 'SG',
      destination_city: 'Batam',
      procedure_code: procedure?.code ?? null,
      wants_ferry: true,
      wants_hotel: (procedure?.recoveryNights ?? 0) > 0,
      wants_transport: true,
      party_size: params.partySize ?? 1,
      budget_signal: null,
    },
    requiresHumanReview: gate.requiresHumanReview,
    reviewReasons: gate.reviewReasons,
    modelVersion: 'hermes-med-2.4.1',
    latencyMs: 900 + Math.floor(Math.random() * 1400),
    createdAt: params.createdAt ?? new Date().toISOString(),
  }
}

/* -------------------------------------------------------------------------- */
/* Activity events                                                             */
/* -------------------------------------------------------------------------- */

const ACTIVITY_TEMPLATES: Record<
  ActivityType,
  { actor: ActivityEvent['actor']; level: ActivityEvent['level']; title: string }
> = {
  MESSAGE_RECEIVED: { actor: 'PATIENT', level: 'info', title: 'Inbound message received' },
  AI_EXTRACTION_STARTED: { actor: 'AI_AGENT', level: 'info', title: 'Hermes extraction started' },
  AI_EXTRACTION_COMPLETED: {
    actor: 'AI_AGENT',
    level: 'success',
    title: 'Structured extraction completed',
  },
  TREATMENT_IDENTIFIED: { actor: 'AI_AGENT', level: 'success', title: 'Treatment identified' },
  PRICING_CALCULATED: { actor: 'SYSTEM', level: 'success', title: 'Pricing calculated' },
  TRAVEL_CALCULATED: { actor: 'SYSTEM', level: 'success', title: 'Travel bundle assembled' },
  HUMAN_REVIEW_REQUIRED: {
    actor: 'SYSTEM',
    level: 'warning',
    title: 'Human review required',
  },
  DOCTOR_REVIEW_SUBMITTED: {
    actor: 'DOCTOR',
    level: 'success',
    title: 'Doctor review submitted',
  },
  QUOTE_DRAFTED: { actor: 'SYSTEM', level: 'info', title: 'Quote drafted' },
  QUOTE_APPROVED: { actor: 'STAFF', level: 'success', title: 'Quote approved' },
  ITINERARY_ISSUED: { actor: 'SYSTEM', level: 'success', title: 'Patient itinerary issued' },
  PATIENT_CONFIRMED: { actor: 'PATIENT', level: 'success', title: 'Patient confirmed booking' },
  STATUS_CHANGED: { actor: 'SYSTEM', level: 'info', title: 'Pipeline status changed' },
  MESSAGE_SENT: { actor: 'STAFF', level: 'info', title: 'Reply sent to patient' },
  // A partner edited catalogue data shared with other facilities. Warning
  // level: it changes what other partners sell, so it is not routine noise.
  CATALOGUE_UPDATED: { actor: 'STAFF', level: 'warning', title: 'Shared catalogue detail changed' },
}

export function buildActivity(params: {
  type: ActivityType
  inquiryId?: UUID | null
  inquiryReference?: string | null
  description: string
  payload?: Record<string, unknown>
  durationMs?: number | null
  createdAt?: string
  level?: ActivityEvent['level']
  title?: string
}): ActivityEvent {
  const template = ACTIVITY_TEMPLATES[params.type]
  return {
    id: uuid(),
    inquiryId: params.inquiryId ?? null,
    inquiryReference: params.inquiryReference ?? null,
    type: params.type,
    actor: template.actor,
    level: params.level ?? template.level,
    title: params.title ?? template.title,
    description: params.description,
    payload: params.payload ?? {},
    durationMs: params.durationMs ?? null,
    createdAt: params.createdAt ?? new Date().toISOString(),
  }
}

/* -------------------------------------------------------------------------- */
/* Inquiry seeding                                                             */
/* -------------------------------------------------------------------------- */

interface SeedSpec {
  patientId: UUID
  hospitalId: UUID
  doctorId: UUID | null
  procedureId: UUID | null
  status: InquiryStatus
  priority: Priority
  channel: Inquiry['channel']
  sourceMessage: string
  confidence: number
  minutesOld: number
  slaMinutes: number
  assignedIndex: number | null
  partySize?: number
  hotelId?: UUID
  transportId?: UUID
  symptoms?: string[]
  window?: string
}

const SEED_SPECS: SeedSpec[] = [
  {
    patientId: PATIENT_IDS.priyaMenon,
    hospitalId: HOSPITAL_IDS.batamMedicalCenter,
    doctorId: DOCTOR_IDS.hartono,
    procedureId: PROCEDURE_IDS.dentalImplant,
    status: 'HOSPITAL_REVIEW_REQUIRED',
    priority: 'HIGH',
    channel: 'WEB',
    sourceMessage:
      "Hi! I'm based in Singapore and I need 2 dental implants. Quotes here are around $10k for both. Can you tell me the total if I come over to Batam, including the ferry and a hotel for one night?",
    confidence: 0.93,
    minutesOld: 42,
    slaMinutes: 78,
    assignedIndex: 0,
    partySize: 1,
    window: 'Next 2 weeks',
    symptoms: ['missing molar', 'previous extraction'],
  },
  {
    patientId: PATIENT_IDS.jonathanLee,
    hospitalId: HOSPITAL_IDS.awalBros,
    doctorId: DOCTOR_IDS.siregar,
    procedureId: PROCEDURE_IDS.cataract,
    status: 'DOCTOR_REVIEW_REQUIRED',
    priority: 'HIGH',
    channel: 'WEB',
    sourceMessage:
      'My optician says I have a cataract in my right eye and should get it done soon. I am 61. What would the surgery cost in Batam and how many days do I need to stay?',
    confidence: 0.88,
    minutesOld: 195,
    slaMinutes: -35,
    assignedIndex: 1,
    partySize: 2,
    hotelId: HOTEL_IDS.radissonGolf,
    window: 'Within 1 month',
    symptoms: ['blurred vision', 'glare at night'],
  },
  {
    patientId: PATIENT_IDS.siti,
    hospitalId: HOSPITAL_IDS.elisabeth,
    doctorId: DOCTOR_IDS.lim,
    procedureId: PROCEDURE_IDS.healthScreening,
    status: 'CONFIRMED_BOOKING',
    priority: 'NORMAL',
    channel: 'WEB',
    sourceMessage:
      'Hello, my husband and I want to do a full body health screening. We can travel on a Saturday. Do you have a package for two people including the ferry?',
    confidence: 0.96,
    minutesOld: 2880,
    slaMinutes: 1200,
    assignedIndex: 2,
    partySize: 2,
    transportId: TRANSPORT_IDS.shuttle,
    window: 'This Saturday',
  },
  {
    patientId: PATIENT_IDS.marcusChia,
    hospitalId: HOSPITAL_IDS.batamMedicalCenter,
    doctorId: DOCTOR_IDS.wijaya,
    procedureId: PROCEDURE_IDS.kneeArthroscopy,
    status: 'PATIENT_CONFIRMATION_PENDING',
    priority: 'NORMAL',
    channel: 'WEB',
    sourceMessage:
      'Tore my meniscus playing football. MRI done in SG already. Orthopaedic surgeon here quoted 14k. What can you do in Batam? I would need help getting around after.',
    confidence: 0.91,
    minutesOld: 620,
    slaMinutes: 340,
    assignedIndex: 0,
    partySize: 1,
    hotelId: HOTEL_IDS.bestWesternPanbil,
    transportId: TRANSPORT_IDS.wheelchairVan,
    window: 'Next month',
    symptoms: ['knee pain', 'locking', 'MRI confirmed tear'],
  },
  {
    patientId: PATIENT_IDS.angelaKoh,
    hospitalId: HOSPITAL_IDS.elisabeth,
    doctorId: null,
    procedureId: null,
    status: 'HUMAN_TAKEOVER',
    priority: 'URGENT',
    channel: 'WEB',
    sourceMessage:
      'my mother has severe pain in her stomach since last night and some bleeding. can she come tomorrow for emergency surgery? she is 68 and has diabetes',
    confidence: 0.41,
    minutesOld: 18,
    slaMinutes: 12,
    assignedIndex: 3,
    partySize: 2,
    window: 'Immediate',
    symptoms: ['severe abdominal pain', 'bleeding', 'diabetic'],
  },
  {
    patientId: PATIENT_IDS.tanWeiMing,
    hospitalId: HOSPITAL_IDS.awalBros,
    doctorId: DOCTOR_IDS.siregar,
    procedureId: PROCEDURE_IDS.lasik,
    status: 'COMPLETED',
    priority: 'LOW',
    channel: 'WEB',
    sourceMessage:
      'Interested in LASIK for both eyes. I saw your Batam package online. How much all-in and is the aftercare done in Singapore or do I come back?',
    confidence: 0.94,
    minutesOld: 11_500,
    slaMinutes: -9000,
    assignedIndex: 1,
    partySize: 1,
    window: 'Completed',
  },
  // Repeat and referred enquiries that keep the earlier pipeline stages populated.
  {
    patientId: PATIENT_IDS.marcusChia,
    hospitalId: HOSPITAL_IDS.elisabeth,
    doctorId: null,
    procedureId: null,
    status: 'NEW_INQUIRY',
    priority: 'NORMAL',
    channel: 'WEB',
    sourceMessage:
      'Hi again — my wife wants to do the full health screening too. Same package as mine? Any slots next weekend?',
    confidence: 0.9,
    minutesOld: 3,
    slaMinutes: 87,
    assignedIndex: null,
    partySize: 1,
    window: 'Next weekend',
  },
  {
    patientId: PATIENT_IDS.priyaMenon,
    hospitalId: HOSPITAL_IDS.elisabeth,
    doctorId: null,
    procedureId: PROCEDURE_IDS.endoscopy,
    status: 'AI_PROCESSING',
    priority: 'NORMAL',
    channel: 'WEB',
    sourceMessage:
      'My GP suggested I get a gastroscopy and colonoscopy done. Do you have a package for both together? How long do I need to stay in Batam?',
    confidence: 0.92,
    minutesOld: 6,
    slaMinutes: 84,
    assignedIndex: null,
    partySize: 1,
    window: 'Next month',
    symptoms: ['acid reflux', 'GP referral'],
  },
  {
    patientId: PATIENT_IDS.siti,
    hospitalId: HOSPITAL_IDS.awalBros,
    doctorId: DOCTOR_IDS.siregar,
    procedureId: PROCEDURE_IDS.lasik,
    status: 'AI_ITINERARY_READY',
    priority: 'NORMAL',
    channel: 'WEB',
    sourceMessage:
      "I'd like to do LASIK. I wear -4.5 contacts. What's the total including the ferry and one night hotel?",
    confidence: 0.95,
    minutesOld: 22,
    slaMinutes: 68,
    assignedIndex: 2,
    partySize: 1,
    window: 'Next 3 weeks',
    symptoms: ['myopia -4.5'],
  },
  {
    patientId: PATIENT_IDS.angelaKoh,
    hospitalId: HOSPITAL_IDS.awalBros,
    doctorId: DOCTOR_IDS.siregar,
    procedureId: PROCEDURE_IDS.cataract,
    status: 'TRAVEL_READY',
    priority: 'NORMAL',
    channel: 'WEB',
    sourceMessage:
      'Following up on my own cataract — the left eye this time. Same surgeon and same hotel as before please.',
    confidence: 0.97,
    minutesOld: 4320,
    slaMinutes: 2880,
    assignedIndex: 1,
    partySize: 2,
    hotelId: HOTEL_IDS.radissonGolf,
    window: 'Next week',
    symptoms: ['blurred vision left eye'],
  },
]

export interface SeededInquiry {
  inquiry: Inquiry
  extraction: AiExtraction | null
  quote: Quote | null
  doctorReview: DoctorReview | null
}

export function seedInquiries(): SeededInquiry[] {
  return SEED_SPECS.map((spec) => {
    const inquiryId = uuid()
    const createdAt = minutesAgo(spec.minutesOld)
    const procedure = spec.procedureId ? procedureMap.get(spec.procedureId)! : null

    // Extraction only exists once Hermes has actually returned — a case still
    // sitting in NEW_INQUIRY or AI_PROCESSING has no structured record yet.
    const extraction =
      spec.status === 'NEW_INQUIRY' || spec.status === 'AI_PROCESSING'
        ? null
        : buildExtraction({
            inquiryId,
            procedureId: spec.procedureId,
            sourceMessage: spec.sourceMessage,
            confidence: spec.confidence,
            urgency: spec.priority,
            partySize: spec.partySize,
            window: spec.window,
            symptoms: spec.symptoms,
            createdAt: minutesAgo(spec.minutesOld - 1),
          })

    const needsQuote = ![
      'NEW_INQUIRY',
      'AI_PROCESSING',
      'HUMAN_TAKEOVER',
    ].includes(spec.status)

    let quote: Quote | null = null
    if (needsQuote && spec.procedureId) {
      quote = buildQuote({
        inquiryId,
        procedureId: spec.procedureId,
        doctorId: spec.doctorId,
        hotelId: spec.hotelId,
        transportId: spec.transportId,
        partySize: spec.partySize,
        status: [
          'QUOTE_APPROVED',
          'PATIENT_CONFIRMATION_PENDING',
          'CONFIRMED_BOOKING',
          'TRAVEL_READY',
          'COMPLETED',
        ].includes(spec.status)
          ? 'APPROVED'
          : 'PENDING_APPROVAL',
      })

      if (quote.status === 'APPROVED') {
        quote.approvedByName = STAFF_NAMES[spec.assignedIndex ?? 0]
        quote.approvedAt = minutesAgo(Math.max(spec.minutesOld - 30, 1))
      }
    }

    // Clinical sign-off record exists once a procedure flagged for review lands.
    const doctorReview: DoctorReview | null =
      procedure?.requiresDoctorReview && spec.doctorId
        ? {
            id: uuid(),
            inquiryId,
            doctorId: spec.doctorId,
            decision: spec.status === 'DOCTOR_REVIEW_REQUIRED' ? 'PENDING' : 'CLEARED',
            clinicalNotes:
              spec.status === 'DOCTOR_REVIEW_REQUIRED'
                ? ''
                : 'Records reviewed. Patient suitable for day-surgery pathway. No contraindications identified.',
            requiredPreOpTests:
              procedure.category === 'OPHTHALMOLOGY'
                ? ['Corneal topography', 'Biometry (IOL Master)', 'Blood glucose']
                : ['Full blood count', 'ECG', 'Coagulation profile'],
            reviewedAt:
              spec.status === 'DOCTOR_REVIEW_REQUIRED'
                ? null
                : minutesAgo(Math.max(spec.minutesOld - 45, 1)),
          }
        : null

    const inquiry: Inquiry = {
      id: inquiryId,
      reference: nextReference(),
      patientId: spec.patientId,
      hospitalId: spec.hospitalId,
      doctorId: spec.doctorId,
      procedureId: spec.procedureId,
      status: spec.status,
      priority: spec.priority,
      channel: spec.channel,
      sourceMessage: spec.sourceMessage,
      assignedToName: spec.assignedIndex === null ? null : STAFF_NAMES[spec.assignedIndex],
      itineraryToken: quote?.status === 'APPROVED' ? itineraryToken() : null,
      slaDueAt: minutesAhead(spec.slaMinutes),
      createdAt,
      updatedAt: minutesAgo(Math.max(spec.minutesOld - 12, 0)),
    }

    return { inquiry, extraction, quote, doctorReview }
  })
}

/* -------------------------------------------------------------------------- */
/* Activity seeding                                                            */
/* -------------------------------------------------------------------------- */

export function seedActivity(seeded: SeededInquiry[]): ActivityEvent[] {
  const events: ActivityEvent[] = []

  for (const { inquiry, extraction, quote } of seeded) {
    const ref = inquiry.reference
    const base = new Date(inquiry.createdAt).getTime()
    const at = (offsetSec: number) => new Date(base + offsetSec * 1000).toISOString()

    events.push(
      buildActivity({
        type: 'MESSAGE_RECEIVED',
        inquiryId: inquiry.id,
        inquiryReference: ref,
        description: 'Guided web chat submission from a Singapore visitor.',
        payload: {
          channel: inquiry.channel,
          message_length: inquiry.sourceMessage.length,
          origin_country: 'SG',
          webhook: `/webhooks/${inquiry.channel.toLowerCase()}`,
        },
        createdAt: at(0),
      }),
    )

    if (!extraction) continue

    events.push(
      buildActivity({
        type: 'AI_EXTRACTION_COMPLETED',
        inquiryId: inquiry.id,
        inquiryReference: ref,
        description: `Hermes returned structured JSON at ${(extraction.confidence * 100).toFixed(0)}% confidence.`,
        payload: {
          model_version: extraction.modelVersion,
          confidence: extraction.confidence,
          procedure_label: extraction.procedureLabel,
          entities: extraction.extractedEntities,
        },
        durationMs: extraction.latencyMs,
        createdAt: at(6),
      }),
    )

    if (extraction.requiresHumanReview) {
      events.push(
        buildActivity({
          type: 'HUMAN_REVIEW_REQUIRED',
          inquiryId: inquiry.id,
          inquiryReference: ref,
          description: `Escalated to a human operator — ${extraction.reviewReasons.join(', ')}.`,
          payload: {
            reasons: extraction.reviewReasons,
            confidence: extraction.confidence,
            threshold: CONFIDENCE_THRESHOLD,
            ai_suspended: true,
          },
          createdAt: at(8),
        }),
      )
    }

    if (quote) {
      const totals = computeTotals(quote)
      events.push(
        buildActivity({
          type: 'PRICING_CALCULATED',
          inquiryId: inquiry.id,
          inquiryReference: ref,
          description: `Bundle priced at S$${totals.totalSgd.toLocaleString()} against a S$${totals.sgBenchmarkSgd.toLocaleString()} Singapore benchmark.`,
          payload: {
            total_sgd: totals.totalSgd,
            total_idr: totals.totalIdr,
            sg_benchmark_sgd: totals.sgBenchmarkSgd,
            savings_sgd: totals.savingsSgd,
            savings_pct: Number(totals.savingsPct.toFixed(1)),
            line_item_count: quote.lineItems.length,
          },
          durationMs: 340,
          createdAt: at(11),
        }),
      )

      if (quote.status === 'APPROVED') {
        events.push(
          buildActivity({
            type: 'QUOTE_APPROVED',
            inquiryId: inquiry.id,
            inquiryReference: ref,
            description: `Approved by ${quote.approvedByName}. Patient itinerary link generated.`,
            payload: {
              approved_by: quote.approvedByName,
              quote_id: quote.id,
              valid_until: quote.validUntil,
              token_issued: Boolean(inquiry.itineraryToken),
            },
            createdAt: at(900),
          }),
        )
      }
    }
  }

  return events.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

/* -------------------------------------------------------------------------- */
/* Messaging seeding                                                           */
/* -------------------------------------------------------------------------- */

export function seedThreads(seeded: SeededInquiry[]): MessageThread[] {
  return seeded.slice(0, 5).map(({ inquiry, quote }) => {
    const threadId = uuid()
    const patient = patientMap.get(inquiry.patientId)!
    const procedure = inquiry.procedureId ? procedureMap.get(inquiry.procedureId) : null
    const totals = quote ? computeTotals(quote) : null

    const messages: Message[] = [
      {
        id: uuid(),
        threadId,
        inquiryId: inquiry.id,
        channel: inquiry.channel,
        direction: 'INBOUND',
        body: inquiry.sourceMessage,
        senderName: patient.fullName,
        status: 'RECEIVED',
        aiSuggestion: null,
        aiSuggestionConfidence: null,
        createdAt: inquiry.createdAt,
      },
      {
        id: uuid(),
        threadId,
        inquiryId: inquiry.id,
        channel: inquiry.channel,
        direction: 'OUTBOUND',
        body: `Hi ${patient.fullName.split(' ')[0]}, thanks for reaching out to MedBridge Pass. I'm putting together your options now — I'll come back within the hour with a full breakdown.`,
        senderName: inquiry.assignedToName ?? 'MedBridge Care Team',
        status: 'DELIVERED',
        aiSuggestion: null,
        aiSuggestionConfidence: null,
        createdAt: new Date(new Date(inquiry.createdAt).getTime() + 240_000).toISOString(),
      },
    ]

    // Latest inbound gets an editable AI-drafted reply for staff to review.
    if (inquiry.status !== 'COMPLETED') {
      messages.push({
        id: uuid(),
        threadId,
        inquiryId: inquiry.id,
        channel: inquiry.channel,
        direction: 'INBOUND',
        body:
          inquiry.status === 'HUMAN_TAKEOVER'
            ? 'Please reply, it is quite urgent for us.'
            : 'Thanks! Also, is the hotel close to the hospital? And can I pay by card?',
        senderName: patient.fullName,
        status: 'RECEIVED',
        aiSuggestion:
          inquiry.status === 'HUMAN_TAKEOVER'
            ? null
            : `Yes — the recovery hotel we've selected is a short drive from the hospital and your private transfer covers every leg. We accept Visa, Mastercard and PayNow, with the balance settled at the hospital on the day.${
                totals && procedure
                  ? ` Your all-in ${procedure.name.toLowerCase()} package comes to S$${totals.totalSgd.toLocaleString()}.`
                  : ''
              }`,
        aiSuggestionConfidence: inquiry.status === 'HUMAN_TAKEOVER' ? null : 0.89,
        createdAt: new Date(new Date(inquiry.updatedAt).getTime() - 120_000).toISOString(),
      })
    }

    return {
      id: threadId,
      patientId: inquiry.patientId,
      inquiryId: inquiry.id,
      channel: inquiry.channel,
      subject: procedure?.name ?? 'Unmapped enquiry',
      unreadCount: inquiry.status === 'HUMAN_TAKEOVER' ? 2 : messages.at(-1)?.direction === 'INBOUND' ? 1 : 0,
      lastMessageAt: messages.at(-1)!.createdAt,
      messages,
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Patient itinerary                                                           */
/* -------------------------------------------------------------------------- */

const DAY_LABEL = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000)
  return `Day ${offset + 1} · ${d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })}`
}

/**
 * Builds the public, token-scoped itinerary. Deliberately carries no UUIDs and
 * no full PII — first name only, and only the operational details the patient
 * needs on the day.
 */
export function buildItinerary(params: {
  inquiry: Inquiry
  quote: Quote
}): PatientItinerary {
  const { inquiry, quote } = params
  const patient = patientMap.get(inquiry.patientId)!
  const hospital = hospitalMap.get(inquiry.hospitalId)!
  const doctor = inquiry.doctorId ? doctorMap.get(inquiry.doctorId) ?? null : null
  const procedure = inquiry.procedureId ? procedureMap.get(inquiry.procedureId)! : null
  const totals = computeTotals(quote)

  const ferryOutLine = quote.lineItems.find(
    (l) => l.category === 'FERRY' && l.refType === 'ferry',
  )
  const ferryOut = ferryOutLine?.refId ? ferryMap.get(ferryOutLine.refId)! : null
  const ferryReturnLine = quote.lineItems.filter((l) => l.category === 'FERRY').at(-1)
  const ferryReturn = ferryReturnLine?.refId ? ferryMap.get(ferryReturnLine.refId)! : null
  const hotelLine = quote.lineItems.find((l) => l.category === 'HOTEL')
  const hotel = hotelLine?.refId ? hotelMap.get(hotelLine.refId)! : null
  const transportLine = quote.lineItems.find((l) => l.category === 'TRANSPORT')
  const transport = transportLine?.refId ? transportMap.get(transportLine.refId)! : null

  const nights = hotelLine?.quantity ?? 0
  const returnDayOffset = Math.max(nights, procedure?.treatmentDays ?? 1) - (nights > 0 ? 0 : 1)

  const steps: ItineraryStep[] = [
    {
      kind: 'FERRY_OUT',
      order: 1,
      title: 'Singapore → Batam Ferry',
      subtitle: ferryOut ? `${ferryOut.operator} · Seat included` : 'Return ferry included',
      dayLabel: DAY_LABEL(0),
      timeLabel: ferryOut ? `${ferryOut.departureTime} → ${ferryOut.arrivalTime}` : 'Morning',
      location: ferryOut?.departTerminal ?? 'HarbourFront Centre, Singapore',
      details: [
        `Arrive at the terminal 60 minutes before departure for immigration.`,
        ferryOut
          ? `Crossing time approximately ${ferryOut.durationMinutes} minutes to ${ferryOut.arriveTerminal}.`
          : 'Crossing time approximately 1 hour.',
        'Bring your passport — validity of at least 6 months is required.',
      ],
      priceSgd: ferryOutLine ? lineTotal(ferryOutLine) : null,
    },
    {
      kind: 'PICKUP',
      order: 2,
      title: 'Terminal Pick-up',
      subtitle: transport ? transport.provider : 'MedBridge Care Fleet',
      dayLabel: DAY_LABEL(0),
      timeLabel: 'On arrival',
      location: hospital.nearestTerminal,
      details: [
        'Your driver will be waiting at the arrival hall holding a MedBridge Pass sign.',
        `Transfer to ${hospital.name} takes about ${hospital.minutesFromTerminal} minutes.`,
        transport?.type === 'WHEELCHAIR_VAN'
          ? 'Wheelchair-accessible vehicle with a trained assistant is assigned to you.'
          : 'English-speaking driver assigned for the full duration of your stay.',
      ],
      priceSgd: transportLine ? lineTotal(transportLine) : null,
    },
    {
      kind: 'HOSPITAL',
      order: 3,
      title: 'Hospital & Doctor',
      subtitle: procedure?.name ?? 'Consultation',
      dayLabel: DAY_LABEL(0),
      timeLabel: 'Same day',
      location: `${hospital.name}, ${hospital.district}`,
      details: [
        doctor ? `You will be seen by ${doctor.fullName} — ${doctor.specialty}.` : 'Specialist assigned on arrival.',
        `${hospital.accreditation} accredited.`,
        procedure
          ? `Expect ${procedure.treatmentDays} clinical day(s) on site.`
          : 'Treatment plan confirmed at consultation.',
        'An English-speaking coordinator accompanies you throughout.',
      ],
      priceSgd:
        (quote.lineItems.find((l) => l.category === 'TREATMENT')
          ? lineTotal(quote.lineItems.find((l) => l.category === 'TREATMENT')!)
          : 0) +
        (quote.lineItems.find((l) => l.category === 'DOCTOR_FEE')
          ? lineTotal(quote.lineItems.find((l) => l.category === 'DOCTOR_FEE')!)
          : 0),
    },
  ]

  if (hotel && nights > 0) {
    steps.push({
      kind: 'HOTEL',
      order: 4,
      title: 'Hotel Recovery',
      subtitle: `${hotel.name} · ${nights} night${nights > 1 ? 's' : ''}`,
      dayLabel: DAY_LABEL(0),
      timeLabel: 'Check-in from 14:00',
      location: `${hotel.name}, ${hotel.district}`,
      details: [
        // Measured to the hospital on THIS itinerary, not to a hospital in
        // general — the distance is a fact about the pair, not about the hotel.
        `${hotel.starRating}★ property, ${formatKm(haversineKm(hotel, hospital)) ?? `in ${hotel.district}`} from ${hospital.name}.`,
        hotel.medicalRecoveryCertified
          ? 'MedBridge recovery-certified: soft-diet menu and lift access confirmed.'
          : 'Standard property with full amenities.',
        ...hotel.amenities.slice(0, 2).map((a) => `Included: ${a}.`),
      ],
      priceSgd: hotelLine ? lineTotal(hotelLine) : null,
    })
  }

  steps.push({
    kind: 'FERRY_RETURN',
    order: steps.length + 1,
    title: 'Return Ferry to Singapore',
    subtitle: ferryReturn ? `${ferryReturn.operator} · Seat included` : 'Return leg included',
    dayLabel: DAY_LABEL(returnDayOffset),
    timeLabel: ferryReturn ? `${ferryReturn.departureTime} → ${ferryReturn.arrivalTime}` : 'Evening',
    location: ferryReturn?.departTerminal ?? 'Batam Centre Ferry Terminal',
    details: [
      'Your driver collects you from the hotel 2 hours before departure.',
      'Post-treatment documents and medication are handed over before you leave.',
      ferryReturn
        ? `Arrive ${ferryReturn.arriveTerminal} at ${ferryReturn.arrivalTime}.`
        : 'Arrive HarbourFront Centre, Singapore.',
    ],
    priceSgd: ferryReturnLine ? lineTotal(ferryReturnLine) : null,
  })

  const costLines: ItineraryCostLine[] = quote.lineItems.map((item) => ({
    label: item.label,
    detail: item.quantity > 1 ? `${item.quantity} × S$${item.unitPriceSgd}` : item.detail,
    priceSgd: lineTotal(item),
  }))

  return {
    token: inquiry.itineraryToken ?? itineraryToken(),
    reference: inquiry.reference,
    patientFirstName: patient.fullName.split(' ')[0],
    status: inquiry.status,
    hospitalName: hospital.name,
    hospitalAddress: hospital.address,
    doctorName: doctor?.fullName ?? null,
    doctorSpecialty: doctor?.specialty ?? null,
    procedureName: procedure?.name ?? 'Consultation',
    travelWindow: `${new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })} – ${new Date(Date.now() + returnDayOffset * 86_400_000).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    steps,
    costLines,
    totalSgd: totals.totalSgd,
    totalIdr: totals.totalIdr,
    singaporeBenchmarkSgd: totals.sgBenchmarkSgd,
    savingsSgd: totals.savingsSgd,
    savingsPct: totals.savingsPct,
    validUntil: quote.validUntil,
    supportPhone: '+62 778 000 000',
    issuedAt: quote.approvedAt ?? new Date().toISOString(),
  }
}
