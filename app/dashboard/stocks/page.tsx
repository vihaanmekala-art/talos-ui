"use client"
import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceArea, Legend } from "recharts"
import { useSession, signIn } from "next-auth/react";

type PriceChartPoint = {
  Date: string
  Close: number
}
type ShieldAlert = {
  ticker: string
  price: number
  msg?: string
  type?: string
}

type StockQuote = {
  name?: string
  price?: number
  change?: number
  change_pct?: number
  max_high?: number
  max_low?: number
}

type AnalysisResponse = {
  error?: string
  rsi_signal?: string
  rsi?: number
  macd?: number
  sharpe?: number
  sma50?: number
  vola?: number
  stock_cagr?: number
  spy_cagr?: number
  sma100?: number
  bull_case?: ScenarioValue
  bear_case?: ScenarioValue
}

type SimulationPoint = {
  Date: string
  p95?: number
  p50?: number
  p5?: number
}

type SimulationResponse = {
  data?: SimulationPoint[]
  probability?: number
  ml_expected_price?: number
}

type BacktestResponse = {
  portfolio?: number[]
  buy_hold?: Array<number | null>
  total_return?: number
  buy_hold_return?: number
  sharpe?: number
  max_drawdown?: number
  buy_signals?: number
  sell_signals?: number
}

type SentimentArticle = {
  url: string
  headline: string
  sentiment?: string
}

type SentimentResponse = {
  score?: number
  label?: string
  articles?: SentimentArticle[]
}

const PERIOD_MAP: Record<string, number> = {
  "1mo": 30,
  "3mo": 90,
  "6mo": 180,
  "1y": 365,
  "2y": 730,
  "5y": 1825,
}
type PriceChartSelection = {
  startIndex: number
  endIndex: number
}

type DrawingPoint = {
  x: number
  y: number
}

type ChartStroke = {
  id: number
  points: DrawingPoint[]
}

type SyncedHoverState =
  | { source: "price"; index: number }
  | { source: "backtest"; index: number }
  | null

type ScenarioValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ScenarioValue[]
  | { [key: string]: ScenarioValue }

type ChartInteractionState = {
  activeTooltipIndex?: number | string | null
  activeIndex?: number | string | null
}

function getChartIndex(nextState: ChartInteractionState) {
  const rawIndex = nextState.activeTooltipIndex ?? nextState.activeIndex
  if (typeof rawIndex === "number" && Number.isFinite(rawIndex)) return rawIndex
  if (typeof rawIndex === "string") {
    const parsedIndex = Number(rawIndex)
    if (Number.isFinite(parsedIndex)) return parsedIndex
  }
  return null
}

function getSelectionMetrics(points: PriceChartPoint[], selection: PriceChartSelection) {
  const startPoint = points[selection.startIndex]
  const endPoint = points[selection.endIndex]
  const leftBound = points[Math.min(selection.startIndex, selection.endIndex)]
  const rightBound = points[Math.max(selection.startIndex, selection.endIndex)]

  if (!startPoint || !endPoint || !leftBound || !rightBound || startPoint.Close === 0) return null

  const change = endPoint.Close - startPoint.Close
  const changePct = (change / startPoint.Close) * 100

  return {
    startPoint,
    endPoint,
    leftBound,
    rightBound,
    change,
    changePct,
  }
}

function mapHoverIndex(sourceIndex: number, sourceLength: number, targetLength: number) {
  if (sourceLength <= 0 || targetLength <= 0) return undefined
  if (sourceLength === 1 || targetLength === 1) return 0

  const progress = sourceIndex / (sourceLength - 1)
  return Math.min(targetLength - 1, Math.max(0, Math.round(progress * (targetLength - 1))))
}

function formatScenarioLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase())
}

function renderScenarioValue(value: ScenarioValue): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <p className="text-sm text-zinc-500">No scenario details available.</p>
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <p className="text-sm leading-relaxed text-zinc-200">{String(value)}</p>
  }

  if (Array.isArray(value)) {
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="flex gap-2 text-sm text-zinc-200">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
            <div className="min-w-0">{renderScenarioValue(item)}</div>
          </div>
        ))}
      </div>
    )
  }

  const entries = Object.entries(value)
  if (entries.length === 0) {
    return <p className="text-sm text-zinc-500">No scenario details available.</p>
  }

  return (
    <div className="space-y-2">
      {entries.map(([key, entryValue]) => (
        <div key={key} className="rounded-xl border border-white/5 bg-black/20 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            {formatScenarioLabel(key)}
          </p>
          <div className="mt-1 text-sm text-zinc-200">{renderScenarioValue(entryValue)}</div>
        </div>
      ))}
    </div>
  )
}

// changed: Added small formatting and request helpers so the page fails gracefully instead of rendering broken values.
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
  } catch {
    return "ws://localhost:8000/ws/shield"
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const contentType = response.headers.get("content-type") ?? ""
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text()

  if (!response.ok) {
    if (payload && typeof payload === "object") {
      const errorPayload = payload as Record<string, unknown>
      const detail = typeof errorPayload.detail === "string"
        ? errorPayload.detail
        : typeof errorPayload.message === "string"
        ? errorPayload.message
        : null

      if (detail) throw new Error(detail)
    }

    if (typeof payload === "string" && payload.trim()) {
      throw new Error(payload)
    }

    throw new Error(`Request failed with status ${response.status}`)
  }

  return payload as T
}

export default function Stocks() {

  const ActivityIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )

  // changed: Stat cards now fall back to readable placeholder text instead of showing undefined values.
  const StatCard = ({ label, value, sub, color = "" }: { label: string; value: string | number | null | undefined; sub?: string; color?: string }) => (
    <div className="bg-zinc-900 rounded-xl p-3 flex flex-col justify-between border border-zinc-800">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">{label}</p>
      <p className={`text-lg font-medium truncate ${color || "text-white"}`}>{value ?? "N/A"}</p>
      {sub && <p className="text-[10px] text-zinc-600 mt-0.5">{sub}</p>}
    </div>
  )

  const SignalPill = ({ signal }: { signal: string }) => {
    const styles: Record<string, string> = {
      Buy: "bg-green-900/40 text-green-400 border-green-800/50",
      Sell: "bg-red-900/40 text-red-400 border-red-800/50",
      Neutral: "bg-zinc-800/40 text-zinc-400 border-zinc-700/50",
      "Strong Buy": "bg-green-900/60 text-green-400 border-green-800/70",
      "Strong Sell": "bg-red-900/60 text-red-400 border-red-800/70",
    }
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${styles[signal] ?? "bg-zinc-800 text-zinc-400"}`}>
        {signal}
      </span>
    )
  }

  const [ticker, setTicker] = useState("")
  const [data, setData] = useState<StockQuote | null>(null)
  const [chartData, setChartData] = useState<PriceChartPoint[] | null>(null)
  // changed: per-component loading flags to improve perceived speed
  const [isPriceLoading, setIsPriceLoading] = useState(false)
  const [isAnalysisLoading, setIsAnalysisLoading] = useState(false)
  const [isSimLoading, setIsSimLoading] = useState(false)
  const [isSentimentLoading, setIsSentimentLoading] = useState(false)
  const [period, setPeriod] = useState("1y")
  const [load, setLoad] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)
  const [sim, setSim] = useState<SimulationPoint[] | null>(null)
  const [prob, setProb] = useState<number | null>(null)
  const [mlReturn, setMlReturn] = useState<number | null>(null)
  const [targetPrice, setTargetPrice] = useState("")
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  const [backtestData, setBacktestData] = useState<BacktestResponse | null>(null)
  const [isBacktesting, setIsBacktesting] = useState(false)
  // changed: overlay states to enable comparing multiple tickers on the backtest chart
  const [overlayTickerInput, setOverlayTickerInput] = useState("")
  const [overlayTickers, setOverlayTickers] = useState<string[]>([])
  const [overlayBacktests, setOverlayBacktests] = useState<Record<string, BacktestResponse | null>>({})
  const [overlayLoading, setOverlayLoading] = useState<Record<string, boolean>>({})
  const [overlayErrors, setOverlayErrors] = useState<Record<string, string | null>>({})
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
  const nextPriceChartStrokeId = useRef(0)
  const [optimizationData, setOptimizationData] = useState(null)
  // changed: RSI optimizer state and thresholds
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [lowThreshold, setLowThreshold] = useState<number | null>(null)
  const [highThreshold, setHighThreshold] = useState<number | null>(null)
  const alertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // changed: Derived UI values now come from sanitized inputs and explicit status labels.
  const parsedTargetPrice = parseTargetPrice(targetPrice)
  const userInitials = session?.user?.name?.slice(0, 2).toUpperCase() || session?.user?.email?.slice(0, 2).toUpperCase() || "TU"
  const shieldStatusLabel = shieldStatus === "live" ? "Shield live" : shieldStatus === "connecting" ? "Shield connecting" : "Shield offline"
  const shieldStatusClasses = shieldStatus === "live"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : shieldStatus === "connecting"
    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
    : "border-red-500/30 bg-red-500/10 text-red-300"
  // changed: optimization handler that calls external optimize endpoint and updates thresholds
  const handleOptimize = async () => {
    if (!ticker) return
    setIsOptimizing(true)
    try {
      const response = await fetch('https://talos-backend-42md.onrender.com/optimize', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: ticker,
          period: 14,
        }),
      })

      if (!response.ok) throw new Error(`Optimize request failed: ${response.status}`)
      const result = await response.json()
      setOptimizationData(result)
      if (typeof result?.best_low === 'number') setLowThreshold(result.best_low)
      if (typeof result?.best_high === 'number') setHighThreshold(result.best_high)
      // Optional: log the best sharpe value returned by the optimizer
      if (result?.max_sharpe) console.log(`Optimized! Best Sharpe: ${result.max_sharpe}`)
    } catch (error) {
      console.error('Optimize Error:', error)
    } finally {
      setIsOptimizing(false)
    }
  }
  // changed: Backtest requests now surface errors and clear stale state when the backend fails.
  async function runBackTest(tickerToTest: string) {
    if (!tickerToTest) return
    setIsBacktesting(true)
    setBacktestError(null)
    try {
      const json = await fetchJson<BacktestResponse>(`${API_BASE}/stock/${encodeURIComponent(tickerToTest)}/backtest`)
      setBacktestData(json)
    } catch (error) {
      console.error("Backtest Error:", error)
      setBacktestData(null)
      setBacktestError(getErrorMessage(error, "Backtest data is unavailable right now."))
    } finally {
      setIsBacktesting(false)
    }
  }

  // changed: helper to fetch and store overlay backtest data for comparison
  async function fetchOverlayBacktest(tickerToFetch: string) {
    const t = sanitizeTickerInput(tickerToFetch)
    if (!t) return
    setOverlayLoading(prev => ({ ...prev, [t]: true }))
    setOverlayErrors(prev => ({ ...prev, [t]: null }))
    try {
      const json = await fetchJson<BacktestResponse>(`${API_BASE}/stock/${encodeURIComponent(t)}/backtest`)
      setOverlayBacktests(prev => ({ ...prev, [t]: json }))
    } catch (error) {
      console.error("Overlay backtest error:", error)
      setOverlayBacktests(prev => ({ ...prev, [t]: null }))
      setOverlayErrors(prev => ({ ...prev, [t]: getErrorMessage(error, "Overlay backtest unavailable right now.") }))
    } finally {
      setOverlayLoading(prev => ({ ...prev, [t]: false }))
    }
  }

  // changed: add/remove overlay ticker helpers used by the UI
  const handleAddOverlay = async () => {
    const t = sanitizeTickerInput(overlayTickerInput)
    if (!t) return
    if (overlayTickers.includes(t)) {
      setOverlayTickerInput("")
      return
    }
    setOverlayTickers(prev => [...prev, t])
    setOverlayTickerInput("")
    void fetchOverlayBacktest(t)
  }

  const handleRemoveOverlay = (t: string) => {
    setOverlayTickers(prev => prev.filter(x => x !== t))
    setOverlayBacktests(prev => {
      const copy = { ...prev }
      delete copy[t]
      return copy
    })
    setOverlayErrors(prev => {
      const copy = { ...prev }
      delete copy[t]
      return copy
    })
    setOverlayLoading(prev => {
      const copy = { ...prev }
      delete copy[t]
      return copy
    })
  }

  // changed: color palette for overlay tickers
  const PALETTE = ["#60a5fa", "#f472b6", "#f97316", "#a78bfa", "#06b6d4", "#f59e0b", "#34d399", "#fb7185"]
  function getColorForTicker(t: string, idx?: number) {
    if (!t) return "#999"
    if (t === ticker) return "#4ade80"
    const base = Math.abs(Array.from(t).reduce((acc, c) => acc + c.charCodeAt(0), 0))
    const i = idx ?? (base % PALETTE.length)
    return PALETTE[i % PALETTE.length]
  }

  // changed: Analysis now validates input, uses safer requests, and replaces silent failures with visible error state.
  async function Analyze(manualTicker?: string) {
    const activeTicker = sanitizeTickerInput(manualTicker ?? ticker)
    if (!activeTicker) {
      setAnalysisError("Enter a ticker symbol to analyze.")
      return
    }

    setTicker(activeTicker)
    setLoad(true)
    setIsAnalysisLoading(true)
    setIsPriceLoading(true)
    setIsSimLoading(true)
    setIsSentimentLoading(true)
    setAnalysisError(null)
    setBacktestError(null)
    setTargetSaveError(null)
    setBacktestData(null)
    try {
      const targetQuery = parsedTargetPrice !== null ? `?target_price=${parsedTargetPrice}` : ""
      const [sData, aData, hData, simData, sentData] = await Promise.all([
        fetchJson<StockQuote>(`${API_BASE}/stock/${encodeURIComponent(activeTicker)}`),
        fetchJson<AnalysisResponse>(`${API_BASE}/analyze/${encodeURIComponent(activeTicker)}`),
        fetchJson<PriceChartPoint[]>(`${API_BASE}/stock/${encodeURIComponent(activeTicker)}/history?period_days=${PERIOD_MAP[period]}`),
        fetchJson<SimulationResponse>(`${API_BASE}/stock/${encodeURIComponent(activeTicker)}/simulate${targetQuery}`),
        fetchJson<SentimentResponse>(`${API_BASE}/stock/${encodeURIComponent(activeTicker)}/sentiment`)
      ])

      setData(sData)
      setAnalysis(aData)
      setChartData(Array.isArray(hData) ? hData : [])
      setSentiment(sentData)
      setAnalysisError(typeof aData?.error === "string" ? aData.error : null)
      if (Array.isArray(simData?.data)) {
        setSim(simData.data)
        setProb(typeof simData.probability === "number" ? simData.probability : null)
        setMlReturn(typeof simData.ml_expected_price === "number" ? simData.ml_expected_price : null)
      } else {
        setSim(null)
        setProb(null)
        setMlReturn(null)
      }
      void runBackTest(activeTicker)

      setRecents(prev => {
        const updated = [activeTicker, ...prev.filter(t => t !== activeTicker)].slice(0, 5)
        localStorage.setItem("talos_recents", JSON.stringify(updated))
        return updated
      })
    } catch (error) {
      console.error("Talos Engine Error:", error)
      setData(null)
      setAnalysis(null)
      setChartData(null)
      setSim(null)
      setProb(null)
      setMlReturn(null)
      setSentiment(null)
      setAnalysisError(getErrorMessage(error, "Talos couldn't load this ticker right now."))
    } finally {
      setLoad(false)
      setIsAnalysisLoading(false)
      setIsPriceLoading(false)
      setIsSimLoading(false)
      setIsSentimentLoading(false)
    }
  }

  // changed: The Shield websocket now follows the configured API host and cleans up timers on unmount.
  useEffect(() => {
    let isCancelled = false
    const socket = new WebSocket(getShieldSocketUrl(API_BASE))

    setShieldStatus("connecting")

    socket.onopen = () => {
      if (!isCancelled) setShieldStatus("live")
    }

    socket.onerror = () => {
      if (!isCancelled) setShieldStatus("offline")
    }

    socket.onclose = () => {
      if (!isCancelled) {
        setShieldStatus(currentStatus => currentStatus === "live" ? "offline" : currentStatus)
      }
    }

    socket.onmessage = event => {
      try {
        const incomingData = JSON.parse(event.data) as ShieldAlert

        if (incomingData.type === "SHIELD_ALERT") {
          if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
          setActiveAlert(incomingData)
          alertTimeoutRef.current = setTimeout(() => setActiveAlert(null), 8000)
        }
      } catch (error) {
        console.error("Shield socket parse error:", error)
      }
    }

    return () => {
      isCancelled = true
      if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
      if (saveResetTimeoutRef.current) clearTimeout(saveResetTimeoutRef.current)
      socket.close()
    }
  }, [API_BASE])

  // changed: Period changes now refresh the price chart with guarded async state updates.
  useEffect(() => {
    if (!ticker || !data) return

    let isCancelled = false

    const chart = async () => {
      try {
        setIsPriceLoading(true)
        const histJson = await fetchJson<PriceChartPoint[]>(`${API_BASE}/stock/${encodeURIComponent(ticker)}/history?period_days=${PERIOD_MAP[period]}`)
        if (!isCancelled) setChartData(Array.isArray(histJson) ? histJson : [])
      } catch (error) {
        if (!isCancelled) {
          setChartData(null)
          setAnalysisError(getErrorMessage(error, "Price history could not be refreshed."))
        }
      } finally {
        if (!isCancelled) setIsPriceLoading(false)
      }
    }

    void chart()

    return () => {
      isCancelled = true
    }
  }, [API_BASE, data, period, ticker])

  // changed: Target-price probability refresh now only runs for valid numeric targets.
  useEffect(() => {
    if (ticker && parsedTargetPrice !== null) {
      const updateSim = async () => {
        try {
          setIsSimLoading(true)
          const json = await fetchJson<SimulationResponse>(`${API_BASE}/stock/${encodeURIComponent(ticker)}/simulate?target_price=${parsedTargetPrice}`)
          if (typeof json?.probability === "number") setProb(json.probability)
        } catch (error) {
          console.error("Target probability update failed:", error)
        }
        finally {
          setIsSimLoading(false)
        }
      }
      const timeoutId = setTimeout(updateSim, 500)
      return () => clearTimeout(timeoutId)
    }
  }, [API_BASE, parsedTargetPrice, ticker])

  // changed: Saved target loading now resets cleanly when the user or ticker changes.
  useEffect(() => {
    if (!session?.user?.id || !ticker) {
      setTargetPrice("")
      return
    }

    let isCancelled = false

    const fetchSavedTarget = async () => {
      try {
        const savedTarget = await fetchJson<{ target_price?: number | null }>(`${API_BASE}/stock/${encodeURIComponent(ticker)}/target/${session.user.id}`)
        if (!isCancelled) {
          setTargetPrice(savedTarget?.target_price !== null && savedTarget?.target_price !== undefined ? String(savedTarget.target_price) : "")
        }
      } catch {
        if (!isCancelled) setTargetPrice("")
      }
    }

    void fetchSavedTarget()

    return () => {
      isCancelled = true
    }
  }, [API_BASE, session, ticker])

  // changed: Recent tickers now read from local storage defensively in case the stored payload is malformed.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("talos_recents")
      if (!saved) return

      const parsedRecents = JSON.parse(saved)
      if (Array.isArray(parsedRecents)) {
        setRecents(parsedRecents.filter((value): value is string => typeof value === "string"))
      }
    } catch (error) {
      console.error("Unable to read saved recents:", error)
      localStorage.removeItem("talos_recents")
    }
  }, [])

  useEffect(() => {
    if (session) setIsGuest(false)
  }, [session])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setPriceChartSelection(null)
    setIsSelectingPriceChart(false)
    setIsPriceChartDrawMode(false)
    setPriceChartStrokes([])
    setActivePriceChartStroke(null)
    setSyncedHover(null)
  }, [chartData])

  // changed: Saving alerts now uses the configured backend and the current signed-in user instead of hardcoded values.
  const handleSaveTarget = async () => {
    if (isGuest || !session?.user?.id) {
      setTargetSaveError("Sign in to arm Shield alerts.")
      return
    }

    if (!ticker) {
      setTargetSaveError("Analyze a ticker before saving an alert.")
      return
    }

    if (parsedTargetPrice === null) {
      setTargetSaveError("Enter a valid positive target price.")
      return
    }

    setIsSavingTarget(true)
    setTargetSaveError(null)

    try {
      await fetchJson(`${API_BASE}/stock/target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.toUpperCase(),
          user_id: session.user.id,
          target_price: parsedTargetPrice,
        }),
      })

      if (saveResetTimeoutRef.current) clearTimeout(saveResetTimeoutRef.current)
      setIsSaved(true)
      saveResetTimeoutRef.current = setTimeout(() => setIsSaved(false), 2000)
    } catch (error) {
      console.error("Shield sync error:", error)
      setTargetSaveError(getErrorMessage(error, "Shield could not save this alert right now."))
    } finally {
      setIsSavingTarget(false)
    }
  }

  const handlePriceChartStart = (nextState: ChartInteractionState) => {
    if (isPriceChartDrawMode) return
    const index = getChartIndex(nextState)
    if (index === null) return
    setIsSelectingPriceChart(true)
    setPriceChartSelection({ startIndex: index, endIndex: index })
  }

  const handlePriceChartMove = (nextState: ChartInteractionState) => {
    if (isPriceChartDrawMode) return
    if (!isSelectingPriceChart) return
    const index = getChartIndex(nextState)
    if (index === null) return
    setPriceChartSelection(prev => (
      prev
        ? { ...prev, endIndex: index }
        : { startIndex: index, endIndex: index }
    ))
  }

  const handlePriceChartEnd = (nextState?: ChartInteractionState) => {
    if (isPriceChartDrawMode) return
    if (!isSelectingPriceChart) return
    const index = nextState ? getChartIndex(nextState) : null
    if (index !== null) {
      setPriceChartSelection(prev => (
        prev
          ? { ...prev, endIndex: index }
          : { startIndex: index, endIndex: index }
      ))
    }
    setIsSelectingPriceChart(false)
  }

  const selectedPriceRange = chartData && priceChartSelection
    ? getSelectionMetrics(chartData, priceChartSelection)
    : null
  // changed: build a unified backtest dataset that includes the primary ticker plus any overlays
  const primaryPortfolio = Array.isArray(backtestData?.portfolio) ? backtestData!.portfolio : []
  const primaryBuyHold = Array.isArray(backtestData?.buy_hold) ? backtestData!.buy_hold : []

  const overlayPortfoliosMap: Record<string, number[]> = {}
  overlayTickers.forEach(t => {
    const b = overlayBacktests[t]
    if (Array.isArray(b?.portfolio)) overlayPortfoliosMap[t] = b!.portfolio as number[]
  })

  const seriesTickers: string[] = []
  if (primaryPortfolio.length > 0 && ticker) seriesTickers.push(ticker)
  overlayTickers.forEach(t => {
    if (Array.isArray(overlayPortfoliosMap[t])) seriesTickers.push(t)
  })

  const maxLen = Math.max(0, primaryPortfolio.length, ...Object.values(overlayPortfoliosMap).map(a => a.length))

  const unifiedBacktestChartData = Array.from({ length: maxLen }).map((_, i) => {
    const item: Record<string, unknown> = { name: i }
    if (primaryPortfolio.length > 0) {
      item.strategy = primaryPortfolio[i] ?? null
      item.buyHold = primaryBuyHold[i] ?? null
    }
    overlayTickers.forEach(t => {
      const arr = overlayPortfoliosMap[t]
      if (Array.isArray(arr)) item[`strategy_${t}`] = arr[i] ?? null
    })
    return item
  })

  const backtestChartData = unifiedBacktestChartData
  const shouldSyncPriceAndBacktest = PERIOD_MAP[period] < PERIOD_MAP["2y"]
  const mirroredPriceHoverIndex = shouldSyncPriceAndBacktest && syncedHover?.source === "backtest"
    ? mapHoverIndex(syncedHover.index, backtestChartData.length, chartData?.length ?? 0)
    : undefined
  const mirroredBacktestHoverIndex = shouldSyncPriceAndBacktest && syncedHover?.source === "price"
    ? mapHoverIndex(syncedHover.index, chartData?.length ?? 0, backtestChartData.length)
    : undefined
  const hasSentimentArticles = Array.isArray(sentiment?.articles) && sentiment.articles.length > 0
  const canAnalyze = sanitizeTickerInput(ticker).length > 0 && !load
  const sentimentScore = typeof sentiment?.score === "number" ? sentiment.score : 0
  const priceChange = typeof data?.change === "number" ? data.change : null
  const stockCagr = typeof analysis?.stock_cagr === "number" ? analysis.stock_cagr : null
  const backtestTotalReturn = typeof backtestData?.total_return === "number" ? backtestData.total_return : null

  const getPriceChartPoint = (event: ReactPointerEvent<SVGSVGElement>): DrawingPoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width),
      y: Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height),
    }
  }

  const handlePriceChartDrawStart = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPriceChartDrawMode) return
    event.preventDefault()
    const point = getPriceChartPoint(event)
    const stroke = {
      id: nextPriceChartStrokeId.current++,
      points: [point],
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setActivePriceChartStroke(stroke)
  }

  const handlePriceChartDrawMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPriceChartDrawMode) return
    setActivePriceChartStroke(prev => {
      if (!prev) return prev
      const point = getPriceChartPoint(event)
      const lastPoint = prev.points[prev.points.length - 1]
      if (lastPoint && lastPoint.x === point.x && lastPoint.y === point.y) return prev
      return {
        ...prev,
        points: [...prev.points, point],
      }
    })
  }

  const finishPriceChartStroke = () => {
    setActivePriceChartStroke(prev => {
      if (prev && prev.points.length > 0) {
        setPriceChartStrokes(current => [...current, prev])
      }
      return null
    })
  }

  const handlePriceChartDrawEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPriceChartDrawMode) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishPriceChartStroke()
  }

  const handlePriceChartHover = (nextState: ChartInteractionState) => {
    handlePriceChartMove(nextState)
    if (!shouldSyncPriceAndBacktest || isPriceChartDrawMode) return

    const index = getChartIndex(nextState)
    if (index === null) return
    setSyncedHover({ source: "price", index })
  }

  const clearPriceChartHover = () => {
    handlePriceChartEnd()
    setSyncedHover(prev => (prev?.source === "price" ? null : prev))
  }

  const handleBacktestHover = (nextState: ChartInteractionState) => {
    if (!shouldSyncPriceAndBacktest) return

    const index = getChartIndex(nextState)
    if (index === null) return
    setSyncedHover({ source: "backtest", index })
  }

  const clearBacktestHover = () => {
    setSyncedHover(prev => (prev?.source === "backtest" ? null : prev))
  }

  if (status === "loading") {
    return <div className="flex h-screen items-center justify-center text-white">Loading Talos...</div>
  }

  if (!session && !isGuest) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-black text-white p-6 text-center">
        <h1 className="text-4xl font-bold mb-4 tracking-tight">TALOS <span className="text-blue-500">ENGINE</span></h1>
        <p className="text-zinc-400 mb-8 max-w-md">Access the quantitative terminal.</p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button onClick={() => void signIn("google")} className="px-8 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-bold transition active:scale-95">
            Sign in with Google
          </button>
          <button onClick={() => setIsGuest(true)} className="px-8 py-3 bg-zinc-900 hover:bg-zinc-800 border border-white/10 rounded-xl font-semibold text-zinc-400 transition">
            Continue as Guest
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 text-white">

      {/* changed: The header now wraps on smaller screens and surfaces live Shield connection status. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-base font-medium">Talos Engine</span>
          <span className="text-xs text-zinc-500">/ stock analysis</span>
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${shieldStatusClasses}`}>
            {shieldStatusLabel}
          </span>
        </div>
        {session?.user && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-xs text-zinc-500">Signed in as</span>
            <div className="w-7 h-7 rounded-full bg-blue-950 flex items-center justify-center text-[10px] font-semibold text-blue-400">
              {userInitials}
            </div>
          </div>
        )}
      </div>

      {/* changed: Active Shield alerts now appear near the top so they're visible even if sentiment content is empty. */}
      {activeAlert && (
        <div className="flex flex-col gap-3 rounded-2xl border border-red-500/40 bg-red-950/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-red-200">Shield activated</p>
            <p className="mt-1 text-sm font-medium text-white">{activeAlert.ticker} reached {formatCurrency(activeAlert.price)}</p>
            <p className="mt-1 text-xs text-red-100/70">{activeAlert.msg || "Your monitored price target was triggered."}</p>
          </div>
          <button
            type="button"
            onClick={() => setActiveAlert(null)}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-red-100 transition hover:border-white/25 hover:bg-white/5"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* changed: Search controls now sanitize ticker input and stack cleanly on narrow screens. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex h-[42px] flex-1 items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-4">
          <input
            className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none font-medium"
            placeholder="Ticker — e.g. AAPL"
            value={ticker}
            onChange={e => {
              const next = sanitizeTickerInput(e.target.value)
              // changed: clear previous results immediately when typing a new ticker
              if (next !== ticker) {
                setData(null)
                setAnalysis(null)
                setChartData(null)
                setSim(null)
                setProb(null)
                setMlReturn(null)
                setBacktestData(null)
                setSentiment(null)
                setAnalysisError(null)
                setBacktestError(null)
              }
              setTicker(next)
            }}
            onKeyDown={e => {
              if (e.key === "Enter") void Analyze()
            }}
          />
          {data?.name && <span className="max-w-[40%] shrink-0 truncate text-xs text-zinc-500">{data.name}</span>}
        </div>
        <button
          type="button"
          onClick={() => void Analyze()}
          disabled={!canAnalyze}
          className="h-[42px] rounded-xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-zinc-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {load ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      {/* changed: Recent tickers and range filters now wrap instead of overflowing on mobile. */}
      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-900 bg-zinc-950/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        {recents.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold text-zinc-600 uppercase shrink-0">Recents:</span>
            {recents.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTicker(t)
                  void Analyze(t)
                }}
                className="px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-medium text-zinc-400 hover:border-blue-500/50 hover:text-white transition active:scale-95"
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setRecents([])
                localStorage.removeItem("talos_recents")
              }}
              className="text-[10px] text-zinc-600 hover:text-red-400 transition"
            >
              Clear
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {Object.keys(PERIOD_MAP).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold transition ${
                period === p ? "bg-blue-700 text-white" : "bg-zinc-900 text-zinc-500 hover:bg-zinc-800"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* changed: Global loader removed in favor of per-component skeletons and spinners. */}

      {/* changed: Analysis failures now render as a proper inline error instead of only logging to the console. */}
      {analysisError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-300">Analysis issue</p>
          <p className="mt-2 text-sm text-red-100">{analysisError}</p>
        </div>
      )}

      {/* changed: The empty state gives the page a stable default layout before the first search. */}
      {!load && !analysisError && !data && !analysis && (
        <div className="rounded-3xl border border-zinc-800 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_45%),linear-gradient(180deg,rgba(24,24,27,0.92),rgba(9,9,11,0.96))] p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">Ready to analyze</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Search any ticker to load price, scenarios, sentiment, and backtests.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Try a liquid symbol like `AAPL`, `MSFT`, or `NVDA`. The charts, alert tools, and scenario cards will populate once the backend responds.</p>
        </div>
      )}

      {/* changed: The signal bar now avoids partial rendering when analysis returns an error payload. */}
      {data && analysis && !analysis.error && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm">
          <span className="text-xl font-medium">{ticker}</span>
          <span className="text-lg text-zinc-200">{formatCurrency(data?.price)}</span>
          {priceChange !== null && (
            <span className={`text-xs font-medium ${priceChange >= 0 ? "text-green-400" : "text-red-400"}`}>
              {priceChange >= 0 ? "+" : ""}{formatNumber(priceChange)} ({formatPercent(data.change_pct, 2)})
            </span>
          )}
          <SignalPill signal={analysis.rsi_signal ?? "Neutral"} />
          <div className="ml-auto flex flex-wrap gap-4">
            {([["RSI", formatNumber(analysis.rsi)], ["MACD", formatNumber(analysis.macd)], ["Sharpe", formatNumber(analysis.sharpe)]] as [string, string][]).map(([label, val]) => (
              <div key={label} className="flex flex-col items-end gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</span>
                <span className="text-xs font-medium text-zinc-200">{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* changed: Metric cards now collapse to smaller responsive columns and keep invalid values readable. */}
      {data && analysis && !analysis.error && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard label="52W High" value={formatCurrency(data?.max_high)} />
          <StatCard label="52W Low" value={formatCurrency(data?.max_low)} />
          <StatCard label="50D SMA" value={formatCurrency(analysis.sma50)} />
          <StatCard label="Volatility" value={formatPercent(analysis.vola)} />
          <StatCard label="Stock CAGR" value={formatPercent(stockCagr)} color={stockCagr !== null && stockCagr > 0 ? "text-green-400" : "text-red-400"} />
          <StatCard label="S&P 500 CAGR" value={formatPercent(analysis.spy_cagr)} color="text-zinc-500" />
          <StatCard label="100D SMA" value={formatCurrency(analysis.sma100)} />
          <StatCard label="Sharpe ratio" value={formatNumber(analysis.sharpe)} />
        </div>
      )}
      {/* changed: analysis skeleton when analysis is loading */}
      {isAnalysisLoading && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-zinc-900 border border-zinc-800 p-3 animate-pulse">
              <div className="h-4 bg-zinc-800 rounded w-3/4 mb-2" />
              <div className="h-6 bg-zinc-800 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* changed: Scenario cards now stack cleanly on smaller screens. */}
      {analysis && !analysis.error && (analysis.bull_case || analysis.bear_case) && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="rounded-2xl border border-emerald-900/60 bg-emerald-950/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Bull Case</p>
                <p className="mt-1 text-xs text-emerald-200/80">What drives upside from here</p>
              </div>
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
                Upside
              </span>
            </div>
            {renderScenarioValue(analysis.bull_case as ScenarioValue)}
          </div>
          <div className="rounded-2xl border border-red-900/60 bg-red-950/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-red-400">Bear Case</p>
                <p className="mt-1 text-xs text-red-200/80">What could pressure the stock</p>
              </div>
              <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[10px] font-semibold text-red-300">
                Downside
              </span>
            </div>
            {renderScenarioValue(analysis.bear_case as ScenarioValue)}
          </div>
        </div>
      )}

      {/* changed: Scenario skeleton while analysis details load */}
      {isAnalysisLoading && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-4 animate-pulse">
            <div className="h-4 bg-zinc-800 rounded w-1/3 mb-3" />
            <div className="h-10 bg-zinc-800 rounded w-full" />
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-4 animate-pulse">
            <div className="h-4 bg-zinc-800 rounded w-1/3 mb-3" />
            <div className="h-10 bg-zinc-800 rounded w-full" />
          </div>
        </div>
      )}

      {/* changed: The chart and projection panels now swap to a single-column layout when space is tight. */}
      {(chartData || sim) && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.4fr_1fr]">

          {/* Price chart */}
          {chartData && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Price · {PERIOD_MAP[period]} days
                </span>
                <div className="text-left sm:text-right">
                  {selectedPriceRange ? (
                    <>
                      <p className={`text-xs font-medium ${selectedPriceRange.changePct >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {selectedPriceRange.changePct >= 0 ? "+" : ""}{selectedPriceRange.changePct.toFixed(2)}% return
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        {selectedPriceRange.startPoint.Date} → {selectedPriceRange.endPoint.Date}
                      </p>
                    </>
                    ) : stockCagr !== null ? (
                    <>
                      <p className={`text-xs font-medium ${stockCagr >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {stockCagr >= 0 ? "+" : ""}{stockCagr.toFixed(1)}% CAGR
                      </p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">Hold and drag to measure return</p>
                    </>
                  ) : (
                      <p className="text-[10px] text-zinc-600">Hold and drag to measure return</p>
                  )}
                </div>
              </div>
                {mounted && (
                <div className="relative" style={{ height: 220 }}>
                    {isPriceLoading && (
                      <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 rounded-2xl">
                        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
                        <p className="text-sm text-zinc-300 ml-3">Loading price history…</p>
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
                        formatter={(value) => [`$${Number(Array.isArray(value) ? value[0] : value ?? 0).toFixed(2)}`, "Close"]}
                        contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "#71717a" }}
                      />
                      {selectedPriceRange && (
                        <ReferenceArea
                          x1={selectedPriceRange.leftBound.Date}
                          x2={selectedPriceRange.rightBound.Date}
                          fill={selectedPriceRange.changePct >= 0 ? "#22c55e" : "#ef4444"}
                          fillOpacity={0.12}
                          strokeOpacity={0}
                          ifOverflow="extendDomain"
                        />
                      )}
                      <Area type="monotone" dataKey="Close" stroke="#4ade80" strokeWidth={2} fill="url(#priceGrad)" dot={false} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                  <svg
                    className={`absolute inset-0 h-full w-full ${isPriceChartDrawMode ? "pointer-events-auto cursor-crosshair" : "pointer-events-none"}`}
                    onPointerDown={handlePriceChartDrawStart}
                    onPointerMove={handlePriceChartDrawMove}
                    onPointerUp={handlePriceChartDrawEnd}
                    onPointerLeave={handlePriceChartDrawEnd}
                  >
                    {priceChartStrokes.map(stroke => (
                      <polyline
                        key={stroke.id}
                        points={stroke.points.map(point => `${point.x},${point.y}`).join(" ")}
                        fill="none"
                        stroke="#facc15"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                    {activePriceChartStroke && (
                      <polyline
                        points={activePriceChartStroke.points.map(point => `${point.x},${point.y}`).join(" ")}
                        fill="none"
                        stroke="#facc15"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                  </svg>
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
                    {priceChartStrokes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPriceChartStrokes([])
                          setActivePriceChartStroke(null)
                        }}
                        className="rounded-md bg-black/55 px-2 py-1 text-[10px] font-semibold text-zinc-300 transition hover:bg-black/75 hover:text-white"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={isPriceChartDrawMode ? "Disable drawing on price chart" : "Enable drawing on price chart"}
                      title={isPriceChartDrawMode ? "Disable drawing" : "Draw on chart"}
                      onClick={() => {
                        setIsPriceChartDrawMode(prev => !prev)
                        setIsSelectingPriceChart(false)
                        setPriceChartSelection(null)
                        setActivePriceChartStroke(null)
                      }}
                      className={`rounded-full border p-1.5 transition ${
                        isPriceChartDrawMode
                          ? "border-amber-400 bg-amber-500/20 text-amber-300"
                          : "border-zinc-700 bg-black/55 text-zinc-400 hover:border-zinc-500 hover:text-white"
                      }`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Monte Carlo */}
          {sim && (
            <div className="relative bg-zinc-900 border border-zinc-800 rounded-2xl p-4 overflow-hidden">
              {isGuest && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md rounded-2xl">
                  <div className="bg-blue-600/20 p-2 rounded-full mb-2 border border-blue-500/50">
                    <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2V7a5 5 0 00-5-5zM7 7a3 3 0 116 0v2H7V7z" />
                    </svg>
                  </div>
                  <p className="text-[11px] font-bold uppercase tracking-widest">Pro Projection</p>
                  <button onClick={() => void signIn("google")} className="text-[10px] text-blue-400 mt-1 hover:underline">
                    Sign in to unlock
                  </button>
                </div>
              )}
              <div className={isGuest ? "blur-sm grayscale opacity-30 select-none pointer-events-none" : ""}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">30-day projection</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Monte Carlo · 1,000 paths</p>
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-blue-400 bg-blue-900/30 border border-blue-900/50 px-2 py-1 rounded-md">AI</span>
                </div>

                {/* changed: Projection stats now include probability context when a valid target price is entered. */}
                {(mlReturn !== null || prob !== null) && (
                  <div className={`mb-3 grid gap-2 ${prob !== null ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                    <div className="bg-black/30 border border-zinc-800 rounded-xl p-2.5">
                      <p className="text-[10px] uppercase font-semibold tracking-widest text-zinc-500 mb-1">AI bias 30D</p>
                      <p className={`text-xl font-medium ${mlReturn === null ? "text-zinc-300" : mlReturn >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {mlReturn !== null ? `${mlReturn >= 0 ? "↑" : "↓"} ${(mlReturn * 100).toFixed(1)}%` : "N/A"}
                      </p>
                    </div>
                    <div className="bg-black/30 border border-zinc-800 rounded-xl p-2.5">
                      <p className="text-[10px] uppercase font-semibold tracking-widest text-zinc-500 mb-1">Conviction</p>
                      <p className="text-sm font-medium mt-1">{mlReturn !== null && Math.abs(mlReturn) > 0.05 ? "High" : "Moderate"}</p>
                    </div>
                    {prob !== null && (
                      <div className="bg-black/30 border border-zinc-800 rounded-xl p-2.5">
                        <p className="text-[10px] uppercase font-semibold tracking-widest text-zinc-500 mb-1">Target odds</p>
                        <p className="text-sm font-medium mt-1">{formatPercent(prob * 100, 1)}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* changed: Simulation rendering now handles empty arrays without leaving a blank card. */}
                {mounted && Array.isArray(sim) && sim.length > 0 ? (
                  <div style={{ height: 120 }}>
                    {isSimLoading && (
                      <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 rounded-2xl">
                        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
                        <p className="text-sm text-zinc-300 ml-3">Loading simulation…</p>
                      </div>
                    )}
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={sim}>
                        <XAxis dataKey="Date" hide />
                        <YAxis domain={["auto", "auto"]} orientation="right" tick={{ fontSize: 10, fill: "#52525b" }} width={48} />
                        <Tooltip
                          formatter={value => [`$${Number(Array.isArray(value) ? value[0] : value ?? 0).toFixed(2)}`, "Price"]}
                          contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 12 }}
                        />
                        <Area type="monotone" dataKey="p95" stroke="#1d4ed8" fill="#1d4ed8" fillOpacity={0.06} strokeWidth={1} strokeDasharray="4 3" dot={false} />
                        <Area type="monotone" dataKey="p50" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2.5} dot={false} />
                        <Area type="monotone" dataKey="p5" stroke="#1d4ed8" fill="transparent" strokeWidth={1} strokeDasharray="4 3" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                    Simulation data is unavailable for this ticker right now.
                  </div>
                )}

                {/* changed: Alert controls now use Tailwind styling, validation, and the signed-in user automatically. */}
                <div className="mt-5">
                  <label className="block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                    Get notified when price hits
                  </label>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={targetPrice}
                      onChange={e => setTargetPrice(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && void handleSaveTarget()}
                      className="h-11 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveTarget()}
                      disabled={isSavingTarget || parsedTargetPrice === null}
                      className="h-11 rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 text-sm font-semibold text-blue-200 transition hover:border-blue-400 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSavingTarget ? "Saving…" : "Arm Shield"}
                    </button>
                  </div>
                  <p className={`mt-2 text-xs ${targetSaveError ? "text-red-300" : isSaved ? "text-emerald-300" : "text-zinc-500"}`}>
                    {targetSaveError
                      ? targetSaveError
                      : isSaved
                      ? "Shield alert saved for your account."
                      : "Save a price target to receive backend Shield alerts."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* changed: Backtest loading remains separate so the rest of the dashboard stays interactive. */}
      {isBacktesting && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm text-zinc-400 font-medium">Running 2-year RSI strategy backtest…</p>
        </div>
      )}

      {/* changed: Backtest failures now render inline feedback instead of silently dropping the panel. */}
      {backtestError && !isBacktesting && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-200">Backtest unavailable</p>
          <p className="mt-2 text-sm text-amber-50/90">{backtestError}</p>
        </div>
      )}

      {/* changed: Backtest content now supports overlays — show when any backtest series exists */}
      {backtestChartData.length > 0 && !isBacktesting && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-medium">RSI backtest</h3>
              <p className="text-[10px] text-zinc-500 mt-1">Buy RSI &lt; 30 / Sell RSI &gt; 70 · 2-year window</p>
            </div>
            <div className="flex gap-4 items-start">
              <div className="text-left sm:text-right">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Strategy</p>
                <p className={`text-2xl font-medium ${backtestTotalReturn !== null && backtestTotalReturn > 0 ? "text-green-400" : "text-red-400"}`}>
                  {backtestTotalReturn !== null && backtestTotalReturn > 0 ? "+" : ""}{formatPercent(backtestTotalReturn)}
                </p>
              </div>
              <div className="border-l border-zinc-800 pl-4 text-left sm:text-right">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Buy &amp; hold</p>
                <p className="text-2xl font-medium text-zinc-400">{formatPercent(backtestData?.buy_hold_return)}</p>
              </div>
            </div>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatCard label="Sharpe ratio" value={formatNumber(backtestData?.sharpe)} />
            <StatCard label="Max drawdown" value={formatPercent(backtestData?.max_drawdown)} color="text-red-400" />
            <StatCard label="Buy signals" value={backtestData?.buy_signals} />
            <StatCard label="Sell signals" value={backtestData?.sell_signals} />
          </div>

          {/* changed: Overlay controls for adding/removing comparison tickers */}
          <div className="mb-3 flex items-center gap-2">
            <input
              value={overlayTickerInput}
              onChange={e => setOverlayTickerInput(sanitizeTickerInput(e.target.value))}
              onKeyDown={e => { if (e.key === "Enter") void handleAddOverlay() }}
              placeholder="Overlay ticker — e.g. MSFT"
              className="h-9 px-3 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white outline-none"
            />
            <button
              type="button"
              onClick={() => void handleAddOverlay()}
              disabled={!sanitizeTickerInput(overlayTickerInput)}
              className="h-9 px-3 rounded-xl bg-white text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Overlay
            </button>
            <button
              type="button"
              onClick={() => void handleOptimize()}
              disabled={isOptimizing || !ticker}
              className="h-9 px-3 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ml-2"
            >
              {isOptimizing ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg>
              )}
              <span>{isOptimizing ? "Crunching Data..." : "Optimize RSI"}</span>
            </button>
            <div className="ml-auto flex gap-2 flex-wrap">
              {overlayTickers.map((ot, idx) => (
                <div key={ot} className="flex items-center gap-2 rounded-full bg-zinc-900 border border-zinc-800 px-3 py-1 text-xs">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getColorForTicker(ot, idx) }} />
                  <span className="font-semibold">{ot}</span>
                  <button type="button" onClick={() => handleRemoveOverlay(ot)} className="ml-1 text-zinc-500 hover:text-white">×</button>
                </div>
              ))}
            </div>
          </div>
          {/* changed: display optimized thresholds when available */}
          {(lowThreshold !== null || highThreshold !== null) && (
            <div className="mb-3 text-sm text-zinc-400">Optimized thresholds: Low <span className="font-semibold text-white">{lowThreshold ?? '—'}</span> &nbsp; High <span className="font-semibold text-white">{highThreshold ?? '—'}</span></div>
          )}

          {mounted && (
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={backtestChartData}
                  onMouseMove={handleBacktestHover}
                  onMouseLeave={clearBacktestHover}
                >
                  <XAxis hide />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#52525b" }} width={40} />
                  <Tooltip
                    defaultIndex={mirroredBacktestHoverIndex}
                    contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
                    formatter={value => [`$${Number(Array.isArray(value) ? value[0] : value ?? 0).toFixed(2)}`]}
                  />
                  <Legend verticalAlign="top" align="right" />
                  {/* primary strategy + buyHold (keeps legacy names) */}
                  {primaryPortfolio.length > 0 && (
                    <>
                      <Line type="monotone" dataKey="strategy" name={ticker || "Primary"} stroke={getColorForTicker(ticker)} strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="buyHold" name="Buy & Hold" stroke="#52525b" strokeWidth={1.5} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                    </>
                  )}
                  {/* overlay strategies */}
                  {overlayTickers.map((ot, idx) => (
                    <Line
                      key={ot}
                      type="monotone"
                      dataKey={`strategy_${ot}`}
                      name={ot}
                      stroke={getColorForTicker(ot, idx)}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* changed: backtest skeleton when primary backtest is loading */}
          {!mounted && isBacktesting && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
              <p className="text-sm text-zinc-400">Running backtest…</p>
            </div>
          )}

          <div className="flex gap-4 mt-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-green-400 rounded" />
              <span className="text-[10px] text-zinc-500">RSI strategy</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 border-t border-dashed border-zinc-500" />
              <span className="text-[10px] text-zinc-500">Buy &amp; hold</span>
            </div>
            {overlayTickers.map((ot, idx) => (
              <div key={ot} className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 rounded" style={{ backgroundColor: getColorForTicker(ot, idx) }} />
                <span className="text-[10px] text-zinc-500">{ot}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* changed: Sentiment now renders a stable shell even when the article list is empty. */}
      {sentiment && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 relative">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <ActivityIcon className="w-4 h-4 text-blue-400" />
              Market sentiment
            </h3>
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
              sentimentScore > 0
                ? "bg-green-500/10 text-green-400 border-green-500/20"
                : sentimentScore < 0
                ? "bg-red-500/10 text-red-400 border-red-500/20"
                : "bg-zinc-800 text-zinc-400 border-zinc-700"
            }`}>
              {sentiment.label ?? "Unavailable"}
            </span>
          </div>
          <div className="relative h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-5">
            <div
              className={`absolute h-full rounded-r-full transition-all duration-700 ${sentimentScore > 0 ? "bg-green-400" : sentimentScore < 0 ? "bg-red-400" : "bg-zinc-500"}`}
              style={{
                width: `${Math.min(Math.abs(sentimentScore), 1) * 100}%`,
                left: "50%",
                transform: sentimentScore < 0 ? "translateX(-100%)" : "none",
              }}
            />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-600" />
          </div>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {isSentimentLoading && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 rounded-2xl">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
                <p className="text-sm text-zinc-300 ml-3">Loading sentiment…</p>
              </div>
            )}
            {hasSentimentArticles ? (
              sentiment.articles?.map((article: SentimentArticle, i: number) => (
                <a
                  key={i}
                  href={article.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start justify-between gap-3 rounded-xl border border-zinc-800 bg-black/20 p-2.5 transition hover:border-blue-500/30"
                >
                  <p className="line-clamp-2 text-xs leading-relaxed text-zinc-300 transition group-hover:text-white">
                    {article.headline}
                  </p>
                  <span className={`shrink-0 text-[9px] font-bold ${
                    article.sentiment === "Bullish" ? "text-green-400" :
                    article.sentiment === "Bearish" ? "text-red-400" : "text-zinc-500"
                  }`}>
                    {article.sentiment}
                  </span>
                </a>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                No recent sentiment articles were returned for this ticker.
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
