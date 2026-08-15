import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  BedDouble,
  Car,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Receipt,
  Ship,
  Stethoscope,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SavingsCallout } from '@/components/shared/SavingsCallout'
import {
  useAddLineItem,
  useApproveQuote,
  useRejectQuote,
  useRemoveLineItem,
  useUpdateLineItem,
} from '@/hooks/queries'
import { useAppStore } from '@/store/useAppStore'
import { computeTotals, lineTotal } from '@/mock/generators'
import { QUOTE_CATEGORY_META } from '@/lib/constants'
import { formatIdr, formatSgd } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { InquiryDetail, QuoteCategory, QuoteLineItem } from '@/types'

const CATEGORY_ICON: Record<QuoteCategory, typeof Receipt> = {
  TREATMENT: Stethoscope,
  DOCTOR_FEE: Stethoscope,
  FERRY: Ship,
  HOTEL: BedDouble,
  TRANSPORT: Car,
  ADMIN: FileText,
}

const CATEGORY_ORDER: QuoteCategory[] = [
  'TREATMENT',
  'DOCTOR_FEE',
  'FERRY',
  'HOTEL',
  'TRANSPORT',
  'ADMIN',
]

interface QuoteBuilderProps {
  detail: InquiryDetail
}

/**
 * Hospital Quote Builder.
 *
 * Staff-editable line items across every leg of the bundle, with the SGD/IDR
 * totals and Singapore savings recalculated live. Approval here is the
 * human-in-the-loop gate — it is what mints the patient itinerary token.
 */
export function QuoteBuilder({ detail }: QuoteBuilderProps) {
  const quote = detail.quote
  const operatorName = useAppStore((state) => state.operatorName)

  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const updateLineItem = useUpdateLineItem(detail.id)
  const addLineItem = useAddLineItem(detail.id)
  const removeLineItem = useRemoveLineItem(detail.id)
  const rejectQuote = useRejectQuote(detail.id)

  const approveQuote = useApproveQuote(detail.id, {
    onSuccess: () => {
      toast.success('Quote approved', {
        description: 'Patient itinerary issued. Secure link is ready to send.',
        icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
      })
    },
    onError: () => toast.error('Could not approve the quote. Please retry.'),
  })

  if (!quote) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Hospital Quote Builder</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            No draft quote yet. It is generated once Hermes has identified the treatment.
          </p>
        </CardContent>
      </Card>
    )
  }

  const totals = computeTotals(quote)
  const approved = quote.status === 'APPROVED'
  const locked = approved || quote.status === 'REJECTED'
  const awaitingHospital = detail.status === 'DOCTOR_REVIEW_REQUIRED'

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: quote.lineItems.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0)

  const handleAdd = (category: QuoteCategory) => {
    addLineItem.mutate({
      category,
      label: 'New line item',
      detail: 'Describe this charge',
      quantity: 1,
      unitPriceSgd: 0,
      refType: null,
      refId: null,
    })
  }

  return (
    <Card id="quote-builder" className="scroll-mt-32">
      <CardHeader className="flex-row items-start justify-between space-y-0 border-b border-slate-100">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-slate-400" />
            Hospital Quote Builder
          </CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            {approved
              ? `Approved by ${quote.approvedByName}. Patient link issued.`
              : 'Verify every line, then approve to release the itinerary to the patient.'}
          </p>
        </div>
        <Badge variant={approved ? 'success' : quote.status === 'REJECTED' ? 'destructive' : 'warning'}>
          {quote.status.replace('_', ' ')}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        {/* Line items grouped by bundle component */}
        <div className="space-y-4">
          {grouped.map(({ category, items }) => {
            const meta = QUOTE_CATEGORY_META[category]
            const Icon = CATEGORY_ICON[category]
            const groupTotal = items.reduce((acc, item) => acc + lineTotal(item), 0)

            return (
              <div key={category} className="rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
                  <Icon className="h-3.5 w-3.5 text-slate-400" />
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                      meta.className,
                    )}
                  >
                    {meta.label}
                  </span>
                  <span className="hidden truncate text-[11px] text-slate-400 sm:inline">
                    {meta.hint}
                  </span>
                  <span className="tabular ml-auto text-sm font-semibold text-slate-700">
                    {formatSgd(groupTotal)}
                  </span>
                </div>

                <ul className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <LineItemRow
                      key={item.id}
                      item={item}
                      locked={locked}
                      onChange={(patch) =>
                        updateLineItem.mutate({ lineItemId: item.id, patch })
                      }
                      onRemove={() => removeLineItem.mutate(item.id)}
                    />
                  ))}
                </ul>

                {!locked && (
                  <div className="border-t border-slate-100 px-3 py-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleAdd(category)}
                    >
                      <Plus className="h-3 w-3" />
                      Add {meta.label.toLowerCase()} line
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Totals */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-slate-600">Bundle total</span>
            <span className="tabular text-2xl font-bold text-slate-900">
              {formatSgd(totals.totalSgd)}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xs text-slate-400">
              Indicative IDR at {quote.idrPerSgd.toLocaleString()} / SGD
            </span>
            <span className="tabular text-sm font-medium text-slate-500">
              {formatIdr(totals.totalIdr)}
            </span>
          </div>
        </div>

        <SavingsCallout
          singaporeSgd={totals.sgBenchmarkSgd}
          medbridgeSgd={totals.totalSgd}
          savingsSgd={totals.savingsSgd}
          savingsPct={totals.savingsPct}
          totalIdr={totals.totalIdr}
        />

        {/* Approval — the human-in-the-loop gate */}
        {approved ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-emerald-900">Patient Itinerary Ready</p>
              <p className="text-xs text-emerald-700">
                Secure link issued. The token carries no database ID or personal data.
              </p>
            </div>
            {detail.itineraryToken && (
              <Button asChild variant="success" size="sm">
                <Link to={`/itinerary/${detail.itineraryToken}`}>
                  Open Patient Pass
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
            )}
          </div>
        ) : quote.status === 'REJECTED' ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-rose-900">
              <XCircle className="h-4 w-4" />
              Quote rejected
            </p>
            {quote.notes && <p className="mt-1 text-xs text-rose-700">{quote.notes}</p>}
          </div>
        ) : awaitingHospital ? (
          /*
             Approving here would 409 — `QuoteController::approve` refuses while
             the case sits at DOCTOR_REVIEW_REQUIRED. Sign-off is the treating
             hospital's now, so this says who it is waiting on instead of
             offering a button that cannot work.
          */
          <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4">
            <Stethoscope className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-orange-900">
                Waiting on clinical sign-off from {detail.hospital.name}
              </p>
              <p className="text-xs text-orange-700">
                The treating hospital decides whether the patient is suitable before this quote
                can be approved. It appears in their partner portal.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-900">Awaiting human approval</p>
              <p className="text-xs text-amber-700">
                Nothing is sent to the patient until a staff member approves this quote.
              </p>
            </div>
            {/*
              Both buttons take the same size. Approve was left on the default
              size while Reject was `sm`, which is three mismatches at once —
              40px against 32px, `rounded-lg` against `rounded-md`, `text-sm`
              against `text-xs` — sitting directly beside each other. `sm`
              matches "Open Patient Pass" in the approved state, so all three
              states of this bar now line up.
            */}
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRejectOpen(true)}
                disabled={approveQuote.isPending}
              >
                Reject
              </Button>
              <Button
                variant="success"
                size="sm"
                onClick={() => approveQuote.mutate(operatorName)}
                disabled={approveQuote.isPending}
              >
                {approveQuote.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <CheckCircle2 />
                )}
                Approve Quote
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this quote</DialogTitle>
            <DialogDescription>
              The case moves to Human Takeover and the AI stands down. The reason is written to
              the audit log.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="e.g. Implant fixture out of stock until March; patient needs a revised date."
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectQuote.isPending}
              onClick={() => {
                rejectQuote.mutate(rejectReason.trim(), {
                  onSuccess: () => {
                    setRejectOpen(false)
                    setRejectReason('')
                    toast.warning('Quote rejected — case escalated to Human Takeover.')
                  },
                })
              }}
            >
              Reject quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */

interface LineItemRowProps {
  item: QuoteLineItem
  locked: boolean
  onChange: (patch: Partial<Pick<QuoteLineItem, 'quantity' | 'unitPriceSgd' | 'label'>>) => void
  onRemove: () => void
}

function LineItemRow({ item, locked, onChange, onRemove }: LineItemRowProps) {
  return (
    <li className="grid grid-cols-12 items-center gap-2 px-3 py-2.5">
      <div className="col-span-12 min-w-0 sm:col-span-6">
        {locked ? (
          <p className="truncate text-sm font-medium text-slate-800">{item.label}</p>
        ) : (
          <Input
            value={item.label}
            onChange={(event) => onChange({ label: event.target.value })}
            className="h-8 border-transparent px-1.5 text-sm font-medium shadow-none hover:border-slate-200 focus-visible:border-slate-200"
          />
        )}
        <p className="truncate px-1.5 text-[11px] text-slate-400">{item.detail}</p>
      </div>

      <div className="col-span-3 sm:col-span-2">
        <Label htmlFor={`qty-${item.id}`} className="sr-only">
          Quantity
        </Label>
        {locked ? (
          <p className="tabular text-right text-sm text-slate-500">× {item.quantity}</p>
        ) : (
          <Input
            id={`qty-${item.id}`}
            type="number"
            min={0}
            value={item.quantity}
            onChange={(event) => onChange({ quantity: Math.max(0, Number(event.target.value)) })}
            className="tabular h-8 px-2 text-right text-sm"
          />
        )}
      </div>

      <div className="col-span-4 sm:col-span-2">
        <Label htmlFor={`unit-${item.id}`} className="sr-only">
          Unit price SGD
        </Label>
        {locked ? (
          <p className="tabular text-right text-sm text-slate-500">
            {formatSgd(item.unitPriceSgd)}
          </p>
        ) : (
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
              S$
            </span>
            <Input
              id={`unit-${item.id}`}
              type="number"
              min={0}
              value={item.unitPriceSgd}
              onChange={(event) =>
                onChange({ unitPriceSgd: Math.max(0, Number(event.target.value)) })
              }
              className="tabular h-8 pl-7 pr-2 text-right text-sm"
            />
          </div>
        )}
      </div>

      <div className="col-span-4 flex items-center justify-end gap-1 sm:col-span-2">
        <span className="tabular text-sm font-semibold text-slate-900">
          {formatSgd(lineTotal(item))}
        </span>
        {!locked && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label={`Remove ${item.label}`}
            className="text-slate-300 hover:text-rose-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </li>
  )
}
