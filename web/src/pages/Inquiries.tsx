import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Columns3, Search, Table2, Users, X } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { KanbanBoard } from '@/components/inquiries/KanbanBoard'
import { InquiryTable } from '@/components/inquiries/InquiryTable'
import { PatientDirectory } from '@/components/inquiries/PatientDirectory'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useInquiries } from '@/hooks/queries'
import { INQUIRY_STATUSES, type InquiryStatus } from '@/types'
import { STATUS_META } from '@/lib/constants'

type View = 'kanban' | 'table' | 'patients'

export default function Inquiries() {
  /*
   * `?status=` seeds the filter so a link can open one lane — "3 cases need a
   * doctor" should land on those three, not on everything. `?view=patients`
   * opens the directory, which is where /patients now redirects.
   *
   * Both seed the initial state rather than driving it: once the page is open
   * the controls own it, so changing them does not rewrite the URL and the back
   * button still leaves the page. An unrecognised value is ignored, because a
   * typo'd query string should show the full pipeline rather than an empty one
   * that looks like a quiet day.
   */
  const [searchParams] = useSearchParams()
  const requestedStatus = searchParams.get('status')
  const initialStatus: InquiryStatus | 'ALL' =
    requestedStatus && (INQUIRY_STATUSES as readonly string[]).includes(requestedStatus)
      ? (requestedStatus as InquiryStatus)
      : 'ALL'

  // A deep link opens in the table: a kanban filtered to one status is ten
  // empty lanes and one full one, which reads as a broken board.
  const [view, setView] = useState<View>(
    searchParams.get('view') === 'patients'
      ? 'patients'
      : initialStatus === 'ALL'
        ? 'kanban'
        : 'table',
  )
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<InquiryStatus | 'ALL'>(initialStatus)
  const [channel, setChannel] = useState('ALL')

  /*
   * 'ALL' is a Select sentinel, not a channel. It must never reach the wire:
   * the backend does `where('channel', $value)` unconditionally, so sending it
   * matched zero rows and the whole pipeline rendered as an empty board while
   * the sidebar badge — which queries unfiltered — still counted the case.
   * An absent key is how you say "no filter" here.
   */
  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: status === 'ALL' ? undefined : [status],
      channel: channel === 'ALL' ? undefined : channel,
    }),
    [search, status, channel],
  )

  const { data: inquiries, isLoading, isFetching } = useInquiries(filters)
  const rows = inquiries ?? []
  const showingPatients = view === 'patients'
  const hasFilters = Boolean(search) || status !== 'ALL' || channel !== 'ALL'

  const clearFilters = () => {
    setSearch('')
    setStatus('ALL')
    setChannel('ALL')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inquiries"
        description={
          showingPatients
            ? 'Everyone who has come through MedBridge, and what their care was worth.'
            : `${rows.length} case${rows.length === 1 ? '' : 's'} across the cross-border workflow.`
        }
        actions={
          <Tabs value={view} onValueChange={(value) => setView(value as View)}>
            <TabsList>
              <TabsTrigger value="kanban">
                <Columns3 />
                Board
              </TabsTrigger>
              <TabsTrigger value="table">
                <Table2 />
                Table
              </TabsTrigger>
              <TabsTrigger value="patients">
                <Users />
                Patients
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {/* One filter row, above everything it scopes. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[15rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              showingPatients
                ? 'Search patient or treatment…'
                : 'Search reference, patient, procedure or message…'
            }
            className="pl-9"
          />
        </div>

        {/*
          Status and channel scope cases, and the directory is a list of people.
          Leaving them visible there would offer filters that change nothing.
        */}
        {!showingPatients && (
          <>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as InquiryStatus | 'ALL')}
            >
              <SelectTrigger className="w-[13.5rem]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {INQUIRY_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_META[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="w-[10rem]">
                <SelectValue placeholder="All channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All channels</SelectItem>
                <SelectItem value="WEB">Web Chat</SelectItem>
                <SelectItem value="INTERNAL">Internal</SelectItem>
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </>
        )}
      </div>

      {/* Hold the previous render at reduced opacity on refetch — no skeleton flash. */}
      <div className={isFetching && !isLoading ? 'opacity-60 transition-opacity' : undefined}>
        {view === 'kanban' ? (
          <KanbanBoard inquiries={rows} loading={isLoading} />
        ) : view === 'table' ? (
          <InquiryTable inquiries={rows} loading={isLoading} />
        ) : (
          <PatientDirectory search={search} />
        )}
      </div>
    </div>
  )
}
