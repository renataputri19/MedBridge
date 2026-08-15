import { MessageCircle, Building2 } from 'lucide-react'
import { CHANNEL_META } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { Channel } from '@/types'

const ICONS = {
  WEB: MessageCircle,
  INTERNAL: Building2,
} as const

export function ChannelBadge({ channel, className }: { channel: Channel; className?: string }) {
  const meta = CHANNEL_META[channel]
  const Icon = ICONS[channel]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        meta.className,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  )
}
