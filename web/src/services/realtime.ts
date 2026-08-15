/**
 * Realtime transport for operational events.
 *
 * Production uses SSE (or WebSocket) against the backend, which is the only
 * component that talks to the Hermes agent. Frames arriving here are already
 * structured `RealtimeEvent` records — never raw model text.
 *
 * In mock mode the in-memory database plays the role of the event source, so
 * the UI wiring is identical either way.
 */
import { API_BASE_URL, REALTIME_TRANSPORT } from '@/lib/constants'
import { mockDb } from '@/mock/db'
import type { RealtimeEvent } from '@/types'

export type RealtimeStatus = 'connecting' | 'live' | 'offline'

type EventListener = (event: RealtimeEvent) => void
type StatusListener = (status: RealtimeStatus) => void

class RealtimeClient {
  private eventListeners = new Set<EventListener>()
  private statusListeners = new Set<StatusListener>()
  private source: EventSource | WebSocket | null = null
  private unsubscribeMock: (() => void) | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private _status: RealtimeStatus = 'offline'

  get status() {
    return this._status
  }

  private setStatus(status: RealtimeStatus) {
    if (this._status === status) return
    this._status = status
    for (const listener of this.statusListeners) listener(status)
  }

  private dispatch(event: RealtimeEvent) {
    for (const listener of this.eventListeners) listener(event)
  }

  connect() {
    if (this.source || this.unsubscribeMock) return

    if (REALTIME_TRANSPORT === 'mock') {
      this.unsubscribeMock = mockDb.subscribe((event) => this.dispatch(event))
      this.setStatus('live')
      return
    }

    this.setStatus('connecting')

    try {
      if (REALTIME_TRANSPORT === 'ws') {
        const url = `${location.origin.replace(/^http/, 'ws')}${API_BASE_URL}/stream`
        const ws = new WebSocket(url)
        ws.onopen = () => {
          this.reconnectAttempts = 0
          this.setStatus('live')
        }
        ws.onmessage = (message) => this.handleFrame(message.data)
        ws.onerror = () => this.setStatus('offline')
        ws.onclose = () => this.scheduleReconnect()
        this.source = ws
      } else {
        const es = new EventSource(`${API_BASE_URL}/stream`, { withCredentials: true })
        es.onopen = () => {
          this.reconnectAttempts = 0
          this.setStatus('live')
        }
        es.onmessage = (message) => this.handleFrame(message.data)
        es.onerror = () => {
          this.setStatus('offline')
          es.close()
          this.source = null
          this.scheduleReconnect()
        }
        this.source = es
      }
    } catch (error) {
      console.warn('[MedBridge] realtime connect failed, falling back to mock bus.', error)
      this.unsubscribeMock = mockDb.subscribe((event) => this.dispatch(event))
      this.setStatus('live')
    }
  }

  private handleFrame(raw: string) {
    try {
      const parsed = JSON.parse(raw) as RealtimeEvent
      this.dispatch(parsed)
    } catch {
      // A malformed frame must never break the stream.
      console.warn('[MedBridge] discarded malformed realtime frame.')
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return

    // Exponential backoff, capped at 30s.
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000)
    this.reconnectAttempts += 1

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.source = null
      this.connect()
    }, delay)
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.source instanceof WebSocket) this.source.close()
    if (this.source instanceof EventSource) this.source.close()
    this.source = null
    this.unsubscribeMock?.()
    this.unsubscribeMock = null
    this.setStatus('offline')
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    listener(this._status)
    return () => this.statusListeners.delete(listener)
  }
}

export const realtime = new RealtimeClient()
