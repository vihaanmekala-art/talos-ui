"use client"
import { useState, useEffect, use } from "react"
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
    const periodMap: Record<string, number> = {
    "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825
};
    
async function Analyze() {
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
    <div className="p-4 max-w-7xl mx-auto space-y-8"> 
        <header>
            <h1 className="text-3xl font-bold text-white">📈 Stock Analysis</h1>
            
            
            <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <input
                    className="p-3 bg-gray-800 rounded-lg text-white flex-grow border border-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter ticker e.g. AAPL"
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value.toUpperCase())}
                />
                <button
                    onClick={Analyze}
                    className="px-8 py-3 bg-white text-black rounded-lg font-bold hover:bg-gray-200 transition active:scale-95"
                >
                    {load ? "Analyzing..." : "Analyze"}
                </button>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {["1mo", "3mo", "6mo", "1y", "2y", "5y"].map((p) => (
                    <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition ${
                            period === p ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                        }`}
                    >
                        {p}
                    </button>
                ))}
            </div>
        </header>

        {load && (
            <div className="flex items-center gap-3 text-blue-400 animate-pulse">
                <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"/>
                <p className="font-medium">Crunching market data...</p>
            </div>
        )}

        {data && analysis && !analysis.error && (
            <section>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    <StatCard label="Price (IEX)" value={`$${data?.price?.toFixed(2)}`} sub="Delayed" />
                    <StatCard label="52W High" value={`$${data?.max_high?.toFixed(2)}`} />
                    <StatCard label="52W Low" value={`$${data?.max_low?.toFixed(2)}`} />
                    <StatCard label="RSI" value={analysis.rsi} color={analysis.rsi > 70 ? 'text-red-400' : analysis.rsi < 30 ? 'text-green-400' : ''} />
                    <StatCard label="MACD" value={analysis.macd} />
                    <StatCard label="50 Day SMA" value={`$${analysis.sma50.toFixed(2)}`} />
                    <StatCard label="Volatility" value={`${analysis.vola.toFixed(2)}%`} />
                    <StatCard label="Sharpe Ratio" value={analysis.sharpe.toFixed(2)} />
                    <StatCard label="Stock CAGR" value={`${analysis.stock_cagr.toFixed(2)}%`} />
                    <StatCard label="S&P 500 CAGR" value={`${analysis.spy_cagr.toFixed(2)}%`} />
                </div>
            </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {chartData && (
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                    <h2 className="text-lg font-bold mb-4">Price History: {ticker}</h2>
                    <div className="h-[300px] w-full">
                      
                      <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                                <XAxis dataKey="Date" hide />
                                <YAxis domain={["auto", "auto"]} tick={{fontSize: 12}} />
                                <Tooltip 
                                    formatter={(value: any) => [`$${Number(value).toFixed(2)}`, "Price"]}
                                    contentStyle={{ backgroundColor: "#1f2937", borderRadius: '8px', border: "none" }} 
                                />
                                <Line type="monotone" dataKey="Close" stroke="#3b82f6" dot={false} strokeWidth={2} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {sim && (
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                    <div className="flex flex-col sm:flex-row justify-between mb-4 gap-2">
                        <h2 className="text-lg font-bold">30-Day Projection</h2>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase font-bold text-blue-400 bg-blue-900/30 px-2 py-1 rounded">Monte Carlo</span>
                        </div>
                    </div>
                    {mlReturn !== null && (
    <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex-1 bg-blue-900/20 border border-blue-500/30 p-4 rounded-xl shadow-lg">
            <p className="text-blue-400 text-xs font-bold uppercase tracking-widest mb-1">
                Talos AI Bias (30D)
            </p>
            <div className="flex items-baseline gap-2">
                <p className={`text-3xl font-black ${mlReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {mlReturn >= 0 ? '↑' : '↓'} {(mlReturn * 100).toFixed(1)}%
                </p>
                <p className="text-gray-400 text-sm font-medium">Expected Return</p>
            </div>
        </div>

        <div className="flex-1 bg-gray-800/40 border border-gray-700 p-4 rounded-xl shadow-lg">
            <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-1">
                Model Confidence
            </p>
            <p className="text-2xl font-bold text-white">
                {mlReturn > 0.05 || mlReturn < -0.05 ? "High Conviction" : "Moderate Trend"}
            </p>
        </div>
    </div>
)}
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={sim}>
                                <XAxis dataKey="Date" hide />
                                <YAxis domain={["auto", "auto"]} orientation="right" tick={{fontSize: 12}} />
                                <Tooltip 
                                    formatter={(val: any) => [`$${Number(val).toFixed(2)}`, "Price"]}
                                    contentStyle={{ backgroundColor: "#111827", borderRadius: "8px", border: "1px solid #374151" }} 
                                />
                                <Area type="monotone" dataKey="p50" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={3} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="mt-6 p-4 bg-gray-950 rounded-lg border border-gray-800">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Target Price Probability</label>
                        <div className="flex items-center gap-4 mt-2">
                            <input
                                className="p-2 bg-gray-800 rounded text-white w-24 border border-gray-700"
                                type="number"
                                value={targetPrice || ''}
                                onChange={(e) => setTargetPrice(e.target.value)}
                                placeholder="Target $"
                            />
                            {prob !== null && (
                                <div className="flex flex-col">
                                    <span className="text-2xl font-black text-green-400">{(prob).toFixed(1)}%</span>
                                    <span className="text-[10px] text-gray-500 text-nowrap">Likelihood of hitting target</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    </div>
)


function StatCard({ label, value, sub, color = "text-white" }: any) {
    return (
        <div className="bg-gray-900 p-3 md:p-4 rounded-xl border border-gray-800 flex flex-col justify-center">
            <p className="text-gray-500 text-[10px] md:text-xs font-bold uppercase tracking-tight">{label}</p>
            <p className={`text-lg md:text-xl font-bold truncate ${color}`}>{value}</p>
            {sub && <p className="text-[10px] text-gray-600">{sub}</p>}
        </div>
    )
}}