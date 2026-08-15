<?php

namespace App\Models;

use App\Models\Concerns\HasCoordinates;
use App\Models\Concerns\HasUuidV4;
use App\Support\Geo;
use Illuminate\Database\Eloquent\Model;

/**
 * Somewhere to eat, walk or look at while you are in Batam.
 *
 * A place is a SUGGESTION and never a quote line. It has no price in SGD, it
 * never enters `draft_lines`, and it cannot move a total or a savings figure —
 * see App\Services\PlaceSuggester and docs/09 D22.
 */
class Place extends Model
{
    use HasCoordinates;
    use HasUuidV4;

    protected $guarded = [];

    protected $casts = [
        'tags' => 'array',
        'price_level' => 'integer',
        'latitude' => 'float',
        'longitude' => 'float',
    ];

    /**
     * The district goes in the search, because place names are not unique.
     *
     * "Moon Batam" is a coin toss; "Moon Nagoya Batam" finds the restaurant.
     * Hotels and hospitals do not need this — their names are distinctive
     * enough on their own — but a one-word warung is not.
     */
    public function searchUrl(): ?string
    {
        $district = trim((string) $this->district);

        // "Batam Kota" already says Batam — no need for "Batam Kota Batam".
        $context = $district === '' || str_contains(mb_strtolower($district), 'batam')
            ? ($district ?: 'Batam')
            : $district.' Batam';

        return Geo::searchUrl((string) $this->name, $context);
    }

    /** Guidebook bands, not amounts. "$$" is a hint; it is not in your quote. */
    public function priceBand(): string
    {
        return match ((int) $this->price_level) {
            0 => 'Free',
            1 => '$',
            2 => '$$',
            3 => '$$$',
            default => '$$$$',
        };
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'category' => $this->category,
            'district' => $this->district,
            'description' => $this->description,
            'priceLevel' => (int) $this->price_level,
            'priceBand' => $this->priceBand(),
            'tags' => $this->tags ?? [],
            'searchUrl' => $this->searchUrl(),
            // Openable proof this place exists, for anyone reviewing the
            // catalogue. Not shown to patients — it is a provenance trail, not
            // a feature.
            'sourceUrl' => $this->sourceUrl(),
            // Where the RECOMMENDATION came from, when a published guide named
            // it. Different from sourceUrl, which is only where the coordinate
            // came from.
            'guideUrl' => $this->guide_url,
        ];
    }
}
