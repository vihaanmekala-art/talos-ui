"use client"

import {
  type Dispatch,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react"
import type { BoardroomResponse } from "../types/boardroom"
import useSWR, { useSWRConfig } from "swr"
import { signIn } from "next-auth/react"
import type { Session } from "next-auth"
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import TradeJournal from "@/components/TradeJournal"
import MonteCarloChart from "@/components/monte"

// ============================================================================
// Types
// ============================================================================

type PriceChartPoint = { 
  Date: string
  Close: number 
}
interface RegimeData {
  current_state: number;
  label: "BEAR" | "BULL";
  is_crisis: boolean;
  stay_probability: number;
}

type StockQuote = {
  name?: string
  price?: number
  change?: number
  change_pct?: number
  max_high?: number
  max_low?: number
  bull_case: number;
  base_case: number;
  bear_case: number;
  paths: number[][];
  regime?: RegimeData;
}

type ScenarioValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ScenarioValue[]
  | { [key: string]: ScenarioValue }

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

type MonteRandomizeResponse = {
  bull_case?: number
  base_case?: number
  bear_case?: number
  paths?: number[][]
  regime?: RegimeData
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

type ChartInteractionState = { 
  activeTooltipIndex?: number | string | null
  activeIndex?: number | string | null 
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

type BlackSwanResponse = {
  ticker: string
  stress_label: string
  historical_drawdown: number
  projected_path: number[]
  vaR_percent: number
}

export type SyncedHoverState = 
  | { source: "price"; index: number } 
  | { source: "backtest"; index: number } 
  | null

// ============================================================================
// Constants
// ============================================================================

export const PERIOD_MAP: Record<string, number> = {
  "1mo": 30,
  "3mo": 90,
  "6mo": 180,
  "1y": 365,
  "2y": 730,
  "5y": 1825,
}

const swrConfig = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  keepPreviousData: true,
} as const

// ============================================================================
// Utilities
// ============================================================================

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

function formatCurrency(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) 
    ? `$${value.toFixed(digits)}` 
    : "N/A"
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) 
    ? value.toFixed(digits) 
    : "N/A"
}

function formatPercent(value: number | null | undefined, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value) 
    ? `${value.toFixed(digits)}%` 
    : "N/A"
}

function parseTargetPrice(value: string): number | null {
  if (!value.trim()) return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function getChartIndex(nextState: ChartInteractionState): number | null {
  const rawIndex = nextState.activeTooltipIndex ?? nextState.activeIndex
  if (typeof rawIndex === "number" && Number.isFinite(rawIndex)) return rawIndex
  if (typeof rawIndex === "string") {
    const n = Number(rawIndex)
    if (Number.isFinite(n)) return n
  }
  return null
}

function mapHoverIndex(
  sourceIndex: number, 
  sourceLength: number, 
  targetLength: number
): number | undefined {
  if (sourceLength <= 0 || targetLength <= 0) return undefined
  if (sourceLength === 1 || targetLength === 1) return 0
  const position = sourceIndex / (sourceLength - 1)
  return Math.min(targetLength - 1, Math.max(0, Math.round(position * (targetLength - 1))))
}

function getSelectionMetrics(points: PriceChartPoint[], selection: PriceChartSelection) {
  const start = points[selection.startIndex]
  const end = points[selection.endIndex]
  const left = points[Math.min(selection.startIndex, selection.endIndex)]
  const right = points[Math.max(selection.startIndex, selection.endIndex)]
  
  if (!start || !end || !left || !right || start.Close === 0) return null
  
  const change = end.Close - start.Close
  const changePct = (change / start.Close) * 100
  
  return { startPoint: start, endPoint: end, leftBound: left, rightBound: right, changePct }
}

function formatScenarioLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

function renderScenarioValue(value: ScenarioValue): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <p className="text-xs text-zinc-600">No scenario details available.</p>
  }
  
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <p className="text-xs leading-relaxed text-zinc-300">{String(value)}</p>
  }
  
  if (Array.isArray(value)) {
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="flex gap-2 text-xs text-zinc-300">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-60" />
            <div>{renderScenarioValue(item)}</div>
          </div>
        ))}
      </div>
    )
  }
  
  const entries = Object.entries(value)
  if (!entries.length) {
    return <p className="text-xs text-zinc-600">No details.</p>
  }
  return (
    <div className="space-y-1.5">
      {entries.map(([key, entryValue]) => (
        <div key={key} className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">
            {formatScenarioLabel(key)}
          </p>
          <div className="mt-0.5 text-xs text-zinc-300">
            {renderScenarioValue(entryValue)}
          </div>
        </div>
      ))}
    </div>
  )
}

const RegimeBadge = ({ regime }: { regime: RegimeData }) => (
  <div
    className={`flex items-center gap-3 rounded-md border px-3 py-1.5 transition-all duration-500 ${
      regime.is_crisis
        ? "bg-red-500/10 border-red-500/50 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.1)]"
        : "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
    }`}
  >
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
            regime.is_crisis ? "bg-red-400" : "bg-emerald-400"
          }`}
        />
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            regime.is_crisis ? "bg-red-500" : "bg-emerald-500"
          }`}
        />
      </span>
      <span className="text-xs font-mono font-bold uppercase tracking-wider">
        {regime.label} Regime
      </span>
    </div>
    <div className="min-w-20">
      <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            regime.is_crisis ? "bg-red-500" : "bg-emerald-500"
          }`}
          style={{ width: `${Math.max(0, Math.min(100, regime.stay_probability * 100))}%` }}
        />
      </div>
      <p className="mt-1 text-[9px] font-mono uppercase tracking-[0.14em] text-current/80">
        Stay {formatPercent(regime.stay_probability * 100)}
      </p>
    </div>
  </div>
)

// ============================================================================
// Components
// ============================================================================

const StatCard = ({
  label,
  value,
  sub,
  color = "",
}: {
  label: string
  value: string | number | null | undefined
  sub?: string
  color?: string
}) => (
  <div className="flex flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
    <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
      {label}
    </p>
    <p className={`font-mono text-base font-medium leading-none ${color || "text-zinc-100"}`}>
      {value ?? "N/A"}
    </p>
    {sub && <p className="text-[9px] text-zinc-700">{sub}</p>}
  </div>
)

const SignalPill = ({ signal }: { signal: string }) => {
  const colorMap: Record<string, string> = {
    Buy: "border-green-700/60 bg-green-950/50 text-green-400",
    Sell: "border-red-700/60 bg-red-950/50 text-red-400",
    Neutral: "border-zinc-700/60 bg-zinc-900 text-zinc-400",
    "Strong Buy": "border-green-600/70 bg-green-950/60 text-green-300",
    "Strong Sell": "border-red-600/70 bg-red-950/60 text-red-300",
  }
  
  return (
    <span className={`font-mono rounded-full border px-3 py-0.5 text-[10px] font-bold tracking-[0.1em] uppercase ${colorMap[signal] ?? "border-zinc-700 bg-zinc-900 text-zinc-400"}`}>
      {signal}
    </span>
  )
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-zinc-800/80 ${className}`} />
}

// ============================================================================
// SWR Hooks
// ============================================================================

type StockQuoteKey = readonly ["stock-quote", string, string, number]
type AnalysisKey = readonly ["analysis", string, string, number]
type HistoryKey = readonly ["history", string, string, string, number]
type SimulationKey = readonly ["simulate", string, string, number]
type RandomizeKey = readonly ["randomize", string, string, number]
type SavedTargetKey = readonly ["saved-target", string, string, string]
type TargetProbabilityKey = readonly ["target-probability", string, string, string]
type BacktestKey = readonly ["backtest", string, string, number]
type SentimentKey = readonly ["sentiment", string, string, number]

function useStockQuote(apiBase: string, ticker: string | null, requestKey: number) {
  return useSWR<StockQuote>(
    ticker ? (["stock-quote", apiBase, ticker, requestKey] as const satisfies StockQuoteKey) : null,
    (key: StockQuoteKey) => fetchJson<StockQuote>(`${key[1]}/stock/${encodeURIComponent(key[2])}`),
    swrConfig,
  )
}

function useAnalysis(apiBase: string, ticker: string | null, requestKey: number) {
  return useSWR<AnalysisResponse>(
    ticker ? (["analysis", apiBase, ticker, requestKey] as const satisfies AnalysisKey) : null,
    (key: AnalysisKey) => fetchJson<AnalysisResponse>(`${key[1]}/analyze/${encodeURIComponent(key[2])}`),
    swrConfig,
  )
}

function useRandomize(apiBase: string, ticker: string | null, requestKey: number) {
  return useSWR<MonteRandomizeResponse>(
    ticker ? (["randomize", apiBase, ticker, requestKey] as const satisfies RandomizeKey) : null,
    (key: RandomizeKey) => fetchJson<MonteRandomizeResponse>(`${key[1]}/randomize?ticker=${encodeURIComponent(key[2])}`),
    swrConfig,
  )
}

// ============================================================================
// Exported Components
// ============================================================================

export function TickerNameBadge({
  apiBase,
  ticker,
  requestKey,
}: {
  apiBase: string
  ticker: string
  requestKey: number
}) {
  const { data } = useStockQuote(apiBase, ticker || null, requestKey)
  if (!ticker || !data?.name) return null
  
  return (
    <span className="truncate font-mono text-[10px] text-zinc-600 max-w-[120px]">
      {data.name}
    </span>
  )
}

export function AnalysisIssueBanner({
  apiBase,
  ticker,
  requestKey,
}: {
  apiBase: string
  ticker: string | null
  requestKey: number
}) {
  const { data, error, isLoading } = useAnalysis(apiBase, ticker, requestKey)
  
  const message = typeof data?.error === "string"
    ? data.error
    : error
      ? getErrorMessage(error, "Talos couldn't load this ticker.")
      : null

  if (!ticker || isLoading || !message) return null

  return (
    <div className="rounded-xl border border-red-500/25 bg-red-950/15 px-4 py-3">
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-red-400">
        Analysis issue
      </p>
      <p className="mt-1 text-xs text-red-200">{message}</p>
    </div>
  )
}

export function OverviewSection({
  apiBase,
  ticker,
  requestKey,
}: {
  apiBase: string
  ticker: string | null
  requestKey: number
}) {
  const quote = useStockQuote(apiBase, ticker, requestKey)
  const analysis = useAnalysis(apiBase, ticker, requestKey)
  const randomize = useRandomize(apiBase, ticker, requestKey)
  const [boardroomLoading, setBoardroomLoading] = useState(false)
  const [boardroomError, setBoardroomError] = useState<string | null>(null)
  const [boardroomData, setBoardroomData] = useState<BoardroomResponse | null>(null)
  async function handleFetchBoardroom() {
    if (!ticker) return
    setBoardroomLoading(true)
    setBoardroomError(null)
    setBoardroomData(null)
    try {
      const data = await fetchJson<BoardroomResponse>(`${apiBase}/boardroom/${encodeURIComponent(ticker)}`)
      setBoardroomData(data)
    } catch (err) {
      setBoardroomError(getErrorMessage(err, "Failed to fetch boardroom"))
    } finally {
      setBoardroomLoading(false)
    }
  }
  
  if (!ticker) return null

  if (quote.isLoading || analysis.isLoading) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
          <SkeletonBlock className="h-4 w-20" />
          <SkeletonBlock className="h-8 w-28" />
          <SkeletonBlock className="h-4 w-24" />
          <SkeletonBlock className="h-6 w-24 rounded-full" />
          <div className="ml-auto flex flex-wrap gap-5">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex flex-col items-end gap-1">
                <SkeletonBlock className="h-2 w-10" />
                <SkeletonBlock className="h-3 w-12" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
              <SkeletonBlock className="h-2 w-12" />
              <SkeletonBlock className="h-4 w-16" />
            </div>
          ))}
        </div>
      </>
    )
  }

  const data = quote.data
  const analysisData = analysis.data

  if (!data || !analysisData || analysisData.error || quote.error || analysis.error) {
    return null
  }
  const priceChange = typeof data.change === "number" ? data.change : null
  const stockCagr = typeof analysisData.stock_cagr === "number" ? analysisData.stock_cagr : null

  const metrics: Array<[string, string]> = [
    ["RSI", formatNumber(analysisData.rsi)],
    ["MACD", formatNumber(analysisData.macd)],
    ["Sharpe", formatNumber(analysisData.sharpe)]
  ]

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
        <span className="font-mono text-xs font-bold tracking-widest text-zinc-500">
          {ticker} (IEX)
        </span>
        <span className="font-mono text-2xl font-semibold text-zinc-50">
          {formatCurrency(data.price)}
        </span>
        {priceChange !== null && (
          <span className={`font-mono text-xs font-medium ${priceChange >= 0 ? "text-green-400" : "text-red-400"}`}>
            {priceChange >= 0 ? "+" : ""}
            {formatNumber(priceChange)} ({formatPercent(data.change_pct, 2)})
          </span>
        )}
        <SignalPill signal={analysisData.rsi_signal ?? "Neutral"} />
        {randomize.isLoading ? (
          <div className="h-10 w-32 animate-pulse rounded border border-slate-700 bg-slate-800" />
        ) : randomize.data?.regime ? (
          <RegimeBadge regime={randomize.data.regime} />
        ) : null}
        <div className="ml-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleFetchBoardroom()}
            className={`ml-2 h-7 px-2 rounded-lg font-mono text-[10px] font-semibold transition ${boardroomLoading ? "bg-zinc-800 text-zinc-400 cursor-wait" : "bg-indigo-700/10 text-indigo-300 hover:bg-indigo-700/20"}`}
          >
            {boardroomLoading ? "Fetching..." : "Boardroom"}
          </button>
          {boardroomError && <p className="text-xs text-red-400">{boardroomError}</p>}
        </div>

        <div className="ml-auto flex flex-wrap gap-5">
          {metrics.map(([label, value]) => (
            <div key={label} className="flex flex-col items-end gap-0.5">
              <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-zinc-600">
                {label}
              </span>
              <span className="font-mono text-xs text-zinc-200">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
        <StatCard label="52W High" value={formatCurrency(data.max_high)} />
        <StatCard label="52W Low" value={formatCurrency(data.max_low)} />
        <StatCard label="50D SMA" value={formatCurrency(analysisData.sma50)} />
        <StatCard label="100D SMA" value={formatCurrency(analysisData.sma100)} />
        <StatCard label="Volatility" value={formatPercent(analysisData.vola)} />
        <StatCard
          label="Stock CAGR"
          value={formatPercent(stockCagr)}
          color={stockCagr !== null && stockCagr > 0 ? "text-green-400" : "text-red-400"}
        />
        <StatCard 
          label="S&P CAGR" 
          value={formatPercent(analysisData.spy_cagr)} 
          color="text-zinc-500" 
        />
        <StatCard label="Sharpe" value={formatNumber(analysisData.sharpe)} />
      </div>

      {boardroomData && (
        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
          <p className="font-mono text-[9px] text-zinc-600">Boardroom</p>
          <p className="mt-1 text-xs text-zinc-200">Session: {boardroomData.session_id}</p>
          <pre className="mt-2 max-h-48 overflow-auto text-xs text-zinc-300">{JSON.stringify(boardroomData.verdict, null, 2)}</pre>
        </div>
      )}

      <TradeJournal ticker={ticker} />
    </>
  )
}

export function PriceChartPanel({
  apiBase,
  ticker,
  period,
  requestKey,
  mounted,
  shouldSync,
  syncedHover,
  backtestLength,
  onDataLengthChange,
  onHoverChange,
}: {
  apiBase: string
  ticker: string | null
  period: string
  requestKey: number
  mounted: boolean
  shouldSync: boolean
  syncedHover: SyncedHoverState
  backtestLength: number
  onDataLengthChange: (length: number) => void
  onHoverChange: Dispatch<SetStateAction<SyncedHoverState>>
}) {
  const history = useSWR<PriceChartPoint[]>(
    ticker ? (["history", apiBase, ticker, period, requestKey] as const satisfies HistoryKey) : null,
    (key: HistoryKey) =>
      fetchJson<PriceChartPoint[]>(
        `${key[1]}/stock/${encodeURIComponent(key[2])}/history?period_days=${PERIOD_MAP[key[3]]}`,
      ),
    swrConfig,
  )
  
  const analysis = useAnalysis(apiBase, ticker, requestKey)
  
  const [priceChartSelection, setPriceChartSelection] = useState<PriceChartSelection | null>(null)
  const [isSelectingPriceChart, setIsSelectingPriceChart] = useState(false)
  const [isPriceChartDrawMode, setIsPriceChartDrawMode] = useState(false)
  const [priceChartStrokes, setPriceChartStrokes] = useState<ChartStroke[]>([])
  const [activePriceChartStroke, setActivePriceChartStroke] = useState<ChartStroke | null>(null)
  const [blackSwanData, setBlackSwanData] = useState<BlackSwanResponse | null>(null)
  const [isBlackSwanLoading, setIsBlackSwanLoading] = useState(false)
  const [showBlackSwanOverlay, setShowBlackSwanOverlay] = useState(false)
  
  const nextStrokeId = useRef(0)

  useEffect(() => {
    const nextLength = Array.isArray(history.data) ? history.data.length : 0
    onDataLengthChange(nextLength)
  }, [history.data, onDataLengthChange])

  useEffect(() => {
    setPriceChartSelection(null)
    setIsSelectingPriceChart(false)
    setIsPriceChartDrawMode(false)
    setPriceChartStrokes([])
    setActivePriceChartStroke(null)
    setBlackSwanData(null)
    setShowBlackSwanOverlay(false)
  }, [ticker, period, requestKey])

  const chartData = Array.isArray(history.data) ? history.data : null
  const stockCagr = typeof analysis.data?.stock_cagr === "number" ? analysis.data.stock_cagr : null
  const selectedRange = chartData && priceChartSelection 
    ? getSelectionMetrics(chartData, priceChartSelection) 
    : null
  const mirroredPriceIdx = shouldSync && syncedHover?.source === "backtest" 
    ? mapHoverIndex(syncedHover.index, backtestLength, chartData?.length ?? 0) 
    : undefined

  async function handleSimulateBlackSwan() {
    if (!ticker) return
    setIsBlackSwanLoading(true)
    setBlackSwanData(null)
    try {
      const data = await fetchJson<BlackSwanResponse>(
        `${apiBase}/stock/${encodeURIComponent(ticker)}/black-swan`
      )
      setBlackSwanData(data)
      setShowBlackSwanOverlay(true)
    } catch (error) {
      console.error("Black swan simulate error:", error)
      setBlackSwanData(null)
    } finally {
      setIsBlackSwanLoading(false)
    }
  }

  const handlePriceChartStart = (state: ChartInteractionState) => {
    if (isPriceChartDrawMode) return
    const index = getChartIndex(state)
    if (index === null) return
    setIsSelectingPriceChart(true)
    setPriceChartSelection({ startIndex: index, endIndex: index })
  }

  const handlePriceChartMove = (state: ChartInteractionState) => {
    if (isPriceChartDrawMode || !isSelectingPriceChart) return
    const index = getChartIndex(state)
    if (index === null) return
    setPriceChartSelection(prev => 
      prev ? { ...prev, endIndex: index } : { startIndex: index, endIndex: index }
    )
  }

  const handlePriceChartEnd = (state?: ChartInteractionState) => {
    if (isPriceChartDrawMode || !isSelectingPriceChart) return
    const index = state ? getChartIndex(state) : null
    if (index !== null) {
      setPriceChartSelection(prev => 
        prev ? { ...prev, endIndex: index } : { startIndex: index, endIndex: index }
      )
    }
    setIsSelectingPriceChart(false)
  }

  const getPriceChartPoint = (event: ReactPointerEvent<SVGSVGElement>): DrawingPoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width),
      y: Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height),
    }
  }

  const handleDrawStart = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPriceChartDrawMode) return
    event.preventDefault()
    const stroke = { id: nextStrokeId.current++, points: [getPriceChartPoint(event)] }
    event.currentTarget.setPointerCapture(event.pointerId)
    setActivePriceChartStroke(stroke)
  }

  const handleDrawMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPriceChartDrawMode) return
    setActivePriceChartStroke(prev => {
      if (!prev) return prev
      const point = getPriceChartPoint(event)
      const last = prev.points[prev.points.length - 1]
      if (last && last.x === point.x && last.y === point.y) return prev
      return { ...prev, points: [...prev.points, point] }
    })
  }

  const finishStroke = () => {
    setActivePriceChartStroke(prev => {
      if (prev && prev.points.length > 0) {
        setPriceChartStrokes(current => [...current, prev])
      }
      return null
    })
  }

  const handleDrawEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPriceChartDrawMode) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishStroke()
  }

  if (!ticker) return null

  if (history.isLoading || analysis.isLoading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <SkeletonBlock className="h-3 w-20" />
          <div className="text-right space-y-1">
            <SkeletonBlock className="ml-auto h-3 w-16" />
            <SkeletonBlock className="ml-auto h-2 w-20" />
          </div>
        </div>
        <div className="relative h-[220px] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
          <div className="absolute inset-0 animate-pulse bg-[linear-gradient(90deg,rgba(24,24,27,0.6),rgba(63,63,70,0.25),rgba(24,24,27,0.6))]" />
        </div>
      </div>
    )
  }

  if (!chartData || history.error) return null

  return (
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
              className={`ml-2 h-7 px-2 rounded-lg font-mono text-[10px] font-semibold transition ${isBlackSwanLoading ? "bg-zinc-800 text-zinc-400 cursor-wait" : "bg-red-700/10 text-red-300 hover:bg-red-700/20"}`}
            >
              {isBlackSwanLoading ? "Simulating..." : "Simulate Black Swan"}
            </button>
          )}
        </div>
        <div className="text-right">
          {selectedRange ? (
            <>
              <p className={`font-mono text-xs font-medium ${selectedRange.changePct >= 0 ? "text-green-400" : "text-red-400"}`}>
                {selectedRange.changePct >= 0 ? "+" : ""}
                {selectedRange.changePct.toFixed(2)}% return
              </p>
              <p className="font-mono text-[9px] text-zinc-600 mt-0.5">
                {selectedRange.startPoint.Date} → {selectedRange.endPoint.Date}
              </p>
            </>
          ) : stockCagr !== null ? (
            <>
              <p className={`font-mono text-xs font-medium ${stockCagr >= 0 ? "text-green-400" : "text-red-400"}`}>
                {stockCagr >= 0 ? "+" : ""}
                {stockCagr.toFixed(1)}% CAGR
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
              onMouseMove={state => {
                handlePriceChartMove(state)
                if (shouldSync && !isPriceChartDrawMode) {
                  const index = getChartIndex(state)
                  if (index !== null) onHoverChange({ source: "price", index })
                }
              }}
              onMouseUp={handlePriceChartEnd}
              onMouseLeave={() => {
                handlePriceChartEnd()
                onHoverChange(previous => (previous?.source === "price" ? null : previous))
              }}
            >
              <defs>
                <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="Date" hide />
              <YAxis 
                domain={["auto", "auto"]} 
                tick={{ fontSize: 9, fill: "#52525b", fontFamily: "IBM Plex Mono" }} 
                width={44} 
              />
              <Tooltip
                defaultIndex={mirroredPriceIdx}
                formatter={value => [`$${Number(Array.isArray(value) ? value[0] : value ?? 0).toFixed(2)}`, "Close"]}
                contentStyle={{ 
                  backgroundColor: "#18181b", 
                  border: "1px solid #27272a", 
                  borderRadius: 8, 
                  fontSize: 11, 
                  fontFamily: "IBM Plex Mono" 
                }}
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
              <Area 
                type="monotone" 
                dataKey="Close" 
                stroke="#22c55e" 
                strokeWidth={1.5} 
                fill="url(#pg)" 
                dot={false} 
                isAnimationActive={false} 
              />
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
                  data={chartData.map((point, index) => ({ 
                    ...point, 
                    blackSwan: blackSwanData.projected_path[index] ?? null 
                  }))}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>

          <svg
            className={`absolute inset-0 h-full w-full ${isPriceChartDrawMode ? "pointer-events-auto cursor-crosshair" : "pointer-events-none"}`}
            onPointerDown={handleDrawStart}
            onPointerMove={handleDrawMove}
            onPointerUp={handleDrawEnd}
            onPointerLeave={handleDrawEnd}
          >
            {priceChartStrokes.map(stroke => (
              <polyline
                key={stroke.id}
                points={stroke.points.map(point => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {activePriceChartStroke && (
              <polyline
                points={activePriceChartStroke.points.map(point => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>

          <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
            {priceChartStrokes.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setPriceChartStrokes([])
                  setActivePriceChartStroke(null)
                }}
                className="rounded bg-black/60 px-2 py-1 font-mono text-[9px] font-semibold text-zinc-400 hover:text-white transition"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsPriceChartDrawMode(current => !current)
                setIsSelectingPriceChart(false)
                setPriceChartSelection(null)
                setActivePriceChartStroke(null)
              }}
              className={`rounded-full border p-1.5 transition ${isPriceChartDrawMode ? "border-amber-500/60 bg-amber-500/15 text-amber-400" : "border-zinc-700 bg-black/50 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"}`}
              title={isPriceChartDrawMode ? "Disable draw mode" : "Draw on chart"}
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function MonteCarloPanel({
  apiBase,
  ticker,
  requestKey,
  session,
  isGuest,
}: {
  apiBase: string
  ticker: string | null
  requestKey: number
  session: Session | null
  isGuest: boolean
}) {
  const { mutate } = useSWRConfig()
  const [targetPrice, setTargetPrice] = useState("")
  const [debouncedTargetPrice, setDebouncedTargetPrice] = useState("")
  const [targetSaveError, setTargetSaveError] = useState<string | null>(null)
  const [isSavingTarget, setIsSavingTarget] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const saveResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const parsedTargetPrice = parseTargetPrice(targetPrice)

  const simulation = useSWR<SimulationResponse>(
    ticker ? (["simulate", apiBase, ticker, requestKey] as const satisfies SimulationKey) : null,
    (key: SimulationKey) => fetchJson<SimulationResponse>(`${key[1]}/stock/${encodeURIComponent(key[2])}/simulate`),
    swrConfig,
  )
  
  const randomize = useRandomize(apiBase, ticker, requestKey)
  
  const savedTarget = useSWR<{ target_price?: number | null }>(
    ticker && session?.user?.id ? (["saved-target", apiBase, ticker, session.user.id] as const satisfies SavedTargetKey) : null,
    (key: SavedTargetKey) => fetchJson<{ target_price?: number | null }>(`${key[1]}/stock/${encodeURIComponent(key[2])}/target/${key[3]}`),
    swrConfig,
  )
  
  const targetProbability = useSWR<SimulationResponse>(
    ticker && parseTargetPrice(debouncedTargetPrice) !== null
      ? (["target-probability", apiBase, ticker, debouncedTargetPrice] as const satisfies TargetProbabilityKey)
      : null,
    (key: TargetProbabilityKey) =>
      fetchJson<SimulationResponse>(`${key[1]}/stock/${encodeURIComponent(key[2])}/simulate?target_price=${key[3]}`),
    swrConfig,
  )

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedTargetPrice(targetPrice), 500)
    return () => clearTimeout(timeoutId)
  }, [targetPrice])

  useEffect(() => {
    setTargetPrice(savedTarget.data?.target_price != null ? String(savedTarget.data.target_price) : "")
  }, [savedTarget.data?.target_price, ticker])

  useEffect(() => {
    return () => {
      if (saveResetRef.current) clearTimeout(saveResetRef.current)
    }
  }, [])

  async function handleSaveTarget() {
    if (!ticker) {
      setTargetSaveError("Analyze a ticker first.")
      return
    }
    if (isGuest || !session?.user?.id) {
      setTargetSaveError("Sign in to arm Shield alerts.")
      return
    }
    if (parsedTargetPrice === null) {
      setTargetSaveError("Enter a valid positive price.")
      return
    }
    setIsSavingTarget(true)
    setTargetSaveError(null)
    try {
      await fetchJson(`${apiBase}/stock/target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          ticker: ticker.toUpperCase(), 
          user_id: session.user.id, 
          target_price: parsedTargetPrice 
        }),
      })
      await mutate(["saved-target", apiBase, ticker, session.user.id])
      if (saveResetRef.current) clearTimeout(saveResetRef.current)
      setIsSaved(true)
      saveResetRef.current = setTimeout(() => setIsSaved(false), 2000)
    } catch (error) {
      setTargetSaveError(getErrorMessage(error, "Shield could not save this alert."))
    } finally {
      setIsSavingTarget(false)
    }
  }

  if (!ticker) return null

  if (simulation.isLoading || randomize.isLoading) {
    return (
      <div className="relative rounded-xl border border-zinc-800 bg-zinc-900 p-4 overflow-hidden">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <SkeletonBlock className="h-3 w-28" />
            <SkeletonBlock className="mt-2 h-2 w-24" />
          </div>
          <SkeletonBlock className="h-5 w-10" />
        </div>
        <div className="mb-3 grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
              <SkeletonBlock className="h-2 w-14" />
              <SkeletonBlock className="mt-2 h-5 w-16" />
            </div>
          ))}
        </div>
        <div className="relative h-[332px] overflow-hidden rounded-xl border border-white/5 bg-[#050505]">
          <div className="absolute inset-0 animate-pulse bg-[linear-gradient(90deg,rgba(24,24,27,0.6),rgba(59,130,246,0.15),rgba(24,24,27,0.6))]" />
        </div>
      </div>
    )
  }

  if (!simulation.data || simulation.error) return null

  const probability = typeof targetProbability.data?.probability === "number"
    ? targetProbability.data.probability
    : typeof simulation.data.probability === "number"
      ? simulation.data.probability
      : null
      
  const mlReturn = typeof simulation.data.ml_expected_price === "number" 
    ? simulation.data.ml_expected_price 
    : null

  return (
    <div className="relative rounded-xl border border-zinc-800 bg-zinc-900 p-4 overflow-hidden">
      {isGuest && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl bg-black/70 backdrop-blur-md">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-blue-500/40 bg-blue-500/10">
            <svg className="h-4 w-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2V7a5 5 0 00-5-5zM7 7a3 3 0 116 0v2H7V7z" />
            </svg>
          </div>
          <p className="font-mono text-[10px] font-bold tracking-widest uppercase text-zinc-300">
            Pro Feature
          </p>
          <button 
            onClick={() => void signIn("google")} 
            className="mt-1 font-mono text-[10px] text-blue-400 hover:underline"
          >
            Sign in to unlock
          </button>
        </div>
      )}

      <div className={isGuest ? "blur-sm grayscale opacity-25 select-none pointer-events-none" : ""}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <p className="font-mono text-xs font-medium text-zinc-200">30-Day Projection</p>
            <p className="font-mono text-[9px] text-zinc-600 mt-0.5">Monte Carlo · 1,000 paths</p>
          </div>
          <span className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest text-blue-400">
            AI
          </span>
        </div>

        {(mlReturn !== null || probability !== null) && (
          <div className={`mb-3 grid gap-2 ${probability !== null ? "grid-cols-3" : "grid-cols-2"}`}>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
              <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-600 mb-1">
                AI Bias 30D
              </p>
              <p className={`font-mono text-lg font-semibold leading-none ${mlReturn === null ? "text-zinc-400" : mlReturn >= 0 ? "text-green-400" : "text-red-400"}`}>
                {mlReturn !== null ? `${mlReturn >= 0 ? "↑" : "↓"} ${(mlReturn * 100).toFixed(1)}%` : "N/A"}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
              <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-600 mb-1">
                Conviction
              </p>
              <p className="font-mono text-sm font-medium mt-1 text-zinc-200">
                {mlReturn !== null && Math.abs(mlReturn) > 0.05 ? "High" : "Moderate"}
              </p>
            </div>
            {probability !== null && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-600 mb-1">
                  Target Odds
                </p>
                <p className="font-mono text-sm font-medium mt-1 text-zinc-200">
                  {formatPercent(probability * 100)}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="relative">
          <MonteCarloChart paths={Array.isArray(randomize.data?.paths) ? randomize.data.paths : []} />
        </div>

        <div className="mt-4 pt-4 border-t border-zinc-800">
          <p className="font-mono text-[9px] tracking-[0.16em] uppercase text-zinc-600 mb-2">
            Arm shield when price hits
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              value={targetPrice}
              onChange={event => setTargetPrice(event.target.value)}
              onKeyDown={event => event.key === "Enter" && void handleSaveTarget()}
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
  )
}

export function ScenarioPanels({
  apiBase,
  ticker,
  requestKey,
}: {
  apiBase: string
  ticker: string | null
  requestKey: number
}) {
  const { data, error, isLoading } = useAnalysis(apiBase, ticker, requestKey)

  if (!ticker) return null

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {["emerald", "red"].map(color => (
          <div 
            key={color} 
            className={`rounded-xl border ${color === "emerald" ? "border-emerald-900/50 bg-emerald-950/15" : "border-red-900/50 bg-red-950/15"} p-4`}
          >
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="mt-2 h-2 w-32" />
            <div className="mt-4 space-y-2">
              <SkeletonBlock className="h-10 w-full" />
              <SkeletonBlock className="h-10 w-full" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!data || data.error || error || (!data.bull_case && !data.bear_case)) {
    return null
  }

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/15 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-500">
              Bull Case
            </p>
            <p className="text-[10px] text-emerald-400/60 mt-0.5">
              What drives upside from here
            </p>
          </div>
          <span className="rounded-full border border-emerald-600/25 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[9px] font-semibold text-emerald-400">
            Upside
          </span>
        </div>
        {renderScenarioValue(data.bull_case as ScenarioValue)}
      </div>
      
      <div className="rounded-xl border border-red-900/50 bg-red-950/15 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-red-500">
              Bear Case
            </p>
            <p className="text-[10px] text-red-400/60 mt-0.5">
              What could pressure the stock
            </p>
          </div>
          <span className="rounded-full border border-red-600/25 bg-red-500/10 px-2.5 py-0.5 font-mono text-[9px] font-semibold text-red-400">
            Downside
          </span>
        </div>
        {renderScenarioValue(data.bear_case as ScenarioValue)}
      </div>
    </div>
  )
}

export function BacktestPanel({
  apiBase,
  ticker,
  requestKey,
  mounted,
  shouldSync,
  syncedHover,
  priceLength,
  onDataLengthChange,
  onHoverChange,
}: {
  apiBase: string
  ticker: string | null
  requestKey: number
  mounted: boolean
  shouldSync: boolean
  syncedHover: SyncedHoverState
  priceLength: number
  onDataLengthChange: (length: number) => void
  onHoverChange: Dispatch<SetStateAction<SyncedHoverState>>
}) {
  const backtest = useSWR<BacktestResponse>(
    ticker ? (["backtest", apiBase, ticker, requestKey] as const satisfies BacktestKey) : null,
    (key: BacktestKey) => fetchJson<BacktestResponse>(`${key[1]}/stock/${encodeURIComponent(key[2])}/backtest`),
    swrConfig,
  )

  const backtestChartData = Array.isArray(backtest.data?.portfolio)
    ? backtest.data.portfolio.map((value, index) => ({
        name: index,
        strategy: value,
        buyHold: backtest.data?.buy_hold?.[index] ?? null,
      }))
    : []

  useEffect(() => {
    onDataLengthChange(backtestChartData.length)
  }, [backtestChartData.length, onDataLengthChange])

  if (!ticker) return null

  if (backtest.isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-10 justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        <span className="font-mono text-xs text-zinc-500">Running RSI backtest…</span>
      </div>
    )
  }

  if (backtest.error) {
    return (
      <div className="rounded-xl border border-amber-600/25 bg-amber-950/15 px-4 py-3">
        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-amber-400">
          Backtest unavailable
        </p>
        <p className="mt-1 text-xs text-amber-200/80">
          {getErrorMessage(backtest.error, "Backtest data is unavailable.")}
        </p>
      </div>
    )
  }

  if (!backtest.data) return null

  const backtestReturn = typeof backtest.data.total_return === "number" 
    ? backtest.data.total_return 
    : null
    
  const mirroredBacktestIdx = shouldSync && syncedHover?.source === "price" 
    ? mapHoverIndex(syncedHover.index, priceLength, backtestChartData.length) 
    : undefined

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="font-mono text-xs font-medium text-zinc-200">RSI Backtest</p>
          <p className="font-mono text-[9px] text-zinc-600 mt-0.5">
            Buy RSI &lt; 30 / Sell RSI &gt; 70 · 2-year window
          </p>
        </div>
        <div className="text-right">
          <p className={`font-mono text-2xl font-semibold ${backtestReturn !== null && backtestReturn > 0 ? "text-green-400" : "text-red-400"}`}>
            {backtestReturn !== null && backtestReturn > 0 ? "+" : ""}
            {formatPercent(backtestReturn, 1)}
          </p>
          <p className="font-mono text-[9px] text-zinc-600 mt-0.5">
            vs {formatPercent(backtest.data.buy_hold_return)} buy &amp; hold
          </p>
        </div>
      </div>
      
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard label="Sharpe" value={formatNumber(backtest.data.sharpe)} />
        <StatCard 
          label="Max Drawdown" 
          value={formatPercent(backtest.data.max_drawdown)} 
          color="text-red-400" 
        />
        <StatCard label="Buy Signals" value={backtest.data.buy_signals} />
        <StatCard label="Sell Signals" value={backtest.data.sell_signals} />
      </div>
      
      {mounted && (
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={backtestChartData}
              onMouseMove={state => {
                if (!shouldSync) return
                const index = getChartIndex(state)
                if (index !== null) onHoverChange({ source: "backtest", index })
              }}
              onMouseLeave={() => onHoverChange(previous => (previous?.source === "backtest" ? null : previous))}
            >
              <XAxis hide />
              <YAxis 
                domain={["auto", "auto"]} 
                tick={{ fontSize: 9, fill: "#52525b", fontFamily: "IBM Plex Mono" }} 
                width={40} 
              />
              <Tooltip
                defaultIndex={mirroredBacktestIdx}
                contentStyle={{ 
                  backgroundColor: "#18181b", 
                  border: "1px solid #27272a", 
                  borderRadius: 8, 
                  fontSize: 11 
                }}
                formatter={value => [`$${Number(Array.isArray(value) ? value[0] : value ?? 0).toFixed(2)}`]}
              />
              <Line 
                type="monotone" 
                dataKey="strategy" 
                stroke="#22c55e" 
                strokeWidth={1.5} 
                dot={false} 
                isAnimationActive={false} 
              />
              <Line 
                type="monotone" 
                dataKey="buyHold" 
                stroke="#3f3f46" 
                strokeWidth={1.5} 
                strokeDasharray="5 5" 
                dot={false} 
                isAnimationActive={false} 
              />
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
  )
}

export function SentimentPanel({
  apiBase,
  ticker,
  requestKey,
}: {
  apiBase: string
  ticker: string | null
  requestKey: number
}) {
  const sentiment = useSWR<SentimentResponse>(
    ticker ? (["sentiment", apiBase, ticker, requestKey] as const satisfies SentimentKey) : null,
    (key: SentimentKey) => fetchJson<SentimentResponse>(`${key[1]}/stock/${encodeURIComponent(key[2])}/sentiment`),
    swrConfig,
  )

  if (!ticker) return null

  if (sentiment.isLoading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-5 w-20 rounded-full" />
        </div>
        <SkeletonBlock className="mb-4 h-1 w-full rounded-full" />
        <div className="space-y-1.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonBlock key={index} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (!sentiment.data || sentiment.error) return null

  const sentimentScore = typeof sentiment.data.score === "number" ? sentiment.data.score : 0

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg 
            className="h-3.5 w-3.5 text-blue-400" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-zinc-600">
            Market Sentiment
          </span>
        </div>
        <span
          className={`font-mono rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${
            sentimentScore > 0
              ? "border-green-700/40 bg-green-950/30 text-green-400"
              : sentimentScore < 0
                ? "border-red-700/40 bg-red-950/30 text-red-400"
                : "border-zinc-700 bg-zinc-800 text-zinc-400"
          }`}
        >
          {sentiment.data.label ?? "Unavailable"}
        </span>
      </div>

      <div className="relative mb-4 h-1 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`absolute h-full rounded-full transition-all duration-700 ${
            sentimentScore > 0 
              ? "bg-green-500" 
              : sentimentScore < 0 
                ? "bg-red-500" 
                : "bg-zinc-600"
          }`}
          style={{
            width: `${Math.min(Math.abs(sentimentScore), 1) * 100}%`,
            left: "50%",
            transform: sentimentScore < 0 ? "translateX(-100%)" : "none",
          }}
        />
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-700" />
      </div>

      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
        {Array.isArray(sentiment.data.articles) && sentiment.data.articles.length > 0 ? (
          sentiment.data.articles.map((article, index) => (
            <a
              key={index}
              href={article.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 transition hover:border-zinc-700"
            >
              <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400 transition group-hover:text-zinc-200">
                {article.headline}
              </p>
              <span
                className={`shrink-0 font-mono text-[9px] font-bold ${
                  article.sentiment === "Bullish" 
                    ? "text-green-400" 
                    : article.sentiment === "Bearish" 
                      ? "text-red-400" 
                      : "text-zinc-600"
                }`}
              >
                {article.sentiment}
              </span>
            </a>
          ))
        ) : (
          <p className="font-mono text-xs text-zinc-600 rounded-lg border border-dashed border-zinc-800 p-4">
            No recent sentiment articles for this ticker.
          </p>
        )}
      </div>
    </div>
  )
}
