"use client"
import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceArea, Legend } from "recharts"
import { useSession, signIn } from "next-auth/react"

// ─── Types ────────────────────────────────────────────────────────────────────
type PriceChartPoint   = { Date: string; Close: number }
type ShieldAlert       = { ticker: string; price: number; msg?: string; type?: string }
type StockQuote        = { name?: string; price?: number; change?: number; change_pct?: number; max_high?: number; max_low?: number }
type AnalysisResponse  = { error?: string; rsi_signal?: string; rsi?: number; macd?: number; sharpe?: number; sma50?: number; vola?: number; stock_cagr?: number; spy_cagr?: number; sma100?: number; bull_case?: ScenarioValue; bear_case?: ScenarioValue }
type SimulationPoint   = { Date: string; p95?: number; p50?: number; p5?: number }
type SimulationResponse = { data?: SimulationPoint[]; probability?: number; ml_expected_price?: number }
type BacktestResponse  = { portfolio?: number[]; buy_hold?: Array<number | null>; total_return?: number; buy_hold_return?: number; sharpe?: number; max_drawdown?: number; buy_signals?: number; sell_signals?: number }
type SentimentArticle  = { url: string; headline: string; sentiment?: string }
type SentimentResponse = { score?: number; label?: string; articles?: SentimentArticle[] }
type PriceChartSelection = { startIndex: number; endIndex: number }
type DrawingPoint      = { x: number; y: number }
type ChartStroke       = { id: number; points: DrawingPoint[] }
type SyncedHoverState  = | { source: "price"; index: number } | { source: "backtest"; index: number } | null
type ScenarioValue     = string | number | boolean | null | undefined | ScenarioValue[] | { [key: string]: ScenarioValue }
type ChartInteractionState = { activeTooltipIndex?: number | string | null; activeIndex?: number | string | null }

// ─── Constants ────────────────────────────────────────────────────────────────
const PERIOD_MAP: Record<string, number> = { "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825 }
const PALETTE = ["#60a5fa", "#f472b6", "#f97316", "#a78bfa", "#06b6d4", "#f59e0b", "#34d399", "#fb7185"]

// ─── Pure helpers ─────────────────────────────────────────────────────────────
function getChartIndex(nextState: ChartInteractionState) {
  const rawIndex = nextState.activeTooltipIndex ?? nextState.activeIndex
  if (typeof rawIndex === "number" && Number.isFinite(rawIndex)) return rawIndex
  if (typeof rawIndex === "string") { const p = Number(rawIndex); if (Number.isFinite(p)) return p }
  return null
}
function getSelectionMetrics(points: PriceChartPoint[], selection: PriceChartSelection) {
  const startPoint = points[selection.startIndex], endPoint = points[selection.endIndex]
  const leftBound = points[Math.min(selection.startIndex, selection.endIndex)]
  const rightBound = points[Math.max(selection.startIndex, selection.endIndex)]
  if (!startPoint || !endPoint || !leftBound || !rightBound || startPoint.Close === 0) return null
  const change = endPoint.Close - startPoint.Close
  const changePct = (change / startPoint.Close) * 100
  return { startPoint, endPoint, leftBound, rightBound, change, changePct }
}
function mapHoverIndex(sourceIndex: number, sourceLength: number, targetLength: number) {
  if (sourceLength <= 0 || targetLength <= 0) return undefined
  if (sourceLength === 1 || targetLength === 1) return 0
  return Math.min(targetLength - 1, Math.max(0, Math.round((sourceIndex / (sourceLength - 1)) * (targetLength - 1))))
}
function formatScenarioLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}
function renderScenarioValue(value: ScenarioValue): ReactNode {
  if (value === null || value === undefined || value === "")
    return <p className="text-xs text-zinc-600">No scenario details available.</p>
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return <p className="text-xs leading-relaxed text-zinc-300">{String(value)}</p>
  if (Array.isArray(value))
    return (
      <div className="space-y-1.5">
        {value.map((item, index) => (
          <div key={index} className="flex gap-2 text-xs text-zinc-300">
            <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
            <div className="min-w-0">{renderScenarioValue(item)}</div>
          </div>
        ))}
      </div>
    )
  const entries = Object.entries(value)
  if (!entries.length) return <p className="text-xs text-zinc-600">No scenario details available.</p>
  return (
    <div className="space-y-1.5">
      {entries.map(([key, entryValue]) => (
        <div key={key} className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">{formatScenarioLabel(key)}</p>
          <div className="mt-0.5 text-xs text-zinc-300">{renderScenarioValue(entryValue)}</div>
        </div>
      ))}
    </div>
  )
}

  
function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
function sanitizeTickerInput(value: string) {
  return value.toUpperCase().replace(/[^A-Z.-]/g, "").slice(0, 10)
}
function parseTargetPrice(value: string) {
  if (!value.trim()) return null
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null
}
function formatCurrency(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(digits)}` : "N/A"
}
function formatNumber(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "N/A"
}
function formatPercent(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}%` : "N/A"
}
function getShieldSocketUrl(apiBase: string) {
  try {
    const apiUrl = new URL(apiBase)
    apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:"
    apiUrl.pathname = "/ws/shield"
    apiUrl.search = ""
    apiUrl.hash = ""
    return apiUrl.toString()
  } catch { return "ws://localhost:8000/ws/shield" }
}
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const contentType = response.headers.get("content-type") ?? ""
  const payload = contentType.includes("application/json") ? await response.json() : await response.text()
  if (!response.ok) {
    if (payload && typeof payload === "object") {
      const ep = payload as Record<string, unknown>
      const detail = typeof ep.detail === "string" ? ep.detail : typeof ep.message === "string" ? ep.message : null
      if (detail) throw new Error(detail)
    }
    if (typeof payload === "string" && payload.trim()) throw new Error(payload)
    throw new Error(`Request failed with status ${response.status}`)
  }
  return payload as T
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = "" }: { label: string; value: string | number | null | undefined; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-600">{label}</p>
      <p className={`truncate text-sm font-semibold tabular-nums leading-none ${color || "text-zinc-100"}`}>{value ?? "N/A"}</p>
      {sub && <p className="text-[9px] text-zinc-700">{sub}</p>}
    </div>
  )
}

function SignalPill({ signal }: { signal: string }) {
  const map: Record<string, string> = {
    "Buy":         "border-green-700/50 bg-green-950/50 text-green-400",
    "Strong Buy":  "border-green-600/60 bg-green-900/50 text-green-300",
    "Sell":        "border-red-700/50  bg-red-950/50  text-red-400",
    "Strong Sell": "border-red-600/60  bg-red-900/50  text-red-300",
    "Neutral":     "border-zinc-700/50 bg-zinc-800/40 text-zinc-400",
  }
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${map[signal] ?? "border-zinc-700 bg-zinc-800 text-zinc-400"}`}>
      {signal}
    </span>
  )
}

function NavBtn({ active, label, children }: { active?: boolean; label: string; children: ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-150 ${active ? "bg-blue-600/20 text-blue-400" : "text-zinc-600 hover:bg-zinc-800/80 hover:text-zinc-300"}`}
    >
      {children}
    </button>
  )
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-800/60 ${className ?? ""}`} />
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Stocks() {
  const [ticker, setTicker]                       = useState("")
  const [data, setData]                           = useState<StockQuote | null>(null)
  const [chartData, setChartData]                 = useState<PriceChartPoint[] | null>(null)
  const [isPriceLoading, setIsPriceLoading]       = useState(false)
  const [isAnalysisLoading, setIsAnalysisLoading] = useState(false)
  const [isSimLoading, setIsSimLoading]           = useState(false)
  const [isSentimentLoading, setIsSentimentLoading] = useState(false)
  const [period, setPeriod]                       = useState("1y")
  const [load, setLoad]                           = useState(false)
  const [analysis, setAnalysis]                   = useState<AnalysisResponse | null>(null)
  const [sim, setSim]                             = useState<SimulationPoint[] | null>(null)
  const [prob, setProb]                           = useState<number | null>(null)
  const [mlReturn, setMlReturn]                   = useState<number | null>(null)
  const [targetPrice, setTargetPrice]             = useState("")
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  const [backtestData, setBacktestData]           = useState<BacktestResponse | null>(null)
  const [isBacktesting, setIsBacktesting]         = useState(false)
  const [overlayTickerInput, setOverlayTickerInput] = useState("")
  const [overlayTickers, setOverlayTickers]       = useState<string[]>([])
  const [overlayBacktests, setOverlayBacktests]   = useState<Record<string, BacktestResponse | null>>({})
  const [overlayLoading, setOverlayLoading]       = useState<Record<string, boolean>>({})
  const [overlayErrors, setOverlayErrors]         = useState<Record<string, string | null>>({})
  const [sentiment, setSentiment]                 = useState<SentimentResponse | null>(null)
  const [recents, setRecents]                     = useState<string[]>([])
  const { data: session, status }                 = useSession()
  const [isGuest, setIsGuest]                     = useState(false)
  const [mounted, setMounted]                     = useState(false)
  const [priceChartSelection, setPriceChartSelection] = useState<PriceChartSelection | null>(null)
  const [isSelectingPriceChart, setIsSelectingPriceChart] = useState(false)
  const [isPriceChartDrawMode, setIsPriceChartDrawMode] = useState(false)
  const [priceChartStrokes, setPriceChartStrokes] = useState<ChartStroke[]>([])
  const [activePriceChartStroke, setActivePriceChartStroke] = useState<ChartStroke | null>(null)
  const [syncedHover, setSyncedHover]             = useState<SyncedHoverState>(null)
  const [activeAlert, setActiveAlert]             = useState<ShieldAlert | null>(null)
  const [isSaved, setIsSaved]                     = useState(false)
  const [analysisError, setAnalysisError]         = useState<string | null>(null)
  const [backtestError, setBacktestError]         = useState<string | null>(null)
  const [targetSaveError, setTargetSaveError]     = useState<string | null>(null)
  const [isSavingTarget, setIsSavingTarget]       = useState(false)
  const [shieldStatus, setShieldStatus]           = useState<"connecting" | "live" | "offline">("connecting")
  const nextPriceChartStrokeId                    = useRef(0)
  const [optimizationData, setOptimizationData]   = useState(null)
  const [isOptimizing, setIsOptimizing]           = useState(false)
  const [lowThreshold, setLowThreshold]           = useState<number | null>(null)
  const [highThreshold, setHighThreshold]         = useState<number | null>(null)
  const alertTimeoutRef                           = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveResetTimeoutRef                       = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Derived ────────────────────────────────────────────────────────────────
  const parsedTargetPrice = parseTargetPrice(targetPrice)
  const userInitials = session?.user?.name?.slice(0, 2).toUpperCase() || session?.user?.email?.slice(0, 2).toUpperCase() || "TU"
  const shieldStatusLabel = shieldStatus === "live" ? "Shield live" : shieldStatus === "connecting" ? "Connecting…" : "Shield offline"
  const shieldStatusClasses = shieldStatus === "live"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : shieldStatus === "connecting"
    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
    : "border-red-500/30 bg-red-500/10 text-red-300"


  function getColorForTicker(t: string, idx?: number) {
    if (!t) return "#999"
    if (t === ticker) return "#4ade80"
    const base = Math.abs(Array.from(t).reduce((acc, c) => acc + c.charCodeAt(0), 0))
    return PALETTE[(idx ?? (base % PALETTE.length)) % PALETTE.length]
  }

  // ── Handlers (all original logic) ─────────────────────────────────────────
  const handleOptimize = async () => {
    if (!ticker) return
    setIsOptimizing(true)
    try {
      const response = await fetch("https://talos-backend-42md.onrender.com/optimize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, period: 14 }),
      })
      if (!response.ok) throw new Error(`Optimize request failed: ${response.status}`)
      const result = await response.json()
      setOptimizationData(result)
      if (typeof result?.best_low === "number") setLowThreshold(result.best_low)
      if (typeof result?.best_high === "number") setHighThreshold(result.best_high)
      if (result?.max_sharpe) console.log(`Optimized! Best Sharpe: ${result.max_sharpe}`)
    } catch (error) { console.error("Optimize Error:", error) }
    finally { setIsOptimizing(false) }
  }

  async function runBackTest(tickerToTest: string) {
    if (!tickerToTest) return
    setIsBacktesting(true); setBacktestError(null)
    try {
      setBacktestData(await fetchJson<BacktestResponse>(`${API_BASE}/stock/${encodeURIComponent(tickerToTest)}/backtest`))
    } catch (error) {
      console.error("Backtest Error:", error); setBacktestData(null)
      setBacktestError(getErrorMessage(error, "Backtest data is unavailable right now."))
    } finally { setIsBacktesting(false) }
  }

  async function fetchOverlayBacktest(tickerToFetch: string) {
    const t = sanitizeTickerInput(tickerToFetch); if (!t) return
    setOverlayLoading(p => ({ ...p, [t]: true })); setOverlayErrors(p => ({ ...p, [t]: null }))
    try {
      const json = await fetchJson<BacktestResponse>(`${API_BASE}/stock/${encodeURIComponent(t)}/backtest`)
      setOverlayBacktests(p => ({ ...p, [t]: json }))
    } catch (error) {
      console.error("Overlay backtest error:", error)
      setOverlayBacktests(p => ({ ...p, [t]: null }))
      setOverlayErrors(p => ({ ...p, [t]: getErrorMessage(error, "Overlay backtest unavailable right now.") }))
    } finally { setOverlayLoading(p => ({ ...p, [t]: false })) }
  }

  const handleAddOverlay = async () => {
    const t = sanitizeTickerInput(overlayTickerInput); if (!t) return
    if (overlayTickers.includes(t)) { setOverlayTickerInput(""); return }
    setOverlayTickers(p => [...p, t]); setOverlayTickerInput(""); void fetchOverlayBacktest(t)
  }

  const handleRemoveOverlay = (t: string) => {
    setOverlayTickers(p => p.filter(x => x !== t))
    setOverlayBacktests(p => { const c = { ...p }; delete c[t]; return c })
    setOverlayErrors(p => { const c = { ...p }; delete c[t]; return c })
    setOverlayLoading(p => { const c = { ...p }; delete c[t]; return c })
  }

  async function Analyze(manualTicker?: string) {
    const activeTicker = sanitizeTickerInput(manualTicker ?? ticker)
    if (!activeTicker) { setAnalysisError("Enter a ticker symbol to analyze."); return }
    setTicker(activeTicker); setLoad(true)
    setIsAnalysisLoading(true); setIsPriceLoading(true); setIsSimLoading(true); setIsSentimentLoading(true)
    setAnalysisError(null); setBacktestError(null); setTargetSaveError(null); setBacktestData(null)
    try {
      const targetQuery = parsedTargetPrice !== null ? `?target_price=${parsedTargetPrice}` : ""
      const [sData, aData, hData, simData, sentData] = await Promise.all([
        fetchJson<StockQuote>(`${API_BASE}/stock/${encodeURIComponent(activeTicker)}`),
        fetchJson<AnalysisResponse>(`${API_BASE}/analyze/${encodeURIComponent(activeTicker)}`),
        fetchJson<PriceChartPoint[]>(`${API_BASE}/stock/${encodeURIComponent(activeTicker)}/history?period_days=${PERIOD_MAP[period]}`),
        fetchJson<SimulationResponse>(`${API_BASE}/stock/${encodeURIComponent(activeTicker)}/simulate${targetQuery}`),
        fetchJson<SentimentResponse>(`${API_BASE}/stock/${encodeURIComponent(activeTicker)}/sentiment`),
      ])
      setData(sData); setAnalysis(aData); setChartData(Array.isArray(hData) ? hData : []); setSentiment(sentData)
      setAnalysisError(typeof aData?.error === "string" ? aData.error : null)
      if (Array.isArray(simData?.data)) {
        setSim(simData.data)
        setProb(typeof simData.probability === "number" ? simData.probability : null)
        setMlReturn(typeof simData.ml_expected_price === "number" ? simData.ml_expected_price : null)
      } else { setSim(null); setProb(null); setMlReturn(null) }
      void runBackTest(activeTicker)
      setRecents(prev => {
        const updated = [activeTicker, ...prev.filter(t => t !== activeTicker)].slice(0, 5)
        localStorage.setItem("talos_recents", JSON.stringify(updated))
        return updated
      })
    } catch (error) {
      console.error("Talos Engine Error:", error)
      setData(null); setAnalysis(null); setChartData(null); setSim(null); setProb(null); setMlReturn(null); setSentiment(null)
      setAnalysisError(getErrorMessage(error, "Talos couldn't load this ticker right now."))
    } finally {
      setLoad(false); setIsAnalysisLoading(false); setIsPriceLoading(false); setIsSimLoading(false); setIsSentimentLoading(false)
    }
  }

  // ── Effects (all original) ─────────────────────────────────────────────────
  useEffect(() => {
    let isCancelled = false
    const socket = new WebSocket(getShieldSocketUrl(API_BASE))
    setShieldStatus("connecting")
    socket.onopen  = () => { if (!isCancelled) setShieldStatus("live") }
    socket.onerror = () => { if (!isCancelled) setShieldStatus("offline") }
    socket.onclose = () => { if (!isCancelled) setShieldStatus(s => s === "live" ? "offline" : s) }
    socket.onmessage = event => {
      try {
        const incomingData = JSON.parse(event.data) as ShieldAlert
        if (incomingData.type === "SHIELD_ALERT") {
          if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
          setActiveAlert(incomingData)
          alertTimeoutRef.current = setTimeout(() => setActiveAlert(null), 8000)
        }
      } catch (error) { console.error("Shield socket parse error:", error) }
    }
    return () => {
      isCancelled = true
      if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
      if (saveResetTimeoutRef.current) clearTimeout(saveResetTimeoutRef.current)
      socket.close()
    }
  }, [API_BASE])

  useEffect(() => {
    if (!ticker || !data) return
    let isCancelled = false
    const chart = async () => {
      try {
        setIsPriceLoading(true)
        const histJson = await fetchJson<PriceChartPoint[]>(`${API_BASE}/stock/${encodeURIComponent(ticker)}/history?period_days=${PERIOD_MAP[period]}`)
        if (!isCancelled) setChartData(Array.isArray(histJson) ? histJson : [])
      } catch (error) {
        if (!isCancelled) { setChartData(null); setAnalysisError(getErrorMessage(error, "Price history could not be refreshed.")) }
      } finally { if (!isCancelled) setIsPriceLoading(false) }
    }
    void chart()
    return () => { isCancelled = true }
  }, [API_BASE, data, period, ticker])

  useEffect(() => {
    if (ticker && parsedTargetPrice !== null) {
      const updateSim = async () => {
        try {
          setIsSimLoading(true)
          const json = await fetchJson<SimulationResponse>(`${API_BASE}/stock/${encodeURIComponent(ticker)}/simulate?target_price=${parsedTargetPrice}`)
          if (typeof json?.probability === "number") setProb(json.probability)
        } catch (error) { console.error("Target probability update failed:", error) }
        finally { setIsSimLoading(false) }
      }
      const timeoutId = setTimeout(updateSim, 500)
      return () => clearTimeout(timeoutId)
    }
  }, [API_BASE, parsedTargetPrice, ticker])

  useEffect(() => {
    if (!session?.user?.id || !ticker) { setTargetPrice(""); return }
    let isCancelled = false
    const fetchSavedTarget = async () => {
      try {
        const savedTarget = await fetchJson<{ target_price?: number | null }>(`${API_BASE}/stock/${encodeURIComponent(ticker)}/target/${session.user.id}`)
        if (!isCancelled) setTargetPrice(savedTarget?.target_price != null ? String(savedTarget.target_price) : "")
      } catch { if (!isCancelled) setTargetPrice("") }
    }
    void fetchSavedTarget()
    return () => { isCancelled = true }
  }, [API_BASE, session, ticker])

  useEffect(() => {
    try {
      const saved = localStorage.getItem("talos_recents")
      if (!saved) return
      const parsedRecents = JSON.parse(saved)
      if (Array.isArray(parsedRecents)) setRecents(parsedRecents.filter((v): v is string => typeof v === "string"))
    } catch (error) { console.error("Unable to read saved recents:", error); localStorage.removeItem("talos_recents") }
  }, [])

  useEffect(() => { if (session) setIsGuest(false) }, [session])
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    setPriceChartSelection(null); setIsSelectingPriceChart(false)
    setIsPriceChartDrawMode(false); setPriceChartStrokes([])
    setActivePriceChartStroke(null); setSyncedHover(null)
  }, [chartData])

  const handleSaveTarget = async () => {
    if (isGuest || !session?.user?.id) { setTargetSaveError("Sign in to arm Shield alerts."); return }
    if (!ticker) { setTargetSaveError("Analyze a ticker before saving an alert."); return }
    if (parsedTargetPrice === null) { setTargetSaveError("Enter a valid positive target price."); return }
    setIsSavingTarget(true); setTargetSaveError(null)
    try {
      await fetchJson(`${API_BASE}/stock/target`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: ticker.toUpperCase(), user_id: session.user.id, target_price: parsedTargetPrice }),
      })
      if (saveResetTimeoutRef.current) clearTimeout(saveResetTimeoutRef.current)
      setIsSaved(true); saveResetTimeoutRef.current = setTimeout(() => setIsSaved(false), 2000)
    } catch (error) { console.error("Shield sync error:", error); setTargetSaveError(getErrorMessage(error, "Shield could not save this alert right now.")) }
    finally { setIsSavingTarget(false) }
  }

  // ── Chart interaction handlers (all original) ──────────────────────────────
  const handlePriceChartStart = (nextState: ChartInteractionState) => {
    if (isPriceChartDrawMode) return
    const index = getChartIndex(nextState); if (index === null) return
    setIsSelectingPriceChart(true); setPriceChartSelection({ startIndex: index, endIndex: index })
  }
  const handlePriceChartMove = (nextState: ChartInteractionState) => {
    if (isPriceChartDrawMode || !isSelectingPriceChart) return
    const index = getChartIndex(nextState); if (index === null) return
    setPriceChartSelection(prev => prev ? { ...prev, endIndex: index } : { startIndex: index, endIndex: index })
  }
  const handlePriceChartEnd = (nextState?: ChartInteractionState) => {
    if (isPriceChartDrawMode || !isSelectingPriceChart) return
    const index = nextState ? getChartIndex(nextState) : null
    if (index !== null) setPriceChartSelection(prev => prev ? { ...prev, endIndex: index } : { startIndex: index, endIndex: index })
    setIsSelectingPriceChart(false)
  }
  const getPriceChartPoint = (event: ReactPointerEvent<SVGSVGElement>): DrawingPoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width), y: Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height) }
  }
  const handlePriceChartDrawStart = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPriceChartDrawMode) return
    event.preventDefault()
    const point = getPriceChartPoint(event)
    const stroke = { id: nextPriceChartStrokeId.current++, points: [point] }
    event.currentTarget.setPointerCapture(event.pointerId); setActivePriceChartStroke(stroke)
  }
  const handlePriceChartDrawMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPriceChartDrawMode) return
    setActivePriceChartStroke(prev => {
      if (!prev) return prev
      const point = getPriceChartPoint(event)
      const lastPoint = prev.points[prev.points.length - 1]
      if (lastPoint && lastPoint.x === point.x && lastPoint.y === point.y) return prev
      return { ...prev, points: [...prev.points, point] }
    })
  }
  const finishPriceChartStroke = () => {
    setActivePriceChartStroke(prev => {
      if (prev && prev.points.length > 0) setPriceChartStrokes(current => [...current, prev])
      return null
    })
  }
  const handlePriceChartDrawEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPriceChartDrawMode) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    finishPriceChartStroke()
  }
  const handlePriceChartHover = (nextState: ChartInteractionState) => {
    handlePriceChartMove(nextState)
    if (!shouldSyncPriceAndBacktest || isPriceChartDrawMode) return
    const index = getChartIndex(nextState); if (index !== null) setSyncedHover({ source: "price", index })
  }
  const clearPriceChartHover = () => {
    handlePriceChartEnd(); setSyncedHover(prev => prev?.source === "price" ? null : prev)
  }
  const handleBacktestHover = (nextState: ChartInteractionState) => {
    if (!shouldSyncPriceAndBacktest) return
    const index = getChartIndex(nextState); if (index !== null) setSyncedHover({ source: "backtest", index })
  }
  const clearBacktestHover = () => setSyncedHover(prev => prev?.source === "backtest" ? null : prev)

  // ── Derived chart data (all original) ─────────────────────────────────────
  const selectedPriceRange = chartData && priceChartSelection ? getSelectionMetrics(chartData, priceChartSelection) : null
  const primaryPortfolio = Array.isArray(backtestData?.portfolio) ? backtestData!.portfolio : []
  const primaryBuyHold   = Array.isArray(backtestData?.buy_hold)  ? backtestData!.buy_hold  : []
  const overlayPortfoliosMap: Record<string, number[]> = {}
  overlayTickers.forEach(t => { const b = overlayBacktests[t]; if (Array.isArray(b?.portfolio)) overlayPortfoliosMap[t] = b!.portfolio as number[] })
  const maxLen = Math.max(0, primaryPortfolio.length, ...Object.values(overlayPortfoliosMap).map(a => a.length))
  const backtestChartData = Array.from({ length: maxLen }).map((_, i) => {
    const item: Record<string, unknown> = { name: i }
    if (primaryPortfolio.length > 0) { item.strategy = primaryPortfolio[i] ?? null; item.buyHold = primaryBuyHold[i] ?? null }
    overlayTickers.forEach(t => { const arr = overlayPortfoliosMap[t]; if (Array.isArray(arr)) item[`strategy_${t}`] = arr[i] ?? null })
    return item
  })
  const shouldSyncPriceAndBacktest = PERIOD_MAP[period] <= PERIOD_MAP["2y"]
  const mirroredPriceHoverIndex    = shouldSyncPriceAndBacktest && syncedHover?.source === "backtest" ? mapHoverIndex(syncedHover.index, backtestChartData.length, chartData?.length ?? 0) : undefined
  const mirroredBacktestHoverIndex = shouldSyncPriceAndBacktest && syncedHover?.source === "price"    ? mapHoverIndex(syncedHover.index, chartData?.length ?? 0, backtestChartData.length)  : undefined
  const hasSentimentArticles = Array.isArray(sentiment?.articles) && sentiment.articles.length > 0
  const canAnalyze           = sanitizeTickerInput(ticker).length > 0 && !load
  const sentimentScore       = typeof sentiment?.score === "number" ? sentiment.score : 0
  const priceChange          = typeof data?.change === "number" ? data.change : null
  const stockCagr            = typeof analysis?.stock_cagr === "number" ? analysis.stock_cagr : null
  const backtestTotalReturn  = typeof backtestData?.total_return === "number" ? backtestData.total_return : null

  const ttStyle = { backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 11 }

  // ── Auth gate ──────────────────────────────────────────────────────────────
  if (status === "loading")
    return <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-600 text-xs tracking-widest">LOADING TALOS…</div>

  if (!session && !isGuest)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 p-6 text-center text-white">
        <p className="mb-2 text-[10px] font-bold tracking-[0.35em] text-zinc-700">QUANTITATIVE TERMINAL</p>
        <h1 className="mb-3 text-5xl font-black tracking-tight">
          TALOS <span className="text-blue-500">ENGINE</span>
        </h1>
        <p className="mb-8 max-w-sm text-sm leading-relaxed text-zinc-500">Access the quantitative terminal.</p>
        <div className="flex w-full max-w-xs flex-col gap-2.5">
          <button onClick={() => void signIn("google")} className="h-11 rounded-xl bg-blue-600 text-sm font-bold transition hover:bg-blue-500 active:scale-95">
            Sign in with Google
          </button>
          <button onClick={() => setIsGuest(true)} className="h-11 rounded-xl border border-zinc-800 bg-zinc-900 text-sm font-semibold text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200">
            Continue as Guest
          </button>
        </div>
      </div>
    )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-white">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex w-14 shrink-0 flex-col items-center gap-1 border-r border-zinc-900 bg-[#0a0a0b] py-3">
        {/* logo mark */}
        <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 shadow-lg shadow-blue-900/40">
          <span className="text-[9px] font-black tracking-widest text-white">TL</span>
        </div>

        <NavBtn active label="Markets">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
        </NavBtn>
        <NavBtn label="Portfolio">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 20V10M12 20V4M6 20v-6"/>
          </svg>
        </NavBtn>
        <NavBtn label="Screener">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </NavBtn>
        <NavBtn label="Alerts">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </NavBtn>

        <div className="mt-auto">
          <NavBtn label="Account">
            {session?.user
              ? <div className="flex h-7 w-7 items-center justify-center rounded-full border border-blue-500/40 bg-blue-950 text-[9px] font-bold text-blue-300">{userInitials}</div>
              : <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
            }
          </NavBtn>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

        {/* ── Topbar ──────────────────────────────────────────────────── */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-900 bg-zinc-950/90 px-4 backdrop-blur-sm">
          {/* wordmark */}
          <div className="hidden items-baseline gap-2 sm:flex">
            <span className="text-sm font-bold tracking-tight text-zinc-200">Talos <span className="text-blue-500">Engine</span></span>
            <span className="text-zinc-700">/</span>
            <span className="text-xs text-zinc-600">stock analysis</span>
          </div>
          <div className="hidden h-4 w-px bg-zinc-800 sm:block" />

          {/* search input */}
          <div className="flex h-8 flex-1 max-w-sm items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 transition focus-within:border-zinc-700 focus-within:bg-zinc-800/80">
            <input
              className="flex-1 bg-transparent text-xs font-semibold uppercase text-zinc-100 outline-none placeholder-zinc-700"
              placeholder="Ticker — e.g. AAPL"
              value={ticker}
              onChange={e => {
                const next = sanitizeTickerInput(e.target.value)
                if (next !== ticker) {
                  setData(null); setAnalysis(null); setChartData(null); setSim(null)
                  setProb(null); setMlReturn(null); setBacktestData(null); setSentiment(null)
                  setAnalysisError(null); setBacktestError(null)
                }
                setTicker(next)
              }}
              onKeyDown={e => { if (e.key === "Enter") void Analyze() }}
            />
            {data?.name && <span className="hidden truncate text-[10px] text-zinc-600 sm:block max-w-[130px]">{data.name}</span>}
          </div>

          <button
            type="button"
            onClick={() => void Analyze()}
            disabled={!canAnalyze}
            className="h-8 rounded-lg bg-white px-4 text-xs font-bold text-black transition hover:bg-zinc-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {load ? "…" : "Analyze"}
          </button>

          {/* recents */}
          {recents.length > 0 && (
            <div className="hidden items-center gap-1.5 sm:flex">
              <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-700">Recent</span>
              {recents.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTicker(t); void Analyze(t) }}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-500 transition hover:border-blue-500/40 hover:text-zinc-200 active:scale-95"
                >
                  {t}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setRecents([]); localStorage.removeItem("talos_recents") }}
                className="text-[9px] text-zinc-700 hover:text-red-400 transition"
              >
                clear
              </button>
            </div>
          )}

          {/* period selector */}
          <div className="ml-auto flex items-center gap-0.5">
            {Object.keys(PERIOD_MAP).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition ${
                  period === p ? "bg-blue-700 text-white" : "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* shield pill */}
          <span className={`hidden rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] sm:inline-flex ${shieldStatusClasses}`}>
            {shieldStatusLabel}
          </span>
        </header>

        {/* ── Scrollable content ───────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">

          {/* Shield alert */}
          {activeAlert && (
            <div className="flex items-center justify-between gap-4 border-b border-red-500/25 bg-red-950/25 px-4 py-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-300">Shield activated</p>
                <p className="mt-0.5 text-sm font-semibold">{activeAlert.ticker} reached {formatCurrency(activeAlert.price)}</p>
                <p className="text-xs text-red-200/60">{activeAlert.msg || "Your monitored price target was triggered."}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveAlert(null)}
                className="shrink-0 rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-white/5"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Loading indicator */}
          {load && (
            <div className="flex items-center gap-2.5 border-b border-zinc-900 bg-zinc-950 px-4 py-2.5">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <span className="text-xs font-medium text-blue-400 animate-pulse">Crunching market data…</span>
            </div>
          )}

          {/* Error */}
          {analysisError && (
            <div className="m-4 rounded-2xl border border-red-500/25 bg-red-950/15 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-400">Analysis issue</p>
              <p className="mt-1 text-xs text-red-200">{analysisError}</p>
            </div>
          )}

          {/* Empty state */}
          {!load && !analysisError && !data && !analysis && (
            <div className="m-4 rounded-3xl border border-zinc-800 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.16),_transparent_50%),linear-gradient(180deg,rgba(24,24,27,0.95),rgba(9,9,11,0.98))] p-8">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400">Ready to analyze</p>
              <h2 className="text-2xl font-bold tracking-tight text-white">Search any ticker to load price, scenarios, sentiment, and backtests.</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-500">
                Try <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300 text-xs">AAPL</code>,{" "}
                <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300 text-xs">MSFT</code>, or{" "}
                <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300 text-xs">NVDA</code>.
                Charts, alert tools, and scenario cards populate once the backend responds.
              </p>
            </div>
          )}

          <div className="space-y-3 p-4">

            {/* ── Signal bar ────────────────────────────────────────────── */}
            {data && analysis && !analysis.error && (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">{ticker}</span>
                <span className="text-2xl font-bold tabular-nums">{formatCurrency(data.price)}</span>
                {priceChange !== null && (
                  <span className={`text-xs font-semibold tabular-nums ${priceChange >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {priceChange >= 0 ? "+" : ""}{formatNumber(priceChange)} ({formatPercent(data.change_pct, 2)})
                  </span>
                )}
                <SignalPill signal={analysis.rsi_signal ?? "Neutral"} />
                <div className="ml-auto flex flex-wrap gap-5">
                  {([["RSI", formatNumber(analysis.rsi)], ["MACD", formatNumber(analysis.macd)], ["Sharpe", formatNumber(analysis.sharpe)]] as [string, string][]).map(([label, val]) => (
                    <div key={label} className="flex flex-col items-end gap-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-600">{label}</span>
                      <span className="text-xs font-semibold tabular-nums text-zinc-200">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Stat grid ─────────────────────────────────────────────── */}
            {data && analysis && !analysis.error && (
              <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
                <StatCard label="52W High"   value={formatCurrency(data.max_high)} />
                <StatCard label="52W Low"    value={formatCurrency(data.max_low)} />
                <StatCard label="50D SMA"    value={formatCurrency(analysis.sma50)} />
                <StatCard label="100D SMA"   value={formatCurrency(analysis.sma100)} />
                <StatCard label="Volatility" value={formatPercent(analysis.vola)} />
                <StatCard label="Stock CAGR" value={formatPercent(stockCagr)} color={stockCagr !== null && stockCagr > 0 ? "text-green-400" : "text-red-400"} />
                <StatCard label="S&P CAGR"   value={formatPercent(analysis.spy_cagr)} color="text-zinc-500" />
                <StatCard label="Sharpe"     value={formatNumber(analysis.sharpe)} />
              </div>
            )}
            {isAnalysisLoading && (
              <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            )}

            {/* ── Scenario cards ────────────────────────────────────────── */}
            {analysis && !analysis.error && (analysis.bull_case || analysis.bear_case) && (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/15 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-400">Bull Case</p>
                      <p className="mt-0.5 text-[10px] text-emerald-300/60">What drives upside from here</p>
                    </div>
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[9px] font-bold text-emerald-400">Upside</span>
                  </div>
                  {renderScenarioValue(analysis.bull_case as ScenarioValue)}
                </div>
                <div className="rounded-2xl border border-red-900/50 bg-red-950/15 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-red-400">Bear Case</p>
                      <p className="mt-0.5 text-[10px] text-red-300/60">What could pressure the stock</p>
                    </div>
                    <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 text-[9px] font-bold text-red-400">Downside</span>
                  </div>
                  {renderScenarioValue(analysis.bear_case as ScenarioValue)}
                </div>
              </div>
            )}
            {isAnalysisLoading && (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <Skeleton className="h-28" /><Skeleton className="h-28" />
              </div>
            )}

            {/* ── Charts row ────────────────────────────────────────────── */}
            {(chartData || sim) && (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.4fr_1fr]">

                {/* Price chart */}
                {chartData && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-600">Price · {PERIOD_MAP[period]} days</span>
                      <div className="text-right">
                        {selectedPriceRange ? (
                          <>
                            <p className={`text-xs font-semibold ${selectedPriceRange.changePct >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {selectedPriceRange.changePct >= 0 ? "+" : ""}{selectedPriceRange.changePct.toFixed(2)}% return
                            </p>
                            <p className="mt-0.5 text-[9px] text-zinc-600">{selectedPriceRange.startPoint.Date} → {selectedPriceRange.endPoint.Date}</p>
                          </>
                        ) : stockCagr !== null ? (
                          <>
                            <p className={`text-xs font-semibold ${stockCagr >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {stockCagr >= 0 ? "+" : ""}{stockCagr.toFixed(1)}% CAGR
                            </p>
                            <p className="mt-0.5 text-[9px] text-zinc-700">Hold and drag to measure return</p>
                          </>
                        ) : <p className="text-[9px] text-zinc-700">Hold and drag to measure return</p>}
                      </div>
                    </div>
                    {mounted && (
                      <div className="relative" style={{ height: 220 }}>
                        {isPriceLoading && (
                          <div className="absolute inset-0 z-40 flex items-center justify-center gap-2 rounded-2xl bg-black/60">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                            <span className="text-xs text-zinc-400">Loading…</span>
                          </div>
                        )}
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={chartData}
                            onMouseDown={handlePriceChartStart}
                            onMouseMove={handlePriceChartHover}
                            onMouseUp={handlePriceChartEnd}
                            onMouseLeave={clearPriceChartHover}
                            onTouchStart={handlePriceChartStart}
                            onTouchMove={handlePriceChartHover}
                            onTouchEnd={handlePriceChartEnd}
                          >
                            <defs>
                              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#4ade80" stopOpacity={0.18} />
                                <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="Date" hide />
                            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#52525b" }} width={45} />
                            <Tooltip
                              defaultIndex={mirroredPriceHoverIndex}
                              formatter={value => [`$${Number(Array.isArray(value) ? value[0] : value ?? 0).toFixed(2)}`, "Close"]}
                              contentStyle={ttStyle} labelStyle={{ color: "#71717a" }}
                            />
                            {selectedPriceRange && (
                              <ReferenceArea
                                x1={selectedPriceRange.leftBound.Date}
                                x2={selectedPriceRange.rightBound.Date}
                                fill={selectedPriceRange.changePct >= 0 ? "#22c55e" : "#ef4444"}
                                fillOpacity={0.12} strokeOpacity={0} ifOverflow="extendDomain"
                              />
                            )}
                            <Area type="monotone" dataKey="Close" stroke="#4ade80" strokeWidth={2} fill="url(#priceGrad)" dot={false} isAnimationActive={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                        {/* Drawing overlay */}
                        <svg
                          className={`absolute inset-0 h-full w-full ${isPriceChartDrawMode ? "pointer-events-auto cursor-crosshair" : "pointer-events-none"}`}
                          onPointerDown={handlePriceChartDrawStart}
                          onPointerMove={handlePriceChartDrawMove}
                          onPointerUp={handlePriceChartDrawEnd}
                          onPointerLeave={handlePriceChartDrawEnd}
                        >
                          {priceChartStrokes.map(stroke => (
                            <polyline key={stroke.id} points={stroke.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#facc15" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                          ))}
                          {activePriceChartStroke && (
                            <polyline points={activePriceChartStroke.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#facc15" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                          )}
                        </svg>
                        <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
                          {priceChartStrokes.length > 0 && (
                            <button type="button" onClick={() => { setPriceChartStrokes([]); setActivePriceChartStroke(null) }}
                              className="rounded-md bg-black/60 px-2 py-0.5 text-[9px] font-bold text-zinc-400 hover:text-white transition">
                              Clear
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={isPriceChartDrawMode ? "Disable drawing" : "Draw on chart"}
                            onClick={() => { setIsPriceChartDrawMode(p => !p); setIsSelectingPriceChart(false); setPriceChartSelection(null); setActivePriceChartStroke(null) }}
                            className={`rounded-full border p-1.5 transition ${isPriceChartDrawMode ? "border-amber-400/60 bg-amber-500/15 text-amber-300" : "border-zinc-700 bg-black/55 text-zinc-500 hover:border-zinc-500 hover:text-white"}`}
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Monte Carlo */}
                {sim && (
                  <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                    {isGuest && (
                      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-2xl bg-black/65 backdrop-blur-md">
                        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-blue-500/40 bg-blue-600/15">
                          <svg className="h-4 w-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2V7a5 5 0 00-5-5zM7 7a3 3 0 116 0v2H7V7z" />
                          </svg>
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-widest">Pro Projection</p>
                        <button onClick={() => void signIn("google")} className="mt-1 text-[10px] text-blue-400 hover:underline">Sign in to unlock</button>
                      </div>
                    )}
                    <div className={isGuest ? "pointer-events-none select-none blur-sm grayscale opacity-25" : ""}>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-zinc-200">30-day projection</p>
                          <p className="mt-0.5 text-[9px] text-zinc-600">Monte Carlo · 1,000 paths</p>
                        </div>
                        <span className="rounded-md border border-blue-900/60 bg-blue-900/25 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-blue-400">AI</span>
                      </div>
                      {(mlReturn !== null || prob !== null) && (
                        <div className={`mb-3 grid gap-2 ${prob !== null ? "grid-cols-3" : "grid-cols-2"}`}>
                          <div className="rounded-xl border border-zinc-800 bg-black/30 p-2.5">
                            <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">AI bias 30D</p>
                            <p className={`text-xl font-bold tabular-nums ${mlReturn === null ? "text-zinc-400" : mlReturn >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {mlReturn !== null ? `${mlReturn >= 0 ? "↑" : "↓"} ${(mlReturn * 100).toFixed(1)}%` : "N/A"}
                            </p>
                          </div>
                          <div className="rounded-xl border border-zinc-800 bg-black/30 p-2.5">
                            <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Conviction</p>
                            <p className="mt-1 text-xs font-semibold text-zinc-200">{mlReturn !== null && Math.abs(mlReturn) > 0.05 ? "High" : "Moderate"}</p>
                          </div>
                          {prob !== null && (
                            <div className="rounded-xl border border-zinc-800 bg-black/30 p-2.5">
                              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Target odds</p>
                              <p className="mt-1 text-xs font-semibold text-zinc-200">{formatPercent(prob * 100, 1)}</p>
                            </div>
                          )}
                        </div>
                      )}
                      {mounted && Array.isArray(sim) && sim.length > 0 ? (
                        <div className="relative" style={{ height: 120 }}>
                          {isSimLoading && (
                            <div className="absolute inset-0 z-40 flex items-center justify-center gap-2 rounded-xl bg-black/60">
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                              <span className="text-xs text-zinc-500">Updating…</span>
                            </div>
                          )}
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={sim}>
                              <XAxis dataKey="Date" hide />
                              <YAxis domain={["auto", "auto"]} orientation="right" tick={{ fontSize: 10, fill: "#52525b" }} width={48} />
                              <Tooltip formatter={value => [`$${Number(Array.isArray(value) ? value[0] : value ?? 0).toFixed(2)}`, "Price"]} contentStyle={ttStyle} />
                              <Area type="monotone" dataKey="p95" stroke="#1d4ed8" fill="#1d4ed8" fillOpacity={0.06} strokeWidth={1} strokeDasharray="4 3" dot={false} />
                              <Area type="monotone" dataKey="p50" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2.5} dot={false} />
                              <Area type="monotone" dataKey="p5"  stroke="#1d4ed8" fill="transparent" strokeWidth={1} strokeDasharray="4 3" dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-zinc-800 bg-black/20 p-4 text-xs text-zinc-600">
                          Simulation data is unavailable for this ticker right now.
                        </div>
                      )}
                      <div className="mt-4">
                        <label className="block text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-600">Get notified when price hits</label>
                        <div className="mt-2 flex gap-2">
                          <input
                            type="number" inputMode="decimal" placeholder="0.00"
                            value={targetPrice} onChange={e => setTargetPrice(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && void handleSaveTarget()}
                            className="h-10 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-xs text-white outline-none transition placeholder-zinc-700 focus:border-blue-500/60"
                          />
                          <button
                            type="button" onClick={() => void handleSaveTarget()}
                            disabled={isSavingTarget || parsedTargetPrice === null}
                            className="h-10 rounded-xl border border-blue-500/35 bg-blue-500/10 px-4 text-xs font-bold text-blue-300 transition hover:border-blue-400/60 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isSavingTarget ? "Saving…" : "Arm Shield"}
                          </button>
                        </div>
                        <p className={`mt-1.5 text-[10px] ${targetSaveError ? "text-red-400" : isSaved ? "text-emerald-400" : "text-zinc-700"}`}>
                          {targetSaveError ?? (isSaved ? "Shield alert saved for your account." : "Save a price target to receive backend Shield alerts.")}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Backtest ──────────────────────────────────────────────── */}
            {isBacktesting && (
              <div className="flex items-center justify-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 py-14">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                <span className="text-sm font-medium text-zinc-500">Running 2-year RSI strategy backtest…</span>
              </div>
            )}
            {backtestError && !isBacktesting && (
              <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber-400">Backtest unavailable</p>
                <p className="mt-1 text-xs text-amber-200/80">{backtestError}</p>
              </div>
            )}

            {backtestChartData.length > 0 && !isBacktesting && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
                {/* header */}
                <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">RSI backtest</h3>
                    <p className="mt-0.5 text-[9px] text-zinc-600">Buy RSI &lt; 30 / Sell RSI &gt; 70 · 2-year window</p>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="text-right">
                      <p className="text-[9px] uppercase tracking-widest text-zinc-600">Strategy</p>
                      <p className={`text-2xl font-bold tabular-nums ${backtestTotalReturn !== null && backtestTotalReturn > 0 ? "text-green-400" : "text-red-400"}`}>
                        {backtestTotalReturn !== null && backtestTotalReturn > 0 ? "+" : ""}{formatPercent(backtestTotalReturn)}
                      </p>
                    </div>
                    <div className="border-l border-zinc-800 pl-4 text-right">
                      <p className="text-[9px] uppercase tracking-widest text-zinc-600">Buy &amp; hold</p>
                      <p className="text-2xl font-bold tabular-nums text-zinc-500">{formatPercent(backtestData?.buy_hold_return)}</p>
                    </div>
                  </div>
                </div>

                {/* stat cards */}
                <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <StatCard label="Sharpe ratio" value={formatNumber(backtestData?.sharpe)} />
                  <StatCard label="Max drawdown" value={formatPercent(backtestData?.max_drawdown)} color="text-red-400" />
                  <StatCard label="Buy signals"  value={backtestData?.buy_signals} />
                  <StatCard label="Sell signals" value={backtestData?.sell_signals} />
                </div>

                {/* optimized thresholds */}
                {(lowThreshold !== null || highThreshold !== null) && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                    <svg className="h-3.5 w-3.5 shrink-0 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9z"/>
                    </svg>
                    <span className="text-xs text-zinc-400">
                      Optimized thresholds — Low: <span className="font-bold text-zinc-200">{lowThreshold ?? "—"}</span>
                      &nbsp;&nbsp;High: <span className="font-bold text-zinc-200">{highThreshold ?? "—"}</span>
                    </span>
                  </div>
                )}

                {/* overlay controls */}
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <input
                    value={overlayTickerInput}
                    onChange={e => setOverlayTickerInput(sanitizeTickerInput(e.target.value))}
                    onKeyDown={e => { if (e.key === "Enter") void handleAddOverlay() }}
                    placeholder="Compare ticker…"
                    className="h-8 w-36 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-xs text-white outline-none placeholder-zinc-700 focus:border-zinc-700"
                  />
                  <button
                    type="button" onClick={() => void handleAddOverlay()} disabled={!sanitizeTickerInput(overlayTickerInput)}
                    className="h-8 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-700 disabled:opacity-30"
                  >
                    + Overlay
                  </button>
                  <button
                    type="button" onClick={() => void handleOptimize()} disabled={isOptimizing || !ticker}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white transition hover:bg-blue-500 disabled:opacity-40"
                  >
                    {isOptimizing
                      ? <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg>
                    }
                    {isOptimizing ? "Crunching…" : "Optimize RSI"}
                  </button>
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    {overlayTickers.map((ot, idx) => (
                      <span key={ot} className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-0.5 text-[10px]">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: getColorForTicker(ot, idx) }} />
                        <span className="font-semibold text-zinc-300">{ot}</span>
                        {overlayLoading[ot] && <div className="h-2.5 w-2.5 animate-spin rounded-full border border-zinc-700 border-t-transparent" />}
                        {overlayErrors[ot] && <span className="text-red-400" title={overlayErrors[ot] ?? undefined}>!</span>}
                        <button type="button" onClick={() => handleRemoveOverlay(ot)} className="text-zinc-600 hover:text-white transition leading-none">×</button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* chart */}
                {mounted && (
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={backtestChartData} onMouseMove={handleBacktestHover} onMouseLeave={clearBacktestHover}>
                        <XAxis hide />
                        <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#52525b" }} width={40} />
                        <Tooltip
                          defaultIndex={mirroredBacktestHoverIndex}
                          contentStyle={ttStyle}
                          formatter={value => [`$${Number(Array.isArray(value) ? value[0] : value ?? 0).toFixed(2)}`]}
                        />
                        <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 10, paddingBottom: 4 }} />
                        {primaryPortfolio.length > 0 && (
                          <>
                            <Line type="monotone" dataKey="strategy" name={ticker || "Primary"} stroke={getColorForTicker(ticker)} strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="buyHold" name="Buy & Hold" stroke="#52525b" strokeWidth={1.5} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                          </>
                        )}
                        {overlayTickers.map((ot, idx) => (
                          <Line key={ot} type="monotone" dataKey={`strategy_${ot}`} name={ot} stroke={getColorForTicker(ot, idx)} strokeWidth={2} dot={false} isAnimationActive={false} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* legend */}
                <div className="mt-3 flex flex-wrap gap-4">
                  <div className="flex items-center gap-1.5">
                    <div className="h-px w-4 bg-green-400 rounded" />
                    <span className="text-[9px] text-zinc-600">RSI strategy</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 border-t border-dashed border-zinc-600" />
                    <span className="text-[9px] text-zinc-600">Buy &amp; hold</span>
                  </div>
                  {overlayTickers.map((ot, idx) => (
                    <div key={ot} className="flex items-center gap-1.5">
                      <div className="h-px w-4 rounded" style={{ backgroundColor: getColorForTicker(ot, idx) }} />
                      <span className="text-[9px] text-zinc-600">{ot}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Sentiment ─────────────────────────────────────────────── */}
            {sentiment && (
              <div className="relative rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
                {isSentimentLoading && (
                  <div className="absolute inset-0 z-40 flex items-center justify-center gap-2 rounded-2xl bg-black/65">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                    <span className="text-xs text-zinc-500">Loading sentiment…</span>
                  </div>
                )}
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                    </svg>
                    <span className="text-sm font-semibold">Market sentiment</span>
                  </div>
                  <span className={`rounded-full border px-3 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${
                    sentimentScore > 0 ? "border-green-500/25 bg-green-500/10 text-green-400"
                    : sentimentScore < 0 ? "border-red-500/25 bg-red-500/10 text-red-400"
                    : "border-zinc-700 bg-zinc-800 text-zinc-500"
                  }`}>
                    {sentiment.label ?? "Unavailable"}
                  </span>
                </div>
                <div className="relative mb-5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={`absolute h-full rounded-r-full transition-all duration-700 ${sentimentScore > 0 ? "bg-green-400" : sentimentScore < 0 ? "bg-red-400" : "bg-zinc-600"}`}
                    style={{ width: `${Math.min(Math.abs(sentimentScore), 1) * 100}%`, left: "50%", transform: sentimentScore < 0 ? "translateX(-100%)" : "none" }}
                  />
                  <div className="absolute bottom-0 left-1/2 top-0 w-px bg-zinc-600" />
                </div>
                <div className="max-h-60 space-y-1.5 overflow-y-auto pr-0.5">
                  {hasSentimentArticles
                    ? sentiment.articles?.map((article: SentimentArticle, i: number) => (
                        <a key={i} href={article.url} target="_blank" rel="noreferrer"
                          className="group flex items-start justify-between gap-3 rounded-xl border border-zinc-800 bg-black/20 p-2.5 transition hover:border-blue-500/30">
                          <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400 transition group-hover:text-zinc-200">{article.headline}</p>
                          <span className={`shrink-0 text-[9px] font-bold ${article.sentiment === "Bullish" ? "text-green-400" : article.sentiment === "Bearish" ? "text-red-400" : "text-zinc-600"}`}>
                            {article.sentiment}
                          </span>
                        </a>
                      ))
                    : <div className="rounded-xl border border-dashed border-zinc-800 bg-black/20 p-4 text-xs text-zinc-600">No recent sentiment articles were returned for this ticker.</div>
                  }
                </div>
              </div>
            )}

          </div>
        </main>
      </div>
    </div>
  )
}