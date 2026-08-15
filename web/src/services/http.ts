/**
 * Thin REST transport.
 *
 * SECURITY: this is the ONLY way the frontend reaches the outside world, and it
 * only ever speaks to the MedBridge backend. There is no LLM SDK, no model
 * endpoint and no API key in this bundle — the Hermes agent lives entirely
 * behind the backend, which returns structured JSON.
 */
import { API_BASE_URL, API_TIMEOUT_MS, USE_MOCKS } from '@/lib/constants'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Raised when the backend is unreachable, so callers can fall back to mocks. */
export class ApiUnavailableError extends Error {
  constructor(readonly cause?: unknown) {
    super('MedBridge API unavailable')
    this.name = 'ApiUnavailableError'
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  query?: Record<string, string | number | boolean | undefined | null>
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE_URL}${path}`
  if (!query) return url

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value))
    }
  }

  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query } = options

  // Timeout guard — an unreachable backend must fail fast so the offline
  // fallback engages instead of leaving the UI spinning.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    const response = await fetch(buildUrl(path, query), {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    if (!response.ok) {
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        payload = await response.text().catch(() => undefined)
      }
      throw new ApiError(
        `Request failed: ${method} ${path}`,
        response.status,
        payload,
      )
    }

    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  } catch (error) {
    // A real HTTP error (4xx/5xx) is a genuine backend response — surface it.
    if (error instanceof ApiError) throw error
    // Network failure, DNS failure, CORS or timeout — fall back to mocks.
    throw new ApiUnavailableError(error)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Runs a live request and falls back to the offline mock generator when the
 * backend cannot be reached. `VITE_USE_MOCKS=true` skips the network entirely,
 * which is what the hackathon demo runs on.
 */
export async function withFallback<T>(
  live: () => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  if (USE_MOCKS) return fallback()

  try {
    return await live()
  } catch (error) {
    if (error instanceof ApiUnavailableError) {
      console.warn('[MedBridge] API unreachable — serving offline mock data.')
      return fallback()
    }
    throw error
  }
}
