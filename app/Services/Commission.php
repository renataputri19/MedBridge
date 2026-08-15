<?php

namespace App\Services;

use App\Models\Quote;
use App\Models\QuoteLineItem;
use Illuminate\Support\Collection;

/**
 * What MedBridge earns on a bundle, and what the suppliers are owed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS AN ENTITLEMENT, NOT A PAYMENT.
 *
 * There is no payments table, no settlement run and no reconciliation anywhere
 * in this system. Nothing here means money has moved. Every figure this class
 * produces is "what we would earn if this trip happens", derived at read time
 * from quote line items and the configured take rates.
 *
 * The dashboards built on it must say so in those words. A revenue number on a
 * screen is read as cash received unless it is labelled otherwise, and the
 * distance between "quoted" and "collected" is exactly where a marketplace
 * fools itself.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * NOTHING IS WRITTEN BACK. Rates are applied to line items on read, so changing
 * a rate re-reports history rather than rewriting it, and a quote a patient
 * already received keeps the prices it was built with (docs/09 D8).
 */
final class Commission
{
    /** Quotes only count once a human has approved them. */
    public const COUNTABLE_QUOTE_STATUS = 'APPROVED';

    /**
     * Inquiry statuses where the patient has committed to the trip.
     *
     * The closest thing this system has to "they paid us". It is a proxy and
     * the UI labels it as one — an approved quote is an offer, and a confirmed
     * booking is a patient saying yes, but neither is a receipt.
     */
    public const COMMITTED_STATUSES = ['CONFIRMED_BOOKING', 'TRAVEL_READY', 'COMPLETED'];

    public static function rateFor(?string $category): float
    {
        $rates = (array) config('medbridge.commission.take_rate', []);

        return (float) ($rates[(string) $category] ?? 0.0);
    }

    /** MedBridge's cut of one line. */
    public static function onLine(QuoteLineItem $line): float
    {
        return round($line->subtotalSgd() * self::rateFor($line->category), 2);
    }

    /** The supplier's share of one line — the remainder, by definition. */
    public static function supplierShareOfLine(QuoteLineItem $line): float
    {
        return round($line->subtotalSgd() - self::onLine($line), 2);
    }

    /**
     * Gross, commission and supplier payout for a whole quote.
     *
     * @return array{grossSgd:float, commissionSgd:float, supplierSgd:float, byCategory:array<string,float>}
     */
    public static function onQuote(Quote $quote): array
    {
        $quote->loadMissing('lineItems');

        $gross = 0.0;
        $commission = 0.0;
        $byCategory = [];

        foreach ($quote->lineItems as $line) {
            $subtotal = $line->subtotalSgd();
            $cut = self::onLine($line);

            $gross += $subtotal;
            $commission += $cut;
            $byCategory[$line->category] = round(($byCategory[$line->category] ?? 0.0) + $cut, 2);
        }

        return [
            'grossSgd' => round($gross, 2),
            'commissionSgd' => round($commission, 2),
            'supplierSgd' => round($gross - $commission, 2),
            'byCategory' => $byCategory,
        ];
    }

    /**
     * Approved quotes, with their inquiry, ready to be attributed to suppliers.
     *
     * A DRAFT quote is not revenue of any kind — it is a proposal that no human
     * has signed off, and half of them will change before they are approved.
     *
     * @return Collection<int, Quote>
     */
    public static function countableQuotes(): Collection
    {
        return self::allQuotes()
            ->filter(fn (Quote $quote) => $quote->status === self::COUNTABLE_QUOTE_STATUS)
            ->values();
    }

    /**
     * Every quote with a live inquiry behind it, approved or not.
     *
     * The partner portals need this and the revenue figures must not use it.
     *
     * A hospital wants to know a patient is coming while the case is still in
     * review — that is when they would hold a slot — so a draft has to be
     * visible to them. It just must never be counted as money: `stageOf()`
     * labels it PENDING, and the payout totals skip it. Showing a partner an
     * amount they are not owed is the same error as hiding a patient who is on
     * their way, in the opposite direction.
     *
     * @return Collection<int, Quote>
     */
    public static function allQuotes(): Collection
    {
        return Quote::query()
            ->with(['lineItems', 'inquiry.patient', 'inquiry.procedure'])
            ->get()
            ->filter(fn (Quote $quote) => $quote->inquiry !== null)
            ->values();
    }

    /**
     * How firm a booking is, from the supplier's point of view.
     *
     *   PENDING   — quoted, still with a human. Expect it; do not bank it.
     *   APPROVED  — a coordinator signed it off. We owe this if it travels.
     *   CONFIRMED — the patient accepted their pass.
     */
    public static function stageOf(Quote $quote): string
    {
        if ($quote->status !== self::COUNTABLE_QUOTE_STATUS) {
            return 'PENDING';
        }

        return self::isCommitted($quote) ? 'CONFIRMED' : 'APPROVED';
    }

    /** Whether a stage represents an amount MedBridge would actually owe. */
    public static function isPayable(Quote $quote): bool
    {
        return $quote->status === self::COUNTABLE_QUOTE_STATUS;
    }

    /** Whether the patient behind a quote has committed to travelling. */
    public static function isCommitted(Quote $quote): bool
    {
        return in_array($quote->inquiry?->status, self::COMMITTED_STATUSES, true);
    }
}
