"use client"
import { useState } from "react"
import { PieChart, ResponsiveContainer, Cell, Pie, Tooltip } from "recharts"

export default function Portfolio() {
    const [tickers, setTickers] = useState("")
    const [data, setData] = useState<any>(null)
    const [spin, setSpin] = useState<any>(false)
    const [error, setError] = useState<string | null>(null)
    const COLORS = ["#ffffff", "#9ca3af", "#4b5563", "#1f2937"];
    const LandmarkIcon = ({ className }: { className?: string }) => (
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
    <line x1="3" y1="22" x2="21" y2="22" />
    <line x1="6" y1="18" x2="6" y2="11" />
    <line x1="10" y1="18" x2="10" y2="11" />
    <line x1="14" y1="18" x2="14" y2="11" />
    <line x1="18" y1="18" x2="18" y2="11" />
    <polygon points="12 2 20 7 4 7 12 2" />
  </svg>
);
    async function Optimize() {
        if (!tickers.includes(',')) {
        setError("Please enter at least two tickers separated by a comma.");
        return;
    }
        setSpin(true)
        const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const res = await fetch(`${API_BASE}/portfolio?tickers=${tickers}`)
        const json = await res.json()
        if (json.error) {
            setError(json.error)
            setSpin(false)
            return
        }
        setData(json)
        setSpin(false)
    }

    return (
  <div className="p-6 max-w-7xl mx-auto space-y-10 text-white">
    {/* Header & Input Section */}
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-white/5 pb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Portfolio Optimizer</h1>
        <p className="text-gray-500 text-sm mt-1">Modern Portfolio Theory · Efficient Frontier Analysis</p>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 md:w-80 px-4 py-2.5 bg-gray-900 border border-white/10 rounded-xl text-sm placeholder-gray-600 outline-none focus:ring-2 focus:ring-blue-500/50 transition"
          placeholder="Tickers — e.g. AAPL, MSFT, TSLA"
          value={tickers}
          onChange={(e) => setTickers(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && Optimize()}
        />
        <button
          onClick={Optimize}
          disabled={spin}
          className="px-6 py-2.5 bg-white text-black text-sm font-bold rounded-xl hover:bg-gray-200 active:scale-95 transition disabled:opacity-50"
        >
          {spin ? "Calculating..." : "Optimize"}
        </button>
      </div>
    </div>

    {/* Error & Loading States */}
    {error && (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
        ⚠️ {error}
      </div>
    )}

    {spin && (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 animate-pulse font-medium">Running 3,000 Monte Carlo Simulations...</p>
      </div>
    )}

    {/* Results Grid */}
    {data && !spin && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {[
          { key: 'max_sharpe', label: 'Max Sharpe Ratio', color: 'text-blue-400', icon: '⭐', theme: '#3b82f6' },
          { key: 'min_vol', label: 'Minimum Volatility', color: 'text-emerald-400', icon: '🛡️', theme: '#10b981' }
        ].map((strat) => (
          <div key={strat.key} className="bg-gray-900/40 backdrop-blur-md border border-white/5 rounded-3xl p-8 hover:border-white/10 transition">
            <div className="flex justify-between items-start mb-8">
              <div>
                <h2 className={`text-2xl font-bold flex items-center gap-2 ${strat.color}`}>
                  <span className="text-xl">{strat.icon}</span> {strat.label}
                </h2>
                <p className="text-gray-500 text-xs mt-1 uppercase tracking-widest font-semibold">Optimal Allocation</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-mono font-bold">{(data[strat.key].sharpe).toFixed(2)}</p>
                <p className="text-[10px] text-gray-600 uppercase font-bold tracking-tighter">Sharpe Ratio</p>
              </div>
            </div>

            {/* Core Stats Row */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Expected Return</p>
                <p className="text-xl font-bold">{(data[strat.key].return * 100).toFixed(2)}%</p>
              </div>
              <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Annual Volatility</p>
                <p className="text-xl font-bold">{(data[strat.key].risk * 100).toFixed(2)}%</p>
              </div>
            </div>

            {/* Composition Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={Object?.entries(data[strat.key].weights).map(([name, value]) => ({ name, value }))}
                      dataKey="value"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      stroke="none"
                    >
                      {Object?.entries(data[strat.key].weights).map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '12px', fontSize: '12px' }}
  itemStyle={{ color: '#fff' }}
  // Cast value to any or use the Recharts-friendly check
  formatter={(value: any) => `${(Number(value) * 100).toFixed(2)}%`}
/>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-3">
                <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Weight Breakdown</h3>
                {Object?.entries(data[strat.key].weights).map(([ticker, weight]: any, index) => (
                  <div key={ticker} className="flex items-center justify-between group">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                      <span className="text-sm font-medium text-gray-300 group-hover:text-white transition">{ticker}</span>
                    </div>
                    <span className="text-sm font-mono font-bold">{(weight * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    )}

    {/* Empty State */}
    {!data && !spin && (
      <div className="border-2 border-dashed border-white/5 rounded-3xl h-64 flex flex-col items-center justify-center text-gray-600">
        <LandmarkIcon className="mb-4 opacity-20" />
        <p className="text-sm">Enter tickers above to calculate the Efficient Frontier</p>
      </div>
    )}
  </div>
)}