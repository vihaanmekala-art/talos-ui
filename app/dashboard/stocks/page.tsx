"use client"
import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceArea } from "recharts"
import { useSession, signIn } from "next-auth/react";

type PriceChartPoint = {
  Date: string
  Close: number
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

export default function Stocks() {

  const ActivityIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )

  const StatCard = ({ label, value, sub, color = "" }: { label: string; value: string | number; sub?: string; color?: string }) => (
    <div className="bg-zinc-900 rounded-xl p-3 flex flex-col justify-between border border-zinc-800">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">{label}</p>
      <p className={`text-lg font-medium truncate ${color || "text-white"}`}>{value}</p>
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

  const [ticker, setTicker] = useState('')
  const [data, setData] = useState<any>(null)
  const [chartData, setChartData] = useState<PriceChartPoint[] | null>(null)
  const [period, setPeriod] = useState<any>('1y')
  const [load, setLoad] = useState<any>(false)
  const [analysis, setAnalysis] = useState<any>(null)
  const [sim, setSim] = useState<any>(null)
  const [prob, setProb] = useState<any>(null)
  const [mlReturn, setMlReturn] = useState<number | null>(null)
  const [targetPrice, setTargetPrice] = useState<any>(null)
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
  const [backtestData, setBacktestData] = useState<any>(null)
  const [isBacktesting, setIsBacktesting] = useState(false)
  const [sentiment, setSentiment] = useState<any>(null)
  const [recents, setRecents] = useState<string[]>([])
  const { data: session, status } = useSession()
  const [isGuest, setIsGuest] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [priceChartSelection, setPriceChartSelection] = useState<PriceChartSelection | null>(null)
  const [isSelectingPriceChart, setIsSelectingPriceChart] = useState(false)
  const [isPriceChartDrawMode, setIsPriceChartDrawMode] = useState(false)
  const [priceChartStrokes, setPriceChartStrokes] = useState<ChartStroke[]>([])
  const [activePriceChartStroke, setActivePriceChartStroke] = useState<ChartStroke | null>(null)
  const nextPriceChartStrokeId = useRef(0)

  const periodMap: Record<string, number> = {
    "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825
  }

  async function runBackTest(tickerToTest: string) {
    if (!tickerToTest) return
    setIsBacktesting(true)
    try {
      const res = await fetch(`${API_BASE}/stock/${tickerToTest}/backtest`)
      const json = await res.json()
      setBacktestData(json)
    } catch (error) {
      console.error("Backtest Error:", error)
    }
    setIsBacktesting(false)
  }

  async function saveTarget(newPrice: number) {
    if (!ticker || !newPrice) return
    try {
      const response = await fetch(`${API_BASE}/stock/target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: session?.user?.id || "guest_user",
          ticker: ticker.toUpperCase(),
          target_price: newPrice,
        }),
      })
      if (response.ok) console.log("Target saved to Talos database")
    } catch (error) {
      console.error("Error saving target:", error)
    }
  }

  async function Analyze(manualTicker?: string) {
    if (!ticker && !manualTicker) return
    const activeTicker = manualTicker || ticker
    setLoad(true)
    try {
      const [resStock, resAnalysis, resHist, resSim, resSent] = await Promise.all([
        fetch(`${API_BASE}/stock/${activeTicker}`),
        fetch(`${API_BASE}/analyze/${activeTicker}`),
        fetch(`${API_BASE}/stock/${activeTicker}/history?period_days=${periodMap[period]}`),
        fetch(`${API_BASE}/stock/${activeTicker}/simulate${targetPrice ? `?target_price=${targetPrice}` : ''}`),
        fetch(`${API_BASE}/stock/${activeTicker}/sentiment`)
      ])
      const sData = await resStock.json()
      const aData = await resAnalysis.json()
      const hData = await resHist.json()
      const simData = await resSim.json()
      const sentData = await resSent.json()
      setData(sData)
      setAnalysis(aData)
      setChartData(hData)
      setSentiment(sentData)
      if (simData?.data) {
        setSim(simData.data)
        setProb(simData.probability)
        setMlReturn(simData.ml_expected_price)
      }
      runBackTest(activeTicker)
    } catch (error) {
      console.error("Talos Engine Error:", error)
    }
    setRecents(prev => {
      const updated = [activeTicker, ...prev.filter(t => t !== activeTicker)].slice(0, 5)
      localStorage.setItem("talos_recents", JSON.stringify(updated))
      return updated
    })
    setLoad(false)
  }

  useEffect(() => {
    if (ticker && data) {
      const chart = async () => {
        const histRes = await fetch(`${API_BASE}/stock/${ticker}/history?period_days=${periodMap[period]}`)
        const histJson = await histRes.json()
        setChartData(histJson)
      }
      chart()
    }
  }, [period])

  useEffect(() => {
    if (ticker && sim && targetPrice) {
      const updateSim = async () => {
        const res = await fetch(`${API_BASE}/stock/${ticker}/simulate?target_price=${targetPrice}`)
        const json = await res.json()
        if (json?.probability !== undefined) setProb(json.probability)
      }
      const timeoutId = setTimeout(updateSim, 500)
      return () => clearTimeout(timeoutId)
    }
  }, [targetPrice])

  useEffect(() => {
    const fetchSavedTarget = async () => {
      const userId = session?.user?.id
      if (userId && ticker) {
        try {
          const res = await fetch(`${API_BASE}/stock/${ticker}/target/${userId}`)
          const data = await res.json()
          if (data.target_price) setTargetPrice(data.target_price)
        } catch (err) {
          console.log("No saved target found for this user.")
        }
      }
    }
    fetchSavedTarget()
  }, [ticker, session])

  useEffect(() => {
    const saved = localStorage.getItem("talos_recents")
    if (saved) setRecents(JSON.parse(saved))
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
  }, [chartData])

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

  if (status === "loading") {
    return <div className="flex h-screen items-center justify-center text-white">Loading Talos...</div>
  }

  if (!session && !isGuest) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-black text-white p-6 text-center">
        <h1 className="text-4xl font-bold mb-4 tracking-tight">TALOS <span className="text-blue-500">ENGINE</span></h1>
        <p className="text-zinc-400 mb-8 max-w-md">Access the quantitative terminal.</p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button onClick={() => signIn("google")} className="px-8 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-bold transition active:scale-95">
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
    <div className="p-4 max-w-6xl mx-auto space-y-4 text-white">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-medium">Talos Engine</span>
          <span className="text-xs text-zinc-500">/ stock analysis</span>
        </div>
        {session?.user && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Signed in as</span>
            <div className="w-7 h-7 rounded-full bg-blue-950 flex items-center justify-center text-[10px] font-semibold text-blue-400">
              {session.user.name?.slice(0, 2).toUpperCase()}
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-3 px-4 h-[38px] bg-zinc-900 border border-zinc-700 rounded-xl">
          <input
            className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none font-medium"
            placeholder="Ticker — e.g. AAPL"
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && Analyze()}
          />
          {data && <span className="text-xs text-zinc-500 shrink-0">{data.name ?? ticker}</span>}
        </div>
        <button
          onClick={() => Analyze()}
          disabled={load}
          className="px-5 h-[38px] bg-white text-black text-sm font-semibold rounded-xl hover:bg-zinc-100 active:scale-95 transition disabled:opacity-50"
        >
          {load ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      {/* Recents + Period selector */}
      <div className="flex items-center gap-2">
        {recents.length > 0 && (
          <>
            <span className="text-[10px] font-bold text-zinc-600 uppercase shrink-0">Recents:</span>
            {recents.map(t => (
              <button
                key={t}
                onClick={() => { setTicker(t); Analyze(t) }}
                className="px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-medium text-zinc-400 hover:border-blue-500/50 hover:text-white transition active:scale-95"
              >
                {t}
              </button>
            ))}
            <button
              onClick={() => { setRecents([]); localStorage.removeItem("talos_recents") }}
              className="text-[10px] text-zinc-600 hover:text-red-400 transition"
            >
              Clear
            </button>
          </>
        )}
        <div className="flex-1" />
        <div className="flex gap-1">
          {Object.keys(periodMap).map(p => (
            <button
              key={p}
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

      {/* Loading */}
      {load && (
        <div className="flex items-center gap-3 text-blue-400">
          <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium animate-pulse">Crunching market data…</span>
        </div>
      )}

      {/* Signal bar */}
      {data && analysis && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm">
          <span className="text-xl font-medium">{ticker}</span>
          <span className="text-lg text-zinc-200">${data?.price?.toFixed(2)}</span>
          {data?.change !== undefined && (
            <span className={`text-xs font-medium ${data.change >= 0 ? "text-green-400" : "text-red-400"}`}>
              {data.change >= 0 ? "+" : ""}{data.change?.toFixed(2)} ({data.change_pct?.toFixed(2)}%)
            </span>
          )}
          <SignalPill signal={analysis.rsi_signal} />
          <div className="ml-auto flex gap-4">
            {([["RSI", analysis.rsi], ["MACD", analysis.macd], ["Sharpe", analysis.sharpe?.toFixed(2)]] as [string, any][]).map(([label, val]) => (
              <div key={label} className="flex flex-col items-end gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</span>
                <span className="text-xs font-medium text-zinc-200">{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stat grid */}
      {data && analysis && !analysis.error && (
        <div className="grid grid-cols-4 gap-2">
          <StatCard label="52W High" value={`$${data?.max_high?.toFixed(2)}`} />
          <StatCard label="52W Low" value={`$${data?.max_low?.toFixed(2)}`} />
          <StatCard label="50D SMA" value={`$${analysis.sma50?.toFixed(2)}`} />
          <StatCard label="Volatility" value={`${analysis.vola}%`} />
          <StatCard label="Stock CAGR" value={`${analysis.stock_cagr?.toFixed(1)}%`} color={analysis.stock_cagr > 0 ? "text-green-400" : "text-red-400"} />
          <StatCard label="S&P 500 CAGR" value={`${analysis.spy_cagr?.toFixed(1)}%`} color="text-zinc-500" />
          <StatCard label="100D SMA" value={`$${analysis.sma100?.toFixed(2)}`} />
          <StatCard label="Sharpe ratio" value={analysis.sharpe?.toFixed(2)} />
        </div>
      )}

      {/* Price chart + Monte Carlo */}
      {(chartData || sim) && (
        <div className="grid grid-cols-[1.4fr_1fr] gap-3">

          {/* Price chart */}
          {chartData && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Price · {periodMap[period]} days
                </span>
                <div className="text-right">
                  {selectedPriceRange ? (
                    <>
                      <p className={`text-xs font-medium ${selectedPriceRange.changePct >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {selectedPriceRange.changePct >= 0 ? "+" : ""}{selectedPriceRange.changePct.toFixed(2)}% return
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        {selectedPriceRange.startPoint.Date} → {selectedPriceRange.endPoint.Date}
                      </p>
                    </>
                  ) : analysis?.stock_cagr !== undefined ? (
                    <>
                      <p className={`text-xs font-medium ${analysis.stock_cagr >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {analysis.stock_cagr >= 0 ? "+" : ""}{analysis.stock_cagr?.toFixed(1)}% CAGR
                      </p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">Hold and drag to measure return</p>
                    </>
                  ) : (
                    <p className="text-[10px] text-zinc-600">Hold and drag to measure return</p>
                  )}
                </div>
              </div>
              {mounted && (
                <div className="relative" style={{ height: 140 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      onMouseDown={handlePriceChartStart}
                      onMouseMove={handlePriceChartMove}
                      onMouseUp={handlePriceChartEnd}
                      onMouseLeave={() => handlePriceChartEnd()}
                      onTouchStart={handlePriceChartStart}
                      onTouchMove={handlePriceChartMove}
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
                  <button onClick={() => signIn("google")} className="text-[10px] text-blue-400 mt-1 hover:underline">
                    Sign in to unlock
                  </button>
                </div>
              )}
              <div className={isGuest ? "blur-sm grayscale opacity-30 select-none pointer-events-none" : ""}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm font-medium">30-day projection</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Monte Carlo · 1,000 paths</p>
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-blue-400 bg-blue-900/30 border border-blue-900/50 px-2 py-1 rounded-md">AI</span>
                </div>
                {mlReturn !== null && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-black/30 border border-zinc-800 rounded-xl p-2.5">
                      <p className="text-[10px] uppercase font-semibold tracking-widest text-zinc-500 mb-1">AI bias 30D</p>
                      <p className={`text-xl font-medium ${mlReturn >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {mlReturn >= 0 ? "↑" : "↓"} {(mlReturn * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div className="bg-black/30 border border-zinc-800 rounded-xl p-2.5">
                      <p className="text-[10px] uppercase font-semibold tracking-widest text-zinc-500 mb-1">Conviction</p>
                      <p className="text-sm font-medium mt-1">{Math.abs(mlReturn) > 0.05 ? "High" : "Moderate"}</p>
                    </div>
                  </div>
                )}
                {mounted && sim?.length > 0 && (
                  <div style={{ height: 120 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={sim}>
                        <XAxis dataKey="Date" hide />
                        <YAxis domain={["auto", "auto"]} orientation="right" tick={{ fontSize: 10, fill: "#52525b" }} width={48} />
                        <Tooltip
                          formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Price"]}
                          contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 12 }}
                        />
                        <Area type="monotone" dataKey="p95" stroke="#1d4ed8" fill="#1d4ed8" fillOpacity={0.06} strokeWidth={1} strokeDasharray="4 3" dot={false} />
                        <Area type="monotone" dataKey="p50" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2.5} dot={false} />
                        <Area type="monotone" dataKey="p5" stroke="#1d4ed8" fill="transparent" strokeWidth={1} strokeDasharray="4 3" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-zinc-800 flex items-end gap-4">
                  <div>
                    <p className="text-[10px] uppercase font-semibold text-zinc-500 mb-1.5 tracking-widest">Target price</p>
                    <input
                      disabled={isGuest}
                      value={targetPrice ?? ""}
                      onChange={e => {
                        const val = parseFloat(e.target.value)
                        setTargetPrice(isNaN(val) ? null : val)
                        if (!isNaN(val)) saveTarget(val)
                      }}
                      className="w-24 px-3 py-1.5 bg-black/30 border border-zinc-800 rounded-lg text-sm outline-none text-white disabled:text-zinc-600 disabled:cursor-not-allowed"
                      placeholder="0.00"
                    />
                  </div>
                  {prob !== null && targetPrice && (
                    <div>
                      <p className="text-[10px] uppercase font-semibold text-zinc-500 mb-1 tracking-widest">Probability</p>
                      <p className="text-2xl font-medium text-green-400">{Number(prob).toFixed(1)}$</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Backtest loading */}
      {isBacktesting && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm text-zinc-400 font-medium">Running 2-year RSI strategy backtest…</p>
        </div>
      )}

      {/* Backtest results */}
      {backtestData && !isBacktesting && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="flex justify-between items-start mb-5">
            <div>
              <h3 className="text-sm font-medium">RSI backtest</h3>
              <p className="text-[10px] text-zinc-500 mt-1">Buy RSI &lt; 30 / Sell RSI &gt; 70 · 2-year window</p>
            </div>
            <div className="flex gap-4 items-start">
              <div className="text-right">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Strategy</p>
                <p className={`text-2xl font-medium ${backtestData.total_return > 0 ? "text-green-400" : "text-red-400"}`}>
                  {backtestData.total_return > 0 ? "+" : ""}{backtestData.total_return}%
                </p>
              </div>
              <div className="text-right pl-4 border-l border-zinc-800">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Buy &amp; hold</p>
                <p className="text-2xl font-medium text-zinc-400">{backtestData.buy_hold_return}%</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-5">
            <StatCard label="Sharpe ratio" value={backtestData.sharpe} />
            <StatCard label="Max drawdown" value={`${backtestData.max_drawdown}%`} color="text-red-400" />
            <StatCard label="Buy signals" value={backtestData.buy_signals} />
            <StatCard label="Sell signals" value={backtestData.sell_signals} />
          </div>
          {mounted && (
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={backtestData.portfolio.map((val: number, i: number) => ({
                  name: i,
                  strategy: val,
                  buyHold: backtestData.buy_hold?.[i] ?? null,
                }))}>
                  <XAxis hide />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#52525b" }} width={40} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
                    formatter={(v: any) => [`$${Number(v).toFixed(2)}`]}
                  />
                  <Line type="monotone" dataKey="strategy" stroke="#4ade80" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="buyHold" stroke="#52525b" strokeWidth={1.5} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex gap-4 mt-3">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-green-400 rounded" />
              <span className="text-[10px] text-zinc-500">RSI strategy</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 border-t border-dashed border-zinc-500" />
              <span className="text-[10px] text-zinc-500">Buy &amp; hold</span>
            </div>
          </div>
        </div>
      )}

      {/* Sentiment */}
      {sentiment?.articles && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <ActivityIcon className="w-4 h-4 text-blue-400" />
              Market sentiment
            </h3>
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
              sentiment.score > 0
                ? "bg-green-500/10 text-green-400 border-green-500/20"
                : sentiment.score < 0
                ? "bg-red-500/10 text-red-400 border-red-500/20"
                : "bg-zinc-800 text-zinc-400 border-zinc-700"
            }`}>
              {sentiment.label}
            </span>
          </div>
          <div className="relative h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-5">
            <div
              className={`absolute h-full rounded-r-full transition-all duration-700 ${sentiment.score > 0 ? "bg-green-400" : "bg-red-400"}`}
              style={{
                width: `${Math.abs(sentiment.score) * 100}%`,
                left: "50%",
                transform: sentiment.score < 0 ? "translateX(-100%)" : "none",
              }}
            />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-600" />
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {sentiment.articles.map((article: any, i: number) => (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noreferrer"
                className="flex justify-between items-start gap-3 p-2.5 bg-black/20 border border-zinc-800 rounded-xl hover:border-blue-500/30 transition group"
              >
                <p className="text-xs text-zinc-300 group-hover:text-white transition line-clamp-2 leading-relaxed">
                  {article.headline}
                </p>
                <span className={`text-[9px] font-bold shrink-0 ${
                  article.sentiment === "Bullish" ? "text-green-400" :
                  article.sentiment === "Bearish" ? "text-red-400" : "text-zinc-500"
                }`}>
                  {article.sentiment}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
