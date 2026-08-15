import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  Info,
  LayoutDashboard,
  Phone,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { PlanFlow } from '@/components/chat/PlanFlow'
import { chatApi } from '@/services/api'
import { ApiError } from '@/services/http'
import { cn } from '@/lib/utils'
import { formatDate, formatSgd } from '@/lib/format'
import { SUPPORT_PHONE } from '@/lib/constants'
import type {
  ChatBundle,
  ChatChoiceOption,
  ChatMessage,
  ChatSession,
  ChatUi,
} from '@/types'

const STORAGE_KEY = 'medbridge.chat-token.v1'

/**
 * The MedBridge front door.
 *
 * An application, not a website with a chat box on it. There is no landing
 * page in front of the assistant, because there is nothing for one to do: the
 * first question is already on screen. The conversation *is* the first screen —
 * header, transcript, composer, one viewport, nothing above it to scroll past.
 *
 * When there is something to price, the plan takes the screen and the assistant
 * drops to a control in the step bar, raising the same transcript and the same
 * composer over the plan when it is wanted. Three earlier shapes were all a
 * version of the same mistake:
 *
 *   - side by side, which asked the visitor to read a conversation and evaluate
 *     two dozen priced choices at once;
 *   - two views that swapped, where every question cost them the plan;
 *   - a gradient hero with a chat card floating on it, which made the assistant
 *     look bolted onto a brochure and the plan, later, like a third site.
 *
 * What holds it together is that the assistant never changes edge. It is at the
 * bottom of the screen before the plan exists and after it, so there is only
 * ever one place to go to say something.
 *
 * Two things worth knowing when reading this file:
 *
 *  1. Nothing rendered here was written by a model. Every prompt and option
 *     comes from the backend's question bank; Hermes only decides which
 *     question is next. That is what keeps rule 5 true in a chat UI.
 *
 *  2. This flow cannot book anything. It ends by submitting a request that a
 *     human reviews, and there is no itinerary link until someone approves it.
 */
/**
 * How close to the bottom still counts as "following the conversation". Above
 * this the visitor is reading something further up and we leave them alone.
 */
const PINNED_SLACK_PX = 120

export default function Chat() {
  const [session, setSession] = useState<ChatSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // A subset of `busy`: the assistant is answering, as opposed to the plan
  // being repriced. Only the former belongs in the transcript.
  const [thinking, setThinking] = useState(false)
  /*
   * The visitor's own turn, shown the moment they send it.
   *
   * The transcript is server-owned: their message only exists in it once the
   * round trip returns, which on a model call is a second or two. Without this,
   * pressing send empties the box and shows nothing but three dots — the thing
   * they just wrote appears to have been swallowed. So we render it locally and
   * drop it when the authoritative transcript arrives carrying the real one.
   */
  const [pending, setPending] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [unpinned, setUnpinned] = useState(false)
  /*
   * Whether the visitor has raised the conversation over the plan. Before there
   * is a plan this means nothing — the conversation is the screen — which is
   * why the render reads `chatExpanded` and not this flag directly.
   */
  const [chatOpen, setChatOpen] = useState(false)

  /*
   * Scrolling is scoped to the transcript, never the page. `scrollIntoView`
   * walks every scrollable ancestor, so anchoring the last turn also dragged
   * the window, and the visitor had to scroll the page back after every send.
   * `scrollTop` on this element moves this element only.
   */
  const listRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pinnedRef = useRef(true)
  const animatingRef = useRef(false)
  const firstPaintRef = useRef(true)
  const refocusRef = useRef(false)
  const handedOffRef = useRef(false)

  /* ---- What the page is showing ---- */

  const stage = session?.stage
  const hasPlan = Boolean(session?.bundle)
  /*
   * A submitted request has nothing left to edit, so the plan comes off the
   * page and the confirmation lands at the end of the conversation it came out
   * of — which by then is the whole page again.
   */
  const planVisible = hasPlan && stage !== 'SUBMITTED'
  // Before there is a plan the conversation IS the page; after, it is unfolded
  // only when the visitor asks for it.
  const chatExpanded = !planVisible || chatOpen

  /* ---- Session bootstrap: resume on refresh, otherwise start fresh ---- */
  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      const saved = localStorage.getItem(STORAGE_KEY)

      if (saved) {
        try {
          const resumed = await chatApi.get(saved)
          if (!cancelled) {
            setSession(resumed)
            setLoading(false)
          }
          return
        } catch (error) {
          // A 404 means expired or unknown — start over rather than stranding
          // the visitor on a dead token.
          if (error instanceof ApiError) {
            localStorage.removeItem(STORAGE_KEY)
          } else {
            if (!cancelled) setLoading(false)
            toast.error('We could not reach MedBridge', {
              description: 'Please check your connection and refresh.',
            })
            return
          }
        }
      }

      try {
        const fresh = await chatApi.start()
        if (cancelled) return
        localStorage.setItem(STORAGE_KEY, fresh.token)
        setSession(fresh)
      } catch {
        toast.error('We could not start the assistant', {
          description: `Please refresh, or call us on ${SUPPORT_PHONE}.`,
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  /* ---- Keeping the transcript at the latest turn ---- */

  const scrollToLatest = (behavior: ScrollBehavior) => {
    const list = listRef.current
    if (!list) return

    pinnedRef.current = true
    setUnpinned(false)

    if (behavior === 'smooth') {
      // The observer below must not fight the animation mid-flight.
      animatingRef.current = true
      window.setTimeout(() => {
        animatingRef.current = false
      }, 400)
    }

    list.scrollTo({ top: list.scrollHeight, behavior })
  }

  // Scrolling away is a deliberate act — reading back over an earlier answer —
  // so it suspends the auto-follow until the visitor returns to the bottom.
  const handleListScroll = () => {
    const list = listRef.current
    // Our own smooth scroll fires this too, and mid-flight it looks exactly
    // like scrolling away — which would flash the jump button on every turn.
    if (!list || animatingRef.current) return

    /*
     * A list with nothing to scroll is always at its latest turn.
     *
     * Without this, one scroll event fired before layout had settled — when the
     * container still measured zero high — read as "scrolled a long way up" and
     * stranded the jump button over a greeting. Nothing could clear it either:
     * a list that cannot scroll never fires another scroll event.
     */
    const overflowing = list.scrollHeight - list.clientHeight > PINNED_SLACK_PX
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight
    const pinned = !overflowing || distance <= PINNED_SLACK_PX

    pinnedRef.current = pinned
    setUnpinned(!pinned)
  }

  /*
   * A turn is not one layout pass: the bubble arrives, then its option chips
   * mount and wrap. Watching the content box catches the whole settle, which a
   * single effect on `messages.length` does not.
   *
   * Re-runs when the conversation folds, because folding unmounts the
   * transcript: an observer left watching the discarded node silently stops
   * following the conversation the next time it is opened.
   */
  useEffect(() => {
    const list = listRef.current
    const content = contentRef.current
    if (!list || !content) return

    const observer = new ResizeObserver(() => {
      // A conversation that has grown short again — a fresh start, a resize —
      // has nowhere to jump to, so the button goes with it.
      if (list.scrollHeight - list.clientHeight <= PINNED_SLACK_PX) {
        pinnedRef.current = true
        setUnpinned(false)
      }
      if (!pinnedRef.current || animatingRef.current) return
      list.scrollTop = list.scrollHeight
    })

    observer.observe(content)
    return () => observer.disconnect()
  }, [chatExpanded])

  const lastMessage = session?.messages[session.messages.length - 1]

  useEffect(() => {
    if (!lastMessage || !pinnedRef.current) return

    // No animation on the first paint — a resumed conversation should simply
    // open at the bottom rather than scroll itself there.
    scrollToLatest(firstPaintRef.current ? 'auto' : 'smooth')
    firstPaintRef.current = false
    // The echo and the typing bubble are turns too — both change the height of
    // the transcript, and both should leave it sitting at the bottom.
    // `chatExpanded` is in here because folding unmounts the transcript:
    // unfolding it remounts at scroll zero, which opens the conversation on the
    // greeting instead of on the turn they left off at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    lastMessage?.id,
    lastMessage?.ui?.kind,
    session?.messages.length,
    pending,
    thinking,
    chatExpanded,
  ])

  // Typing, then a send, then a disabled input: focus has to be handed back or
  // the next message needs a click first.
  useEffect(() => {
    if (busy || !refocusRef.current) return
    refocusRef.current = false
    inputRef.current?.focus()
  }, [busy])

  /* ---- Moving between the conversation and the plan ---- */

  /*
   * The first plan, once.
   *
   * The conversation gives the screen over to it, so the page starts at the top
   * — the second shell has a document scroll where the first had none, and
   * inheriting a stale offset would open the plan halfway down itself. Once
   * only: doing this on every reprice would drag the page out from under
   * someone who is reading.
   */
  useEffect(() => {
    if (!hasPlan) {
      handedOffRef.current = false
      return
    }
    if (handedOffRef.current) return

    handedOffRef.current = true
    setChatOpen(false)
    window.scrollTo({ top: 0 })
  }, [hasPlan])

  /*
   * Raising arms the "open at the bottom" path, so the conversation appears at
   * the turn they left off at rather than animating up through the whole thing
   * from the greeting.
   */
  const openChat = () => {
    firstPaintRef.current = true
    setChatOpen(true)
  }

  // Lowering leaves the plan exactly where it was. Nothing behind the dock
  // moved while it was up, so there is nothing to restore.
  const closeChat = () => setChatOpen(false)

  /* ---- Actions ---- */

  const describe = (error: unknown, fallback: string) =>
    error instanceof ApiError && typeof error.body === 'object' && error.body !== null
      ? String((error.body as { message?: string }).message ?? fallback)
      : fallback

  /**
   * One conversational turn.
   *
   * `echo` is what the visitor just said, in their own words — the typed text,
   * or the label of the chip they tapped. It holds their place in the
   * transcript until the server's copy replaces it.
   */
  const run = async (action: () => Promise<ChatSession>, echo?: string) => {
    setBusy(true)
    setThinking(true)
    if (echo !== undefined) setPending(echo)

    try {
      setSession(await action())
      return true
    } catch (error) {
      toast.error('Something went wrong', {
        description: describe(error, `Please try again, or call us on ${SUPPORT_PHONE}.`),
      })
      return false
    } finally {
      // Cleared alongside the new transcript, so the echo hands over to the
      // real message in one paint instead of blinking out and back in.
      setPending(null)
      setBusy(false)
      setThinking(false)
    }
  }

  const patchBundle = async (fn: () => Promise<{ bundle: ChatBundle }>) => {
    setBusy(true)
    try {
      const { bundle } = await fn()
      setSession((prev) => (prev ? { ...prev, bundle } : prev))
    } catch (error) {
      toast.error('Could not update your plan', { description: describe(error, 'Please try again.') })
    } finally {
      setBusy(false)
    }
  }

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || !session || busy) return
    setDraft('')
    refocusRef.current = true
    // A send is always a request to follow along, even if they had scrolled up.
    scrollToLatest('smooth')

    // Nothing reached the server, so nothing is in the transcript: hand the
    // words back to the box rather than losing what they typed.
    if (!(await run(() => chatApi.send(session.token, text), text))) {
      setDraft(text)
    }
  }

  const handleRestart = async () => {
    localStorage.removeItem(STORAGE_KEY)
    setLoading(true)
    setSession(null)
    try {
      const fresh = await chatApi.start()
      localStorage.setItem(STORAGE_KEY, fresh.token)
      setSession(fresh)
    } catch {
      toast.error('Could not start a new conversation')
    } finally {
      setLoading(false)
    }
  }

  /* ---- Render ---- */

  const canType = Boolean(session) && stage !== 'SUBMITTED' && stage !== 'EMERGENCY'
  const planEditable = stage === 'RECOMMENDED' && !busy
  const bundle = session?.bundle ?? null
  // `findLast` needs a newer lib target than this project builds against.
  const submitted = session?.messages
    .slice()
    .reverse()
    .find((message) => message.ui?.kind === 'submitted')?.ui

  /* ---- The two pieces, built once and placed twice ---- */

  /**
   * The conversation itself. No card, no border, no shadow: it is the page it
   * is on, not a widget embedded in one.
   */
  const transcript = (
    <div className="relative min-h-0 flex-1">
      <div
        ref={listRef}
        onScroll={handleListScroll}
        className="scrollbar-thin h-full overflow-y-auto overscroll-contain"
      >
        <div ref={contentRef} className="mx-auto w-full max-w-2xl space-y-5 px-4 py-5">
          {/* What the page is, said once, at the top of the conversation and
              scrolling away with it. It used to be a gradient banner the chat
              box sat on top of, which made the assistant look like a widget
              bolted onto a brochure — and the plan, later, like a third site. */}
          {!hasPlan && <Opening />}

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-3/4 rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          ) : !session ? (
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-slate-800">The assistant is unavailable.</p>
              <p className="mt-1 text-sm text-slate-500">
                Please call us on {SUPPORT_PHONE} and we'll help you directly.
              </p>
              <Button className="mt-4" onClick={handleRestart}>
                <RefreshCw className="h-4 w-4" />
                Try again
              </Button>
            </div>
          ) : (
            session.messages.map((message) => (
              <Turn
                key={message.id}
                message={message}
                busy={busy}
                onChoice={(slot, value, label) => {
                  void run(() => chatApi.choose(session.token, slot, value), label)
                }}
                onSend={(text) => {
                  void run(() => chatApi.send(session.token, text), text)
                }}
              />
            ))
          )}

          {/* Their turn, before the server has one. Same bubble as the real
              thing — only dimmed, so the wait reads as "sending" rather than as
              a different kind of message. */}
          {pending !== null && session && (
            <div className="flex animate-in justify-end fade-in slide-in-from-bottom-1">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm text-white opacity-70 shadow-sm">
                {pending}
              </div>
            </div>
          )}

          {/* The assistant is composing — shown in the flow so the list still
              ends at the bottom while we wait. */}
          {thinking && session && <TypingBubble />}

          {/* The confirmation is the last turn of the conversation that
              produced it, not a card on a screen it arrives at. */}
          {submitted?.kind === 'submitted' && (
            <div className="space-y-3 pt-1">
              <SubmittedCard ui={submitted} />
              <Disclaimer />
            </div>
          )}
        </div>
      </div>

      {/* Only while the visitor has scrolled away — otherwise the list follows
          on its own and a button would be noise. */}
      {unpinned && session && (
        <button
          type="button"
          onClick={() => scrollToLatest('smooth')}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-md backdrop-blur transition hover:bg-slate-50"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          Latest message
        </button>
      )}
    </div>
  )

  /**
   * The composer, at the bottom of the viewport in both shells. It is the one
   * thing that never moves — which is most of what makes this read as one
   * screen the visitor is still on rather than a series of them.
   */
  const composer = (
    <div className="shrink-0 border-t border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-2xl px-4 py-3">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSend()
              }
            }}
            placeholder={canType ? 'Type your message…' : 'Your request has been submitted'}
            disabled={busy || !canType}
            aria-label="Message"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={busy || !canType || !draft.trim()}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        {/* The one promise worth standing under the box you type into. */}
        {!hasPlan && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-teal-600" />
            Nothing is booked from this chat — a coordinator reviews every request.
          </p>
        )}
      </div>
    </div>
  )

  /*
   * ---- Shell one: the conversation is the application ----
   *
   * Header, conversation, composer, one viewport, nothing above it to scroll
   * past. There is no landing page in front of this because there is nothing
   * for one to do: the first question is already on screen.
   */
  if (!planVisible || !session || !bundle) {
    return (
      <div className="flex h-dvh flex-col bg-white">
        <SiteHeader onRestart={handleRestart} showRestart={Boolean(session)} />
        {transcript}
        {composer}
      </div>
    )
  }

  /*
   * ---- Shell two: the plan is the application ----
   *
   * The same header, and the assistant still at the bottom — as a control in
   * the step bar rather than an open composer, raising the conversation over
   * the plan when it is wanted. The plan is never navigated away from, so a
   * question costs nothing and there is nothing to find again afterwards.
   */
  return (
    <div className="min-h-dvh bg-slate-50">
      <SiteHeader onRestart={handleRestart} showRestart={Boolean(session)} />

      {/* Fades up on arrival rather than cutting: the conversation just handed
          the screen over, and an instant swap is what made this read as a
          different site. Plays once — the wrapper stays mounted through every
          reprice. Padded out from under the dock while it is raised. */}
      <div
        className={cn(
          'animate-in fade-in slide-in-from-bottom-4 duration-500',
          chatOpen && 'pb-[60vh]',
        )}
      >
        <PlanFlow
          bundle={bundle}
          disabled={!planEditable}
          leading={<AssistantButton open={chatOpen} onToggle={chatOpen ? closeChat : openChat} />}
          pinnedFooter={!chatOpen}
          onToggle={(key, included) =>
            patchBundle(() => chatApi.toggleLine(session.token, key, included))
          }
          onSwap={(key, refId) => patchBundle(() => chatApi.swapLine(session.token, key, refId))}
          onChooseHospital={(refId) =>
            patchBundle(() => chatApi.chooseHospital(session.token, refId))
          }
          onSetNights={(nights) => patchBundle(() => chatApi.setNights(session.token, nights))}
          contactForm={
            <ContactForm
              submitting={busy}
              totalSgd={bundle.totals.totalSgd}
              onSubmit={async (submission) => {
                setBusy(true)
                try {
                  setSession(await chatApi.submit(session.token, submission))
                } catch (error) {
                  toast.error('We could not submit your request', {
                    description: describe(error, 'Please try again in a moment.'),
                  })
                } finally {
                  setBusy(false)
                }
              }}
            />
          }
          disclaimer={<Disclaimer />}
        />
      </div>

      {/*
        Raised, not navigated to. No scrim: the plan stays lit and legible
        behind it, because half the questions asked here are about the row the
        visitor is looking at while they type.
      */}
      {chatOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 flex h-[min(60vh,32rem)] animate-in flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-[0_-8px_30px_rgba(15,23,42,0.14)] slide-in-from-bottom"
          role="dialog"
          aria-label="Care assistant"
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b border-slate-200 px-4 py-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">Care assistant</p>
              <p className="text-[11px] text-slate-500">Your plan updates as you answer</p>
            </div>
            <StageBadge stage={stage} />
            <button
              type="button"
              onClick={closeChat}
              className="flex shrink-0 items-center gap-0.5 rounded-full px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            >
              Hide
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </header>

          {transcript}
          {composer}
        </div>
      )}
    </div>
  )
}

/**
 * What this page is, in the only place it belongs: at the top of the
 * conversation, in the same column, scrolling away as the conversation starts.
 *
 * It replaced a full-bleed gradient hero carrying the same three claims at four
 * times the size. The hero was not wrong about the claims — it was wrong about
 * being a separate thing the assistant was placed on.
 */
const CLAIMS = [
  'Choose your own hospital',
  'Every price from the catalogue',
  'Reviewed by a person',
]

function Opening() {
  return (
    <div className="border-b border-slate-100 pb-5">
      <h1 className="text-lg font-bold leading-snug tracking-tight text-slate-900">
        Plan your Batam treatment trip
      </h1>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Tell the care assistant what you need. We build the whole trip from real hospital pricing —
        treatment, ferries, hotel and transfers — and you choose every part of it.
      </p>

      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-slate-500">
        {CLAIMS.map((claim) => (
          <li key={claim} className="flex items-center gap-1">
            <Check className="h-3 w-3 shrink-0 text-teal-600" />
            {claim}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The assistant, once the plan owns the screen.
 *
 * It sits in the step bar at the bottom — the same edge the composer occupied a
 * moment ago — so the thing the visitor talks to has not moved, only shrunk.
 */
function AssistantButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant={open ? 'default' : 'outline'}
      size="icon"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? 'Hide the care assistant' : 'Ask the care assistant'}
      title={open ? 'Hide the care assistant' : 'Ask the care assistant'}
    >
      <Sparkles className="h-4 w-4" />
    </Button>
  )
}

/* -------------------------------------------------------------------------- */
/* Chrome                                                                      */
/* -------------------------------------------------------------------------- */

function SiteHeader({ onRestart, showRestart }: { onRestart: () => void; showRestart: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      {/* Aligned to the content column, not the viewport — the whole page is
          one centred column now, and a logo floating far to its left reads as
          a different page from the one underneath it. */}
      <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-teal-500 text-white">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900">MedBridge Pass</p>
          <p className="truncate text-[11px] text-slate-500">
            Treatment in Batam, arranged end to end
          </p>
        </div>

        {showRestart && (
          <Button variant="ghost" size="icon-sm" onClick={onRestart} title="Start over">
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}

        {/* The way into the hospital operations portal. */}
        <Button asChild variant="outline" size="sm">
          <Link to="/dashboard">
            <LayoutDashboard className="h-4 w-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
        </Button>
      </div>
    </header>
  )
}

function StageBadge({ stage }: { stage: ChatSession['stage'] | undefined }) {
  if (!stage) return null

  const meta = {
    COLLECTING: { label: 'In progress', variant: 'neutral' as const },
    RECOMMENDED: { label: 'Plan ready', variant: 'default' as const },
    SUBMITTED: { label: 'Submitted', variant: 'success' as const },
    EMERGENCY: { label: 'Urgent care', variant: 'destructive' as const },
  }[stage]

  return (
    <Badge variant={meta.variant} size="sm">
      {meta.label}
    </Badge>
  )
}

/*
 * Standing fine print, styled as fine print.
 *
 * It used to wear amber, which in this design system means "needs attention"
 * (docs/05). Nothing here needs attention — it is always true, on every plan —
 * and a permanent alarm beside the one banner that IS conditional (the budget)
 * taught the patient to discount both.
 */
function Disclaimer() {
  return (
    <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-slate-400">
      <Info className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>
        This platform provides travel and cost estimates for planning purposes only. Medical
        suitability, treatment recommendations, availability and final pricing are confirmed by the
        treating hospital and doctor before anything is booked.
      </span>
    </p>
  )
}

/* -------------------------------------------------------------------------- */
/* One conversational turn                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The assistant is composing.
 *
 * Sits in the flow rather than floating, so the transcript still ends at the
 * bottom while we wait and the answer lands exactly where the dots were.
 */
function TypingBubble() {
  return (
    <div
      className="flex animate-in gap-2.5 fade-in"
      role="status"
      aria-live="polite"
      aria-label="The care assistant is typing"
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-slate-100 px-3.5 py-3">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
            style={{ animationDelay: `${dot * 120}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

function Turn({
  message,
  busy,
  onChoice,
  onSend,
}: {
  message: ChatMessage
  busy: boolean
  /** `label` is what the tap says in the visitor's voice — echoed while we wait. */
  onChoice: (slot: string, value: string | number, label: string) => void
  onSend: (text: string) => void
}) {
  if (message.role === 'PATIENT') {
    return (
      <div className="flex animate-in justify-end fade-in slide-in-from-bottom-1">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm text-white shadow-sm">
          {message.body}
        </div>
      </div>
    )
  }

  return (
    <div className="animate-in space-y-2.5 fade-in slide-in-from-bottom-1">
      <div className="flex gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-slate-100 px-3.5 py-2 text-sm leading-relaxed text-slate-700">
          {message.body}
        </div>
      </div>

      {message.ui && (
        <div className="pl-9">
          <Attachment ui={message.ui} busy={busy} onChoice={onChoice} onSend={onSend} />
        </div>
      )}
    </div>
  )
}

function Attachment({
  ui,
  busy,
  onChoice,
  onSend,
}: {
  ui: ChatUi
  busy: boolean
  onChoice: (slot: string, value: string | number, label: string) => void
  onSend: (text: string) => void
}) {
  switch (ui.kind) {
    /*
     * The opening turn. No question yet — just a few things the visitor might
     * say, which post as their own message, plus the catalogue folded away for
     * anyone who would rather pick than type.
     */
    case 'intro':
      return <IntroOptions ui={ui} busy={busy} onChoice={onChoice} onSend={onSend} />

    // The visitor asked about something else. Not a dead end: the same openers
    // as the intro, so there is always one tap back into the conversation.
    case 'scope':
      return <ScopeOptions ui={ui} busy={busy} onChoice={onChoice} onSend={onSend} />

    case 'choice':
      return (
        <ProcedureGrid
          options={ui.options}
          busy={busy}
          onPick={(value, label) => onChoice(ui.slot, value, label)}
        />
      )

    case 'date':
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {ui.suggestions.map((suggestion) => (
              <Button
                key={suggestion.value}
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onChoice(ui.slot, suggestion.value, suggestion.label)}
              >
                {suggestion.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5">
            <CalendarDays className="ml-1 h-4 w-4 shrink-0 text-slate-400" />
            <Input
              type="date"
              min={ui.min}
              max={ui.max}
              disabled={busy}
              aria-label="Travel date"
              className="h-8 border-0 shadow-none focus-visible:ring-0"
              onChange={(event) => {
                const picked = event.target.value
                // Echoed the way the backend will write it back, so the bubble
                // does not change shape when the real transcript arrives.
                if (picked) onChoice(ui.slot, picked, formatDate(picked))
              }}
            />
          </div>
        </div>
      )

    case 'emergency':
      return (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="flex items-center gap-2 text-sm font-bold text-rose-900">
            <AlertTriangle className="h-4 w-4" />
            Get help now
          </p>
          <div className="mt-2.5 grid gap-1.5">
            <Button asChild variant="destructive" size="sm">
              <a href={`tel:${ui.contacts.sg_ambulance}`}>
                <Phone className="h-4 w-4" />
                Ambulance {ui.contacts.sg_ambulance}
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`tel:${ui.supportPhone.replace(/\s/g, '')}`}>
                <Phone className="h-4 w-4" />
                MedBridge team
              </a>
            </Button>
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-rose-800">
            Cross-border travel is not appropriate for urgent symptoms. A MedBridge coordinator has
            been alerted and will follow up.
          </p>
        </div>
      )

    // The bundle lives in the plan panel beside the chat, not in the transcript.
    case 'bundle':
    case 'submitted':
    case 'text':
    default:
      return null
  }
}

/* -------------------------------------------------------------------------- */
/* Opening turn                                                                */
/* -------------------------------------------------------------------------- */

function IntroOptions({
  ui,
  busy,
  onChoice,
  onSend,
}: {
  ui: Extract<ChatUi, { kind: 'intro' }>
  busy: boolean
  onChoice: (slot: string, value: string | number, label: string) => void
  onSend: (text: string) => void
}) {
  return (
    <TreatmentOpeners
      quickReplies={ui.quickReplies}
      browse={ui.browse}
      busy={busy}
      onChoice={onChoice}
      onSend={onSend}
    />
  )
}

/**
 * The reply to a question this assistant is not for.
 *
 * Rendered as a quiet aside rather than an error: being asked about football is
 * not the visitor doing something wrong. The openers come first so the way back
 * is a tap, and the phone number appears only on a repeat — by then a person is
 * a better answer than a third nudge.
 */
function ScopeOptions({
  ui,
  busy,
  onChoice,
  onSend,
}: {
  ui: Extract<ChatUi, { kind: 'scope' }>
  busy: boolean
  onChoice: (slot: string, value: string | number, label: string) => void
  onSend: (text: string) => void
}) {
  return (
    <div className="space-y-2.5">
      <TreatmentOpeners
        quickReplies={ui.quickReplies}
        browse={ui.browse}
        // Already asked once — offer the catalogue open, not folded away.
        defaultOpen
        busy={busy}
        onChoice={onChoice}
        onSend={onSend}
      />

      {ui.supportPhone && (
        <a
          href={`tel:${ui.supportPhone.replace(/\s/g, '')}`}
          className="flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-brand-300 hover:text-brand-800"
        >
          <Phone className="h-3.5 w-3.5" />
          Call {ui.supportPhone}
        </a>
      )}
    </div>
  )
}

/**
 * Openers plus the catalogue behind a disclosure.
 *
 * Shared by the greeting and the out-of-scope reply: both need to say "here is
 * what I can do" and both need the full list one tap away without a wall of
 * cards arriving uninvited.
 */
function TreatmentOpeners({
  quickReplies,
  browse,
  busy,
  defaultOpen = false,
  onChoice,
  onSend,
}: {
  quickReplies: { label: string; message: string }[]
  browse?: ChatChoiceOption[]
  busy: boolean
  defaultOpen?: boolean
  onChoice: (slot: string, value: string | number, label: string) => void
  onSend: (text: string) => void
}) {
  const [browsing, setBrowsing] = useState(defaultOpen)

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {quickReplies.map((reply) => (
          <button
            key={reply.label}
            type="button"
            disabled={busy}
            onClick={() => onSend(reply.message)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 disabled:opacity-60"
          >
            {reply.label}
          </button>
        ))}

        {browse && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setBrowsing((open) => !open)}
            className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-800 disabled:opacity-60"
          >
            {browsing ? 'Hide' : 'Browse all treatments'}
            <ChevronDown className={cn('h-3 w-3 transition', browsing && 'rotate-180')} />
          </button>
        )}
      </div>

      {browse && browsing && (
        <ProcedureGrid
          options={browse}
          busy={busy}
          onPick={(value, label) => onChoice('procedure_code', value, label)}
        />
      )}
    </div>
  )
}

/**
 * The treatment catalogue, two-up and compact rather than a stack of slabs.
 *
 * Sized by the catalogue, which is expected to grow: past a handful of options
 * the grid scrolls inside a fixed height instead of pushing the conversation
 * off the screen, and past a dozen it gains a filter, because scanning is a
 * worse way to find "gastroscopy" than typing three letters of it.
 *
 * Both thresholds are deliberately above today's six, so the current catalogue
 * renders exactly as it did before.
 */
const BROWSE_SCROLL_THRESHOLD = 6
const BROWSE_SEARCH_THRESHOLD = 12

function ProcedureGrid({
  options,
  busy,
  onPick,
}: {
  options: ChatChoiceOption[]
  busy: boolean
  /** The label rides along so the tap can be echoed in the visitor's voice. */
  onPick: (value: string | number, label: string) => void
}) {
  const [query, setQuery] = useState('')

  const needle = query.trim().toLowerCase()
  // Detail carries the clinical wording ("phacoemulsification"), which is often
  // what a visitor half-remembers when the treatment name escapes them.
  const visible = needle
    ? options.filter((option) =>
        `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(needle),
      )
    : options

  return (
    <div className="space-y-1.5">
      {options.length > BROWSE_SEARCH_THRESHOLD && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search treatments"
            aria-label="Search treatments"
            className="h-8 pl-8 text-xs"
          />
        </div>
      )}

      <div
        className={cn(
          'grid gap-1.5 sm:grid-cols-2',
          options.length > BROWSE_SCROLL_THRESHOLD && 'max-h-72 overflow-y-auto pr-1',
        )}
      >
        {visible.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            disabled={busy}
            onClick={() => onPick(option.value, option.label)}
            className="group rounded-xl border border-slate-200 bg-white p-2.5 text-left transition hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-60"
          >
            <p className="text-xs font-semibold leading-snug text-slate-800">{option.label}</p>
            {option.meta ? (
              <p className="mt-1 text-[11px] text-slate-500">
                from{' '}
                <span className="tabular font-semibold text-brand-700">
                  {formatSgd(option.meta.fromSgd)}
                </span>{' '}
                <span className="tabular line-through">{formatSgd(option.meta.singaporeSgd)}</span>{' '}
                in SG
              </p>
            ) : (
              option.detail && <p className="mt-1 text-[11px] text-slate-500">{option.detail}</p>
            )}
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-3 text-[11px] leading-relaxed text-slate-500">
          Nothing matches “{query.trim()}”. Describe it in your own words instead — the assistant
          reads plain English, and a coordinator picks up anything it cannot place.
        </p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Submission                                                                  */
/* -------------------------------------------------------------------------- */

function SubmittedCard({
  ui,
}: {
  ui: Extract<ChatUi, { kind: 'submitted' }>
}) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-emerald-900">
        <BadgeCheck className="h-4 w-4" />
        Request {ui.reference} sent
      </p>

      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-emerald-800">Estimated total</dt>
          <dd className="tabular font-semibold text-emerald-900">
            {formatSgd(ui.totals.totalSgd)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-emerald-800">You save</dt>
          <dd className="tabular font-semibold text-emerald-900">
            {formatSgd(ui.totals.savingsSgd)} ({ui.totals.savingsPct.toFixed(0)}%)
          </dd>
        </div>
      </dl>

      {ui.requiresDoctorReview && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-white/70 p-2.5 text-[11px] leading-relaxed text-emerald-900">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
          This procedure is reviewed by one of our specialists before your quote is confirmed.
        </p>
      )}

      {/*
        Deliberately NOT a link to the itinerary. The pass does not exist yet:
        a token is minted only when a human approves the quote (docs/09 D4), and
        offering a link here would either 404 or force us to break that rule.
      */}
      <p className="mt-3 text-[11px] leading-relaxed text-emerald-800">
        The hospital confirms pricing and availability, then a coordinator finalises your
        itinerary and sends you a private link. Every request is checked by a person — we never
        send an automated quote.
      </p>
    </div>
  )
}

function ContactForm({
  onSubmit,
  submitting,
  totalSgd,
}: {
  onSubmit: (submission: {
    fullName: string
    phone: string
    email?: string
    yearOfBirth?: number
    consent: boolean
    notes?: string
  }) => void
  submitting: boolean
  totalSgd: number
}) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [yearOfBirth, setYearOfBirth] = useState('')
  const [notes, setNotes] = useState('')
  const [consent, setConsent] = useState(false)

  const valid = fullName.trim().length >= 2 && phone.trim().length >= 6 && consent

  /*
   * Always open, because it no longer has to share a screen with the choosing.
   * It lives on the review step, which the visitor reaches only once they are
   * done editing — asking for a passport name while someone is still comparing
   * ferries was a question out of order.
   */
  return (
    <section className="space-y-3 rounded-2xl border border-brand-200 bg-white p-4 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-slate-800">Send this plan to the hospital</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
          Your estimate is {formatSgd(totalSgd)}. A coordinator confirms availability and final
          pricing with you before anything is reserved.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="chat-name">Your name</Label>
        <Input
          id="chat-name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="As it appears on your passport"
          autoComplete="name"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="chat-phone">Mobile</Label>
          <Input
            id="chat-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+65 …"
            autoComplete="tel"
            inputMode="tel"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="chat-yob">Year of birth</Label>
          <Input
            id="chat-yob"
            value={yearOfBirth}
            onChange={(event) => setYearOfBirth(event.target.value)}
            placeholder="1979"
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="chat-email">Email (optional)</Label>
        <Input
          id="chat-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="chat-notes">Anything we should know? (optional)</Label>
        <Textarea
          id="chat-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Mobility needs, preferred appointment time, allergies…"
          rows={2}
        />
      </div>

      {/*
        PDPA consent, captured explicitly at first contact and stored with a
        timestamp. Not a pre-ticked box.
      */}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        <span className="text-[11px] leading-relaxed text-slate-600">
          I agree that MedBridge and its partner hospital may hold and use these details to prepare
          and confirm my treatment and travel arrangements.
        </span>
      </label>

      <Button
        size="lg"
        className={cn('w-full')}
        disabled={!valid || submitting}
        onClick={() =>
          onSubmit({
            fullName: fullName.trim(),
            phone: phone.trim(),
            email: email.trim() || undefined,
            yearOfBirth: /^\d{4}$/.test(yearOfBirth.trim()) ? Number(yearOfBirth.trim()) : undefined,
            consent,
            notes: notes.trim() || undefined,
          })
        }
      >
        <ClipboardList className="h-4 w-4" />
        Send my request
      </Button>
    </section>
  )
}
