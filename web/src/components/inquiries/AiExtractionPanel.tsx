import { AlertTriangle, Bot, Clock, Sparkles, Tag, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ConfidenceMeter } from '@/components/shared/ConfidenceMeter'
import { JsonInspector } from '@/components/shared/JsonInspector'
import { formatDuration, humanizeEnum } from '@/lib/format'
import type { AiExtraction, ReviewReason } from '@/types'

const REASON_COPY: Record<ReviewReason, string> = {
  LOW_CONFIDENCE: 'Confidence fell below the auto-quote threshold.',
  UNKNOWN_PROCEDURE: 'The request did not map to a catalogue procedure.',
  EMERGENCY_LANGUAGE: 'Emergency or acute-symptom language was detected.',
  HIGH_RISK_PROCEDURE: 'This procedure always requires clinical sign-off.',
  PRICE_OUT_OF_BAND: 'Calculated price fell outside the approved band.',
}

/**
 * Structured view of what Hermes extracted.
 *
 * This renders the parsed record only — fields, entities, scores. Raw model text
 * and reasoning traces are never sent to the frontend, let alone displayed.
 */
/**
 * A plan the patient assembled themselves, rather than one Hermes inferred.
 *
 * The chat writes `self_configured` when the visitor picked every option out of
 * the catalogue. Confidence is then 1.0 by construction — there was no
 * inference to be confident about — so rendering a 100% meter would be the same
 * empty reassurance as a threshold slider that gates nothing.
 */
function isSelfConfigured(extraction: AiExtraction): boolean {
  return extraction.extractedEntities?.self_configured === true
}

export function AiExtractionPanel({ extraction }: { extraction: AiExtraction | null }) {
  if (!extraction) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-slate-400" />
            AI Extracted Request
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            Awaiting extraction. Hermes runs on the backend as soon as the message is queued.
          </p>
        </CardContent>
      </Card>
    )
  }

  const procedureLabel = extraction.procedureLabel.trim().toLowerCase()
  const symptomKeywords = extraction.symptomKeywords.filter(
    (keyword) => keyword.trim().toLowerCase() !== procedureLabel,
  )

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 border-b border-slate-100">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-slate-400" />
            AI Extracted Request
          </CardTitle>
          {/*
            Latency only when it was measured. The chat path never times the
            call, so this read "gemini-3.5-flash · 0ms" on every case that came
            through the front door — a performance number for work that was
            never clocked.
          */}
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            {extraction.modelVersion}
            {extraction.latencyMs > 0 && ` · ${formatDuration(extraction.latencyMs)}`}
          </p>
        </div>
        <Badge variant={extraction.requiresHumanReview ? 'warning' : 'success'}>
          {extraction.requiresHumanReview ? 'Human review' : 'Auto-eligible'}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4 pt-5">
        {/* Escalation banner takes priority over everything else. */}
        {extraction.requiresHumanReview && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              HUMAN_REVIEW_REQUIRED
            </p>
            <ul className="mt-2 space-y-1">
              {extraction.reviewReasons.map((reason) => (
                <li key={reason} className="flex items-start gap-2 text-xs text-amber-800">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <span className="font-mono font-semibold">{reason}</span> — {REASON_COPY[reason]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Interpreted request
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{extraction.intentSummary}</p>
        </div>

        {isSelfConfigured(extraction) ? (
          <p className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">Configured by the patient.</span> Every
            option below was chosen from the catalogue in the web chat, so there is no extraction
            confidence to report. The gate still applies.
          </p>
        ) : (
          <ConfidenceMeter value={extraction.confidence} />
        )}

        <dl className="grid grid-cols-2 gap-3">
          <Field icon={Sparkles} label="Procedure" value={extraction.procedureLabel} />
          <Field icon={Tag} label="Urgency" value={humanizeEnum(extraction.urgency)} />
          <Field
            icon={Users}
            label="Travel party"
            value={`${extraction.travelPartySize} traveller${extraction.travelPartySize > 1 ? 's' : ''}`}
          />
          <Field icon={Clock} label="Preferred window" value={extraction.preferredWindow} />
        </dl>

        {/*
          Keywords that merely repeat the procedure are dropped. A patient who
          picks "Cataract Surgery" from a list gets it echoed back as a symptom
          keyword, which then sat directly under the Procedur