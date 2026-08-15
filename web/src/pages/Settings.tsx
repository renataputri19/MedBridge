import { useState } from 'react'
import { Database, Save, ShieldCheck, User, Wifi } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppStore } from '@/store/useAppStore'
import {
  API_BASE_URL,
  CONFIDENCE_THRESHOLD,
  REALTIME_TRANSPORT,
  REQUIRE_DOCTOR_REVIEW_FOR_HIGH_RISK,
  USE_MOCKS,
} from '@/lib/constants'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

/**
 * Operator identity plus a read-only view of the safety gate.
 *
 * This page deliberately offers no control over the gate or over pricing. Both
 * run server-side (`config/medbridge.php`), so a browser-local override could
 * only ever change how a result is *rendered* — a confidence badge reporting a
 * threshold the backend is not applying. Tuning them for real means the backend
 * env, and eventually an authenticated settings endpoint.
 */
export default function Settings() {
  const operatorName = useAppStore((state) => state.operatorName)
  const hospitalName = useAppStore((state) => state.hospitalName)
  const setOperator = useAppStore((state) => state.setOperator)
  const realtimeStatus = useAppStore((state) => state.realtimeStatus)

  const [name, setName] = useState(operatorName)
  const [facility, setFacility] = useState(hospitalName)

  const dirty = name !== operatorName || facility !== hospitalName

  const save = () => {
    setOperator(name.trim() || operatorName, facility.trim() || hospitalName)
    toast.success('Profile saved')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Operator identity and system status."
        actions={
          <Button onClick={save} disabled={!dirty}>
            <Save className="h-4 w-4" />
            Save changes
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ---- Operator ---- */}
        <Card>
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2">
              <User className="h-4 w-4 text-slate-400" />
              Operator Profile
            </CardTitle>
            <p className="text-sm text-slate-500">
              The name recorded against quote approvals and outbound replies.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <Field label="Your name" htmlFor="operator-name">
              <Input
                id="operator-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field
              label="Organisation"
              htmlFor="facility-name"
              hint="Shown in the portal header. MedBridge coordinates across every partner, so this is not one hospital's name."
            >
              <Input
                id="facility-name"
                value={facility}
                onChange={(event) => setFacility(event.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        {/* ---- Safety gate (read-only) ---- */}
        <Card>
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-400" />
              AI Safety & Human-in-the-Loop
            </CardTitle>
            <p className="text-sm text-slate-500">
              When Hermes must hand a case to a person. Enforced server-side.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            <Row label="Confidence threshold">
              <span className="tabular text-sm font-semibold text-slate-900">
                {Math.round(CONFIDENCE_THRESHOLD * 100)}%
              </span>
            </Row>
            <Row label="Always escalate high-risk procedures">
              <Badge
                variant={REQUIRE_DOCTOR_REVIEW_FOR_HIGH_RISK ? 'success' : 'warning'}
                size="sm"
              >
                {REQUIRE_DOCTOR_REVIEW_FOR_HIGH_RISK ? 'On' : 'Off'}
              </Badge>
            </Row>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Always escalates, not configurable
              </p>
              <ul className="mt-1.5 space-y-1 text-xs text-slate-600">
                <li>• Emergency or acute-symptom language</li>
                <li>• Requests that map to no catalogue procedure</li>
                <li>• Any quote reaching a patient without human approval</li>
              </ul>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-400">
              These values come from the backend configuration. They are shown here so the gate is
              visible, and are not editable from the browser — the escalation decision is made by
              the server, never by this page.
            </p>
          </CardContent>
        </Card>

        {/* ---- System ---- */}
        <Card className="lg:col-span-2">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4 text-slate-400" />
              System & Data Source
            </CardTitle>
            <p className="text-sm text-slate-500">
              Read-only — these come from environment variables at build time.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            <Row label="Data source">
              <Badge variant={USE_MOCKS ? 'warning' : 'success'}>
                {USE_MOCKS ? 'Offline mock data' : 'Live backend'}
              </Badge>
            </Row>
            <Row label="API base URL">
              <span className="font-mono text-xs text-slate-600">{API_BASE_URL}</span>
            </Row>
            <Row label="Realtime transport">
              <span className="flex items-center gap-1.5">
                <Wifi
                  className={cn(
                    'h-3.5 w-3.5',
                    realtimeStatus === 'live' ? 'text-emerald-500' : 'text-slate-400',
                  )}
                />
                <span className="font-mono text-xs uppercase text-slate-600">
                  {REALTIME_TRANSPORT}
                </span>
                <Badge variant={realtimeStatus === 'live' ? 'success' : 'neutral'} size="sm">
                  {realtimeStatus}
                </Badge>
              </span>
            </Row>
            <Row label="AI provider access">
              <Badge variant="success" size="sm">
                None — backend only
              </Badge>
            </Row>

            <Separator />

            <p className="text-[11px] leading-relaxed text-slate-400">
              Pricing — exchange rate, coordination fee and the Singapore benchmark — is applied by
              the backend when a bundle is priced. Catalogue price edits affect new quotes only;
              quotes already drafted keep the price the patient was shown.
            </p>
          </CardContent>
        </Card>
      </div>

      {dirty && (
        <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-white p-3 shadow-lg">
          <p className="text-sm text-slate-600">You have unsaved changes.</p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setName(operatorName)
                setFacility(hospitalName)
              }}
            >
              Discard
            </Button>
            <Button size="sm" onClick={save}>
              <Save className="h-3.5 w-3.5" />
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-500">{label}</span>
      {children}
    </div>
  )
}
