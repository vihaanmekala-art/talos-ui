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
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const periodMap: Record<string, number> = {
    "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825
};
    
    async function Analyze() {
        setLoad(true)
        const [stockRes, analysisRes, histRes, simRes] = await Promise.all([
        fetch(`${API_BASE}/stock/${ticker}`),
        fetch(`${API_BASE}/analyze/${ticker}`),
        fetch(`${API_BASE}/stock/${ticker}/history?period_days=${periodMap[period]}`),
        fetch(`${API_BASE}/stock/${ticker}/simulate`)
    ])
    const stockJson = await stockRes.json()
    const analysisJson = await analysisRes.json()
    const histJson = await histRes.json()
    const simJson = await simRes.json()
    setData(stockJson)
    setAnalysis(analysisJson)
    setChartData(histJson)
    setSim(simJson)
    setLoad(false)
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


    return (
        <div>
    
            <h1 className="text-3xl font-bold">📈 Stock Analysis</h1>
            {load && <div className="mt-6 flex items-center gap-2 text-gray-400">
        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
        <p>Crunching Numbers...</p>
    </div>}
            <input
                className="mt-4 p-2 bg-gray-800 rounded text-white"
                placeholder="Enter ticker e.g. AAPL"
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
            />
            <button
                onClick={Analyze}
                className="ml-4 px-4 py-2 bg-white text-black rounded font-semibold hover:bg-gray-200 transition"
            >
                Analyze
            </button>
            <div className="mt-4 flex gap-2">
  {["1mo", "3mo", "6mo", "1y", "2y", "5y"].map((p) => (
    <button
      key={p}
      onClick={() => setPeriod(p)}
      className={`px-3 py-1 rounded text-sm font-semibold transition ${
        period === p ? "bg-white text-black" : "bg-gray-800 text-white hover:bg-gray-700"
      }`}
    >
      {p}
    </button>
  ))}
</div>
            {data && analysis && !analysis.error && (
                <div className="mt-6 grid grid-cols-3 gap-4">
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">Price (IEX Exchange. May be off by a 1-2 dollars.)</p>
                        <p className="text-2xl font-bold">${data?.price?.toFixed(2) ?? 'N/A'}</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">52 Week High</p>
                        <p className="text-2xl font-bold">${data?.max_high?.toFixed(2) ?? 'N/A'}</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">52 Week Low</p>
                        <p className="text-2xl font-bold">${data?.max_low?.toFixed(2) ?? 'N/A'}</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">RSI</p>
                        <p className="text-2xl font-bold">{analysis.rsi}</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">Mean Average Convergence/Divergence (MACD) </p>
                        <p className="text-2xl font-bold">{analysis.macd}</p>
                    </div>
                    
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">50 Day Simple Moving Average </p>
                        <p className="text-2xl font-bold">${analysis.sma50.toFixed(2)}</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">100 Day Simple Moving Average </p>
                        <p className="text-2xl font-bold">${analysis.sma100.toFixed(2)}</p>
                    </div>
                    
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">Standard Deviation (Volatility) </p>
                        <p className="text-2xl font-bold">{analysis.vola.toFixed(2)}%</p>
                    </div>
                    
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">Stock CAGR </p>
                        <p className="text-2xl font-bold">{analysis.stock_cagr.toFixed(2)}%</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">S&P 500 CAGR </p>
                        <p className="text-2xl font-bold">{analysis.spy_cagr.toFixed(2)}%</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">Sharpe Ratio </p>
                        <p className="text-2xl font-bold">{analysis.sharpe.toFixed(2)}</p>
                    </div>
                    
                </div>
            )}
            {chartData && (
  <div className="mt-8 bg-gray-900 p-4 rounded-lg">
    <h2 className="text-xl font-bold mb-4">Price History for {data.ticker}</h2>
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData}>
        <XAxis dataKey="Date" hide />
        <YAxis domain={["auto", "auto"]} />
        <Tooltip formatter={(value: any) => [`$${Number(value).toFixed(2)}`, "Price"]}
  contentStyle={{ backgroundColor: "#1f2937", border: "none", color: "#ffffff" }} />
        <Line type="monotone" dataKey="Close" stroke="#6a4242" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>)}
  {sim && (
  <div className="mt-8 bg-gray-900 p-6 rounded-lg border border-gray-800">
    <div className="flex justify-between items-center mb-4">
      <h2 className="text-xl font-bold text-white">30-Day Price Projection for {data.ticker}</h2>
      <span className="text-xs font-mono text-blue-400 bg-blue-900/20 px-2 py-1 rounded border border-blue-800/50">
        Stochastic Volatility Model
      </span>
    </div>
    
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={sim}>
        <XAxis dataKey="Date" hide />
        <YAxis 
          domain={["auto", "auto"]} 
          orientation="right" 
          tick={{fill: '#9ca3af', fontSize: 12}} 
          axisLine={false}
          tickLine={false}
        />
        <Tooltip 
          formatter={(val: any) => [`$${Number(val).toFixed(2)}`, "Predicted Price"]}
          contentStyle={{ backgroundColor: "#111827", borderRadius: "8px", border: "1px solid #374151", color: "#fff" }} 
          itemStyle={{ color: "#3b82f6" }}
        />
        
        
        <Area 
          type="monotone" 
          dataKey="p95" 
          stroke="none" 
          fill="#3b82f6" 
          fillOpacity={0.1} 
        />
        <Area 
          type="monotone" 
          dataKey="p5" 
          stroke="none" 
          fill="#3b82f6" 
          fillOpacity={0.1} 
        />

        <Area 
          type="monotone" 
          dataKey="p50" 
          stroke="#3b82f6" 
          fill="#3b82f6" 
          fillOpacity={0.3} 
          strokeWidth={3} 
        />
      </AreaChart>
    </ResponsiveContainer>
    <p className="mt-4 text-xs text-gray-500 italic">
      *This simulation uses 1,000 Monte Carlo iterations. It is a mathematical projection, not financial advice.
    </p>
  </div>
)}

        </div>
    )
}