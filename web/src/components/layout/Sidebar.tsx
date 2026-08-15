import { NavLink } from 'react-router-dom'
import {
  BedDouble,
  Building2,
  Car,
  FileText,
  Inbox,
  LayoutDashboard,
  MapPin,
  Settings as SettingsIcon,
  ShieldCheck,
  Ship,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useInquiries } from '@/hooks/queries'
import { REVIEW_STATUSES } from '@/lib/constants'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Shows the number of cases stopped at the review gate. */
  badge?: boolean
}

interface NavSection {
  label: string | null
  items: NavItem[]
}

/*
 * Four sections used to be five, and twelve rows used to be sixteen.
 *
 * Gone: AI Activity (the audit trail is recorded and served, but no longer
 * rendered anywhere), Messages (patients talk through the chat at `/`,
 * so a second staff inbox was a duplicate of the same conversation), Analytics
 * (charts of a handful of rows), and Patients (a second list of people already
 * reachable from their own case — now a tab on Inquiries).
 */
const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/inquiries', label: 'Inquiries', icon: Inbox, badge: true },
      { to: '/quotes', label: 'Quotes & Passes', icon: FileText },
      { to: '/places', label: 'Places & Wisata', icon: MapPin },
    ],
  },
  /*
   * Partner portals — what each supplier sees of MedBridge.
   *
   * In the prototype they live in this sidebar so you can move between roles
   * without signing in. A real partner deployment would never render this nav:
   * a hotel has no business seeing the inquiry pipeline above it.
   */
  {
    label: 'Partner portals',
    items: [
      { to: '/hospital', label: 'Hospitals', icon: Building2 },
      { to: '/hotel', label: 'Hotels', icon: BedDouble },
      { to: '/ferry', label: 'Ferry', icon: Ship },
      { to: '/transport', label: 'Ground Transport', icon: Car },
    ],
  },
  {
    label: null,
    items: [{ to: '/settings', label: 'Settings', icon: SettingsIcon }],
  },
]

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: inquiries } = useInquiries()

  const reviewCount =
    inquiries?.filter((inquiry) => REVIEW_STATUSES.includes(inquiry.status)).length ?? 0

  return (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-slate-800 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-lg shadow-brand-500/25">
          <Stethoscope className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">MedBridge Pass</p>
          <p className="truncate text-[10px] leading-tight text-slate-500">
            Cross-border care, one pass
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="scrollbar-thin flex-1 overflow-y-auto p-3">
        {NAV_SECTIONS.map((section, index) => (
          <div key={section.label ?? `section-${index}`} className={cn(index > 0 && 'mt-5')}>
            {section.label && (
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                {section.label}
              </p>
            )}

            <div className="space-y-0.5">
              {section.items.map(({ to, label, icon: Icon, badge }) => {
                const count = badge ? reviewCount : 0

                return (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-white')} />
                        <span className="flex-1 truncate">{label}</span>
                        {count > 0 && (
                          <span
                            className={cn(
                              'tabular shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                              isActive
                                ? 'bg-white/20 text-white'
                                : 'bg-amber-500/20 text-amber-400',
                            )}
                          >
                            {count}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Safety footer — the human-in-the-loop promise, always visible. */}
      <div className="shrink-0 border-t border-slate-800 p-3">
        <div className="rounded-lg bg-slate-800/60 p-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-teal-400" />
            <p className="text-xs font-semibold text-slate-200">Human-in-the-Loop</p>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
            Hermes drafts. Staff and doctors approve. No quote reaches a patient without a
            human sign-off.
          </p>
        </div>
      </div>
    </div>
  )
}
