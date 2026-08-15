<?php

use App\Http\Controllers\Api\CatalogueController;
use App\Http\Controllers\Api\ChatController;
use App\Http\Controllers\Api\InquiryController;
use App\Http\Controllers\Api\ItineraryController;
use App\Http\Controllers\Api\MessageController;
use App\Http\Controllers\Api\OperationsController;
use App\Http\Controllers\Api\PartnerCatalogueController;
use App\Http\Controllers\Api\PartnerController;
use App\Http\Controllers\Api\QuoteController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| MedBridge Pass API — /api/v1
|--------------------------------------------------------------------------
|
| Two surfaces live here.
|
|   PUBLIC   /chat/*       the patient front door, unauthenticated by design
|            /itinerary/*  the patient pass, resolved by opaque token only
|
|   INTERNAL everything else — the hospital operations portal
|
| Both public surfaces are rate-limited hard: they are the only unauthenticated
| endpoints in the system, and the itinerary token space (~32^24) does not make
| enumeration impossible, only expensive.
|
| Note routes/web.php excludes `api` and `storage` from the SPA catch-all. Keep
| it that way — otherwise an unimplemented endpoint returns HTML with a 200, the
| frontend fallback layer reads that as "backend unreachable", and a broken
| backend looks like a healthy one.
|
*/

Route::prefix('v1')->group(function () {

    /* ------------------------------------------------------------------ */
    /* Public — patient chat                                               */
    /* ------------------------------------------------------------------ */

    Route::prefix('chat')->middleware('throttle:40,1')->group(function () {
        Route::post('sessions', [ChatController::class, 'start']);
        Route::get('sessions/{token}', [ChatController::class, 'show']);
        Route::post('sessions/{token}/messages', [ChatController::class, 'message']);
        Route::post('sessions/{token}/choice', [ChatController::class, 'choice']);
        Route::post('sessions/{token}/bundle', [ChatController::class, 'updateBundle']);
        Route::post('sessions/{token}/submit', [ChatController::class, 'submit']);
    });

    /* ------------------------------------------------------------------ */
    /* Public — patient pass                                               */
    /* ------------------------------------------------------------------ */

    Route::middleware('throttle:20,1')->group(function () {
        Route::get('itinerary/{token}', [ItineraryController::class, 'show']);
        Route::post('itinerary/{token}/confirm', [ItineraryController::class, 'confirm']);
    });

    /* ------------------------------------------------------------------ */
    /* Operations portal                                                   */
    /* ------------------------------------------------------------------ */
    /*
     * Not yet authenticated — staff accounts are the next milestone (docs/10).
     * When Sanctum lands, wrap this group in auth:sanctum and nothing else
     * needs to change: the HTTP client already sends credentials: 'include'.
     */

    Route::get('dashboard/kpis', [OperationsController::class, 'kpis']);
    Route::get('activity', [OperationsController::class, 'activity']);
    Route::get('analytics/summary', [OperationsController::class, 'analytics']);
    // The marketplace's own P&L — commission entitlement, never settled cash.
    Route::get('saas/summary', [OperationsController::class, 'saas']);

    /*
     * Partner portals. `{type}` is one of hospital|hotel|ferry|transport and is
     * validated in the controller.
     *
     * Scoped to one partner by id, but NOT authenticated — like every other
     * route in this group. The scoping shapes the payload; it does not secure
     * it. A partner's Sanctum token must be pinned to its own id when auth
     * lands, or one hotel can read another's arrivals.
     */
    Route::get('partners/{type}', [PartnerController::class, 'index']);
    Route::get('partners/{type}/{id}', [PartnerController::class, 'show']);

    /*
     * Partner self-service. Each write is scoped to the partner in the path and
     * re-checks ownership of the row it touches.
     *
     * Note these are NOT under `partners/{type}/...` with a wildcard type: the
     * shape of what a hospital edits has nothing in common with what a ferry
     * operator edits, and one polymorphic write endpoint would validate the
     * union of every field for every partner.
     */
    Route::patch('partners/hospital/{id}/procedures/{procedureId}', [PartnerCatalogueController::class, 'updateHospitalProcedure']);
    Route::patch('partners/hospital/{id}/doctors/{doctorId}', [PartnerCatalogueController::class, 'updateDoctor']);

    Route::patch('partners/hotel/{id}/rate', [PartnerCatalogueController::class, 'updateHotel']);
    Route::patch('partners/ferry/{id}/fare', [PartnerCatalogueController::class, 'updateFerry']);
    Route::patch('partners/transport/{id}/price', [PartnerCatalogueController::class, 'updateTransport']);
    Route::get('patients', [OperationsController::class, 'patients']);
    Route::get('doctors', [OperationsController::class, 'doctors']);
    Route::get('quotes', [OperationsController::class, 'quotes']);

    Route::get('inquiries', [InquiryController::class, 'index']);
    Route::get('inquiries/{id}', [InquiryController::class, 'show']);
    Route::patch('inquiries/{id}/status', [InquiryController::class, 'setStatus']);
    Route::patch('inquiries/{id}/assign', [InquiryController::class, 'assign']);

    Route::post('inquiries/{id}/quote/line-items', [QuoteController::class, 'addLineItem']);
    Route::patch('inquiries/{id}/quote/line-items/{lineItemId}', [QuoteController::class, 'updateLineItem']);
    Route::delete('inquiries/{id}/quote/line-items/{lineItemId}', [QuoteController::class, 'removeLineItem']);

    // The human-in-the-loop gate. `approve` is the only route in this file that
    // can mint an itinerary token, and there is deliberately no bulk variant.
    Route::post('inquiries/{id}/quote/approve', [QuoteController::class, 'approve']);
    Route::post('inquiries/{id}/quote/reject', [QuoteController::class, 'reject']);

    /*
     * The patient said yes, recorded by staff.
     *
     * Same destination as `itinerary/{token}/confirm`, by a different hand —
     * a coordinator who took the confirmation over the phone. It writes a
     * different activity event on purpose, so the audit trail can still tell
     * "the patient clicked it" from "we were told they agreed".
     */
    Route::post('inquiries/{id}/confirm', [QuoteController::class, 'confirm']);

    Route::get('messages/threads', [MessageController::class, 'threads']);
    Route::post('messages/threads/{id}/send', [MessageController::class, 'send']);
    Route::post('messages/threads/{id}/read', [MessageController::class, 'markRead']);

    Route::prefix('catalogue')->group(function () {
        Route::get('hospitals', [CatalogueController::class, 'hospitals']);
        Route::get('doctors', [CatalogueController::class, 'doctors']);
        Route::get('procedures', [CatalogueController::class, 'procedures']);
        Route::get('ferry-routes', [CatalogueController::class, 'ferryRoutes']);
        Route::get('hotels', [CatalogueController::class, 'hotels']);
        Route::get('ground-transport', [CatalogueController::class, 'groundTransport']);
        // Read-only, and deliberately without a PATCH sibling — a place has a
        // price band, never an amount.
        Route::get('places', [CatalogueController::class, 'places']);

        Route::patch('procedures/{id}', [CatalogueController::class, 'updateProcedure']);
        Route::patch('hotels/{id}', [CatalogueController::class, 'updateHotel']);
        Route::patch('ground-transport/{id}', [CatalogueController::class, 'updateGroundTransport']);
        Route::patch('ferry-routes/{id}', [CatalogueController::class, 'updateFerryRoute']);
    });
});
