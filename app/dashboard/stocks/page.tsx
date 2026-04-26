"use client"
import {
  useState,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceArea,
} from "recharts"
import { useSession, signIn } from "next-auth/react"

// ─── Types ────────────────────────────────────────────────────────────────────

type PriceChartPoint = { Date: string; Close: number }
type ShieldAlert = { ticker: string; price: number; msg?: string; type?: string }
type StockQuote = {
  name?: string; price?: number; change?: number
  change_pct?: number; max_high?: number; max_low?: number
}
type AnalysisResponse = {
  error?: string; rsi_signal?: string; rsi?: number; macd?: number
  sharpe?: number; sma50?: number; vola?: number; stock_cagr?: number
  spy_cagr?: number; sma100?: number
  bull_case?: ScenarioValue; bear_case?: ScenarioValue
}
type SimulationPoint = { Date: string; p95?: number; p50?: number; p5?: number }
type SimulationResponse = { data?: SimulationPoint[]; probability?: number; ml_expected_price?: number }
type BacktestResponse = {
  portfolio?: number[]; buy_hold?: Array<number | null>
  total_return?: number; buy_hold_return?: number
  sharpe?: number; max_drawdown?: number
  buy_signals?: number; sell_signals?: number
}
type SentimentArticle = { url: string; headline: string; sentiment?: string }
type SentimentResponse = { score?: number; label?: string; articles?: SentimentArticle[] }
type PriceChartSelection = { startIndex: number; endIndex: number }
type DrawingPoint = { x: number; y: number }
type ChartStroke = { id: number; points: DrawingPoint[] }
type SyncedHoverState = { source: "price"; index: number } | { source: "backtest"; index: number } | null
type ScenarioValue = string | number | boolean | null | undefined | ScenarioValue[] | { [key: string]: ScenarioValue }
type ChartInteractionState = { activeTooltipIndex?: number | string | null; activeIndex?: number | string | null }

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIOD_MAP: Record<string, number> = {
  "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getChartIndex(nextState: ChartInteractionState) {
  const rawIndex = nextState.activeTooltipIndex ?? nextState.activeIndex
  if (typeof rawIndex === "number" && Number.isFinite(rawIndex)) return rawIndex
  if (typeof rawIndex === "string") {
    const n = Number(rawIndex)
    if (Number.isFinite(n)) return n
  }
  return null
}

function getSelectionMetrics(points: PriceChartPoint[], s: PriceChartSelection) {
  const start = points[s.startIndex]; const end = points[s.endIndex]
  const left = points[Math.min(s.startIndex, s.endIndex)]
  const right = points[Math.max(s.startIndex, s.endIndex)]
  if (!start || !end || !left || !right || start.Close === 0) return null
  const change = end.Close - start.Close
  const changePct = (change / start.Close) * 100
  return { startPoint: start, endPoint: end, leftBound: left, rightBound: right, change, changePct }
}

function mapHoverIndex(si: number, sl: number, tl: number) {
  if (sl <= 0 || tl <= 0) return undefined
  if (sl === 1 || tl === 1) return 0
  const p = si / (sl - 1)
  return Math.min(tl - 1, Math.max(0, Math.round(p * (tl - 1))))
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function sanitizeTickerInput(value: string) {
  return value.toUpperCase().replace(/[^A-Z.-]/g, "").slice(0, 10)
}

function parseTargetPrice(value: string) {
  if (!value.trim()) return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
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
    const u = new URL(apiBase)
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
    u.pathname = "/ws/shield"
    u.search = ""; u.hash = ""
    return u.toString()
  } catch { return "ws://localhost:8000/ws/shield" }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const ct = res.headers.get("content-type") ?? ""
  const payload = ct.includes("application/json") ? await res.json() : await res.text()
  if (!res.ok) {
    if (payload && typeof payload === "object") {
      const ep = payload as Record<string, unknown>
      const detail = typeof ep.detail === "string" ? ep.detail : typeof ep.message === "string" ? ep.message : null
      if (detail) throw new Error(detail)
    }
    if (typeof payload === "string" && payload.trim()) throw new Error(payload)
    throw new Error(`Request failed with status ${res.status}`)
  }
  return payload as T
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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
      <div className="space-y-2">
        {value.map((item, i) => (
          <div key={i} className="flex gap-2 text-xs text-zinc-300">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-60" />
            <div>{renderScenarioValue(item)}</div>
          </div>
        ))}
      </div>
    )
  const entries = Object.entries(value)
  if (!entries.length) return <p className="text-xs text-zinc-600">No details.</p>
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">{formatScenarioLabel(k)}</p>
          <div className="mt-0.5 text-xs text-zinc-300">{renderScenarioValue(v)}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

const StatCard = ({
  label, value, sub, color = "",
}: { label: string; value: string | number | null | undefined; sub?: string; color?: string }) => (
  <div className="flex flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
    <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">{label}</p>
    <p className={`font-mono text-base font-medium leading-none ${color || "text-zinc-100"}`}>{value ?? "N/A"}</p>
    {sub && <p className="text-[9px] text-zinc-700">{sub}</p>}
  </div>
)

// ─── Signal Pill ──────────────────────────────────────────────────────────────

const SignalPill = ({ signal }: { signal: string }) => {
  const map: Record<string, string> = {
    Buy: "border-green-700/60 bg-green-950/50 text-green-400",
    Sell: "border-red-700/60 bg-red-950/50 text-red-400",
    Neutral: "border-zinc-700/60 bg-zinc-900 text-zinc-400",
    "Strong Buy": "border-green-600/70 bg-green-950/60 text-green-300",
    "Strong Sell": "border-red-600/70 bg-red-950/60 text-red-300",
  }
  return (
    <span className={`font-mono rounded-full border px-3 py-0.5 text-[10px] font-bold tracking-[0.1em] uppercase ${map[signal] ?? "border-zinc-700 bg-zinc-900 text-zinc-400"}`}>
    {signal}
    </span>
  )
}

// ─── Nav Icon ─────────────────────────────────────────────────────────────────

const NavIcon = ({ active, children }: { active?: boolean; children: ReactNode }) => (
  <div className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-colors ${active ? "bg-blue-500/15 text-blue-400" : "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"}`}>
    {children}
  </div>
)

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Stocks() {
  const [ticker, setTicker] = useState("")
  const [data, setData] = useState<StockQuote | null>(null)
  const [chartData, setChartData] = useState<PriceChartPoint[] | null>(null)
  const [period, setPeriod] = useState("1y")
  const [load, setLoad] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)
  const [sim, setSim] = useState<SimulationPoint[] | null>(null)
  const [prob, setProb] = useState<number | null>(null)
  const [mlReturn, setMlReturn] = useState<number | null>(null)
  const [targetPrice, setTargetPrice] = useState("")
  const [backtestData, setBacktestData] = useState<BacktestResponse | null>(null)
  const [isBacktesting, setIsBacktesting] = useState(false)
  const [blackSwanData, setBlackSwanData] = useState<{ ticker: string; stress_label: string; historical_drawdown: number; projected_path: number[]; vaR_percent: number } | null>(null)
  const [isBlackSwanLoading, setIsBlackSwanLoading] = useState(false)
  const [showBlackSwanOverlay, setShowBlackSwanOverlay] = useState(false)
  const [sentiment, setSentiment] = useState<SentimentResponse | null>(null)
  const [recents, setRecents] = useState<string[]>([])
  const { data: session, status } = useSession()
  const [isGuest, setIsGuest] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [priceChartSelection, setPriceChartSelection] = useState<PriceChartSelection | null>(null)
  const [isSelectingPriceChart, setIsSelectingPriceChart] = useState(false)
  const [isPriceChartDrawMode, setIsPriceChartDrawMode] = useState(false)
  const [priceChartStrokes, setPriceChartStrokes] = useState<ChartStroke[]>([])
  const [activePriceChartStroke, setActivePriceChartStroke] = useState<ChartStroke | null>(null)
  const [syncedHover, setSyncedHover] = useState<SyncedHoverState>(null)
  const [activeAlert, setActiveAlert] = useState<ShieldAlert | null>(null)
  const [isSaved, setIsSaved] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [backtestError, setBacktestError] = useState<string | null>(null)
  const [targetSaveError, setTargetSaveError] = useState<string | null>(null)
  const [isSavingTarget, setIsSavingTarget] = useState(false)
  const [shieldStatus, setShieldStatus] = useState<"connecting" | "live" | "offline">("connecting")
  const nextStrokeId = useRef(0)
  const alertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  const parsedTargetPrice = parseTargetPrice(targetPrice)
  const userInitials =
    session?.user?.name?.slice(0, 2).toUpperCase() ||
    session?.user?.email?.slice(0, 2).toUpperCase() || "TU"
  const shieldLabel = { live: "Shield live", connecting: "Connecting…", offline: "Shield offline" }[shieldStatus]
  const shieldClass = {
    live: "border-emerald-600/40 bg-emerald-500/10 text-emerald-400",
    connecting: "border-amber-600/40 bg-amber-500/10 text-amber-400",
    offline: "border-red-600/40 bg-red-500/10 text-red-400",
  }[shieldStatus]

  // ── Backtest ────────────────────────────────────────────────────────────────

  async function runBackTest(t: string) {
    if (!t) return
    setIsBacktesting(true); setBacktestError(null)
    try {
      setBacktestData(await fetchJson<BacktestResponse>(`${API_BASE}/stock/${encodeURIComponent(t)}/backtest`))
    } catch (e) {
      setBacktestData(null)
      setBacktestError(getErrorMessage(e, "Backtest data is unavailable."))
    } finally { setIsBacktesting(false) }
  }

  // Simulate / fetch black-swan worst-case projection for current ticker
  async function handleSimulateBlackSwan() {
    const t = sanitizeTickerInput(ticker)
    if (!t) return
    setIsBlackSwanLoading(true)
    setBlackSwanData(null)
    try {
      const bs = await fetchJson<{ ticker: string; stress_label: string; historical_drawdown: number; projected_path: number[]; vaR_percent: number }>(
        `${API_BASE}/stock/${encodeURIComponent(t)}/black-swan`
      )
      setBlackSwanData(bs)
      setShowBlackSwanOverlay(true)
    } catch (e) {
      console.error("Black swan simulate error:", e)
      setBlackSwanData(null)
    } finally {
      setIsBlackSwanLoading(false)
    }
  }

  // ── Analyze ─────────────────────────────────────────────────────────────────

  async function Analyze(manualTicker?: string) {
    const t = sanitizeTickerInput(manualTicker ?? ticker)
    if (!t) { setAnalysisError("Enter a ticker symbol."); return }
    setTicker(t); setLoad(true)
    setAnalysisError(null); setBacktestError(null); setTargetSaveError(null); setBacktestData(null)
    try {
      const tq = parsedTargetPrice !== null ? `?target_price=${parsedTargetPrice}` : ""
      const [sData, aData, hData, simData, sentData] = await Promise.all([
        fetchJson<StockQuote>(`${API_BASE}/stock/${encodeURIComponent(t)}`),
        fetchJson<AnalysisResponse>(`${API_BASE}/analyze/${encodeURIComponent(t)}`),
        fetchJson<PriceChartPoint[]>(`${API_BASE}/stock/${encodeURIComponent(t)}/history?period_days=${PERIOD_MAP[period]}`),
        fetchJson<SimulationResponse>(`${API_BASE}/stock/${encodeURIComponent(t)}/simulate${tq}`),
        fetchJson<SentimentResponse>(`${API_BASE}/stock/${encodeURIComponent(t)}/sentiment`),
      ])
      setData(sData); setAnalysis(aData)
      setChartData(Array.isArray(hData) ? hData : [])
      setSentiment(sentData)
      setAnalysisError(typeof aData?.error === "string" ? aData.error : null)
      if (Array.isArray(simData?.data)) {
        setSim(simData.data)
        setProb(typeof simData.probability === "number" ? simData.probability : null)
        setMlReturn(typeof simData.ml_expected_price === "number" ? simData.ml_expected_price : null)
      } else { setSim(null); setProb(null); setMlReturn(null) }
      void runBackTest(t)
      setRecents(prev => {
        const u = [t, ...prev.filter(x => x !== t)].slice(0, 5)
        localStorage.setItem("talos_recents", JSON.stringify(u))
        return u
      })
    } catch (e) {
      setData(null); setAnalysis(null); setChartData(null)
      setSim(null); setProb(null); setMlReturn(null); setSentiment(null)
      setAnalysisError(getErrorMessage(e, "Talos couldn't load this ticker."))
    } finally { setLoad(false) }
  }

  // ── Effects ─────────────────────────────────────────────────────────────────

  // Shield WebSocket
  useEffect(() => {
    let cancelled = false
    const socket = new WebSocket(getShieldSocketUrl(API_BASE))
    setShieldStatus("connecting")
    socket.onopen = () => { if (!cancelled) setShieldStatus("live") }
    socket.onerror = () => { if (!cancelled) setShieldStatus("offline") }
    socket.onclose = () => { if (!cancelled) setShieldStatus(s => s === "live" ? "offline" : s) }
    socket.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data) as ShieldAlert
        if (d.type === "SHIELD_ALERT") {
          if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
          setActiveAlert(d)
          alertTimeoutRef.current = setTimeout(() => setActiveAlert(null), 8000)
        }
      } catch {}
    }
    return () => {
      cancelled = true
      if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
      if (saveResetRef.current) clearTimeout(saveResetRef.current)
      socket.close()
    }
  }, [API_BASE])

  // Period → refresh chart
  useEffect(() => {
    if (!ticker || !data) return
    let cancelled = false
    const load = async () => {
      try {
        const h = await fetchJson<PriceChartPoint[]>(`${API_BASE}/stock/${encodeURIComponent(ticker)}/history?period_days=${PERIOD_MAP[period]}`)
        if (!cancelled) setChartData(Array.isArray(h) ? h : [])
      } catch (e) {
        if (!cancelled) { setChartData(null); setAnalysisError(getErrorMessage(e, "Price history could not be refreshed.")) }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [API_BASE, data, period, ticker])

  // Target price → simulation
  useEffect(() => {
    if (!ticker || parsedTargetPrice === null) return
    const id = setTimeout(async () => {
      try {
        const j = await fetchJson<SimulationResponse>(`${API_BASE}/stock/${encodeURIComponent(ticker)}/simulate?target_price=${parsedTargetPrice}`)
        if (typeof j?.probability === "number") setProb(j.probability)
      } catch {}
    }, 500)
    return () => clearTimeout(id)
  }, [API_BASE, parsedTargetPrice, ticker])

  // Load saved target
  useEffect(() => {
    if (!session?.user?.id || !ticker) { setTargetPrice(""); return }
    let cancelled = false
    const load = async () => {
      try {
        const j = await fetchJson<{ target_price?: number | null }>(`${API_BASE}/stock/${encodeURIComponent(ticker)}/target/${session.user.id}`)
        if (!cancelled) setTargetPrice(j?.target_price != null ? String(j.target_price) : "")
      } catch { if (!cancelled) setTargetPrice("") }
    }
    void load()
    return () => { cancelled = true }
  }, [API_BASE, session, ticker])

  // Load recents
  useEffect(() => {
    try {
      const s = localStorage.getItem("talos_recents")
      if (!s) return
      const p = JSON.parse(s)
      if (Array.isArray(p)) setRecents(p.filter((x): x is string => typeof x === "string"))
    } catch { localStorage.removeItem("talos_recents") }
  }, [])

  useEffect(() => { if (session) setIsGuest(false) }, [session])
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    setPriceChartSelection(null); setIsSelectingPriceChart(false)
    setIsPriceChartDrawMode(false); setPriceChartStrokes([])
    setActivePriceChartStroke(null); setSyncedHover(null)
  }, [chartData])

  // ── Save target ─────────────────────────────────────────────────────────────

  const handleSaveTarget = async () => {
    if (isGuest || !session?.user?.id) { setTargetSaveError("Sign in to arm Shield alerts."); return }
    if (!ticker) { setTargetSaveError("Analyze a ticker first."); return }
    if (parsedTargetPrice === null) { setTargetSaveError("Enter a valid positive price."); return }
    setIsSavingTarget(true); setTargetSaveError(null)
    try {
      await fetchJson(`${API_BASE}/stock/target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: ticker.toUpperCase(), user_id: session.user.id, target_price: parsedTargetPrice }),
      })
      if (saveResetRef.current) clearTimeout(saveResetRef.current)
      setIsSaved(true)
      saveResetRef.current = setTimeout(() => setIsSaved(false), 2000)
    } catch (e) {
      setTargetSaveError(getErrorMessage(e, "Shield could not save this alert."))
    } finally { setIsSavingTarget(false) }
  }

  // ── Chart interaction helpers ────────────────────────────────────────────────

  const handlePriceChartStart = (s: ChartInteractionState) => {
    if (isPriceChartDrawMode) return
    const i = getChartIndex(s); if (i === null) return
    setIsSelectingPriceChart(true)
    setPriceChartSelection({ startIndex: i, endIndex: i })
  }

  const handlePriceChartMove = (s: ChartInteractionState) => {
    if (isPriceChartDrawMode || !isSelectingPriceChart) return
    const i = getChartIndex(s); if (i === null) return
    setPriceChartSelection(prev => prev ? { ...prev, endIndex: i } : { startIndex: i, endIndex: i })
  }

  const handlePriceChartEnd = (s?: ChartInteractionState) => {
    if (isPriceChartDrawMode || !isSelectingPriceChart) return
    const i = s ? getChartIndex(s) : null
    if (i !== null) setPriceChartSelection(prev => prev ? { ...prev, endIndex: i } : { startIndex: i, endIndex: i })
    setIsSelectingPriceChart(false)
  }

  const getPriceChartPoint = (e: ReactPointerEvent<SVGSVGElement>): DrawingPoint => {
    const b = e.currentTarget.getBoundingClientRect()
    return { x: Math.min(Math.max(e.clientX - b.left, 0), b.width), y: Math.min(Math.max(e.clientY - b.top, 0), b.height) }
  }

  const handleDrawStart = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPriceChartDrawMode) return
    e.preventDefault()
    const stroke = { id: nextStrokeId.current++, points: [getPriceChartPoint(e)] }
    e.currentTarget.setPointerCapture(e.pointerId)
    setActivePriceChartStroke(stroke)
  }

  const handleDrawMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPriceChartDrawMode) return
    setActivePriceChartStroke(prev => {
      if (!prev) return prev
      const pt = getPriceChartPoint(e)
      const last = prev.points[prev.points.length - 1]
      if (last && last.x === pt.x && last.y === pt.y) return prev
      return { ...prev, points: [...prev.points, pt] }
    })
  }

  const finishStroke = () => {
    setActivePriceChartStroke(prev => {
      if (prev && prev.points.length > 0) setPriceChartStrokes(c => [...c, prev])
      return null
    })
  }

  const handleDrawEnd = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPriceChartDrawMode) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    finishStroke()
  }

  const selectedRange = chartData && priceChartSelection
    ? getSelectionMetrics(chartData, priceChartSelection) : null

  const backtestChartData = Array.isArray(backtestData?.portfolio)
    ? backtestData.portfolio.map((v: number, i: number) => ({ name: i, strategy: v, buyHold: backtestData.buy_hold?.[i] ?? null }))
    : []

  const shouldSync = PERIOD_MAP[period] < PERIOD_MAP["2y"]
  const mirroredPriceIdx = shouldSync && syncedHover?.source === "backtest"
    ? mapHoverIndex(syncedHover.index, backtestChartData.length, chartData?.length ?? 0) : undefined
  const mirroredBtIdx = shouldSync && syncedHover?.source === "price"
    ? mapHoverIndex(syncedHover.index, chartData?.length ?? 0, backtestChartData.length) : undefined

  const canAnalyze = sanitizeTickerInput(ticker).length > 0 && !load
  const sentimentScore = typeof sentiment?.score === "number" ? sentiment.score : 0
  const priceChange = typeof data?.change === "number" ? data.change : null
  const stockCagr = typeof analysis?.stock_cagr === "number" ? analysis.stock_cagr : null
  const btReturn = typeof backtestData?.total_return === "number" ? backtestData.total_return : null

  // ── Auth gate ────────────────────────────────────────────────────────────────

  if (status === "loading")
    return <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-400 font-mono text-sm tracking-wider">LOADING TALOS…</div>

  if (!session && !isGuest)
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

  // ── Main UI ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">

      {/* ─── Sidebar ──────────────────────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col items-center w-14 shrink-0 border-r border-zinc-900 bg-zinc-950 py-4 gap-2">
        {/* Logo */}
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
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
          </svg>
        </NavIcon>
        <NavIcon>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </NavIcon>
        <NavIcon>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </NavIcon>
        <div className="mt-auto">
          <NavIcon>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 1 0-16 0" />
            </svg>
          </NavIcon>
        </div>
      </div>

      {/* ─── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0">

        {/* ─── Topbar ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 border-b border-zinc-900 bg-zinc-950 px-5 h-12 shrink-0">
          <span className="font-mono text-[10px] font-semibold tracking-[0.22em] text-zinc-600">TALOS ENGINE</span>
          <div className="h-4 w-px bg-zinc-800" />

          {/* Search */}
          <div className="flex h-8 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 transition focus-within:border-zinc-700">
            <input
              className="w-24 bg-transparent font-mono text-xs font-semibold uppercase text-zinc-100 outline-none placeholder-zinc-700"
              placeholder="TICKER"
              value={ticker}
              onChange={e => setTicker(sanitizeTickerInput(e.target.value))}
              onKeyDown={e => { if (e.key === "Enter") void Analyze() }}
            />
            {data?.name && <span className="truncate font-mono text-[10px] text-zinc-600 max-w-[120px]">{data.name}</span>}
          </div>

          <button
            type="button"
            onClick={() => void Analyze()}
            disabled={!canAnalyze}
            className="h-8 rounded-lg bg-blue-500 px-4 font-mono text-xs font-bold text-white transition hover:bg-blue-400 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {load ? "…" : "RUN"}
          </button>

          {/* Recents */}
          {recents.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="font-mono text-[9px] tracking-[0.16em] text-zinc-700">RECENTS</span>
              {recents.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTicker(t); void Analyze(t) }}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] font-medium text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-200 active:scale-95"
                >
                  {t}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setRecents([]); localStorage.removeItem("talos_recents") }}
                className="font-mono text-[9px] text-zinc-700 hover:text-red-400 transition"
              >
                clear
              </button>
            </div>
          )}

          {/* Period pills */}
          <div className="ml-auto flex items-center gap-1">
            {Object.keys(PERIOD_MAP).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-md px-2.5 py-1 font-mono text-[10px] font-semibold transition ${period === p ? "bg-zinc-800 text-zinc-100" : "text-zinc-600 hover:text-zinc-400"}`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Shield status */}
          <span className={`hidden sm:inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.14em] uppercase ${shieldClass}`}>
            {shieldLabel}
          </span>

          {/* User avatar */}
          {session?.user && (
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 font-mono text-[10px] font-bold text-blue-400">
              {userInitials}
            </div>
          )}
        </div>

        {/* ─── Content ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto p-4 space-y-3">

          {/* Shield alert */}
          {activeAlert && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3">
              <div>
                <p className="font-mono text-[9px] font-bold tracking-[0.2em] uppercase text-red-400">Shield Activated</p>
                <p className="mt-0.5 text-sm font-medium">{activeAlert.ticker} hit {formatCurrency(activeAlert.price)}</p>
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

          {/* Loading */}
          {load && (
            <div className="flex items-center gap-3 text-blue-400">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
              <span className="font-mono text-xs animate-pulse">Crunching market data…</span>
            </div>
          )}

          {/* Error */}
          {analysisError && (
            <div className="rounded-xl border border-red-500/25 bg-red-950/15 px-4 py-3">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-red-400">Analysis issue</p>
              <p className="mt-1 text-xs text-red-200">{analysisError}</p>
            </div>
          )}

          {/* Empty state */}
          {!load && !analysisError && !data && !analysis && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8">
              <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-blue-400 mb-3">Ready</p>
              <h2 className="text-2xl font-bold tracking-tight text-zinc-100">
                Search any ticker to load price, scenarios, sentiment, and backtests.
              </h2>
              <p className="mt-2 max-w-lg text-sm text-zinc-500 leading-relaxed">
                Try <code className="font-mono text-zinc-400 text-xs">AAPL</code>,{" "}
                <code className="font-mono text-zinc-400 text-xs">MSFT</code>, or{" "}
                <code className="font-mono text-zinc-400 text-xs">NVDA</code>.
              </p>
            </div>
          )}

          {/* ── Signal bar ──────────────────────────────────────────────── */}
          {data && analysis && !analysis.error && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
              <span className="font-mono text-xs font-bold tracking-widest text-zinc-500">{ticker}</span>
              <span className="font-mono text-2xl font-semibold text-zinc-50">{formatCurrency(data.price)}</span>
              {priceChange !== null && (
                <span className={`font-mono text-xs font-medium ${priceChange >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {priceChange >= 0 ? "+" : ""}{formatNumber(priceChange)} ({formatPercent(data.change_pct, 2)})
                </span>
              )}
              <SignalPill signal={analysis.rsi_signal ?? "Neutral"} />
              <div className="ml-auto flex flex-wrap gap-5">
                {([["RSI", formatNumber(analysis.rsi)], ["MACD", formatNumber(analysis.macd)], ["Sharpe", formatNumber(analysis.sharpe)]] as [string, string][]).map(([label, val]) => (
                  <div key={label} className="flex flex-col items-end gap-0.5">
                    <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-zinc-600">{label}</span>
                    <span className="font-mono text-xs text-zinc-200">{val}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Stat cards ──────────────────────────────────────────────── */}
          {data && analysis && !analysis.error && (
            <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
              <StatCard label="52W High" value={formatCurrency(data.max_high)} />
              <StatCard label="52W Low" value={formatCurrency(data.max_low)} />
              <StatCard label="50D SMA" value={formatCurrency(analysis.sma50)} />
              <StatCard label="100D SMA" value={formatCurrency(analysis.sma100)} />
              <StatCard label="Volatility" value={formatPercent(analysis.vola)} />
              <StatCard
                label="Stock CAGR"
                value={formatPercent(stockCagr)}
                color={stockCagr !== null && stockCagr > 0 ? "text-green-400" : "text-red-400"}
              />
              <StatCard label="S&P CAGR" value={formatPercent(analysis.spy_cagr)} color="text-zinc-500" />
              <StatCard label="Sharpe" value={formatNumber(analysis.sharpe)} />
            </div>
          )}

          {/* ── Chart + Projection ──────────────────────────────────────── */}
          {(chartData || sim) && (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.45fr_1fr]">

              {/* Price chart */}
              {chartData && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-zinc-600">
                        Price · {PERIOD_MAP[period]}d
                      </span>
                      {ticker && (
                        <button
                          type="button"
                          onClick={() => void handleSimulateBlackSwan()}
                          className={`ml-2 h-7 px-2 rounded-lg font-mono text-[10px] font-semibold transition ${
                            isBlackSwanLoading ? "bg-zinc-800 text-zinc-400 cursor-wait" : "bg-red-700/10 text-red-300 hover:bg-red-700/20"
                          }`}
                        >
                          {isBlackSwanLoading ? "Simulating..." : "Simulate Black Swan"}
                        </button>
                      )}
                    </div>
                    <div className="text-right">
                      {selectedRange ? (
                        <>
                          <p className={`font-mono text-xs font-medium ${selectedRange.changePct >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {selectedRange.changePct >= 0 ? "+" : ""}{selectedRange.changePct.toFixed(2)}% return
                          </p>
                          <p className="font-mono text-[9px] text-zinc-600 mt-0.5">
                            {selectedRange.startPoint.Date} → {selectedRange.endPoint.Date}
                          </p>
                        </>
                      ) : stockCagr !== null ? (
                        <>
                          <p className={`font-mono text-xs font-medium ${stockCagr >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {stockCagr >= 0 ? "+" : ""}{stockCagr.toFixed(1)}% CAGR
                          </p>
                          <p className="font-mono text-[9px] text-zinc-700 mt-0.5">drag to measure</p>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {mounted && (
                    <div className="relative" style={{ height: 220 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={chartData}
                          onMouseDown={handlePriceChartStart}
                          onMouseMove={s => { handlePriceChartMove(s); if (shouldSync && !isPriceChartDrawMode) { const i = getChartIndex(s); if (i !== null) setSyncedHover({ source: "price", index: i }) } }}
                          onMouseUp={handlePriceChartEnd}
                          onMouseLeave={() => { handlePriceChartEnd(); setSyncedHover(p => p?.source === "price" ? null : p) }}
                        >
                          <defs>
                            <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} />
                              <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="Date" hide />
                          <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "#52525b", fontFamily: "IBM Plex Mono" }} width={44} />
                          <Tooltip
                            defaultIndex={mirroredPriceIdx}
                            formatter={v => [`$${Number(Array.isArray(v) ? v[0] : v ?? 0).toFixed(2)}`, "Close"]}
                            contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 11, fontFamily: "IBM Plex Mono" }}
                            labelStyle={{ color: "#52525b" }}
                          />
                          {selectedRange && (
                            <ReferenceArea
                              x1={selectedRange.leftBound.Date}
                              x2={selectedRange.rightBound.Date}
                              fill={selectedRange.changePct >= 0 ? "#22c55e" : "#ef4444"}
                              fillOpacity={0.1}
                              strokeOpacity={0}
                              ifOverflow="extendDomain"
                            />
                          )}
                          <Area type="monotone" dataKey="Close" stroke="#22c55e" strokeWidth={1.5} fill="url(#pg)" dot={false} isAnimationActive={false} />
                          {showBlackSwanOverlay && blackSwanData?.projected_path && (
                            <Line
                              type="monotone"
                              dataKey="blackSwan"
                              name={blackSwanData.stress_label ?? "Black Swan"}
                              stroke="#ef4444"
                              strokeWidth={2}
                              strokeDasharray="6 4"
                              dot={false}
                              isAnimationActive={false}
                              data={chartData?.map((p, i) => ({ ...p, blackSwan: blackSwanData.projected_path[i] ?? null })) ?? []}
                            />
                          )}
                        </AreaChart>
                      </ResponsiveContainer>

                      {/* Drawing overlay */}
                      <svg
                        className={`absolute inset-0 h-full w-full ${isPriceChartDrawMode ? "pointer-events-auto cursor-crosshair" : "pointer-events-none"}`}
                        onPointerDown={handleDrawStart}
                        onPointerMove={handleDrawMove}
                        onPointerUp={handleDrawEnd}
                        onPointerLeave={handleDrawEnd}
                      >
                        {priceChartStrokes.map(s => (
                          <polyline key={s.id} points={s.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        ))}
                        {activePriceChartStroke && (
                          <polyline points={activePriceChartStroke.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        )}
                      </svg>

                      {/* Draw mode controls */}
                      <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
                        {priceChartStrokes.length > 0 && (
                          <button
                            type="button"
                            onClick={() => { setPriceChartStrokes([]); setActivePriceChartStroke(null) }}
                            className="rounded bg-black/60 px-2 py-1 font-mono text-[9px] font-semibold text-zinc-400 hover:text-white transition"
                          >
                            Clear
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { setIsPriceChartDrawMode(p => !p); setIsSelectingPriceChart(false); setPriceChartSelection(null); setActivePriceChartStroke(null) }}
                          className={`rounded-full border p-1.5 transition ${isPriceChartDrawMode ? "border-amber-500/60 bg-amber-500/15 text-amber-400" : "border-zinc-700 bg-black/50 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"}`}
                          title={isPriceChartDrawMode ? "Disable draw mode" : "Draw on chart"}
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Monte Carlo / Shield */}
              {sim && (
                <div className="relative rounded-xl border border-zinc-800 bg-zinc-900 p-4 overflow-hidden">
                  {/* Guest lock */}
                  {isGuest && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl bg-black/70 backdrop-blur-md">
                      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-blue-500/40 bg-blue-500/10">
                        <svg className="h-4 w-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2V7a5 5 0 00-5-5zM7 7a3 3 0 116 0v2H7V7z" />
                        </svg>
                      </div>
                      <p className="font-mono text-[10px] font-bold tracking-widest uppercase text-zinc-300">Pro Feature</p>
                      <button onClick={() => void signIn("google")} className="mt-1 font-mono text-[10px] text-blue-400 hover:underline">Sign in to unlock</button>
                    </div>
                  )}

                  <div className={isGuest ? "blur-sm grayscale opacity-25 select-none pointer-events-none" : ""}>
                    {/* Header */}
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <p className="font-mono text-xs font-medium text-zinc-200">30-Day Projection</p>
                        <p className="font-mono text-[9px] text-zinc-600 mt-0.5">Monte Carlo · 1,000 paths</p>
                      </div>
                      <span className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest text-blue-400">AI</span>
                    </div>

                    {/* Mini stats */}
                    {(mlReturn !== null || prob !== null) && (
                      <div className={`mb-3 grid gap-2 ${prob !== null ? "grid-cols-3" : "grid-cols-2"}`}>
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                          <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-600 mb-1">AI Bias 30D</p>
                          <p className={`font-mono text-lg font-semibold leading-none ${mlReturn === null ? "text-zinc-400" : mlReturn >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {mlReturn !== null ? `${mlReturn >= 0 ? "↑" : "↓"} ${(mlReturn * 100).toFixed(1)}%` : "N/A"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                          <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-600 mb-1">Conviction</p>
                          <p className="font-mono text-sm font-medium mt-1 text-zinc-200">{mlReturn !== null && Math.abs(mlReturn) > 0.05 ? "High" : "Moderate"}</p>
                        </div>
                        {prob !== null && (
                          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                            <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-600 mb-1">Target Odds</p>
                            <p className="font-mono text-sm font-medium mt-1 text-zinc-200">{formatPercent(prob * 100)}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Simulation chart */}
                    {mounted && Array.isArray(sim) && sim.length > 0 ? (
                      <div style={{ height: 110 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={sim}>
                            <XAxis dataKey="Date" hide />
                            <YAxis domain={["auto", "auto"]} orientation="right" tick={{ fontSize: 9, fill: "#52525b", fontFamily: "IBM Plex Mono" }} width={44} />
                            <Tooltip
                              formatter={v => [`$${Number(Array.isArray(v) ? v[0] : v ?? 0).toFixed(2)}`, "Price"]}
                              contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 11 }}
                            />
                            <Area type="monotone" dataKey="p95" stroke="#1d4ed8" fill="#1d4ed8" fillOpacity={0.04} strokeWidth={1} strokeDasharray="4 3" dot={false} />
                            <Area type="monotone" dataKey="p50" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.12} strokeWidth={2} dot={false} />
                            <Area type="monotone" dataKey="p5" stroke="#1d4ed8" fill="transparent" strokeWidth={1} strokeDasharray="4 3" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-xs font-mono text-zinc-600">
                        Simulation data unavailable for this ticker.
                      </div>
                    )}

                    {/* Shield alert input */}
                    <div className="mt-4 pt-4 border-t border-zinc-800">
                      <p className="font-mono text-[9px] tracking-[0.16em] uppercase text-zinc-600 mb-2">Arm shield when price hits</p>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={targetPrice}
                          onChange={e => setTargetPrice(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && void handleSaveTarget()}
                          className="h-9 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 font-mono text-xs text-zinc-100 outline-none transition placeholder-zinc-700 focus:border-zinc-600"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveTarget()}
                          disabled={isSavingTarget || parsedTargetPrice === null}
                          className="h-9 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 font-mono text-xs font-bold text-blue-300 transition hover:border-blue-400/50 hover:bg-blue-500/15 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isSavingTarget ? "…" : "ARM"}
                        </button>
                      </div>
                      <p className={`mt-1.5 font-mono text-[10px] ${targetSaveError ? "text-red-400" : isSaved ? "text-green-400" : "text-zinc-700"}`}>
                        {targetSaveError ?? (isSaved ? "Shield alert saved." : "Save a target to receive backend alerts.")}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Scenario cards ──────────────────────────────────────────── */}
          {analysis && !analysis.error && (analysis.bull_case || analysis.bear_case) && (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/15 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-500">Bull Case</p>
                    <p className="text-[10px] text-emerald-400/60 mt-0.5">What drives upside from here</p>
                  </div>
                  <span className="rounded-full border border-emerald-600/25 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[9px] font-semibold text-emerald-400">Upside</span>
                </div>
                {renderScenarioValue(analysis.bull_case as ScenarioValue)}
              </div>
              <div className="rounded-xl border border-red-900/50 bg-red-950/15 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-red-500">Bear Case</p>
                    <p className="text-[10px] text-red-400/60 mt-0.5">What could pressure the stock</p>
                  </div>
                  <span className="rounded-full border border-red-600/25 bg-red-500/10 px-2.5 py-0.5 font-mono text-[9px] font-semibold text-red-400">Downside</span>
                </div>
                {renderScenarioValue(analysis.bear_case as ScenarioValue)}
              </div>
            </div>
          )}

          {/* ── Backtest ────────────────────────────────────────────────── */}
          {isBacktesting && (
            <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-10 justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <span className="font-mono text-xs text-zinc-500">Running RSI backtest…</span>
            </div>
          )}

          {backtestError && !isBacktesting && (
            <div className="rounded-xl border border-amber-600/25 bg-amber-950/15 px-4 py-3">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-amber-400">Backtest unavailable</p>
              <p className="mt-1 text-xs text-amber-200/80">{backtestError}</p>
            </div>
          )}

          {backtestData && !isBacktesting && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <p className="font-mono text-xs font-medium text-zinc-200">RSI Backtest</p>
                  <p className="font-mono text-[9px] text-zinc-600 mt-0.5">Buy RSI &lt; 30 / Sell RSI &gt; 70 · 2-year window</p>
                </div>
                <div className="text-right">
                  <p className={`font-mono text-2xl font-semibold ${btReturn !== null && btReturn > 0 ? "text-green-400" : "text-red-400"}`}>
                    {btReturn !== null && btReturn > 0 ? "+" : ""}{formatPercent(btReturn, 1)}
                  </p>
                  <p className="font-mono text-[9px] text-zinc-600 mt-0.5">vs {formatPercent(backtestData.buy_hold_return)} buy &amp; hold</p>
                </div>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                <StatCard label="Sharpe" value={formatNumber(backtestData.sharpe)} />
                <StatCard label="Max Drawdown" value={formatPercent(backtestData.max_drawdown)} color="text-red-400" />
                <StatCard label="Buy Signals" value={backtestData.buy_signals} />
                <StatCard label="Sell Signals" value={backtestData.sell_signals} />
              </div>
              {mounted && (
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={backtestChartData}
                      onMouseMove={s => { if (!shouldSync) return; const i = getChartIndex(s); if (i !== null) setSyncedHover({ source: "backtest", index: i }) }}
                      onMouseLeave={() => setSyncedHover(p => p?.source === "backtest" ? null : p)}
                    >
                      <XAxis hide />
                      <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "#52525b", fontFamily: "IBM Plex Mono" }} width={40} />
                      <Tooltip
                        defaultIndex={mirroredBtIdx}
                        contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 11 }}
                        formatter={v => [`$${Number(Array.isArray(v) ? v[0] : v ?? 0).toFixed(2)}`]}
                      />
                      <Line type="monotone" dataKey="strategy" stroke="#22c55e" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="buyHold" stroke="#3f3f46" strokeWidth={1.5} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="mt-3 flex gap-4">
                <div className="flex items-center gap-1.5">
                  <div className="h-px w-4 bg-green-500 rounded" />
                  <span className="font-mono text-[9px] text-zinc-600">RSI strategy</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-px w-4 border-t border-dashed border-zinc-600" />
                  <span className="font-mono text-[9px] text-zinc-600">Buy &amp; hold</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Sentiment ───────────────────────────────────────────────── */}
          {sentiment && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="h-3.5 w-3.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-zinc-600">Market Sentiment</span>
                </div>
                <span className={`font-mono rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${
                  sentimentScore > 0 ? "border-green-700/40 bg-green-950/30 text-green-400"
                    : sentimentScore < 0 ? "border-red-700/40 bg-red-950/30 text-red-400"
                    : "border-zinc-700 bg-zinc-800 text-zinc-400"
                }`}>
                  {sentiment.label ?? "Unavailable"}
                </span>
              </div>

              {/* Sentiment bar */}
              <div className="relative mb-4 h-1 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={`absolute h-full rounded-full transition-all duration-700 ${sentimentScore > 0 ? "bg-green-500" : sentimentScore < 0 ? "bg-red-500" : "bg-zinc-600"}`}
                  style={{
                    width: `${Math.min(Math.abs(sentimentScore), 1) * 100}%`,
                    left: "50%",
                    transform: sentimentScore < 0 ? "translateX(-100%)" : "none",
                  }}
                />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-700" />
              </div>

              {/* Articles */}
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                {Array.isArray(sentiment.articles) && sentiment.articles.length > 0
                  ? sentiment.articles.map((a, i) => (
                      <a
                        key={i}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 transition hover:border-zinc-700"
                      >
                        <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400 transition group-hover:text-zinc-200">{a.headline}</p>
                        <span className={`shrink-0 font-mono text-[9px] font-bold ${a.sentiment === "Bullish" ? "text-green-400" : a.sentiment === "Bearish" ? "text-red-400" : "text-zinc-600"}`}>
                          {a.sentiment}
                        </span>
                      </a>
                    ))
                  : <p className="font-mono text-xs text-zinc-600 rounded-lg border border-dashed border-zinc-800 p-4">No recent sentiment articles for this ticker.</p>
                }
              </div>
            </div>
          )}

        </div>
        {/* /content */}
      </div>
      {/* /body */}
    </div>
    /* /shell */
  )
}