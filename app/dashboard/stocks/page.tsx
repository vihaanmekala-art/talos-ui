"use client"
import { useState } from "react"

export default function Stocks() {
    const [ticker, setTicker] = useState('')
    const [data, setData] = useState<any>(null)
    async function Analyze() {
        const res = await fetch(`http://localhost:8000/stock/${ticker}`)
        const json = await res.json()
        setData(json)
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
      {data && (
        <div className="mt-6 flex flex-col gap-2">
          <p>Price: ${data.price}</p>
          <p>Market Cap: ${data.market_cap}</p>
          <p>P/E Ratio: {data.pe_ratio}</p>
        </div>
      )}
    </div>
  )
}