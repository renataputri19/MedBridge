import { Phone, User } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/format'
import { initials } from '@/lib/utils'
import type { InquiryDetail } from '@/types'

/**
 * Patient identity panel.
 *
 * Contact details arrive from the API already masked — the operations UI never
 * receives a raw phone number or email address.
 */
export function PatientPanel({ detail }: { detail: InquiryDetail }) {
  const { patient } = detail

  /*
   * Year of birth is optional in the chat, nullable in the schema, and cast to
   * `(int) 0` on the way out — so subtracting it blind rendered every patient
   * who skipped the field as "2026 yrs". No year means no age, not an age of
   * however long ago the year zero was.
   */
  const age = patient.yearOfBirth > 0 ? new Date().getFullYear() - patient.yearOfBirth : null

  const gender =
    patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : null

  // Both are frequently absent, and " · " with nothing either side is worse
  // than an empty line.
  const subtitle = [age !== null ? `${age} yrs` : null, gender].filter(Boolean).join(' · ')

  return (
    <Card>
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <User className="h-4 w-4 text-slate-400" />
          Patient Information
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 pt-5">
        <div className="flex items-center gap-3">
          <Avatar className="h-11 w-11">
            <AvatarFallback className="text-sm">{initials(patient.fullName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-900">{patient.fullName}</p>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
        </div>

        {/*
          Phone is the only row here that varies by patient. Origin, language
          and channel were all written by the backend as constants — 'SG',
          'English', 'WEB' — so they showed the same three values on every case
          in the pipeline. Facility repeated the Treating Facility card
          immediately below this one, and channel repeated the badge in the page
          header. A field that cannot differ is not information.
        */}
        <dl className="space-y-2.5 text-sm">
          <Row icon={Phone} label="Phone">
            <span className="tabular">{patient.phoneMasked}</span>
          </Row>
        </dl>

        {/* Verbatim first message — the source of truth for the extraction. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Original message
            </p>
            <Badge variant="neutral" size="sm">
              {formatDateTime(detail.createdAt)}
            </Badge>
          </div>
          <p className="text-sm italic leading-relaxed text-slate-600">
            “{detail.sourceMessage}”
          </p>
        </div>

        <p className="text-[11px] leading-relaxed text-slate-400">
          Contact details are masked at the API boundary. Full records are accessible only from
          the hospital record system with an audited lookup.
        </p>
      </CardContent>
    </Card>
  )
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Phone
  label: