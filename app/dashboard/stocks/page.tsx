"use client"
import { useState } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"

export default function Stocks() {
    const [ticker, setTicker] = useState('')
    const [data, setData] = useState<any>(null)
    const [chartData, setChartData] = useState<any>(null)
    const [period, setPeriod] = useState<any>('1y')

    async function Analyze() {
        const res = await fetch(`http://localhost:8000/stock/${ticker}`)
        const json = await res.json()
        setData(json)

        const histRes = await fetch(`http://localhost:8000/stock/${ticker}/history`)
        const histJson = await histRes.json()
        setChartData(histJson)
    }

    return (
        <div>
            <h1 className="text-3xl font-bold">📈 Stock Analysis</h1>
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
            {data && (
                <div className="mt-6 grid grid-cols-3 gap-4">
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">Price</p>
                        <p className="text-2xl font-bold">${data.price}</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">Market Cap</p>
                        <p className="text-2xl font-bold">${(data.market_cap / 1e9).toFixed(2)}B</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">P/E Ratio</p>
                        <p className="text-2xl font-bold">{data.pe_ratio}</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">Forward P/E</p>
                        <p className="text-2xl font-bold">{data.forward_pe}</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">Dividend Yield</p>
                        <p className="text-2xl font-bold">{data.dividend_yield}</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">Debt to Equity</p>
                        <p className="text-2xl font-bold">{data.debt_to_equity}</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">52 Week High</p>
                        <p className="text-2xl font-bold">${data.fifty_two_week_high}</p>
                    </div>
                    <div className="bg-gray-900 p-4 rounded-lg">
                        <p className="text-gray-400 text-sm">52 Week Low</p>
                        <p className="text-2xl font-bold">${data.fifty_two_week_low}</p>
                    </div>
                </div>
            )}
            {chartData && (
  <div className="mt-8 bg-gray-900 p-4 rounded-lg">
    <h2 className="text-xl font-bold mb-4">Price History</h2>
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData}>
        <XAxis dataKey="Date" hide />
        <YAxis domain={["auto", "auto"]} />
        <Tooltip formatter={(value: any) => [`$${Number(value).toFixed(2)}`, "Price"]}
  contentStyle={{ backgroundColor: "#1f2937", border: "none", color: "#ffffff" }} />
        <Line type="monotone" dataKey="Close" stroke="#ffffff" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>
)}
        </div>
    )
}