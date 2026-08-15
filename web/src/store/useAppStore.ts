/**
 * Global UI state: the realtime connection, the live event stream and operator
 * identity.
 *
 * Server data lives in TanStack Query — this store only holds state that is
 * genuinely client-side or push-driven.
 *
 * It used to also drive a scripted "live demo": a timed sequence that invented
 * an inquiry, walked it through the pipeline and played chimes. The real
 * patient chat at `/` now produces the same pipeline from an actual visitor, so
 * the simulation had become a second, fictional source of cases sitting beside
 * the real one — and the two were indistinguishable on the board.
 */
import { create } from 'zustand'
import { realtime, type RealtimeStatus } from '@/services/realtime'
import type { ActivityEvent, RealtimeEvent } from '@/types'

const MAX_FEED = 120

interface AppState {
  /* Operator identity — replaced by the real session when auth lands. */
  operatorName: string
  hospitalName: string

  /* Realtime */
  realtimeStatus: RealtimeStatus
  feed: ActivityEvent[]
  /** Bumped whenever a push arrives so queries can invalidate cheaply. */
  liveRevision: number

  /* Actions */
  connect: () => void
  disconnect: () => void
  setOperator: (operatorName: string, hospitalName: string) => void
  pushFeed: (event: ActivityEvent) => void
}

let unsubscribeEvents: (() => void) | null = null
let unsubscribeStatus: (() => void) | null = null

export const useAppStore = create<AppState>((set, get) => ({
  operatorName: 'Nadia Putri',
  /*
   * MedBridge's own portal, not a hospital's. Naming the operator rather than a
   * facility is the accurate framing: hospitals are one of four partner types,
   * each with their own portal, and this portal coordinates across all of them.
   */
  hospitalName: 'MedBridge Pass',

  realtimeStatus: 'offline',
  feed: [],
  liveRevision: 0,

  connect: () => {
    if (unsubscribeEvents) return

    unsubscribeStatus = realtime.onStatus((realtimeStatus) => set({ realtimeStatus }))

    unsubscribeEvents = realtime.onEvent((event: RealtimeEvent) => {
      if (event.type === 'activity') {
        get().pushFeed(event.payload)
      }
      // Any push invalidates server state; components watch this counter.
      set((state) => ({ liveRevision: state.liveRevision + 1 }))
    })

    realtime.connect()
  },

  disconnect: () => {
    unsubscribeEvents?.()
    unsubscribeStatus?.()
    unsubscribeEvents = null
    unsubscribeStatus = null
    realtime.disconnect()
  },

  setOperator: (operatorName, hospitalName) => set({ operatorName, hospitalName }),

  pushFeed: (event) =>
    set((state) => ({ feed: [event, ...state.feed].slice(0, MAX_FEED) })),
}))
