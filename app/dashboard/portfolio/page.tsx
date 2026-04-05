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
        <div>
            <h1 className="text-3xl font-bold">⚖️ Portfolio Optimizer</h1>
            {spin && <div className="mt-6 flex items-center gap-2 text-gray-400">
        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
        <p>Calculating optimal weights...</p>
    </div>}
            {<input
                className="mt-4 p-2 bg-gray-800 rounded text-white w-96"
                placeholder="Enter 2+ tickers e.g. AAPL, NVDA"
                value={tickers}
                onChange={(e) => setTickers(e.target.value)}
            />}<button
                onClick={Optimize}
                className="ml-4 px-4 py-2 bg-white text-black rounded font-semibold hover:bg-gray-200 transition">
                Optimize
              </button>
            {data && (
    <div className="mt-6 grid grid-cols-2 gap-6">
        <div className="bg-gray-900 p-4 rounded-lg">
            <h2 className="text-xl font-bold mb-4">⭐ Max Sharpe</h2>
            <p>Return: {(data.max_sharpe.return * 100).toFixed(2)}%</p>
            <p>Risk: {(data.max_sharpe.risk * 100).toFixed(2)}%</p>
            <p>Sharpe: {data.max_sharpe.sharpe.toFixed(2)}</p>
            <h3 className="mt-4 font-bold">Weights</h3>
            {Object.entries(data.max_sharpe.weights).map(([ticker, weight]: any) => (
                <p key={ticker}>{ticker}: {(weight * 100).toFixed(1)}%</p>
            ))}
            <ResponsiveContainer width="100%" height={200}>
  <PieChart>
    <Pie
      data={Object.entries(data.max_sharpe.weights).map(([name, value]) => ({ name, value }))}
      dataKey="value"
      cx="50%" cy="50%" outerRadius={60}
    >
      {Object.entries(data.max_sharpe.weights).map((entry, index) => (
        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
      ))}
    </Pie>
  </PieChart>
</ResponsiveContainer>
        </div>
        <div className="bg-gray-900 p-4 rounded-lg">
            <h2 className="text-xl font-bold mb-4">🛡️ Min Volatility</h2>
            <p>Return: {(data.min_vol.return * 100).toFixed(2)}%</p>
            <p>Risk: {(data.min_vol.risk * 100).toFixed(2)}%</p>
            <p>Sharpe: {data.min_vol.sharpe.toFixed(2)}</p>
            <h3 className="mt-4 font-bold">Weights</h3>
            {Object.entries(data.min_vol.weights).map(([ticker, weight]: any) => (
                <p key={ticker}>{ticker}: {(weight * 100).toFixed(1)}%</p>
            ))}
            <ResponsiveContainer width="100%" height={200}>
        <PieChart>
    <Pie
      data={Object.entries(data.min_vol.weights).map(([name, value]) => ({ name, value }))}
      dataKey="value"
      cx="50%" cy="50%" outerRadius={60}
    >
      {Object.entries(data.min_vol.weights).map((entry, index) => (
        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
      ))}
    </Pie>
  </PieChart>
</ResponsiveContainer>
  
        </div>

    </div>)}
    {error && <p className="mt-4 text-red-400">{error}</p>}
        
      </div>
)}
