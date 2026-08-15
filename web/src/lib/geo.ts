/**
 * Distance and map links — the mirror of `App\Support\Geo` in PHP.
 *
 * The backend is authoritative: every distance the patient sees in the chat is
 * computed server-side and arrives on the payload. This file exists for the
 * offline mock, which has to describe the same world the database does (the
 * fixed UUIDs in `mock/seed.ts` are the other half of that promise).
 *
 * Two rules carried across from the backend copy:
 *
 *  1. A distance is a fact about a PAIR of places, so it is never stored. The
 *     hotel catalogue used to hold one `distanceToHospitalKm` scalar, which was
 *     wrong for two of the three hospitals a patient can choose.
 *
 *  2. We link BY NAME, not by pin. There is no Google Maps URL in this system.
 *     A coordinate link drops a pin at whatever we stored, and a building
 *     centroid two hundred metres out lands the patient in the car park next
 *     door. A plain Google search for "Best Western Panbil Batam" resolves to
 *     the business, with its live rating, reviews and directions — none of
 *     which we store.
 *
 *     Coordinates are for ARITHMETIC (distance), never for navigation.
 */

export interface Coordinates {
  latitude: number | null
  longitude: number | null
}

const EARTH_RADIUS_KM = 6371.0088

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in kilometres, rounded to the precision we can justify. */
export function haversineKm(a: Coordinates, b: Coordinates): number | null {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) {
    // "We don't know" — rendered as silence rather than as 0 km, which would
    // read as "next door".
    return null
  }

  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2

  // Nearest half-kilometre — the precision an OSM building centroid justifies.
  const km = EARTH_RADIUS_KM * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
  return Math.round(km * 2) / 2
}

/**
 * "~4 km", "~4.5 km" — an approximation, rendered as one.
 *
 * The tilde is not decoration. These distances come from building centroids
 * accurate to a couple of hundred metres, and "3.8 km" would claim otherwise.
 */
export function formatKm(km: number | null | undefined): string | null {
  if (km === null || km === undefined) return null
  return `~${Number(km.toFixed(1))} km`
}

/**
 * A Google search for the place, by name. Mirrors `Geo::searchUrl()` in PHP.
 *
 * Deliberately not a Maps URL: a pin goes exactly where our coordinate says,
 * and ours are good to a few hundred metres. Google resolves the name.
 */
export function searchUrl(name: string, context = 'Batam'): string | null {
  const trimmed = name.replace(/\s*\(.*?\)\s*/g, ' ').trim()
  if (!trimmed) return null

  const query = trimmed.toLowerCase().includes(context.toLowerCase())
    ? trimmed
    : `${trimmed} ${context}`

  return `https://www.google.com/search?${new URLSearchParams({ q: query }).toString()}`
}
