/**
 * MedBridge REST surface.
 *
 * Each function maps 1:1 to a backend endpoint and degrades to the in-memory
 * mock database when the API is unreachable, so the UI behaves identically
 * offline. Response shapes are the contract — the frontend never sees raw model
 * output, only these structured records.
 */
import { request, withFallback } from './http'
import { mockDb } from '@/mock/db'
import { sleep } from '@/lib/utils'
import type {
  ActivityEvent,
  ChatBundle,
  ChatSession,
  ChatSubmission,
  DoctorReviewDecision,
  Doctor,
  FerryRoute,
  GroundTransport,
  Hospital,
  Hotel,
  Inquiry,
  InquiryDetail,
  InquiryStatus,
  PartnerPortal,
  PartnerProcedureRow,
  PartnerSummary,
  PartnerType,
  PatientItinerary,
  PatientSummary,
  Place,
  Procedure,
  SaasSummary,
  Quote,
  QuoteLineItem,
  QuoteSummary,
  UUID,
} from '@/types'
import {
  doctors,
  ferryRoutes,
  groundTransport,
  hospitals,
  hotels,
  places,
  procedures,
} from '@/mock/seed'

/** Small artificial latency so loading states are visible in the demo. */
const LATENCY_MS = 220

/* -------------------------------------------------------------------------- */
/* Inquiries                                                                   */
/* -------------------------------------------------------------------------- */

export interface InquiryFilters {
  status?: InquiryStatus[]
  search?: string
  channel?: string
}

export const inquiriesApi = {
  list: (filters: InquiryFilters = {}) =>
    withFallback<Inquiry[]>(
      () =>
        request('/inquiries', {
          query: {
            status: filters.status?.join(','),
            search: filters.search,
            channel: filters.channel,
          },
        }),
      async () => {
        await sleep(LATENCY_MS)
        return mockDb.listInquiries(filters)
      },
    ),

  get: (id: UUID) =>
    withFallback<InquiryDetail>(
      () => request(`/inquiries/${id}`),
      async () => {
        await sleep(LATENCY_MS)
        const detail = mockDb.getInquiry(id)
        if (!detail) throw new Error(`Inquiry ${id} not found`)
        return detail
      },
    ),

  setStatus: (id: UUID, status: InquiryStatus, note?: string) =>
    withFallback<Inquiry>(
      () => request(`/inquiries/${id}/status`, { method: 'PATCH', body: { status, note } }),
      async () => {
        await sleep(LATENCY_MS)
        const updated = mockDb.setStatus(id, status, note)
        if (!updated) throw new Error(`Inquiry ${id} not found`)
        return updated
      },
    ),

  assign: (id: UUID, doctorId: UUID | null, staffName: string) =>
    withFallback<InquiryDetail>(
      () => request(`/inquiries/${id}/assign`, { method: 'PATCH', body: { doctorId, staffName } }),
      async () => {
        await sleep(LATENCY_MS)
        mockDb.assignCase(id, doctorId, staffName)
        return mockDb.getInquiry(id)!
      },
    ),
}

/* -------------------------------------------------------------------------- */
/* Quotes                                                                      */
/* -------------------------------------------------------------------------- */

export const quotesApi = {
  updateLineItem: (
    inquiryId: UUID,
    lineItemId: UUID,
    patch: Partial<Pick<QuoteLineItem, 'quantity' | 'unitPriceSgd' | 'label' | 'detail'>>,
  ) =>
    withFallback<Quote>(
      () =>
        request(`/inquiries/${inquiryId}/quote/line-items/${lineItemId}`, {
          method: 'PATCH',
          body: patch,
        }),
      async () => {
        const quote = mockDb.updateLineItem(inquiryId, lineItemId, patch)
        if (!quote) throw new Error('Quote line item not found')
        return quote
      },
    ),

  addLineItem: (inquiryId: UUID, item: Omit<QuoteLineItem, 'id' | 'quoteId'>) =>
    withFallback<Quote>(
      () => request(`/inquiries/${inquiryId}/quote/line-items`, { method: 'POST', body: item }),
      async () => {
        const quote = mockDb.addLineItem(inquiryId, item)
        if (!quote) throw new Error('Quote not found')
        return quote
      },
    ),

  removeLineItem: (inquiryId: UUID, lineItemId: UUID) =>
    withFallback<Quote>(
      () =>
        request(`/inquiries/${inquiryId}/quote/line-items/${lineItemId}`, { method: 'DELETE' }),
      async () => {
        const quote = mockDb.removeLineItem(inquiryId, lineItemId)
        if (!quote) throw new Error('Quote not found')
        return quote
      },
    ),

  /** Human-in-the-loop approval — the only path that mints a patient token. */
  approve: (inquiryId: UUID, approvedByName: string) =>
    withFallback<InquiryDetail>(
      () => request(`/inquiries/${inquiryId}/quote/approve`, { method: 'POST', body: { approvedByName } }),
      async () => {
        await sleep(LATENCY_MS)
        const detail = mockDb.approveQuote(inquiryId, approvedByName)
        if (!detail) throw new Error('Quote not found')
        return detail
      },
    ),

  reject: (inquiryId: UUID, reason: string) =>
    withFallback<InquiryDetail>(
      () => request(`/inquiries/${inquiryId}/quote/reject`, { method: 'POST', body: { reason } }),
      async () => {
        await sleep(LATENCY_MS)
        const detail = mockDb.rejectQuote(inquiryId, reason)
        if (!detail) throw new Error('Quote not found')
        return detail
      },
    ),
}

/* -------------------------------------------------------------------------- */
/* Doctor review                                                               */
/* -------------------------------------------------------------------------- */

export const doctorReviewApi = {
  submit: (
    inquiryId: UUID,
    input: { decision: DoctorReviewDecision; clinicalNotes: string; doctorId: UUID | null },
  ) =>
    withFallback<InquiryDetail>(
      () => request(`/inquiries/${inquiryId}/doctor-review`, { method: 'POST', body: input }),
      async () => {
        await sleep(LATENCY_MS)
        const detail = mockDb.submitDoctorReview(inquiryId, input)
        if (!detail) throw new Error('Inquiry not found')
        return detail
      },
    ),
}

/* -------------------------------------------------------------------------- */
/* Activity                                                                    */
/* -------------------------------------------------------------------------- */

export const activityApi = {
  list: (limit = 100) =>
    withFallback<ActivityEvent[]>(
      () => request('/activity', { query: { limit } }),
      async () => {
        await sleep(LATENCY_MS)
        return mockDb.listActivity(limit)
      },
    ),
}

/* -------------------------------------------------------------------------- */
/* Patient web chat (public, session-token scoped)                             */
/* -------------------------------------------------------------------------- */

/**
 * The front door.
 *
 * Note what is NOT here: any notion of a model. The browser sends the visitor's
 * text to MedBridge and receives structured turns back — questions drawn from
 * the backend's question bank, and a priced bundle. Hermes lives entirely
 * behind these endpoints.
 *
 * These calls deliberately do NOT use withFallback. A mock conversation would
 * produce a bundle that was never written to the database, and the visitor
 * would be told their request was submitted when nothing had been. When the
 * backend is down, this must fail loudly.
 */
export const chatApi = {
  start: () => request<ChatSession>('/chat/sessions', { method: 'POST' }),

  get: (token: string) => request<ChatSession>(`/chat/sessions/${token}`),

  /** Free text the visitor typed. This is the only path that reaches Hermes. */
  send: (token: string, body: string) =>
    request<ChatSession>(`/chat/sessions/${token}/messages`, { method: 'POST', body: { body } }),

  /** A chip tap or date pick — a stated fact, so no extraction is needed. */
  choose: (token: string, slot: string, value: string | number) =>
    request<ChatSession>(`/chat/sessions/${token}/choice`, {
      method: 'POST',
      body: { slot, value },
    }),

  /** Drop a line from the bundle. Non-removable lines are refused server-side. */
  toggleLine: (token: string, key: string, included: boolean) =>
    request<{ bundle: ChatBundle }>(`/chat/sessions/${token}/bundle`, {
      method: 'POST',
      body: { action: 'toggle', key, included },
    }),

  /** Swap a hotel/ferry/transfer/doctor. Repriced from the catalogue, not the client. */
  swapLine: (token: string, key: string, refId: UUID) =>
    request<{ bundle: ChatBundle }>(`/chat/sessions/${token}/bundle`, {
      method: 'POST',
      body: { action: 'swap', key, refId },
    }),

  /**
   * Choose the treating hospital. Rebuilds the bundle — treatment price,
   * specialist and ferry terminal move together — while carrying across the
   * hotel, transfer and include/exclude decisions already made.
   */
  chooseHospital: (token: string, refId: UUID) =>
    request<{ bundle: ChatBundle }>(`/chat/sessions/${token}/bundle`, {
      method: 'POST',
      body: { action: 'hospital', refId },
    }),

  /** Change the number of recovery nights. 0 drops the hotel line entirely. */
  setNights: (token: string, nights: number) =>
    request<{ bundle: ChatBundle }>(`/chat/sessions/${token}/bundle`, {
      method: 'POST',
      body: { action: 'nights', nights },
    }),

  /**
   * Confirm and submit. This is where the anonymous session becomes a real case
   * in the database — and where it stops, waiting for a human.
   */
  submit: (token: string, submission: ChatSubmission) =>
    request<ChatSession>(`/chat/sessions/${token}/submit`, { method: 'POST', body: submission }),
}

/* -------------------------------------------------------------------------- */
/* Patient itinerary (public, token-scoped)                                    */
/* -------------------------------------------------------------------------- */

export const itineraryApi = {
  /**
   * PRIVACY: resolved by opaque token only. No database UUID and no PII ever
   * appears in this URL, and the payload carries first name only.
   */
  getByToken: (token: string) =>
    withFallback<PatientItinerary>(
      () => request(`/itinerary/${token}`),
      async () => {
        await sleep(LATENCY_MS)
        const itinerary = mockDb.getItineraryByToken(token)
        if (!itinerary) throw new Error('Itinerary not found or expired')
        return itinerary
      },
    ),

  confirm: (token: string) =>
    withFallback<{ status: InquiryStatus }>(
      () => request(`/itinerary/${token}/confirm`, { method: 'POST' }),
      async () => {
        await sleep(LATENCY_MS)
        return { status: 'CONFIRMED_BOOKING' as InquiryStatus }
      },
    ),
}

/* -------------------------------------------------------------------------- */
/* Directories                                                                 */
/* -------------------------------------------------------------------------- */

export const patientsApi = {
  list: () =>
    withFallback<PatientSummary[]>(
      () => request('/patients'),
      async () => {
        await sleep(LATENCY_MS)
        return mockDb.listPatientSummaries()
      },
    ),
}

export const quotesDirectoryApi = {
  list: () =>
    withFallback<QuoteSummary[]>(
      () => request('/quotes'),
      async () => {
        await sleep(LATENCY_MS)
        return mockDb.listQuoteSummaries()
      },
    ),
}

/* -------------------------------------------------------------------------- */
/* Partner portals + the marketplace's own numbers                             */
/* -------------------------------------------------------------------------- */

/**
 * These deliberately do NOT use withFallback, for the same reason `chatApi`
 * does not.
 *
 * The mock database has no approved quotes and no bookings, so a fallback here
 * could only invent them — and a partner portal showing fabricated arrivals, or
 * a revenue figure with no quote behind it, is worse than an error message. A
 * commercial screen has to fail loudly rather than reassure.
 */
export const partnersApi = {
  list: (type: PartnerType) => request<PartnerSummary[]>(`/partners/${type}`),
  get: (type: PartnerType, id: UUID) => request<PartnerPortal>(`/partners/${type}/${id}`),

  /* -- Self-service. Each write is scoped to the partner in the path. ----- */

  updateProcedure: (
    hospitalId: UUID,
    procedureId: UUID,
    patch: Partial<
      Pick<
        PartnerProcedureRow,
        'priceSgd' | 'available' | 'sgBenchmarkSgd' | 'treatmentDays' | 'recoveryNights'
      >
    >,
  ) =>
    request<PartnerProcedureRow>(`/partners/hospital/${hospitalId}/procedures/${procedureId}`, {
      method: 'PATCH',
      body: patch,
    }),

  updateDoctor: (
    hospitalId: UUID,
    doctorId: UUID,
    patch: { consultationFeeSgd?: number; yearsExperience?: number },
  ) =>
    request<Doctor>(`/partners/hospital/${hospitalId}/doctors/${doctorId}`, {
      method: 'PATCH',
      body: patch,
    }),

  updateHotelRate: (hotelId: UUID, nightlyRateSgd: number) =>
    request<Hotel>(`/partners/hotel/${hotelId}/rate`, {
      method: 'PATCH',
      body: { nightlyRateSgd },
    }),

  updateFerryFare: (ferryId: UUID, priceSgd: number) =>
    request<FerryRoute>(`/partners/ferry/${ferryId}/fare`, {
      method: 'PATCH',
      body: { priceSgd },
    }),

  updateTransportPrice: (transportId: UUID, priceSgd: number) =>
    request<GroundTransport>(`/partners/transport/${transportId}/price`, {
      method: 'PATCH',
      body: { priceSgd },
    }),
}

export const saasApi = {
  summary: () => request<SaasSummary>('/saas/summary'),
}

/* -------------------------------------------------------------------------- */
/* Catalogue pricing (hospital-managed)                                        */
/* -------------------------------------------------------------------------- */

export const pricingApi = {
  updateProcedure: (
    id: UUID,
    patch: Partial<Pick<Procedure, 'batamPriceSgd' | 'sgBenchmarkSgd' | 'requiresDoctorReview'>>,
  ) =>
    withFallback<Procedure>(
      () => request(`/catalogue/procedures/${id}`, { method: 'PATCH', body: patch }),
      async () => {
        const row = mockDb.updateProcedurePricing(id, patch)
        if (!row) throw new Error('Procedure not found')
        return row
      },
    ),

  updateHotel: (id: UUID, nightlyRateSgd: number) =>
    withFallback<Hotel>(
      () => request(`/catalogue/hotels/${id}`, { method: 'PATCH', body: { nightlyRateSgd } }),
      async () => {
        const row = mockDb.updateHotelRate(id, nightlyRateSgd)
        if (!row) throw new Error('Hotel not found')
        return row
      },
    ),

  updateTransport: (id: UUID, priceSgd: number) =>
    withFallback<GroundTransport>(
      () => request(`/catalogue/ground-transport/${id}`, { method: 'PATCH', body: { priceSgd } }),
      async () => {
        const row = mockDb.updateTransportPrice(id, priceSgd)
        if (!row) throw new Error('Transport option not found')
        return row
      },
    ),

  updateFerry: (id: UUID, priceSgd: number) =>
    withFallback<FerryRoute>(
      () => request(`/catalogue/ferry-routes/${id}`, { method: 'PATCH', body: { priceSgd } }),
      async () => {
        const row = mockDb.updateFerryPrice(id, priceSgd)
        if (!row) throw new Error('Ferry route not found')
        return row
      },
    ),
}

/* -------------------------------------------------------------------------- */
/* Reference catalogue                                                         */
/* -------------------------------------------------------------------------- */

export const catalogueApi = {
  hospitals: () =>
    withFallback<Hospital[]>(
      () => request('/catalogue/hospitals'),
      () => hospitals,
    ),
  doctors: () =>
    withFallback<Doctor[]>(
      () => request('/catalogue/doctors'),
      () => doctors,
    ),
  procedures: () =>
    withFallback<Procedure[]>(
      () => request('/catalogue/procedures'),
      () => procedures,
    ),
  ferries: () =>
    withFallback<FerryRoute[]>(
      () => request('/catalogue/ferry-routes'),
      () => ferryRoutes,
    ),
  hotels: () =>
    withFallback<Hotel[]>(
      () => request('/catalogue/hotels'),
      () => hotels,
    ),
  transport: () =>
    withFallback<GroundTransport[]>(
      () => request('/catalogue/ground-transport'),
      () => groundTransport,
    ),
  /**
   * Read-only, and there is no `pricingApi.updatePlace` to match it. Every
   * other catalogue row has an amount staff can edit; a place has a band and
   * nothing to add up, which is the whole point (docs/09 D22).
   */
  places: () =>
    withFallback<Place[]>(
      () => request('/catalogue/places'),
      () => places,
    ),
}
