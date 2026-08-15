import { Link } from 'react-router-dom'
import { ArrowRight, Building2, MapPin, ShieldAlert } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePartners } from '@/hooks/queries'
import { PARTNER_META } from '@/lib/partners'
import { formatSgd } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PartnerType } from '@/types'

/**
 * The partner picker — a stand-in for a login screen.
 *
 * There is no authentication in this prototype, so "which partner are you" is
 * answered by choosing from a list rather than by signing in. That is a
 * demo affordance and the banner says so: in production this page does not
 * exist, because a partner's token already answers the question.
 */
export default function PartnerIndex({ type }: { type: PartnerType }) {
  const meta = PARTNER_META[type]
  const { data: partners, isLoading, isError } = usePartners(type)

  return (
    <div className="space-y-5">
      <PageHeader title={meta.plural} description={meta.blurb} />

      {/*
        Said plainly, because a portal that shows commercial figures without
        asking who you are is alarming if you do not know it is deliberate.
      */}
      <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs leading-relaxed text-amber-900">
        <ShieldAlert className="mt-px h-4 w-4 shrink-0 text-amber-600" />
        <span>
          <span className="font-semibold">Prototype — no sign-in. </span>
          Choosing a partner here stands in for logging in as them. In production each partner
          reaches only their own portal, and this list does not exist.
        </span>
      </p>

      {isError ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm font-medium text-slate-700">Could not load partners</p>
            <p className="mt-1 text-xs text-slate-500">
              The MedBridge API is unreachable. These figures are never mocked — a partner
              portal showing invented bookings would be worse than an error.
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(partners ?? []).map((partner) => (
            <Link
              key={partner.id}
              to={`/${meta.path}/${partner.id}`}
              className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{partner.name}</p>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {partner.district}
                  </p>
                </div>
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
                    meta.accent,
                  )}
                >
                  <Building2 className="h-4 w-4" />
                </span>
              </div>

              <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
                <div>
                  <p className="text-[11px] text-slate-400">Bookings</p>
                  <p className="tabular text-lg font-bold text-slate-900">
                    {partner.bookingCount}
                  </p>
                  {partner.pendingCount > 0 && (
                    <p className="tabular text-[11px] font-medium text-amber-700">
                      {partner.pendingCount} in review
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-400">Due to you</p>
                  <p className="tabular text-lg font-bold text-teal-600">
                    {formatSgd(partner.supplierSgd)}
                  </p>
                  {partner.pipelineSgd > 0 && (
                    <p className="tabular text-[11px] text-slate-400">
                      +{formatSgd(partner.pipelineSgd)} pending
                    </p>
                  )}
                </div>
                <ArrowRight className="mb-1 h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
