import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  FileText,
  PiggyBank,
  Receipt,
  Search,
  Ticket,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useQuoteSummaries } from '@/hooks/queries'
import { formatCompactSgd, formatDate, formatNumber, formatSgd } from '@/lib/format'
import type { QuoteStatus } from '@/types'

const STATUS_VARIANT: Record<QuoteStatus, 'success' | 'warning' | 'destructive' | 'neutral'> = {
  APPROVED: 'success',
  PENDING_APPROVAL: 'warning',
  DRAFT: 'neutral',
  REJECTED: 'destructive',
  EXPIRED: 'neutral',
}

export default function Quotes() {
  const { data, isLoading } = useQuoteSummaries()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<QuoteStatus | 'ALL'>('ALL')
  const [copied, setCopied] = useState<string | null>(null)

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (data ?? []).filter((row) => {
      if (status !== 'ALL' && row.status !== status) return false
      if (!query) return true
      return (
        row.reference.toLowerCase().includes(query) ||
        row.patientName.toLowerCase().includes(query) ||
        row.procedureName.toLowerCase().includes(query)
      )
    })
  }, [data, search, status])

  const totals = useMemo(() => {
    const all = data ?? []
    const approved = all.filter((r) => r.status === 'APPROVED')
    return {
      quotes: all.length,
      issued: all.filter((r) => r.itineraryToken).length,
      approvedValue: approved.reduce((acc, r) => acc + r.totalSgd, 0),
      savings: approved.reduce((acc, r) => acc + r.savingsSgd, 0),
    }
  }, [data])

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/itinerary/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(token)
      setTimeout(() => setCopied(null), 1800)
      toast.success('Pass link copied', { description: 'Ready to send to the patient.' })
    } catch {
      toast.error('Could not copy. Copy it from the pass page instead.')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quotes & Itineraries"
        description="Every priced bundle and the patient passes issued from them."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total quotes"
          value={formatNumber(totals.quotes)}
          icon={Receipt}
          accent="sky"
          hint="Draft through approved"
          loading={isLoading}
        />
        <KpiCard
          label="Passes issued"
          value={formatNumber(totals.issued)}
          icon={Ticket}
          accent="violet"
          hint="Live patient links"
          loading={isLoading}
        />
        <KpiCard
          label="Approved value"
          value={formatCompactSgd(totals.approvedValue)}
          icon={FileText}
          accent="emerald"
          hint="Bundle revenue"
          loading={isLoading}
        />
        <KpiCard
          label="Savings delivered"
          value={formatCompactSgd(totals.savings)}
          icon={PiggyBank}
          accent="teal"
          hint="vs Singapore benchmark"
          loading={isLoading}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[15rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reference, patient or procedure…"
            className="pl-9"
          />
        </div>

        <Select value={status} onValueChange={(value) => setStatus(value as QuoteStatus | 'ALL')}>
          <SelectTrigger className="w-[12rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All quote statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="PENDING_APPROVAL">Pending approval</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="EXPIRED">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No quotes match these filters"
          description="Quotes appear here once Hermes has identified a treatment and priced the bundle."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead>Reference</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Procedure</TableHead>
                <TableHead>Quote</TableHead>
                <TableHead>Pipeline</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Saving</TableHead>
                <TableHead>Approved by</TableHead>
                <TableHead className="text-right">Patient pass</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.quoteId}>
                  <TableCell>
                    <Link
                      to={`/inquiries/${row.inquiryId}`}
                      className="font-mono text-xs font-medium text-brand-600 hover:underline"
                    >
                      {row.reference}
                    </Link>
                    <p className="text-[11px] text-slate-400">{row.lineItemCount} line items</p>
                  </TableCell>

                  <TableCell className="whitespace-nowrap font-medium text-slate-900">
                    {row.patientName}
                  </TableCell>

                  <TableCell>
                    <p className="max-w-[14rem] truncate">{row.procedureName}</p>
                    <p className="max-w-[14rem] truncate text-[11px] text-slate-400">
                      {row.hospitalName}
                    </p>
                  </TableCell>

                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]} size="sm">
                      {row.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <StatusBadge status={row.inquiryStatus} short />
                  </TableCell>

                  <TableCell className="tabular whitespace-nowrap text-right">
                    <p className="font-semibold text-slate-900">{formatSgd(row.totalSgd)}</p>
                    <p className="text-[11px] text-slate-400 line-through">
                      {formatSgd(row.sgBenchmarkSgd)}
                    </p>
                  </TableCell>

                  <TableCell className="tabular whitespace-nowrap text-right">
                    <p className="font-semibold text-teal-600">{formatSgd(row.savingsSgd)}</p>
                    <p className="text-[11px] text-teal-500">−{row.savingsPct.toFixed(0)}%</p>
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-xs text-slate-500">
                    {row.approvedByName ?? <span className="text-slate-300">Not approved</span>}
                    {row.approvedAt && (
                      <p className="text-[11px] text-slate-400">{formatDate(row.approvedAt)}</p>
                    )}
                  </TableCell>

                  <TableCell className="text-right">
                    {row.itineraryToken ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => copyLink(row.itineraryToken!)}
                          aria-label="Copy patient pass link"
                          title="Copy pass link"
                        >
                          {copied === row.itineraryToken ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/itinerary/${row.itineraryToken}`}>
                            Open
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    ) : (
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/inquiries/${row.inquiryId}?panel=quote`}>
                          Review
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        A patient pass only exists once a human approved the quote. Links resolve by opaque token
        and expose no database identifiers or personal data.
      </p>
    </div>
  )
}
