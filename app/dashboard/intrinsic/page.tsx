'use client'
import { useState, useEffect } from "react"

export default function Intrinsic() {
  const [ticker, setTicker] = useState('AAPL')
  const [growthRate, setGrowthRate] = useState(8)
  const [discountRate, setDiscountRate] = useState(10)
  const [terminalGrowth, setTerminalGrowth] = useState(3)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

    async function Inter(ticker:string) {
        setLoading(true)
        const response = await fetch(`http://localhost:8000/intrinsic?ticker=${ticker}&growth_rate=${growthRate / 100}&discount_rate=${discountRate / 100}&terminal_growth=${terminalGrowth / 100}`)
        const json = await response.json()
        setData(json)
        setLoading(false)
        if (json.error) {
            setError(json.error)
            setLoading(false)
            return
        }
    }
       useEffect(() => {
    if (ticker && data) {
        Inter(ticker);
    }
}, [growthRate, discountRate, terminalGrowth]);
    
    return (
  <>
  <div className="max-w-6xl mx-auto px-6 py-8">
    <h1 className="text-3xl font-bold">📊 Intrinsic Value</h1>
    <div>
      {loading && (
        <div className="mt-6 flex items-center gap-2 text-gray-400">
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <p>Predicting The Unpredictable...</p>
        </div>
      )}

      {<div className="mt-4">
    <label className="text-gray-400 text-sm">FCF Growth Rate</label>
    <div className="flex items-center gap-4 mt-1">
        <input 
            type="range" 
            min="0" max="50" 
            value={growthRate} 
            onChange={(e) => setGrowthRate(Number(e.target.value))}
            className="w-48 accent-white"
        />
        <span className="font-bold">{growthRate}%</span>
    </div>
</div>}
    {<div className="mt-4">
    <label className="text-gray-400 text-sm">Discount Rate</label>
    <div className="flex items-center gap-4 mt-1">
        <input 
            type="range" 
            min="0" max="50" 
            value={discountRate} 
            onChange={(e) => setDiscountRate(Number(e.target.value))}
            className="w-48 accent-white"
        />
        <span className="font-bold">{discountRate}%</span>
    </div>
</div>
    }
    {<div className="mt-4">
    <label className="text-gray-400 text-sm">Terminal Growth Rate</label>
    <div className="flex items-center gap-4 mt-1">
        <input 
            type="range" 
            min="0" max="50" 
            value={terminalGrowth} 
            onChange={(e) => setTerminalGrowth(Number(e.target.value))}
            className="w-48 accent-white"
        />
        <span className="font-bold">{terminalGrowth}%</span>
    </div>
</div>
    }
    <input
    className="mt-4 p-2 bg-gray-800 rounded text-white"
    placeholder="Enter ticker e.g. AAPL"
    value={ticker}
    onChange={(e) => setTicker(e.target.value)}
/>
<button
    onClick={() => Inter(ticker)}
    className="ml-4 px-4 py-2 bg-white text-black rounded font-semibold hover:bg-gray-200 transition"
>
    Calculate
</button>
{data && (
    <div className="mt-6">
        <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-900 p-4 rounded-lg">
                <p className="text-gray-400 text-sm">Current Price</p>
                <p className="text-2xl font-bold">${data.current_price?.toFixed(2)}</p>
            </div>
            <div className="bg-gray-900 p-4 rounded-lg">
                <p className="text-gray-400 text-sm">Intrinsic Value</p>
                <p className="text-2xl font-bold">${data.intrinsic_value?.toFixed(2)}</p>
            </div>
            <div className="bg-gray-900 p-4 rounded-lg">
                <p className="text-gray-400 text-sm">Terminal Value</p>
                <p className="text-2xl font-bold">${data.terminal_value?.toFixed(2)}B</p>
            </div>
        </div>
        <div className={`mt-4 p-4 rounded-lg text-center text-xl font-bold ${
            data.intrinsic_value > data.current_price * 1.15 ? "bg-green-900 text-green-400" :
            data.intrinsic_value < data.current_price * 0.85 ? "bg-red-900 text-red-400" :
            "bg-yellow-900 text-yellow-400"
        }`}>
            {data.intrinsic_value > data.current_price * 1.15 ? "🟢 Undervalued" :
             data.intrinsic_value < data.current_price * 0.85 ? "🔴 Overvalued" :
             "🟡 Fairly Valued"}
        </div>
    </div>
)}
{error && <p className="mt-4 text-red-400">{error}</p>}
        
    </div>
    </div>
  </>
);




    




}