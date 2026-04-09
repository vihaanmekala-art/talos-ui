"use client"
import { useState } from "react"
import { PieChart, ResponsiveContainer, Cell, Pie } from "recharts"

export default function Portfolio() {
    const [tickers, setTickers] = useState("")
    const [data, setData] = useState<any>(null)
    const [spin, setSpin] = useState<any>(false)
    const [error, setError] = useState<string | null>(null)
    const COLORS = ["#ffffff", "#9ca3af", "#4b5563", "#1f2937"];

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
    <div className="p-4 max-w-6xl mx-auto"> {/* Added padding and max-width for large screens */}
        <h1 className="text-2xl md:text-3xl font-bold text-white">⚖️ Portfolio Optimizer</h1>

        {/* Input Group: Stacked on mobile, row on desktop */}
        <div className="mt-6 flex flex-col md:flex-row gap-3">
            <input
                className="p-2 bg-gray-800 rounded text-white w-full md:w-96 border border-gray-700 focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Enter 2+ tickers e.g. AAPL, NVDA"
                value={tickers}
                onChange={(e) => setTickers(e.target.value)}
            />
            <button
                onClick={Optimize}
                className="px-6 py-2 bg-white text-black rounded font-semibold hover:bg-gray-200 transition active:scale-95"
            >
                {spin ? "Optimizing..." : "Optimize"}
            </button>
        </div>

        {spin && (
            <div className="mt-6 flex items-center gap-2 text-gray-400">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <p>Calculating optimal weights...</p>
            </div>
        )}

        {error && <p className="mt-4 text-red-400 bg-red-400/10 p-2 rounded">{error}</p>}

        {data && (
            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                
                <div className="bg-gray-900 p-6 rounded-xl border border-gray-800">
                    <h2 className="text-xl font-bold mb-4 text-blue-400">⭐ Max Sharpe</h2>
                    <div className="space-y-1 text-gray-300">
                        <p>Return: <span className="text-white font-mono">{(data.max_sharpe.return * 100).toFixed(2)}%</span></p>
                        <p>Risk: <span className="text-white font-mono">{(data.max_sharpe.risk * 100).toFixed(2)}%</span></p>
                        <p>Sharpe: <span className="text-white font-mono">{data.max_sharpe.sharpe.toFixed(2)}</span></p>
                    </div>
                    
                    <h3 className="mt-6 mb-2 font-bold text-sm uppercase tracking-wider text-gray-500">Weights</h3>
                    <div className="grid grid-cols-2 gap-2">
                        {Object.entries(data.max_sharpe.weights).map(([ticker, weight]: any) => (
                            <p key={ticker} className="text-sm">{ticker}: <span className="font-bold">{(weight * 100).toFixed(1)}%</span></p>
                        ))}
                    </div>

                    <div className="h-[200px] mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={Object.entries(data.max_sharpe.weights).map(([name, value]) => ({ name, value }))}
                                    dataKey="value"
                                    cx="50%" cy="50%" outerRadius={60}
                                    stroke="none"
                                >
                                    {Object.entries(data.max_sharpe.weights).map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Min Volatility Card */}
                <div className="bg-gray-900 p-6 rounded-xl border border-gray-800">
                    <h2 className="text-xl font-bold mb-4 text-green-400">🛡️ Min Volatility</h2>
                    <div className="space-y-1 text-gray-300">
                        <p>Return: <span className="text-white font-mono">{(data.min_vol.return * 100).toFixed(2)}%</span></p>
                        <p>Risk: <span className="text-white font-mono">{(data.min_vol.risk * 100).toFixed(2)}%</span></p>
                        <p>Sharpe: <span className="text-white font-mono">{data.min_vol.sharpe.toFixed(2)}</span></p>
                    </div>

                    <h3 className="mt-6 mb-2 font-bold text-sm uppercase tracking-wider text-gray-500">Weights</h3>
                    <div className="grid grid-cols-2 gap-2">
                        {Object.entries(data.min_vol.weights).map(([ticker, weight]: any) => (
                            <p key={ticker} className="text-sm">{ticker}: <span className="font-bold">{(weight * 100).toFixed(1)}%</span></p>
                        ))}
                    </div>

                    <div className="h-[200px] mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={Object.entries(data.min_vol.weights).map(([name, value]) => ({ name, value }))}
                                    dataKey="value"
                                    cx="50%" cy="50%" outerRadius={60}
                                    stroke="none"
                                >
                                    {Object.entries(data.min_vol.weights).map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        )}
    </div>
)}