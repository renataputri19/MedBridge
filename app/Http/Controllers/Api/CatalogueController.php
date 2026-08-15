<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Doctor;
use App\Models\FerryRoute;
use App\Models\GroundTransport;
use App\Models\Hospital;
use App\Models\Hotel;
use App\Models\Place;
use App\Models\Procedure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The hospital-managed catalogue.
 *
 * PRICE EDITS APPLY TO NEW QUOTES ONLY. Nothing here touches quote_line_items,
 * which store the price they were built with. Repricing a bundle a patient has
 * already received is indefensible, so the write path simply does not exist
 * (docs/09 D8).
 */
class CatalogueController extends Controller
{
    public function hospitals(): JsonResponse
    {
        return response()->json(Hospital::orderBy('name')->get()->map->toApi()->values());
    }

    public function doctors(): JsonResponse
    {
        return response()->json(Doctor::orderBy('full_name')->get()->map->toApi()->values());
    }

    public function procedures(): JsonResponse
    {
        return response()->json(Procedure::orderBy('name')->get()->map->toApi()->values());
    }

    public function ferryRoutes(): JsonResponse
    {
        return response()->json(FerryRoute::orderBy('departure_time')->get()->map->toApi()->values());
    }

    public function hotels(): JsonResponse
    {
        return response()->json(Hotel::orderBy('nightly_rate_sgd')->get()->map->toApi()->values());
    }

    public function groundTransport(): JsonResponse
    {
        return response()->json(GroundTransport::orderBy('price_sgd')->get()->map->toApi()->values());
    }

    /**
     * Places — restaurants, malls, parks, beaches and sights.
     *
     * READ-ONLY, and there is no sibling `updatePlace()` below on purpose. The
     * other catalogue rows have a price to edit; a place has a `price_level`
     * band and no amount, because the moment staff can type a number into one,
     * a place has a price, and a thing with a price ends up in a bundle. This
     * endpoint exists so the portal can SEE what patients are shown, not so it
     * can put a figure on it (docs/09 D22).
     */
    public function places(): JsonResponse
    {
        return response()->json(
            Place::orderBy('category')->orderBy('name')->get()->map->toApi()->values()
        );
    }

    public function updateProcedure(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'batamPriceSgd' => ['nullable', 'numeric', 'min:0'],
            'sgBenchmarkSgd' => ['nullable', 'numeric', 'min:0'],
            'requiresDoctorReview' => ['nullable', 'boolean'],
        ]);

        $procedure = Procedure::whereKey($id)->firstOr(fn () => abort(404, 'Procedure not found.'));

        $procedure->update(array_filter([
            'batam_price_sgd' => $data['batamPriceSgd'] ?? null,
            'sg_benchmark_sgd' => $data['sgBenchmarkSgd'] ?? null,
            'requires_doctor_review' => $data['requiresDoctorReview'] ?? null,
        ], fn ($v) => $v !== null));

        return response()->json($procedure->fresh()->toApi());
    }

    public function updateHotel(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['nightlyRateSgd' => ['required', 'numeric', 'min:0']]);
        $hotel = Hotel::whereKey($id)->firstOr(fn () => abort(404, 'Hotel not found.'));
        $hotel->update(['nightly_rate_sgd' => $data['nightlyRateSgd']]);

        return response()->json($hotel->fresh()->toApi());
    }

    public function updateGroundTransport(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['priceSgd' => ['required', 'numeric', 'min:0']]);
        $row = GroundTransport::whereKey($id)->firstOr(fn () => abort(404, 'Transport option not found.'));
        $row->update(['price_sgd' => $data['priceSgd']]);

        return response()->json($row->fresh()->toApi());
    }

    public function updateFerryRoute(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['priceSgd' => ['required', 'numeric', 'min:0']]);
        $row = FerryRoute::whereKey($id)->firstOr(fn () => abort(404, 'Ferry route not found.'));
        $row->update(['price_sgd' => $data['priceSgd']]);

        return response()->json($row->fresh()->toApi());
    }
}
