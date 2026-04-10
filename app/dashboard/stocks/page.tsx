"use client"
import { useState, useEffect } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts"

export default function Stocks() {
    const [ticker, setTicker] = useState('')
    const [data, setData] = useState<any>(null)
    const [chartData, setChartData] = useState<any>(null)
    const [period, setPeriod] = useState<any>('1y')
    const [load, setLoad] = useState<any>(false)
    const [analysis, setAnalysis] = useState<any>(null)
    const [sim, setSim] = useState<any>(null)
    const [prob, setProb] = useState<any>(null)
    const [mlReturn, setMlReturn] = useState<number | null>(null);
    const [targetPrice, setTargetPrice] = useState<any>(null)
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const [backtestData, setBacktestData] = useState<any>(null);
    const [isBacktesting, setIsBacktesting] = useState(false);
    const periodMap: Record<string, number> = {
    "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825
};
async function runBacktest() {
    setIsBacktesting(true);
    try {
        const res = await fetch(`${API_BASE}/stock/${ticker}/backtest`);
        const json = await res.json();
        setBacktestData(json);
    } catch (error) {
        console.error("Backtest Error:", error);
    }
    setIsBacktesting(false);
}


async function Analyze() {
    if (!ticker) return;
    setLoad(true);
    const hasTarget = targetPrice !== null && targetPrice !== "";const simUrl = `${API_BASE}/stock/${ticker}/simulate${hasTarget ? `?target_price=${targetPrice}` : ''}`;
    try {
        const [resStock, resAnalysis, resHist, resSim] = await Promise.all([
            fetch(`${API_BASE}/stock/${ticker}`),
            fetch(`${API_BASE}/analyze/${ticker}`),
            fetch(`${API_BASE}/stock/${ticker}/history?period_days=${periodMap[period]}`),
            fetch(simUrl) 
        ]);

  
        const sData = await resStock.json();
        const aData = await resAnalysis.json();
        const hData = await resHist.json();
        const simData = await resSim.json();

       
        if (simData && simData.data) {
            setSim(simData.data);         
            setProb(simData.probability);
            setMlReturn(simData.ml_expected_price);
        } else {
            setSim(null);
            setProb(null);
        }

        setData(sData);
        setAnalysis(aData);
        setChartData(hData);
        runBacktest();
        
    } catch (error) {
        console.error("Talos Engine Error:", error);
    }
    
    setLoad(false);
}

    useEffect(() => {
        if (ticker && data){
            async function chart() {
                const histRes = await fetch(`${API_BASE}/stock/${ticker}/history?period_days=${periodMap[period]}`)
            const histJson = await histRes.json()
            setChartData(histJson)
            }
            chart()
        }
    }, [period]
)
useEffect(() => {
        if (ticker && sim && targetPrice) {
            const updateSim = async () => {
                const simUrl = `${API_BASE}/stock/${ticker}/simulate?target_price=${targetPrice}`;
                const res = await fetch(simUrl);
                const json = await res.json();
                if (json && json.probability !== undefined) {
                    setProb(json.probability);
                }
            };
            
            const timeoutId = setTimeout(updateSim, 500); 
            return () => clearTimeout(timeoutId);
        }
    }, [targetPrice]);

    return (
    <div className="p-4 max-w-6xl mx-auto space-y-6 text-white">

      {/* Header */}
      <div>
        <div className="flex items-baseline gap-3 mb-5">
          <h1 className="text-2xl font-bold text-white">Stock analysis</h1>
          <span className="text-sm text-gray-500">Talos Engine</span>
        </div>

        <div className="flex gap-2">
          <input
            className="flex-1 px-4 py-2.5 bg-gray-900 border border-white/10 rounded-xl text-white text-sm placeholder-gray-600 outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition"
            placeholder="Ticker — e.g. AAPL"
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && Analyze()}
          />
          <button
            onClick={Analyze}
            disabled={load}
            className="px-6 py-2.5 bg-white text-black text-sm font-semibold rounded-xl hover:bg-gray-100 active:scale-95 transition disabled:opacity-50"
          >
            {load ? "Analyzing…" : "Analyze"}
          </button>
        </div>

        <div className="flex gap-1.5 mt-3 flex-wrap">
          {Object.keys(periodMap).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                period === p
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800/80 text-gray-400 hover:bg-gray-700"
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
      {data && analysis && !analysis.error && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-gray-900/60 border border-white/5 rounded-xl text-sm">
          <span className="font-bold text-white text-base">{ticker}</span>
          <span className="text-gray-300 font-medium">${data?.price?.toFixed(2)}</span>
          <SignalPill signal={analysis.rsi_signal} />
          <div className="mt-1 w-full sm:mt-0 sm:ml-auto sm:w-auto flex gap-4 text-xs text-gray-500">
            <span>RSI <span className="text-gray-300 font-medium">{analysis.rsi}</span></span>
            <span>MACD <span className="text-gray-300 font-medium">{analysis.macd}</span></span>
            <span>Sharpe <span className="text-gray-300 font-medium">{analysis.sharpe?.toFixed(2)}</span></span>
          </div>
        </div>
      )}

      {/* Stat grid */}
      {data && analysis && !analysis.error && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <StatCard label="52W High" value={`$${data?.max_high?.toFixed(2)}`} />
          <StatCard label="52W Low" value={`$${data?.max_low?.toFixed(2)}`} />
          <StatCard label="50D SMA" value={`$${analysis.sma50?.toFixed(2)}`} />
          <StatCard label="Volatility" value={`${analysis.vola}%`} />
          <StatCard
            label="Stock CAGR"
            value={`${analysis.stock_cagr?.toFixed(1)}%`}
            color={analysis.stock_cagr > 0 ? "text-green-400" : "text-red-400"}
          />
          <StatCard label="S&P 500 CAGR" value={`${analysis.spy_cagr?.toFixed(1)}%`} />
          <StatCard label="Sharpe ratio" value={analysis.sharpe?.toFixed(2)} />
          <StatCard label="100D SMA" value={`$${analysis.sma100?.toFixed(2)}`} />
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Price history */}
        {chartData && (
          <div className="bg-gray-900/60 border border-white/5 rounded-2xl p-4">
            <div className="mb-4">
              <p className="font-semibold text-white text-sm">Price history</p>
              <p className="text-xs text-gray-500">{ticker} · {period}</p>
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis dataKey="Date" hide />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "#6b7280" }} width={55} />
                  <Tooltip
                    formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Price"]}
                    contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: "10px", fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="Close" stroke="#3b82f6" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Monte Carlo projection */}
        {sim && (
          <div className="bg-gray-900/60 border border-white/5 rounded-2xl p-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-semibold text-white text-sm">30-day projection</p>
                <p className="text-xs text-gray-500">Monte Carlo · 1,000 paths</p>
              </div>
              <span className="text-[10px] uppercase font-bold text-blue-400 bg-blue-900/30 border border-blue-900/50 px-2 py-1 rounded-md">
                AI-powered
              </span>
            </div>

            {mlReturn !== null && (
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-gray-800/50 border border-white/5 rounded-xl p-3">
                  <p className="text-[10px] uppercase font-semibold tracking-widest text-gray-500 mb-1">AI bias (30D)</p>
                  <p className={`text-2xl font-bold ${mlReturn >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {mlReturn >= 0 ? "↑" : "↓"} {(mlReturn * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="bg-gray-800/50 border border-white/5 rounded-xl p-3">
                  <p className="text-[10px] uppercase font-semibold tracking-widest text-gray-500 mb-1">Conviction</p>
                  <p className="text-base font-semibold text-white mt-1">
                    {Math.abs(mlReturn) > 0.05 ? "High" : "Moderate"}
                  </p>
                </div>
              </div>
            )}

            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sim}>
                  <XAxis dataKey="Date" hide />
                  <YAxis domain={["auto", "auto"]} orientation="right" tick={{ fontSize: 11, fill: "#6b7280" }} width={55} />
                  <Tooltip
                    formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Price"]}
                    contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: "10px", fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="p95" stroke="#1d4ed8" fill="#1d4ed8" fillOpacity={0.06} strokeWidth={1} strokeDasharray="4 3" dot={false} />
                  <Area type="monotone" dataKey="p50" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2.5} dot={false} />
                  <Area type="monotone" dataKey="p5" stroke="#1d4ed8" fill="transparent" strokeWidth={1} strokeDasharray="4 3" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-4">
              <div>
                <p className="text-[10px] uppercase font-semibold text-gray-500 mb-1.5 tracking-widest">Target price</p>
                <input
                  className="w-24 px-3 py-1.5 bg-gray-800 border border-white/10 rounded-lg text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
                  type="number"
                  value={targetPrice}
                  onChange={e => setTargetPrice(e.target.value)}
                  placeholder="$ target"
                />
              </div>
              {prob !== null && targetPrice && (
                <div>
                  <p className="text-[10px] uppercase font-semibold text-gray-500 mb-1 tracking-widest">Probability</p>
                  <p className="text-2xl font-bold text-green-400">{Number(prob).toFixed(1)}%</p>
                </div>
              )}
            </div>
          </div>
        )}
{isBacktesting && (
  <div className="bg-gray-900/60 border border-white/5 rounded-2xl p-12 col-span-1 lg:col-span-2 flex flex-col items-center justify-center">
    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
    <p className="text-sm text-gray-400 font-medium">Running 2-year RSI Strategy Backtest...</p>
  </div>
)}
        {/* Insert this below your Monte Carlo Chart <div> */}
{backtestData && !isBacktesting && (
  <div className="bg-gray-900/60 border border-white/5 rounded-2xl p-6 col-span-1 lg:col-span-2">
    <div className="flex justify-between items-center mb-6">
      <div>
        <h3 className="text-lg font-bold">RSI Backtest Results</h3>
        <p className="text-xs text-gray-500">Strategy: Buy At RSI Less Than 30, Sell RSI At More Than 70 (2 Year History)</p>
      </div>
      <div className="flex gap-4">
        <div className="text-right">
          <p className="text-[10px] text-gray-500 uppercase">Strategy Return</p>
          <p className={`text-xl font-bold ${backtestData.total_return > 0 ? "text-green-400" : "text-red-400"}`}>
            {backtestData.total_return}%
          </p>
        </div>
        <div className="text-right border-l border-white/10 pl-4">
          <p className="text-[10px] text-gray-500 uppercase">Buy & Hold</p>
          <p className="text-xl font-bold text-gray-300">{backtestData.buy_hold_return}%</p>
        </div>
      </div>
    </div>

    {/* Backtest Stats Grid */}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Sharpe Ratio" value={backtestData.sharpe} />
        <StatCard label="Max Drawdown" value={`${backtestData.max_drawdown}%`} color="text-red-400" />
        <StatCard label="Buy Signals" value={backtestData.buy_signals} />
        <StatCard label="Sell Signals" value={backtestData.sell_signals} />
    </div>

    {/* Strategy Performance Chart */}
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={backtestData.portfolio.map((val: number, i: number) => ({
            name: i,
            strategy: val,
            buyHold: backtestData.buy_hold[i]
        }))}>
          <XAxis hide />
          <YAxis domain={["auto", "auto"]} tick={{fontSize: 10}} />
          <Tooltip 
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151" }}
            formatter={(v: any) => [`$${Number(v).toFixed(2)}`]}
          />
          <Line type="monotone" dataKey="strategy" stroke="#10b981" strokeWidth={2} dot={false} name="RSI Strategy" />
          <Line type="monotone" dataKey="buyHold" stroke="#6b7280" strokeWidth={1} strokeDasharray="5 5" dot={false} name="Buy & Hold" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>
)}
      </div>
    </div>
  )


function StatCard({ label, value, sub, color = "" }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="bg-gray-900/60 rounded-xl p-3 flex flex-col justify-between border border-white/5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-semibold truncate ${color || "text-white"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
    </div>
  )
}

function SignalPill({ signal }: { signal: string }) {
  const styles: Record<string, string> = {
    Buy: "bg-green-900/40 text-green-400 border-green-800/50",
    Sell: "bg-red-900/40 text-red-400 border-red-800/50",
    Hold: "bg-amber-900/40 text-amber-400 border-amber-800/50",
  }
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${styles[signal] ?? "bg-gray-800 text-gray-400"}`}>
      {signal}
    </span>
  )
}}