import { Link } from 'react-router-dom'
import { MessageCircle, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, initials } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'

/**
 * Portal chrome: who you are, whether the event stream is up, and one way out
 * to the patient-facing chat.
 *
 * The "Run Live Demo" button and its mute toggle used to sit here. Both are
 * gone: the demo simulated inbound patients, and there is a real front door at
 * `/` now that does it for real.
 */
export function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const operatorName = useAppStore((state) => state.operatorName)
  const hospitalName = useAppStore((state) => state.hospitalName)
  const realtimeStatus = useAppStore((state) => state.realtimeStatus)

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur-md lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="hidden min-w-0 flex-1 md:block">
        <p className="truncate text-sm font-semibold text-slate-900">{hospitalName}</p>
        <p className="text-xs text-slate-500">Operations Portal</p>
      </div>
      <div className="flex-1 md:hidden" />

      {/* Realtime indicator */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset sm:flex',
              realtimeStatus === 'live'
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : realtimeStatus === 'connecting'
                  ? 'bg-amber-50 text-amber-700 ring-amber-200'
                  : 'bg-slate-100 text-slate-500 ring-slate-200',
            )}
          >
            <span className="relative flex h-2 w-2">
              {realtimeStatus === 'live' && (
                <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-emerald-400" />
              )}
              <span
                className={cn(
                  'relative inline-flex h-2 w-2 rounded-full',
                  realtimeStatus === 'live'
                    ? 'bg-emerald-500'
                    : realtimeStatus === 'connecting'
                      ? 'bg-amber-500'
                      : 'bg-slate-400',
                )}
              />
            </span>
            {realtimeStatus === 'live'
              ? 'Live'
              : realtimeStatus === 'connecting'
                ? 'Connecting'
                : 'Offline'}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          Operational event stream. Frames are structured records from the backend — never raw
          model output.
        </TooltipContent>
      </Tooltip>

      {/* Staff can see exactly what a visitor sees. */}
      <Button asChild variant="outline" size="sm">
        <Link to="/">
          <MessageCircle className="h-4 w-4" />
          <span className="hidden sm:inline">Patient chat</span>
        </Link>
      </Button>

      <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
        <Avatar className="h-8 w-8">
          <AvatarFallback>{initials(operatorName)}</AvatarFallback>
        </Avatar>
        <div className="hidden lg:block">
          <p className="text-xs font-semibold leading-tight text-slate-900">{operatorName}</p>
          <p className="text-[11px] leading-tight text-slate-500">Operations Staff</p>
        </div>
      </div>
    </header>
  )
}
