<?php

namespace App\Support;

/**
 * Distance and outbound map links.
 *
 * TWO RULES LIVE HERE, and both are the reason this file exists rather than a
 * column on a table.
 *
 * 1. DISTANCE IS COMPUTED, NEVER STORED. `hotels.distance_to_hospital_km` used
 *    to be a single scalar, which was already wrong the day the patient gained
 *    a choice of three hospitals: the same hotel showed the same distance
 *    whichever facility they picked. A distance is a fact about a *pair* of
 *    places, so it is derived from coordinates at read time.
 *
 * 2. WE LINK BY NAME, NOT BY PIN. There is no Google Maps URL anywhere in this
 *    system any more. A coordinate link drops a pin at whatever we stored, and
 *    a building centroid that is 200 m out lands the patient in the car park
 *    next door — which is precisely what happened, twice, in review.
 *
 *    A plain Google search for "Best Western Panbil Batam" resolves to the
 *    business itself, with its live rating, reviews, hours and directions,
 *    because that is the problem Google already solved. Names are robust where
 *    coordinates are brittle: a name has to be very wrong to find nothing,
 *    while a coordinate only has to be slightly wrong to be confidently wrong.
 *
 *    Coordinates still exist — they are how distances are computed — but they
 *    are used for ARITHMETIC, never for navigation.
 */
final class Geo
{
    /** Mean Earth radius, kilometres. */
    private const EARTH_RADIUS_KM = 6371.0088;

    /**
     * Great-circle distance between two points, in kilometres.
     *
     * Batam is a 15 km island and every pair we measure sits inside it, so the
     * spherical approximation is accurate to a few metres here — far below the
     * precision of the coordinates themselves.
     */
    public static function haversineKm(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);

        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;

        return self::EARTH_RADIUS_KM * 2 * asin(min(1.0, sqrt($a)));
    }

    /**
     * Rounded to the nearest half-kilometre, because that is the precision our
     * coordinates actually justify.
     *
     * These are building centroids from OpenStreetMap, good to a hundred metres
     * or two. Printing "3.8 km" claims a hundred-metre accuracy we do not have;
     * "~4 km" says the true thing, and it is also the only part of the number a
     * patient uses — near, or a drive.
     */
    public static function roundKm(float $km): float
    {
        return round($km * 2) / 2;
    }

    /**
     * A Google search for the place, by name.
     *
     * Deliberately a search and NOT a Maps URL. We used to build
     * `maps/search/?api=1&query=<lat>,<lon>`, which drops a pin exactly where
     * our coordinate says — so a centroid a couple of hundred metres out put
     * the patient in a neighbouring industrial lot, looking at factories and
     * wondering what else we had got wrong.
     *
     * Searching "Best Western Premier Panbil Batam" instead hands the problem
     * to the system that is good at it. Google resolves the business, shows its
     * live rating, reviews, photos, hours and a Directions button, and none of
     * that is stored, cached or mirrored on our side — which keeps us clear of
     * the Maps Platform terms as well.
     */
    public static function searchUrl(?string $name, string $context = 'Batam'): ?string
    {
        $name = trim((string) $name);

        if ($name === '') {
            return null;
        }

        // Drop a parenthetical expansion — "RSBP Batam (Rumah Sakit Badan
        // Pengusahaan)" searches better as "RSBP Batam".
        $name = trim(preg_replace('/\s*\(.*?\)\s*/u', ' ', $name) ?? $name);

        $query = str_contains(mb_strtolower($name), mb_strtolower($context))
            ? $name
            : $name.' '.$context;

        return 'https://www.google.com/search?'.http_build_query(['q' => $query]);
    }
}
