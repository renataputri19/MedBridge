<?php

namespace App\Models\Concerns;

use App\Support\Geo;

/**
 * A row that sits somewhere on the map.
 *
 * Shared by hospitals, hotels and places so "how far is this from that" has one
 * implementation. Distance is always between a pair — nothing here stores a
 * distance, because a stored distance can only ever be right about one pair.
 */
trait HasCoordinates
{
    public function hasCoordinates(): bool
    {
        return $this->latitude !== null && $this->longitude !== null;
    }

    /**
     * Kilometres from this row to another, or null when either lacks a fix.
     *
     * Null is a real answer: it means "we do not know", and every caller
     * renders that as silence rather than as 0.0 km, which would read as
     * "next door".
     */
    public function distanceKmTo(?object $other): ?float
    {
        if (! $this->hasCoordinates() || ! $other || ! method_exists($other, 'hasCoordinates') || ! $other->hasCoordinates()) {
            return null;
        }

        return Geo::roundKm(Geo::haversineKm(
            (float) $this->latitude,
            (float) $this->longitude,
            (float) $other->latitude,
            (float) $other->longitude,
        ));
    }

    /**
     * Where this row's identity and position came from, e.g. `node/736609690`.
     *
     * Openable at openstreetmap.org/node/736609690. It exists so a reviewer can
     * check a place is real without trusting this repository — which is the
     * check that was missing when the catalogue held businesses that were not.
     */
    public function sourceUrl(): ?string
    {
        return $this->osm_ref
            ? 'https://www.openstreetmap.org/'.ltrim((string) $this->osm_ref, '/')
            : null;
    }

    /**
     * A Google search for this place, so the patient can check it themselves.
     *
     * By name, never by pin — see Geo::searchUrl(). Google finds the business,
     * shows the live rating and reviews, and offers directions; we store none
     * of it.
     */
    public function searchUrl(): ?string
    {
        return Geo::searchUrl((string) ($this->name ?? ''));
    }
}
