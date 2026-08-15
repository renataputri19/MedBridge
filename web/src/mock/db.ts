/**
 * In-memory mock database — the offline stand-in for PostgreSQL.
 *
 * It mirrors the backend's query surface exactly so `services/api.ts` can fall
 * back to it transparently when the REST API is unreachable. State lives for the
 * lifetime of the tab; every write emits a realtime event so the UI updates the
 * same way it would from an SSE frame.
 */
import { CLOSED_WON_STATUSES, IDR_PER_SGD, REVIEW_STATUSES } from '@/lib/constants'
import { itineraryToken, uuid } from '@/lib/utils'
import type {
  ActivityEvent,
  AnalyticsSummary,
  DashboardKpis,
  DoctorSummary,
  FerryRoute,
  GroundTransport,
  Hotel,
  Inquiry,
  InquiryDetail,
  InquiryStatus,
  Message,
  MessageThread,
  PatientItinerary,
  PatientSummary,
  PriceComparisonRow,
  Procedure,
  Quote,
  QuoteLineItem,
  QuoteSummary,
  RealtimeEvent,
  TreatmentDistribution,
  UUID,
  VolumeTrendPoint,
} from '@/types'
import {
  buildActivity,
  buildItinerary,
  buildQuote,
  computeTotals,
  lineTotal,
  nextReference,
  seedActivity,
  seedInquiries,
  seedThreads,
  type SeededInquiry,
} from './generators'
import {
  doctorMap,
  doctors,
  ferryMap,
  hospitalMap,
  hotelMap,
  patientMap,
  patients,
  procedureMap,
  procedures,
  transportMap,
} from './seed'

type Listener = (event: RealtimeEvent) => void

class MockDatabase {
  private inquiries: Inquiry[] = []
  private extractions = new Map<UUID, SeededInquiry['extraction']>()
  private quotes = new Map<UUID, Quote>()
  private activity: ActivityEvent[] = []
  private threads: MessageThread[] = []
  private listeners = new Set<Listener>()

  constructor() {
    this.reset()
  }

  reset() {
    const seeded = seedInquiries()
    this.inquiries = seeded.map((s) => s.inquiry)
    this.extractions = new Map(seeded.map((s) => [s.inquiry.id, s.extraction]))
    this.quotes = new Map(
      seeded.filter((s) => s.quote).map((s) => [s.inquiry.id, s.quote!]),
    )
    this.activity = seedActivity(seeded)
    this.threads = seedThreads(seeded)
  }

  /* ------------------------------------------------------------------ */
  /* Realtime plumbing                                                   */
  /* ------------------------------------------------------------------ */

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: RealtimeEvent) {
    for (const listener of this.listeners) listener(event)
  }

  private pushActivity(event: ActivityEvent) {
    this.activity.unshift(event)
    this.emit({ type: 'activity', payload: event })
  }

  /* ------------------------------------------------------------------ */
  /* Reads                                                               */
  /* ------------------------------------------------------------------ */

  listInquiries(filters?: {
    status?: InquiryStatus[]
    search?: string
    channel?: string
  }): Inquiry[] {
    let rows = [...this.inquiries]

    if (filters?.status?.length) {
      rows = rows.filter((i) => filters.status!.includes(i.status))
    }

    if (filters?.channel && filters.channel !== 'ALL') {
      rows = rows.filter((i) => i.channel === filters.channel)
    }

    if (filters?.search) {
      const q = filters.search.toLowerCase()
      rows = rows.filter((i) => {
        const patient = patientMap.get(i.patientId)
        const procedure = i.procedureId ? procedureMap.get(i.procedureId) : null
        return (
          i.reference.toLowerCase().includes(q) ||
          patient?.fullName.toLowerCase().includes(q) ||
          procedure?.name.toLowerCase().includes(q) ||
          i.sourceMessage.toLowerCase().includes(q)
        )
      })
    }

    return rows.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
  }

  getInquiry(id: UUID): InquiryDetail | null {
    const inquiry = this.inquiries.find((i) => i.id === id)
    if (!inquiry) return null
    return this.hydrate(inquiry)
  }

  private hydrate(inquiry: Inquiry): InquiryDetail {
    return {
      ...inquiry,
      patient: patientMap.get(inquiry.patientId)!,
      hospital: hospitalMap.get(inquiry.hospitalId)!,
      doctor: inquiry.doctorId ? doctorMap.get(inquiry.doctorId) ?? null : null,
      procedure: inquiry.procedureId ? procedureMap.get(inquiry.procedureId) ?? null : null,
      aiExtraction: this.extractions.get(inquiry.id) ?? null,
      quote: this.quotes.get(inquiry.id) ?? null,
    }
  }

  listActivity(limit = 100): ActivityEvent[] {
    return this.activity.slice(0, limit)
  }

  listThreads(): MessageThread[] {
    return [...this.threads].sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    )
  }

  getKpis(): DashboardKpis {
    const leads = this.inquiries.length
    const itineraries = this.inquiries.filter((i) => i.itineraryToken).length
    const pending = this.inquiries.filter((i) => REVIEW_STATUSES.includes(i.status)).length
    const confirmed = this.inquiries.filter((i) =>
      CLOSED_WON_STATUSES.includes(i.status),
    ).length

    const savings = [...this.quotes.values()]
      .filter((q) => q.status === 'APPROVED')
      .reduce((acc, q) => acc + computeTotals(q).savingsSgd, 0)

    return {
      // Deltas are week-over-week and come from the backend in production;
      // here they are stable pseudo-values so the demo reads consistently.
      singaporeLeads: leads + 38,
      singaporeLeadsDelta: 24,
      aiItineraries: itineraries + 21,
      aiItinerariesDelta: 31,
      pendingReviews: pending,
      pendingReviewsDelta: -12,
      confirmedBookings: confirmed + 14,
      confirmedBookingsDelta: 18,
      totalSavingsSgd: Math.round(savings + 128_400),
      totalSavingsDelta: 27,
    }
  }

  getAnalytics(): AnalyticsSummary {
    const funnel = [
      { stage: 'Inquiries', count: 186 },
      { stage: 'AI Processed', count: 171 },
      { stage: 'Quoted', count: 132 },
      { stage: 'Approved', count: 98 },
      { stage: 'Confirmed', count: 61 },
      { stage: 'Travelled', count: 54 },
    ]

    // Distribution weights chosen so the mix reads like a real Batam caseload.
    const weights = [42, 58, 24, 19, 11, 32]
    const treatments: TreatmentDistribution[] = procedures.map((p, index) => ({
      procedureId: p.id,
      name: p.name.split('(')[0].trim(),
      category: p.category,
      count: weights[index],
      revenueSgd: weights[index] * p.batamPriceSgd,
    }))

    const priceComparison: PriceComparisonRow[] = procedures.map((p) => {
      const savings = p.sgBenchmarkSgd - p.batamPriceSgd
      return {
        procedureId: p.id,
        name: p.name.split('(')[0].trim(),
        singaporeSgd: p.sgBenchmarkSgd,
        medbridgeSgd: p.batamPriceSgd,
        savingsSgd: savings,
        savingsPct: (savings / p.sgBenchmarkSgd) * 100,
      }
    })

    const trend: VolumeTrendPoint[] = Array.from({ length: 12 }, (_, i) => {
      const date = new Date(Date.now() - (11 - i) * 7 * 86_400_000)
      const inquiries = 8 + Math.round(Math.sin(i / 2.2) * 3) + i
      const confirmed = Math.max(2, Math.round(inquiries * (0.3 + i * 0.012)))
      return {
        date: date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }),
        inquiries,
        confirmed,
        savingsSgd: confirmed * 2650,
      }
    })

    const avgSavingsPct =
      priceComparison.reduce((acc, r) => acc + r.savingsPct, 0) / priceComparison.length

    return {
      funnel,
      treatments,
      priceComparison,
      trend,
      conversionRate: (funnel[4].count / funnel[0].count) * 100,
      avgResponseMinutes: 11,
      aiAutomationRate: 78.4,
      avgSavingsPct,
    }
  }

  getItineraryByToken(token: string): PatientItinerary | null {
    const inquiry = this.inquiries.find((i) => i.itineraryToken === token)
    if (!inquiry) return null

    const quote = this.quotes.get(inquiry.id)
    if (!quote) return null

    return buildItinerary({ inquiry, quote })
  }

  /** Convenience for the demo: the most recently issued itinerary token. */
  latestItineraryToken(): string | null {
    const withToken = this.inquiries
      .filter((i) => i.itineraryToken)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    return withToken[0]?.itineraryToken ?? null
  }

  /* ------------------------------------------------------------------ */
  /* Writes                                                              */
  /* ------------------------------------------------------------------ */

  private touch(inquiry: Inquiry, status?: InquiryStatus) {
    if (status) inquiry.status = status
    inquiry.updatedAt = new Date().toISOString()
    this.emit({ type: 'inquiry.updated', payload: { ...inquiry } })
    this.emit({ type: 'kpis.updated', payload: this.getKpis() })
  }

  setStatus(id: UUID, status: InquiryStatus, note?: string): Inquiry | null {
    const inquiry = this.inquiries.find((i) => i.id === id)
    if (!inquiry) return null

    const previous = inquiry.status
    this.touch(inquiry, status)

    this.pushActivity(
      buildActivity({
        type: 'STATUS_CHANGED',
        inquiryId: inquiry.id,
        inquiryReference: inquiry.reference,
        description: note ?? `Pipeline moved from ${previous} to ${status}.`,
        payload: { from: previous, to: status, inquiry_id: inquiry.id },
      }),
    )

    return { ...inquiry }
  }

  updateLineItem(
    inquiryId: UUID,
    lineItemId: UUID,
    patch: Partial<Pick<QuoteLineItem, 'quantity' | 'unitPriceSgd' | 'label' | 'detail'>>,
  ): Quote | null {
    const quote = this.quotes.get(inquiryId)
    if (!quote) return null

    const item = quote.lineItems.find((l) => l.id === lineItemId)
    if (!item) return null

    Object.assign(item, patch)
    quote.updatedAt = new Date().toISOString()

    return { ...quote, lineItems: [...quote.lineItems] }
  }

  addLineItem(inquiryId: UUID, item: Omit<QuoteLineItem, 'id' | 'quoteId'>): Quote | null {
    const quote = this.quotes.get(inquiryId)
    if (!quote) return null

    quote.lineItems.push({ ...item, id: uuid(), quoteId: quote.id })
    quote.updatedAt = new Date().toISOString()
    return { ...quote, lineItems: [...quote.lineItems] }
  }

  removeLineItem(inquiryId: UUID, lineItemId: UUID): Quote | null {
    const quote = this.quotes.get(inquiryId)
    if (!quote) return null

    quote.lineItems = quote.lineItems.filter((l) => l.id !== lineItemId)
    quote.updatedAt = new Date().toISOString()
    return { ...quote, lineItems: [...quote.lineItems] }
  }

  /**
   * Staff approval. This is the human-in-the-loop gate: only after a person
   * approves does a patient-facing token get minted.
   */
  approveQuote(inquiryId: UUID, approvedByName: string): InquiryDetail | null {
    const inquiry = this.inquiries.find((i) => i.id === inquiryId)
    const quote = this.quotes.get(inquiryId)
    if (!inquiry || !quote) return null

    quote.status = 'APPROVED'
    quote.approvedByName = approvedByName
    quote.approvedAt = new Date().toISOString()
    quote.updatedAt = quote.approvedAt

    if (!inquiry.itineraryToken) inquiry.itineraryToken = itineraryToken()
    this.touch(inquiry, 'QUOTE_APPROVED')

    const totals = computeTotals(quote)

    this.pushActivity(
      buildActivity({
        type: 'QUOTE_APPROVED',
        inquiryId: inquiry.id,
        inquiryReference: inquiry.reference,
        description: `Quote approved by ${approvedByName}. Total S$${totals.totalSgd.toLocaleString()}, saving S$${totals.savingsSgd.toLocaleString()} versus Singapore.`,
        payload: {
          approved_by: approvedByName,
          quote_id: quote.id,
          total_sgd: totals.totalSgd,
          total_idr: totals.totalIdr,
          savings_sgd: totals.savingsSgd,
          savings_pct: Number(totals.savingsPct.toFixed(1)),
        },
      }),
    )

    this.pushActivity(
      buildActivity({
        type: 'ITINERARY_ISSUED',
        inquiryId: inquiry.id,
        inquiryReference: inquiry.reference,
        description: 'Secure patient itinerary link generated and queued for delivery.',
        payload: {
          // The token is opaque and carries no PII — safe to log operationally.
          itinerary_token: inquiry.itineraryToken,
          route: `/itinerary/${inquiry.itineraryToken}`,
          expires_at: quote.validUntil,
        },
      }),
    )

    return this.hydrate(inquiry)
  }

  /**
   * The patient's acceptance, recorded by staff rather than clicked by them.
   *
   * Mirrors `QuoteController::confirm`: only from an approved quote, and a
   * distinct activity type from PATIENT_CONFIRMED so the audit trail keeps
   * "they clicked it" and "we were told" apart.
   */
  confirmForPatient(inquiryId: UUID, confirmedByName: string): InquiryDetail | null {
    const inquiry = this.inquiries.find((i) => i.id === inquiryId)
    const quote = this.quotes.get(inquiryId)
    if (!inquiry || !quote) return null
    if (quote.status !== 'APPROVED') return null
    if (!['QUOTE_APPROVED', 'PATIENT_CONFIRMATION_PENDING'].includes(inquiry.status)) return null

    this.touch(inquiry, 'CONFIRMED_BOOKING')

    this.pushActivity(
      buildActivity({
        type: 'STAFF_CONFIRMED_FOR_PATIENT',
        inquiryId: inquiry.id,
        inquiryReference: inquiry.reference,
        description: `${confirmedByName} recorded the patient's acceptance.`,
        payload: { reference: inquiry.reference, confirmed_by: confirmedByName },
      }),
    )

    return this.hydrate(inquiry)
  }

  rejectQuote(inquiryId: UUID, reason: string): InquiryDetail | null {
    const inquiry = this.inquiries.find((i) => i.id === inquiryId)
    const quote = this.quotes.get(inquiryId)
    if (!inquiry || !quote) return null

    quote.status = 'REJECTED'
    quote.notes = reason
    quote.updatedAt = new Date().toISOString()
    this.touch(inquiry, 'HUMAN_TAKEOVER')

    this.pushActivity(
      buildActivity({
        type: 'STATUS_CHANGED',
        inquiryId: inquiry.id,
        inquiryReference: inquiry.reference,
        level: 'warning',
        title: 'Quote rejected',
        description: reason,
        payload: { quote_id: quote.id, reason },
      }),
    )

    return this.hydrate(inquiry)
  }

  /* ------------------------------------------------------------------ */
  /* Messaging                                                           */
  /* ------------------------------------------------------------------ */

  sendMessage(threadId: UUID, body: string, senderName: string): Message | null {
    const thread = this.threads.find((t) => t.id === threadId)
    if (!thread) return null

    const message: Message = {
      id: uuid(),
      threadId,
      inquiryId: thread.inquiryId,
      channel: thread.channel,
      direction: 'OUTBOUND',
      body,
      senderName,
      status: 'SENT',
      aiSuggestion: null,
      aiSuggestionConfidence: null,
      createdAt: new Date().toISOString(),
    }

    thread.messages.push(message)
    thread.lastMessageAt = message.createdAt
    thread.unreadCount = 0

    // Clear the AI draft that was just acted on so it cannot be re-sent.
    const pending = [...thread.messages].reverse().find((m) => m.aiSuggestion)
    if (pending) pending.aiSuggestion = null

    const inquiry = this.inquiries.find((i) => i.id === thread.inquiryId)

    this.pushActivity(
      buildActivity({
        type: 'MESSAGE_SENT',
        inquiryId: thread.inquiryId,
        inquiryReference: inquiry?.reference ?? null,
        description: `Reply sent to the patient by ${senderName}.`,
        payload: {
          thread_id: threadId,
          channel: thread.channel,
          length: body.length,
          reviewed_by_human: true,
        },
      }),
    )

    return message
  }

  markThreadRead(threadId: UUID) {
    const thread = this.threads.find((t) => t.id === threadId)
    if (thread) thread.unreadCount = 0
  }

  /* ------------------------------------------------------------------ */
  /* Directory aggregates                                                */
  /* ------------------------------------------------------------------ */

  listPatientSummaries(): PatientSummary[] {
    return patients
      .map((patient) => {
        const cases = this.inquiries.filter((i) => i.patientId === patient.id)
        const quotes = cases
          .map((i) => this.quotes.get(i.id))
          .filter((q): q is Quote => Boolean(q) && q!.status === 'APPROVED')

        const sorted = [...cases].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
        const latest = sorted[0] ?? null

        return {
          patient,
          caseCount: cases.length,
          activeCaseCount: cases.filter(
            (i) => i.status !== 'COMPLETED' && i.status !== 'HUMAN_TAKEOVER',
          ).length,
          completedCaseCount: cases.filter((i) => i.status === 'COMPLETED').length,
          lifetimeSavingsSgd: Math.round(
            quotes.reduce((acc, q) => acc + computeTotals(q).savingsSgd, 0),
          ),
          lifetimeValueSgd: Math.round(
            quotes.reduce((acc, q) => acc + computeTotals(q).totalSgd, 0),
          ),
          lastContactAt: latest?.updatedAt ?? null,
          latestStatus: latest?.status ?? null,
          latestInquiryId: latest?.id ?? null,
          procedures: [
            ...new Set(
              cases
                .map((i) => (i.procedureId ? procedureMap.get(i.procedureId)?.name : null))
                .filter((name): name is string => Boolean(name)),
            ),
          ],
        }
      })
      .sort((a, b) => {
        if (!a.lastContactAt) return 1
        if (!b.lastContactAt) return -1
        return new Date(b.lastContactAt).getTime() - new Date(a.lastContactAt).getTime()
      })
  }

  listDoctorSummaries(): DoctorSummary[] {
    return doctors.map((doctor) => {
      const cases = this.inquiries.filter((i) => i.doctorId === doctor.id)
      return {
        doctor,
        hospitalName: hospitalMap.get(doctor.hospitalId)?.name ?? 'Unassigned',
        assignedCaseCount: cases.length,
        pendingReviewCount: cases.filter((i) => i.status === 'HOSPITAL_REVIEW_REQUIRED').length,
        clearedCount: cases.filter((i) => i.status === 'QUOTE_APPROVED').length,
        completedCount: cases.filter((i) => i.status === 'COMPLETED').length,
      }
    })
  }

  listQuoteSummaries(): QuoteSummary[] {
    return this.inquiries
      .map((inquiry) => {
        const quote = this.quotes.get(inquiry.id)
        if (!quote) return null

        const totals = computeTotals(quote)
        return {
          quoteId: quote.id,
          inquiryId: inquiry.id,
          reference: inquiry.reference,
          patientName: patientMap.get(inquiry.patientId)?.fullName ?? 'Unknown',
          procedureName: inquiry.procedureId
            ? (procedureMap.get(inquiry.procedureId)?.name ?? 'Unmapped')
            : 'Unmapped',
          hospitalName: hospitalMap.get(inquiry.hospitalId)?.name ?? '—',
          status: quote.status,
          inquiryStatus: inquiry.status,
          totalSgd: totals.totalSgd,
          totalIdr: totals.totalIdr,
          sgBenchmarkSgd: totals.sgBenchmarkSgd,
          savingsSgd: totals.savingsSgd,
          savingsPct: totals.savingsPct,
          lineItemCount: quote.lineItems.length,
          approvedByName: quote.approvedByName,
          approvedAt: quote.approvedAt,
          validUntil: quote.validUntil,
          itineraryToken: inquiry.itineraryToken,
          createdAt: quote.createdAt,
        } satisfies QuoteSummary
      })
      .filter((row): row is QuoteSummary => row !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  /* ------------------------------------------------------------------ */
  /* Catalogue pricing (hospital-managed)                                */
  /* ------------------------------------------------------------------ */

  /**
   * Catalogue rows are shared references, so mutating in place updates every
   * lookup map. New quotes pick the change up immediately; quotes already
   * drafted keep the price they were built with.
   */
  updateProcedurePricing(
    id: UUID,
    patch: Partial<Pick<Procedure, 'batamPriceSgd' | 'sgBenchmarkSgd' | 'requiresDoctorReview'>>,
  ): Procedure | null {
    const procedure = procedureMap.get(id)
    if (!procedure) return null
    Object.assign(procedure, patch)
    return { ...procedure }
  }

  updateHotelRate(id: UUID, nightlyRateSgd: number): Hotel | null {
    const hotel = hotelMap.get(id)
    if (!hotel) return null
    hotel.nightlyRateSgd = nightlyRateSgd
    return { ...hotel }
  }

  updateTransportPrice(id: UUID, priceSgd: number): GroundTransport | null {
    const transport = transportMap.get(id)
    if (!transport) return null
    transport.priceSgd = priceSgd
    return { ...transport }
  }

  updateFerryPrice(id: UUID, priceSgd: number): FerryRoute | null {
    const ferry = ferryMap.get(id)
    if (!ferry) return null
    ferry.priceSgd = priceSgd
    return { ...ferry }
  }

  /* ------------------------------------------------------------------ */
  /* Demo hooks                                                          */
  /* ------------------------------------------------------------------ */

  /** Injects a brand-new inbound inquiry, as the webhook would. */
  createInquiry(params: {
    patientId: UUID
    hospitalId: UUID
    channel: Inquiry['channel']
    sourceMessage: string
  }): Inquiry {
    const inquiry: Inquiry = {
      id: uuid(),
      reference: nextReference(),
      patientId: params.patientId,
      hospitalId: params.hospitalId,
      doctorId: null,
      procedureId: null,
      status: 'NEW_INQUIRY',
      priority: 'HIGH',
      channel: params.channel,
      sourceMessage: params.sourceMessage,
      assignedToName: null,
      itineraryToken: null,
      slaDueAt: new Date(Date.now() + 90 * 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.inquiries.unshift(inquiry)
    this.emit({ type: 'inquiry.created', payload: { ...inquiry } })
    this.emit({ type: 'kpis.updated', payload: this.getKpis() })

    // Mirror it into the messaging centre so /messages stays consistent.
    const threadId = uuid()
    const patient = patientMap.get(params.patientId)!
    this.threads.unshift({
      id: threadId,
      patientId: params.patientId,
      inquiryId: inquiry.id,
      channel: params.channel,
      subject: 'New inbound enquiry',
      unreadCount: 1,
      lastMessageAt: inquiry.createdAt,
      messages: [
        {
          id: uuid(),
          threadId,
          inquiryId: inquiry.id,
          channel: params.channel,
          direction: 'INBOUND',
          body: params.sourceMessage,
          senderName: patient.fullName,
          status: 'RECEIVED',
          aiSuggestion: null,
          aiSuggestionConfidence: null,
          createdAt: inquiry.createdAt,
        },
      ],
    })

    return { ...inquiry }
  }

  attachExtraction(inquiryId: UUID, extraction: SeededInquiry['extraction']) {
    this.extractions.set(inquiryId, extraction)
    const inquiry = this.inquiries.find((i) => i.id === inquiryId)
    if (!inquiry || !extraction) return

    inquiry.procedureId = extraction.procedureId
    this.touch(inquiry)
  }

  attachQuote(inquiryId: UUID, quote: Quote) {
    this.quotes.set(inquiryId, quote)
    const inquiry = this.inquiries.find((i) => i.id === inquiryId)
    if (inquiry) this.touch(inquiry)
  }

  assignCase(inquiryId: UUID, doctorId: UUID | null, staffName: string) {
    const inquiry = this.inquiries.find((i) => i.id === inquiryId)
    if (!inquiry) return
    inquiry.doctorId = doctorId
    inquiry.assignedToName = staffName
    this.touch(inquiry)
  }

  logActivity(event: ActivityEvent) {
    this.pushActivity(event)
  }

  /** Exposed so the demo can price a bundle without duplicating logic. */
  buildQuoteFor(inquiryId: UUID, procedureId: UUID, doctorId: UUID | null): Quote {
    return buildQuote({ inquiryId, procedureId, doctorId })
  }

  getQuoteTotals(inquiryId: UUID) {
    const quote = this.quotes.get(inquiryId)
    return quote ? computeTotals(quote) : null
  }

  /** Aggregate SGD saved across every approved quote — used by the KPI strip. */
  totalSavings(): number {
    return [...this.quotes.values()]
      .filter((q) => q.status === 'APPROVED')
      .reduce((acc, q) => acc + computeTotals(q).savingsSgd, 0)
  }

  get idrRate() {
    return IDR_PER_SGD
  }

  /** Line-level helper re-exported so callers do not import generators directly. */
  static total = lineTotal
}

export const mockDb = new MockDatabase()

/** Patient directory is static reference data — exposed for pickers/filters. */
export const mockPatients = patients
