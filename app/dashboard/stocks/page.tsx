"use client"

import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react"
import { signIn, useSession } from "next-auth/react"
import {
  AnalysisIssueBanner,
  BacktestPanel,
  MonteCarloPanel,
  OverviewSection,
  PERIOD_MAP,
  PriceChartPanel,
  ScenarioPanels,
  SentimentPanel,
  TickerNameBadge,
  type SyncedHoverState,
} from "@/components/stocks-dashboard"

type ShieldAlert = { ticker: string; price: number; msg?: string; type?: string }

function sanitizeTickerInput(value: string) {
  return value.toUpperCase().replace(/[^A-Z.-]/g, "").slice(0, 10)
}

function formatCurrency(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(digits)}` : "N/A"
}

function getShieldSocketUrl(apiBase: string) {
  try {
    const url = new URL(apiBase)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.pathname = "/ws/shield"
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return "ws://localhost:8000/ws/shield"
  }
}

const NavIcon = ({ active, children }: { active?: boolean; children: ReactNode }) => (
  <div className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-colors ${active ? "bg-blue-500/15 text-blue-400" : "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"}`}>
    {children}
  </div>
)

export default function Stocks() {
  const [tickerInput, setTickerInput] = useState("")
  const [activeTicker, setActiveTicker] = useState<string | null>(null)
  const [requestKey, setRequestKey] = useState(0)
  const [period, setPeriod] = useState("1y")
  const [recents, setRecents] = useState<string[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const stored = localStorage.getItem("talos_recents")
      if (!stored) return []
      const parsed = JSON.parse(stored)
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []
    } catch {
      return []
    }
  })
  const [isGuest, setIsGuest] = useState(false)
  const [activeAlert, setActiveAlert] = useState<ShieldAlert | null>(null)
  const [shieldStatus, setShieldStatus] = useState<"connecting" | "live" | "offline">("connecting")
  const [syncedHover, setSyncedHover] = useState<SyncedHoverState>(null)
  const [priceLength, setPriceLength] = useState(0)
  const [backtestLength, setBacktestLength] = useState(0)
  const { data: session, status } = useSession()
  const alertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  const userInitials =
    session?.user?.name?.slice(0, 2).toUpperCase() ||
    session?.user?.email?.slice(0, 2).toUpperCase() ||
    "TU"
  const shieldLabel = { live: "Shield live", connecting: "Connecting…", offline: "Shield offline" }[shieldStatus]
  const shieldClass = {
    live: "border-emerald-600/40 bg-emerald-500/10 text-emerald-400",
    connecting: "border-amber-600/40 bg-amber-500/10 text-amber-400",
    offline: "border-red-600/40 bg-red-500/10 text-red-400",
  }[shieldStatus]
  const canAnalyze = sanitizeTickerInput(tickerInput).length > 0
  const shouldSync = PERIOD_MAP[period] < PERIOD_MAP["2y"]
  const viewingAsGuest = !session && isGuest

  function updateRecents(ticker: string) {
    setRecents(previous => {
      const updated = [ticker, ...previous.filter(entry => entry !== ticker)].slice(0, 5)
      localStorage.setItem("talos_recents", JSON.stringify(updated))
      return updated
    })
  }

  function handleRun(manualTicker?: string) {
    const nextTicker = sanitizeTickerInput(manualTicker ?? tickerInput)
    if (!nextTicker) return
    setTickerInput(nextTicker)
    setActiveTicker(nextTicker)
    setRequestKey(Date.now())
    setSyncedHover(null)
    setPriceLength(0)
    setBacktestLength(0)
    updateRecents(nextTicker)
  }

  const handleHoverChange: Dispatch<SetStateAction<SyncedHoverState>> = value => {
    setSyncedHover(value)
  }

  useEffect(() => {
    let cancelled = false
    const socket = new WebSocket(getShieldSocketUrl(API_BASE))
    socket.onopen = () => {
      if (!cancelled) setShieldStatus("live")
    }
    socket.onerror = () => {
      if (!cancelled) setShieldStatus("offline")
    }
    socket.onclose = () => {
      if (!cancelled) setShieldStatus(current => (current === "live" ? "offline" : current))
    }
    socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data) as ShieldAlert
        if (data.type === "SHIELD_ALERT") {
          if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
          setActiveAlert(data)
          alertTimeoutRef.current = setTimeout(() => setActiveAlert(null), 8000)
        }
      } catch {}
    }
    return () => {
      cancelled = true
      if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
      socket.close()
    }
  }, [API_BASE])

  if (status === "loading") {
    return <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-400 font-mono text-sm tracking-wider">LOADING TALOS…</div>
  }

  if (!session && !viewingAsGuest) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 text-center">
        <div className="mb-8">
          <p className="font-mono text-xs tracking-[0.3em] text-zinc-600 mb-3">QUANTITATIVE TERMINAL</p>
          <h1 className="text-5xl font-bold tracking-tight text-white">
            TALOS <span className="text-blue-400">ENGINE</span>
          </h1>
          <p className="mt-3 text-sm text-zinc-500 max-w-sm mx-auto leading-relaxed">
            AI-powered stock analysis. Price projection, backtesting, and real-time Shield alerts.
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={() => void signIn("google")}
            className="h-11 rounded-xl bg-blue-500 font-semibold text-sm text-white hover:bg-blue-400 transition active:scale-95"
          >
            Sign in with Google
          </button>
          <button
            onClick={() => setIsGuest(true)}
            className="h-11 rounded-xl border border-zinc-800 bg-zinc-900 font-semibold text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition"
          >
            Continue as Guest
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <div className="hidden lg:flex flex-col items-center w-14 shrink-0 border-r border-zinc-900 bg-zinc-950 py-4 gap-2">
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
          <span className="font-mono text-[10px] font-bold text-blue-400">TL</span>
        </div>
        <NavIcon active>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        </NavIcon>
        <NavIcon>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" />
          </svg>
        </NavIcon>
        <NavIcon>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </NavIcon>
        <NavIcon>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </NavIcon>
        <div className="mt-auto">
          <NavIcon>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M20 21a8 8 0 1 0-16 0" />
            </svg>
          </NavIcon>
        </div>
      </div>

      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex items-center gap-3 border-b border-zinc-900 bg-zinc-950 px-5 h-12 shrink-0">
          <span className="font-mono text-[10px] font-semibold tracking-[0.22em] text-zinc-600">TALOS ENGINE</span>
          <div className="h-4 w-px bg-zinc-800" />

          <div className="flex h-8 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 transition focus-within:border-zinc-700">
            <input
              className="w-24 bg-transparent font-mono text-xs font-semibold uppercase text-zinc-100 outline-none placeholder-zinc-700"
              placeholder="TICKER"
              value={tickerInput}
              onChange={event => setTickerInput(sanitizeTickerInput(event.target.value))}
              // Changed: Monte Carlo fetch now runs only through the explicit RUN action or Enter key.
              onKeyDown={event => {
                if (event.key === "Enter") void handleRun()
              }}
            />
            {activeTicker && <TickerNameBadge apiBase={API_BASE} ticker={activeTicker} requestKey={requestKey} />}
          </div>

          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={!canAnalyze}
            className="h-8 rounded-lg bg-blue-500 px-4 font-mono text-xs font-bold text-white transition hover:bg-blue-400 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            RUN
          </button>

          {recents.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="font-mono text-[9px] tracking-[0.16em] text-zinc-700">RECENTS</span>
              {recents.map(ticker => (
                <button
                  key={ticker}
                  type="button"
                  onClick={() => {
                    setTickerInput(ticker)
                    handleRun(ticker)
                  }}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] font-medium text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-200 active:scale-95"
                >
                  {ticker}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setRecents([])
                  localStorage.removeItem("talos_recents")
                }}
                className="font-mono text-[9px] text-zinc-700 hover:text-red-400 transition"
              >
                clear
              </button>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1">
            {Object.keys(PERIOD_MAP).map(periodKey => (
              <button
                key={periodKey}
                type="button"
                onClick={() => setPeriod(periodKey)}
                className={`rounded-md px-2.5 py-1 font-mono text-[10px] font-semibold transition ${period === periodKey ? "bg-zinc-800 text-zinc-100" : "text-zinc-600 hover:text-zinc-400"}`}
              >
                {periodKey}
              </button>
            ))}
          </div>

          <span className={`hidden sm:inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.14em] uppercase ${shieldClass}`}>
            {shieldLabel}
          </span>

          {session?.user && (
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 font-mono text-[10px] font-bold text-blue-400">
              {userInitials}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {activeAlert && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3">
              <div>
                <p className="font-mono text-[9px] font-bold tracking-[0.2em] uppercase text-red-400">Shield Activated</p>
                <p className="mt-0.5 text-sm font-medium">
                  {activeAlert.ticker} hit {formatCurrency(activeAlert.price)}
                </p>
                <p className="text-xs text-red-200/60">{activeAlert.msg || "Your price target was triggered."}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveAlert(null)}
                className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 font-mono text-xs text-red-300 hover:bg-white/5 transition"
              >
                Dismiss
              </button>
            </div>
          )}

          {!activeTicker && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8">
              <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-blue-400 mb-3">Ready</p>
              <h2 className="text-2xl font-bold tracking-tight text-zinc-100">
                Search any ticker to load price, scenarios, sentiment, and backtests.
              </h2>
              <p className="mt-2 max-w-lg text-sm text-zinc-500 leading-relaxed">
                Try <code className="font-mono text-zinc-400 text-xs">AAPL</code>,{" "}
                <code className="font-mono text-zinc-400 text-xs">MSFT</code>, or{" "}
                <code className="font-mono text-zinc-400 text-xs">NVDA</code>, or more!
              </p>
            </div>
          )}

          {activeTicker && (
            <>
              <AnalysisIssueBanner apiBase={API_BASE} ticker={activeTicker} requestKey={requestKey} />
              <OverviewSection apiBase={API_BASE} ticker={activeTicker} requestKey={requestKey} />

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.45fr_1fr]">
                <PriceChartPanel
                  apiBase={API_BASE}
                  ticker={activeTicker}
                  period={period}
                  requestKey={requestKey}
                  mounted
                  shouldSync={shouldSync}
                  syncedHover={syncedHover}
                  backtestLength={backtestLength}
                  onDataLengthChange={setPriceLength}
                  onHoverChange={handleHoverChange}
                />
                <MonteCarloPanel apiBase={API_BASE} ticker={activeTicker} requestKey={requestKey} session={session ?? null} isGuest={viewingAsGuest} />
              </div>

              <ScenarioPanels apiBase={API_BASE} ticker={activeTicker} requestKey={requestKey} />

              <BacktestPanel
                apiBase={API_BASE}
                ticker={activeTicker}
                requestKey={requestKey}
                mounted
                shouldSync={shouldSync}
                syncedHover={syncedHover}
                priceLength={priceLength}
                onDataLengthChange={setBacktestLength}
                onHoverChange={handleHoverChange}
              />

              <SentimentPanel apiBase={API_BASE} ticker={activeTicker} requestKey={requestKey} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
