<?php

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| The MedBridge Pass frontend is a React SPA built from `web/` into
| `public/app`. Every non-API path returns the SPA shell so client-side
| routing (/dashboard, /inquiries/:id, /itinerary/:token) works on a hard
| refresh or a directly pasted link.
|
| API routes live in routes/api.php under the /api prefix. They are excluded
| from the catch-all below so an unimplemented or mistyped endpoint returns a
| real 404 instead of the HTML shell — otherwise the frontend's offline
| fallback would silently mask a broken backend.
|
*/

Route::get('/{any?}', function () {
    $index = public_path('app/index.html');

    abort_if(
        ! File::exists($index),
        503,
        'Frontend bundle not found. Run "npm install && npm run build" in the web/ directory.'
    );

    return response(File::get($index))->header('Content-Type', 'text/html');
})->where('any', '^(?!api($|/)|storage($|/)).*$');
