import { useState } from 'react'
import { Check, ChevronRight, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface JsonInspectorProps {
  data: unknown
  label?: string
  defaultOpen?: boolean
  className?: string
}

/**
 * Collapsible debug view of a backend event payload.
 *
 * This shows STRUCTURED backend JSON only — never model chain-of-thought or raw
 * generated text. It exists for engineers watching the pipeline, and is kept out
 * of every patient-facing surface.
 */
export function JsonInspector({
  data,
  label = 'Event payload',
  defaultOpen = false,
  className,
}: JsonInspectorProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [copied, setCopied] = useState(false)

  const serialised = JSON.stringify(data, null, 2)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serialised)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard is unavailable in insecure contexts — fail quietly.
    }
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border border-slate-200 bg-slate-50', className)}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex flex-1 items-center gap-1.5 text-left text-xs font-medium text-slate-600 transition-colors hover:text-slate-900"
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')}
          />
          <span className="font-mono">{label}</span>
        </button>

        {open && (
          <Button variant="ghost" size="icon-sm" onClick={copy} title="Copy JSON">
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>

      {open && (
        <pre className="scrollbar-thin max-h-72 overflow-auto border-t border-slate-200 bg-slate-900 px-3 py-3 text-[11px] leading-relaxed text-slate-100">
          <code>{serialised}</code>
        </pre>
      )}
    </div>
  )
}
