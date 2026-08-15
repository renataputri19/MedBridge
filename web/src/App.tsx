import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { useLiveSync } from '@/hooks/queries'
import Chat from '@/pages/Chat'
import Dashboard from '@/pages/Dashboard'
import Inquiries from '@/pages/Inquiries'
import InquiryDetail from '@/pages/InquiryDetail'
import Quotes from '@/pages/Quotes'
import Places from '@/pages/Places'
import Settings from '@/pages/Settings'
import Itinerary from '@/pages/Itinerary'
import PartnerIndex from '@/pages/partners/PartnerIndex'
import PartnerPortal from '@/pages/partners/PartnerPortal'
import NotFound from '@/pages/NotFound'
import { PARTNER_TYPES, PARTNER_META } from '@/lib/partners'

export default function App() {
  // Opens the realtime stream and bridges pushes into the query cache.
  useLiveSync()

  return (
    <Routes>
      {/*
        Patient-facing routes. Deliberately OUTSIDE the operations shell: no
        sidebar, no internal navigation, no staff chrome.

        `/` is the front door — the guided chat where a visitor describes what
        they need and shapes their own bundle. The operations portal lives
        behind /dashboard, reachable from the header button.
      */}
      <Route index element={<Chat />} />
      <Route path="/itinerary/:token" element={<Itinerary />} />

      {/* Operations portal */}
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/inquiries" element={<Inquiries />} />
        <Route path="/inquiries/:id" element={<InquiryDetail />} />
        <Route path="/quotes" element={<Quotes />} />
        <Route path="/places" element={<Places />} />
        <Route path="/settings" element={<Settings />} />

        {/*
          Retired screens, redirected rather than 404'd so a bookmark still
          lands somewhere useful.

          Doctors and treatment pricing are partner-owned — they live in each
          hospital's own portal. Patients is a tab on the pipeline now; the
          per-case audit trail that used to be /ai-activity sits inside the case
          it describes. Messages and Analytics are gone outright: the first
          duplicated the patient chat, the second charted a handful of rows.
        */}
        <Route path="/doctors" element={<Navigate to="/hospital" replace />} />
        <Route path="/treatments" element={<Navigate to="/hospital" replace />} />
        <Route path="/logistics" element={<Navigate to="/places" replace />} />
        <Route path="/patients" element={<Navigate to="/inquiries?view=patients" replace />} />
        <Route path="/ai-activity" element={<Navigate to="/inquiries" replace />} />
        <Route path="/messages" element={<Navigate to="/inquiries" replace />} />
        <Route path="/analytics" element={<Navigate to="/dashboard" replace />} />

        {/*
          Partner portals — one tenant type per top-level segment, exactly as
          a supplier would be given: /hospital/:id, /hotel/:id, and so on.

          Generated from PARTNER_TYPES rather than written out four times, so
          adding a fifth supplier type is one entry in `lib/partners.ts`.

          These sit inside AppShell for the prototype so the sidebar stays
          available to move between roles. A real partner deployment would
          render them outside it — a hotel has no business seeing MedBridge's
          inquiry pipeline in a nav rail.
        */}
        {PARTNER_TYPES.map((type) => (
          <Route key={type} path={PARTNER_META[type].path}>
            <Route index element={<PartnerIndex type={type} />} />
            <Route path=":id" element={<PartnerPortal type={type} />} />
          </Route>
        ))}

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
