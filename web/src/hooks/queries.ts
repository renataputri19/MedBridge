/**
 * TanStack Query bindings over the REST service layer.
 *
 * Realtime pushes bump `liveRevision` in the Zustand store; `useLiveSync`
 * translates that into targeted cache invalidations so the UI stays current
 * without polling.
 */
import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query'
import {
  activityApi,
  catalogueApi,
  inquiriesApi,
  itineraryApi,
  partnersApi,
  patientsApi,
  pricingApi,
  quotesApi,
  quotesDirectoryApi,
  saasApi,
  type InquiryFilters,
} from '@/services/api'
import { useAppStore } from '@/store/useAppStore'
import type {
  DoctorReviewDecision,
  InquiryDetail,
  InquiryStatus,
  PartnerType,
  Procedure,
  QuoteLineItem,
  UUID,
} from '@/types'

export const queryKeys = {
  inquiries: (filters: InquiryFilters = {}) => ['inquiries', filters] as const,
  inquiry: (id: UUID) => ['inquiries', id] as const,
  activity: (limit: number) => ['activity', limit] as const,
  itinerary: (token: string) => ['itinerary', token] as const,
  catalogue: (kind: string) => ['catalogue', kind] as const,
  patients: ['patients'] as const,
  quotes: ['quotes'] as const,
  partners: (type: string) => ['partners', type] as const,
  partner: (type: string, id: UUID) => ['partners', type, id] as const,
  reviewQueue: (hospitalId: UUID) => ['partners', 'hospital', hospitalId, 'reviews'] as const,
  saas: ['saas', 'summary'] as const,
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

export function useInquiries(filters: InquiryFilters = {}) {
  return useQuery({
    queryKey: queryKeys.inquiries(filters),
    queryFn: () => inquiriesApi.list(filters),
    staleTime: 10_000,
  })
}

export function useInquiry(id: UUID | undefined) {
  return useQuery({
    queryKey: queryKeys.inquiry(id ?? ''),
    queryFn: () => inquiriesApi.get(id!),
    enabled: Boolean(id),
  })
}

export function useActivity(limit = 100) {
  return useQuery({
    queryKey: queryKeys.activity(limit),
    queryFn: () => activityApi.list(limit),
    staleTime: 5_000,
  })
}

export function useItinerary(token: string | undefined) {
  return useQuery({
    queryKey: queryKeys.itinerary(token ?? ''),
    queryFn: () => itineraryApi.getByToken(token!),
    enabled: Boolean(token),
    retry: false,
  })
}

/** The patient accepting their pass, in-app. */
export function useConfirmItinerary(token: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => itineraryApi.confirm(token!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.itinerary(token ?? '') })
    },
  })
}

export function useProcedures() {
  return useQuery({
    queryKey: queryKeys.catalogue('procedures'),
    queryFn: () => catalogueApi.procedures(),
    staleTime: Infinity,
  })
}

export function useHospitals() {
  return useQuery({
    queryKey: queryKeys.catalogue('hospitals'),
    queryFn: () => catalogueApi.hospitals(),
    staleTime: Infinity,
  })
}

export function useDoctors() {
  return useQuery({
    queryKey: queryKeys.catalogue('doctors'),
    queryFn: () => catalogueApi.doctors(),
    staleTime: Infinity,
  })
}

export function useHotels() {
  return useQuery({
    queryKey: queryKeys.catalogue('hotels'),
    queryFn: () => catalogueApi.hotels(),
    staleTime: Infinity,
  })
}

export function useFerryRoutes() {
  return useQuery({
    queryKey: queryKeys.catalogue('ferries'),
    queryFn: () => catalogueApi.ferries(),
    staleTime: Infinity,
  })
}

export function useGroundTransport() {
  return useQuery({
    queryKey: queryKeys.catalogue('transport'),
    queryFn: () => catalogueApi.transport(),
    staleTime: Infinity,
  })
}

/* -------------------------------------------------------------------------- */
/* Partner portals                                                             */
/* -------------------------------------------------------------------------- */

/** The picker for one supplier type — stands in for a partner login. */
export function usePartners(type: PartnerType) {
  return useQuery({
    queryKey: queryKeys.partners(type),
    queryFn: () => partnersApi.list(type),
    staleTime: 30_000,
  })
}

export function usePartner(type: PartnerType, id: UUID | undefined) {
  return useQuery({
    queryKey: queryKeys.partner(type, id ?? ''),
    queryFn: () => partnersApi.get(type, id!),
    enabled: Boolean(id),
    retry: false,
  })
}

/**
 * Partner self-service writes.
 *
 * All of them invalidate the partner's own portal AND the shared catalogue,
 * because a price a hospital sets is the price the patient chat quotes — the
 * two views must not disagree about what a procedure costs.
 */
function usePartnerInvalidator(type: PartnerType, id: UUID | undefined) {
  const queryClient = useQueryClient()

  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.partners(type) })
    if (id) void queryClient.invalidateQueries({ queryKey: queryKeys.partner(type, id) })
    void queryClient.invalidateQueries({ queryKey: ['catalogue'] })
    void queryClient.invalidateQueries({ queryKey: ['activity'] })
  }
}

export function useUpdatePartnerProcedure(hospitalId: UUID | undefined) {
  const invalidate = usePartnerInvalidator('hospital', hospitalId)

  return useMutation({
    mutationFn: ({
      procedureId,
      patch,
    }: {
      procedureId: UUID
      patch: Parameters<typeof partnersApi.updateProcedure>[2]
    }) => partnersApi.updateProcedure(hospitalId!, procedureId, patch),
    onSuccess: invalidate,
  })
}

export function useUpdatePartnerDoctor(hospitalId: UUID | undefined) {
  const invalidate = usePartnerInvalidator('hospital', hospitalId)

  return useMutation({
    mutationFn: ({
      doctorId,
      patch,
    }: {
      doctorId: UUID
      patch: { consultationFeeSgd?: number; yearsExperience?: number }
    }) => partnersApi.updateDoctor(hospitalId!, doctorId, patch),
    onSuccess: invalidate,
  })
}

/**
 * The single rate a hotel, ferry or transfer partner owns.
 *
 * The three endpoints return three different row shapes, and the caller only
 * ever needs to know the write succeeded — so the result is deliberately
 * discarded rather than widened into a union nobody reads.
 */
export function useUpdatePartnerRate(type: PartnerType, id: UUID | undefined) {
  const invalidate = usePartnerInvalidator(type, id)

  return useMutation<void, Error, number>({
    mutationFn: async (value: number) => {
      if (type === 'hotel') await partnersApi.updateHotelRate(id!, value)
      else if (type === 'ferry') await partnersApi.updateFerryFare(id!, value)
      else await partnersApi.updateTransportPrice(id!, value)
    },
    onSuccess: invalidate,
  })
}

/** The marketplace's own P&L. Entitlement, never settled cash. */
export function useSaasSummary() {
  return useQuery({
    queryKey: queryKeys.saas,
    queryFn: () => saasApi.summary(),
    staleTime: 30_000,
  })
}

/** Restaurants, malls, parks, beaches and sights. Never priced, never quoted. */
export function usePlaces() {
  return useQuery({
    queryKey: queryKeys.catalogue('places'),
    queryFn: () => catalogueApi.places(),
    staleTime: Infinity,
  })
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

/** Invalidates every list/aggregate touched by a write to one inquiry. */
function useInquiryInvalidator() {
  const queryClient = useQueryClient()
  return (inquiryId?: UUID) => {
    void queryClient.invalidateQueries({ queryKey: ['inquiries'] })
    void queryClient.invalidateQueries({ queryKey: ['activity'] })
    // The dashboard's four figures are derived from quotes, so any write to a
    // case can move them.
    void queryClient.invalidateQueries({ queryKey: queryKeys.saas })
    void queryClient.invalidateQueries({ queryKey: queryKeys.quotes })
    if (inquiryId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inquiry(inquiryId) })
    }
  }
}

export function useSetInquiryStatus(
  options?: UseMutationOptions<unknown, Error, { id: UUID; status: InquiryStatus; note?: string }>,
) {
  const invalidate = useInquiryInvalidator()
  return useMutation({
    mutationFn: ({ id, status, note }: { id: UUID; status: InquiryStatus; note?: string }) =>
      inquiriesApi.setStatus(id, status, note),
    ...options,
    onSuccess: (...args) => {
      invalidate(args[1].id)
      options?.onSuccess?.(...args)
    },
  })
}

export function useUpdateLineItem(inquiryId: UUID) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      lineItemId,
      patch,
    }: {
      lineItemId: UUID
      patch: Partial<Pick<QuoteLineItem, 'quantity' | 'unitPriceSgd' | 'label' | 'detail'>>
    }) => quotesApi.updateLineItem(inquiryId, lineItemId, patch),
    onSuccess: (quote) => {
      // Patch the detail cache in place — avoids a full refetch while editing.
      queryClient.setQueryData<InquiryDetail>(queryKeys.inquiry(inquiryId), (previous) =>
        previous ? { ...previous, quote } : previous,
      )
    },
  })
}

export function useAddLineItem(inquiryId: UUID) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (item: Omit<QuoteLineItem, 'id' | 'quoteId'>) =>
      quotesApi.addLineItem(inquiryId, item),
    onSuccess: (quote) => {
      queryClient.setQueryData<InquiryDetail>(queryKeys.inquiry(inquiryId), (previous) =>
        previous ? { ...previous, quote } : previous,
      )
    },
  })
}

export function useRemoveLineItem(inquiryId: UUID) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (lineItemId: UUID) => quotesApi.removeLineItem(inquiryId, lineItemId),
    onSuccess: (quote) => {
      queryClient.setQueryData<InquiryDetail>(queryKeys.inquiry(inquiryId), (previous) =>
        previous ? { ...previous, quote } : previous,
      )
    },
  })
}

export function useApproveQuote(
  inquiryId: UUID,
  options?: UseMutationOptions<InquiryDetail, Error, string>,
) {
  const invalidate = useInquiryInvalidator()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (approvedByName: string) => quotesApi.approve(inquiryId, approvedByName),
    ...options,
    onSuccess: (...args) => {
      queryClient.setQueryData(queryKeys.inquiry(inquiryId), args[0])
      invalidate(inquiryId)
      options?.onSuccess?.(...args)
    },
  })
}

export function useRejectQuote(inquiryId: UUID) {
  const invalidate = useInquiryInvalidator()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason: string) => quotesApi.reject(inquiryId, reason),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.inquiry(inquiryId), detail)
      invalidate(inquiryId)
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Clinical sign-off — the hospital's, not operations'                         */
/* -------------------------------------------------------------------------- */

export function useReviewQueue(hospitalId: UUID | undefined) {
  return useQuery({
    queryKey: queryKeys.reviewQueue(hospitalId ?? ''),
    queryFn: () => partnersApi.reviewQueue(hospitalId!),
    enabled: Boolean(hospitalId),
    retry: false,
  })
}

export function useSubmitReview(hospitalId: UUID) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      reference,
      ...body
    }: {
      reference: string
      decision: DoctorReviewDecision
      clinicalNotes: string
      doctorId?: UUID | null
      requiredPreOpTests?: string[]
    }) => partnersApi.submitReview(hospitalId, reference, body),
    onSuccess: () => {
      // The queue shrinks, and the case moves on — so the pipeline and the
      // portal's own counts both go stale.
      void queryClient.invalidateQueries({ queryKey: queryKeys.reviewQueue(hospitalId) })
      void queryClient.invalidateQueries({ queryKey: ['partner'] })
      void queryClient.invalidateQueries({ queryKey: ['inquiries'] })
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Directories                                                                 */
/* -------------------------------------------------------------------------- */

export function usePatientSummaries() {
  return useQuery({
    queryKey: queryKeys.patients,
    queryFn: () => patientsApi.list(),
    staleTime: 15_000,
  })
}

export function useQuoteSummaries() {
  return useQuery({
    queryKey: queryKeys.quotes,
    queryFn: () => quotesDirectoryApi.list(),
    staleTime: 15_000,
  })
}

/* -------------------------------------------------------------------------- */
/* Catalogue pricing                                                           */
/* -------------------------------------------------------------------------- */

/** Any price change invalidates the catalogue and everything derived from it. */
function usePricingInvalidator() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['catalogue'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.quotes })
    void queryClient.invalidateQueries({ queryKey: queryKeys.saas })
  }
}

export function useUpdateProcedurePricing() {
  const invalidate = usePricingInvalidator()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: UUID
      patch: Partial<Pick<Procedure, 'batamPriceSgd' | 'sgBenchmarkSgd' | 'requiresDoctorReview'>>
    }) => pricingApi.updateProcedure(id, patch),
    onSuccess: invalidate,
  })
}

export function useUpdateHotelRate() {
  const invalidate = usePricingInvalidator()
  return useMutation({
    mutationFn: ({ id, nightlyRateSgd }: { id: UUID; nightlyRateSgd: number }) =>
      pricingApi.updateHotel(id, nightlyRateSgd),
    onSuccess: invalidate,
  })
}

export function useUpdateTransportPrice() {
  const invalidate = usePricingInvalidator()
  return useMutation({
    mutationFn: ({ id, priceSgd }: { id: UUID; priceSgd: number }) =>
      pricingApi.updateTransport(id, priceSgd),
    onSuccess: invalidate,
  })
}

export function useUpdateFerryPrice() {
  const invalidate = usePricingInvalidator()
  return useMutation({
    mutationFn: ({ id, priceSgd }: { id: UUID; priceSgd: number }) =>
      pricingApi.updateFerry(id, priceSgd),
    onSuccess: invalidate,
  })
}

/* -------------------------------------------------------------------------- */
/* Realtime → cache bridge                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Mounted once at the app root. Opens the realtime connection and invalidates
 * server state whenever a push lands, debounced so a burst of demo events does
 * not trigger a refetch storm.
 */
export function useLiveSync() {
  const queryClient = useQueryClient()
  const connect = useAppStore((state) => state.connect)
  const disconnect = useAppStore((state) => state.disconnect)
  const liveRevision = useAppStore((state) => state.liveRevision)

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  useEffect(() => {
    if (liveRevision === 0) return

    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['inquiries'] })
      void queryClient.invalidateQueries({ queryKey: ['activity'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.saas })
    }, 250)

    return () => clearTimeout(timer)
  }, [liveRevision, queryClient])
}
