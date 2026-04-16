"use client"
import { useState, useEffect, useRef } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts"
import { useSession, signIn, signOut } from "next-auth/react";
export default function Stocks() {
  
  const ActivityIcon = ({ className }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);
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
    const [sentiment, setSentiment] = useState<any>(null);
    const [recents, setRecents] = useState<string[]>([]);
    const { data: session, status } = useSession();
    const [isGuest, setIsGuest] = useState(false);
    const [mounted, setMounted] = useState(false); 
    const chartRef = useRef<HTMLDivElement | null>(null);
    const monteRef = useRef<HTMLDivElement | null>(null);
    // To prevent hydration mismatch
    const periodMap: Record<string, number> = {
    "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825
};

// 1. Show a loading state while NextAuth checks the cookies


// 3. If they ARE logged in, the rest of your code (the dashboard) runs below...
async function runBackTest(tickerToTest: string) {
  if (!tickerToTest) return;

  setIsBacktesting(true);
  try {
    const res = await fetch(`${API_BASE}/stock/${tickerToTest}/backtest`);
    const json = await res.json();
    setBacktestData(json);
  } catch (error) {
    console.error("Backtest Error:", error);
  }
  setIsBacktesting(false);
}
async function saveTarget(newPrice: number) {
    // If there's no ticker or no price, don't do anything
    if (!ticker || !newPrice) return;

    try {
        const response = await fetch(`${API_BASE}/stock/target`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                user_id: session?.user?.id || "guest_user", // Fallback to guest if no login
                ticker: ticker.toUpperCase(),
                target_price: newPrice,
            }),
        });

        if (response.ok) {
            console.log("Target saved to Talos database");
        }
    } catch (error) {
        console.error("Error saving target:", error);
    }
}
async function Analyze(manualTicker?: string) {
    if (!ticker && !manualTicker) return;
    const activeTicker = manualTicker || ticker; 
    setLoad(true);

    try {
        const [resStock, resAnalysis, resHist, resSim, resSent] = await Promise.all([
            fetch(`${API_BASE}/stock/${activeTicker}`),
            fetch(`${API_BASE}/analyze/${activeTicker}`),
            fetch(`${API_BASE}/stock/${activeTicker}/history?period_days=${periodMap[period]}`),
            fetch(`${API_BASE}/stock/${activeTicker}/simulate${targetPrice ? `?target_price=${targetPrice}` : ''}`),
            fetch(`${API_BASE}/stock/${activeTicker}/sentiment`)
        ]);

        const sData = await resStock.json();
        const aData = await resAnalysis.json();
        const hData = await resHist.json();
        const simData = await resSim.json();
        const sentData = await resSent.json();
        
        setData(sData);
        setAnalysis(aData);
        setChartData(hData);
        setSentiment(sentData);
    
        if (simData && simData.data) {
            setSim(simData.data);         
            setProb(simData.probability);
            setMlReturn(simData.ml_expected_price);
        }
         runBackTest(activeTicker);
        
    } catch (error) {
        console.error("Talos Engine Error:", error);
    }
    setRecents(prev => {
        const updated = [activeTicker, ...prev.filter(t => t !== activeTicker)].slice(0, 5);
        localStorage.setItem("talos_recents", JSON.stringify(updated));
        return updated;
    });
    setLoad(false);
}
console.log("Stocks Render:", { 
    hasData: !!backtestData, 
    isMounted: mounted, 
    status: status,
    windowWidth: typeof window !== 'undefined' ? window.innerWidth : 'SSR'
});
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
useEffect(() => {
    const fetchSavedTarget = async () => {
        // We only fetch from the DB if we have a user ID
        const userId = session?.user?.id; 
        
        if (userId && ticker) {
            try {
                const res = await fetch(`${API_BASE}/stock/${ticker}/target/${userId}`);
                const data = await res.json();
                if (data.target_price) {
                    setTargetPrice(data.target_price);
                }
            } catch (err) {
                console.log("No saved target found for this user.");
            }
        }
    };
    fetchSavedTarget();
}, [ticker, session]);
useEffect(() => {
  const saved = localStorage.getItem("talos_recents");
  if (saved) setRecents(JSON.parse(saved));
}, []);
useEffect(() => {
    if (session) {
        setIsGuest(false);
    }
}, [session]);
useEffect(() => {
  setMounted(true);

  const timer = setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 200);

  return () => clearTimeout(timer);
}, []);

useEffect(() => {
  if (chartRef.current) {
    let el: HTMLElement | null = chartRef.current;
    let depth = 0;

    while (el && depth < 5) {
      const rect = el.getBoundingClientRect();
      console.log(`🔍 Parent level ${depth}`, {
        tag: el.tagName,
        width: rect.width,
        height: rect.height,
        display: getComputedStyle(el).display
      });
      el = el.parentElement;
      depth++;
    }
  }
}, [backtestData]);
useEffect(() => {
  if (sim) {
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 100);
  }
}, [sim]);
useEffect(() => {
  if (monteRef.current) {
    const rect = monteRef.current.getBoundingClientRect();
    console.log("📉 Monte Carlo size:", rect.width, rect.height);
  }
}, [sim, mounted]);
useEffect(() => {
  if (chartRef.current) {
    const rect = chartRef.current.getBoundingClientRect();
    console.log("📦 Chart container size:", {
      width: rect.width,
      height: rect.height
    });
  }
}, [backtestData]);
if (status === "loading") {
  return <div className="flex h-screen items-center justify-center text-white">Loading Talos...</div>;
}

if (!session && !isGuest) {
  console.log("🎯 FINAL CHECK:", {
  readyToRender:
    mounted &&
    backtestData?.portfolio?.length > 0,
});
    return (
        <div className="flex h-screen flex-col items-center justify-center bg-black text-white p-6 text-center">
            <h1 className="text-4xl font-bold mb-4 tracking-tight">TALOS <span className="text-blue-500">ENGINE</span></h1>
            <p className="text-gray-400 mb-8 max-w-md">Access the quantitative terminal.</p>
            
            <div className="flex flex-col gap-3 w-full max-w-xs">
                <button 
                    onClick={() => signIn("google")}
                    className="px-8 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-bold transition transform active:scale-95"
                >
                    Sign in with Google
                </button>
                
                <button 
                    onClick={() => setIsGuest(true)}
                    className="px-8 py-3 bg-gray-900 hover:bg-gray-800 border border-white/10 rounded-xl font-semibold text-gray-400 transition"
                >
                    Continue as Guest
                </button>
            </div>
        </div>
    );
}
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
            onClick={() => Analyze()}
            disabled={load}
            className="px-6 py-2.5 bg-white text-black text-sm font-semibold rounded-xl hover:bg-gray-100 active:scale-95 transition disabled:opacity-50"
          >
            {load ? "Analyzing…" : "Analyze"}
          </button>
        </div>
        {recents.length > 0 && (
  <div className="flex gap-2 mt-2 overflow-x-auto pb-2 no-scrollbar">
    <span className="text-[10px] uppercase font-bold text-gray-600 flex items-center">Recents:</span>
    {recents.map(t => (
      <button
        key={t}
        onClick={() => {
          setTicker(t);
          Analyze(t);
        }}
        className="px-3 py-1 bg-gray-900 border border-white/5 rounded-lg text-xs font-medium hover:bg-gray-800 hover:border-blue-500/50 transition active:scale-95"
      >
        {t}
      </button>
    ))}
    <button 
      onClick={() => { setRecents([]); localStorage.removeItem("talos_recents"); }}
      className="text-[10px] text-gray-600 hover:text-red-400 ml-auto"
    >
      Clear
    </button>
  </div>
)}
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
        {mounted && backtestData?.portfolio?.length > 0 && (
          <div className="w-full h-[350px] min-h-[350px]">
  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Equity Curve</h3>
  
  {/* The parent MUST have a strict pixel height, not percentages */}
  <div className="w-full min-w-0"> 
  <ResponsiveContainer width="100%" height={160}>
      <LineChart 
        data={backtestData.portfolio.map((val: number, i: number) => ({
          name: i,
          strategy: val,
          buyHold: backtestData.buy_hold ? backtestData.buy_hold[i] : null
        }))}
        
      >
        <XAxis dataKey="name" hide />
        <YAxis domain={["auto", "auto"]} tick={{fontSize: 10, fill: "#4b5563"}} width={45} />
        <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151" }} />
        <Line type="monotone" dataKey="strategy" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="buyHold" stroke="#4b5563" strokeWidth={1} strokeDasharray="4 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>
</div>
        )}

        {/* Monte Carlo projection */}
      
        {sim && (
  <div className="relative bg-gray-900/60 border border-white/5 rounded-2xl p-4 overflow-hidden">
    {isGuest && (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md">
        <div className="bg-blue-600/20 p-2 rounded-full mb-2 border border-blue-500/50">
          <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2V7a5 5 0 00-5-5zM7 7a3 3 0 116 0v2H7V7z" />
          </svg>
        </div>
        <p className="text-[11px] font-bold text-white uppercase tracking-widest">Pro Projection</p>
        <button onClick={() => signIn("google")} className="text-[10px] text-blue-400 mt-1 hover:underline">
          Sign in to unlock
        </button>
      </div>
    )}

    {/* ✅ Everything in one wrapper */}
    <div className={isGuest ? "blur-sm grayscale opacity-30 select-none pointer-events-none" : ""}>
      <div className="flex items-start justify-between mb-4">
        <p className="font-semibold text-white text-sm">30-day projection</p>
        <p className="text-xs text-gray-500">Monte Carlo · 1,000 paths</p>
      </div>
      <span className="text-[10px] uppercase font-bold text-blue-400 bg-blue-900/30 border border-blue-900/50 px-2 py-1 rounded-md">
        AI-powered
      </span>

      {mlReturn !== null && (
        <div className="grid grid-cols-2 gap-2 mb-4 mt-4">
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

     <div ref={monteRef} className="w-full h-[160px] min-w-0">
        {mounted && sim?.length > 0 && monteRef.current && (
          <ResponsiveContainer width="100%" height={160}>
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
        </ResponsiveContainer>)}
      </div>

      <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-4">
        <div>
          <p className="text-[10px] uppercase font-semibold text-gray-500 mb-1.5 tracking-widest">Target price</p>
          <input
            disabled={isGuest}
            value={targetPrice ?? ""}
            onChange={e => {
              const val = parseFloat(e.target.value);
              setTargetPrice(isNaN(val) ? null : val);
              if (!isNaN(val)) saveTarget(val);
            }}
            className={`w-24 px-3 py-1.5 rounded-lg text-sm outline-none ${
              isGuest ? "bg-gray-900 text-gray-600 cursor-not-allowed" : "bg-gray-800 text-white"
            }`}
            placeholder="0.00"
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
  </div>
)}
{/* 1. The Backtesting Loading State */}
{isBacktesting && (
  <div className="bg-gray-900/60 border border-white/5 rounded-2xl p-12 col-span-1 lg:col-span-2 flex flex-col items-center justify-center">
    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
    <p className="text-sm text-gray-400 font-medium">Running 2-year RSI Strategy Backtest...</p>
  </div>
)}

{/* 2. The Strategy Results & Chart */}
{backtestData && !isBacktesting && (
  <div className="relative bg-gray-900/60 border border-white/5 rounded-2xl p-6 col-span-1 lg:col-span-2">
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

    {/* Strategy Performance Chart - Working "Git History" Version */}
    <div className="h-[300px] w-full">
      {mounted && (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={backtestData.portfolio.map((val: number, i: number) => ({
              name: i,
              strategy: val,
              buyHold: backtestData.buy_hold ? backtestData.buy_hold[i] : null
          }))}>
            <XAxis hide />
            <YAxis domain={["auto", "auto"]} tick={{fontSize: 10, fill: "#4b5563"}} width={40} />
            <Tooltip 
              contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151" }}
              formatter={(v: any) => [`$${Number(v).toFixed(2)}`]}
            />
            <Line type="monotone" dataKey="strategy" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="buyHold" stroke="#6b7280" strokeWidth={1} strokeDasharray="5 5" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  </div>
)}{sentiment && sentiment.articles && (
  <div className="bg-gray-900/60 border border-white/5 rounded-2xl p-6">
    <div className="flex justify-between items-center mb-6">
      <h3 className="font-bold text-white flex items-center gap-2">
        <ActivityIcon className="text-blue-400 w-5 h-5" />
        <span>Market Sentiment</span>
      </h3>
      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
        sentiment.score > 0 ? "bg-green-500/10 text-green-400 border border-green-500/20" : 
        sentiment.score < 0 ? "bg-red-500/10 text-red-400 border border-red-500/20" : 
        "bg-gray-500/10 text-gray-400 border border-gray-500/20"
      }`}>
        {sentiment.label}
      </span>
    </div>

    {/* Sentiment Meter */}
    <div className="relative h-4 bg-gray-800 rounded-full overflow-hidden mb-6">
      {/* Indicator needle/bar */}
      <div 
        className={`absolute h-full transition-all duration-1000 ${
          sentiment.score > 0 ? "bg-green-500" : "bg-red-500"
        }`}
        style={{ 
          width: `${Math.abs(sentiment.score) * 100}%`,
          left: '50%',
          transform: sentiment.score < 0 ? `translateX(-100%)` : 'none'
        }}
      />
      <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/20 z-10" /> {/* Center mark */}
    </div>

    {/* News Feed */}
    <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
      {sentiment?.articles?.map((article: any, i: number) => (
        <a 
          key={i} 
          href={article.url} 
          target="_blank" 
          rel="noreferrer"
          className="block p-3 bg-white/5 rounded-xl border border-white/5 hover:border-blue-500/30 transition group"
        >
          <div className="flex justify-between items-start gap-3">
            <p className="text-xs text-gray-300 group-hover:text-white transition line-clamp-2">
              {article.headline}
            </p>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
              article.sentiment === "Bullish" ? "text-green-400" : 
              article.sentiment === "Bearish" ? "text-red-400" : "text-gray-500"
            }`}>
              {article.sentiment}
            </span>
          </div>
        </a>
      ))}
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
    "Strong Buy": "bg-green-900/60 text-green-400 border-green-800/70",
    "Strong Sell": "bg-red-900/60 text-red-400 border-red-800/70",
  }
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${styles[signal] ?? "bg-gray-800 text-gray-400"}`}>
      {signal}
    </span>
  )
}}