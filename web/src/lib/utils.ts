import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * RFC-4122 v4 UUID. Uses the platform CSPRNG when available and falls back to
 * a Math.random implementation for non-secure contexts (file://, older WebViews).
 *
 * Every identifier in the mock layer is produced here — the system has no
 * auto-incrementing integer keys.
 */
export function uuid(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()

  const bytes = new Uint8Array(16)
  if (c?.getRandomValues) {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  // Set version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuidV4(value: string): boolean {
  return UUID_V4.test(value)
}

/**
 * Opaque, URL-safe token for patient-facing routes. Deliberately *not* a UUID
 * so that a leaked itinerary link can never be replayed against the API as a
 * database key, and carries no PII.
 */
export function itineraryToken(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(24)
  const c = globalThis.crypto
  if (c?.getRandomValues) {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  return `mbp_${body}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Deterministic pick so seeded mock data is stable across reloads. */
export function pick<T>(items: readonly T[], index: number): T {
  return items[index % items.length]
}

export function randomOf<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

export function sum(values: number[]): number {
  return values.reduce((acc, n) => acc + n, 0)
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/** Mask a phone number down to country code + last 3 digits. */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 5) return '•••'
  return `+${digits.slice(0, 2)} •••• ${digits.slice(-3)}`
}

export function maskEmail(raw: string): string {
  const [local, domain] = raw.split('@')
  if (!domain) return '•••'
  const head = local.slice(0, 2)
  return `${head}${'•'.repeat(Math.max(local.length - 2, 2))}@${domain}`
}
