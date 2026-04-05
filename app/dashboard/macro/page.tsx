'use client'
import { useEffect, useState } from "react";

export default function Macro() {
  const [data, setData] = useState<any>(null)
  const [spinner, setSpinner] = useState(true)
  useEffect(() => {
    async function Load() {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const res = await fetch(`${API_BASE}/macro`)
      const json = await res.json()
      setData(json) 
      setSpinner(false)
    }
    Load();
  }, [])

    return (
        <div>
            <h1 className="text-3xl font-bold">🌐 Macroeconomic Data</h1>
            {spinner && (
                <div className="mt-6 flex items-center gap-2 text-gray-400">
        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
        <p>Loading macro data...</p>
    </div>
            )}
            {data && (<div className="mt-6 grid grid-cols-3 gap-4">
        <div className="bg-gray-900 p-4 rounded-lg">
            <p className="text-gray-400 text-sm">GDP Growth</p>
            <p className="text-2xl font-bold">{data.gdp_growth}%</p>
        </div>
        <div className="bg-gray-900 p-4 rounded-lg">
            <p className="text-gray-400 text-sm">Inflation (CPI)</p>
            <p className="text-2xl font-bold">{data.inflation}</p>
        </div>
        <div className="bg-gray-900 p-4 rounded-lg">
            <p className="text-gray-400 text-sm">Fed Funds Rate</p>
            <p className="text-2xl font-bold">{data.fed_funds}%</p>
        </div>
        <div className="bg-gray-900 p-4 rounded-lg">
            <p className="text-gray-400 text-sm">Unemployment</p>
            <p className="text-2xl font-bold">{data.unemployment}%</p>
        </div>
        <div className="bg-gray-900 p-4 rounded-lg">
            <p className="text-gray-400 text-sm">10Y Treasury Yield</p>
            <p className="text-2xl font-bold">{data.treasury_yield}%</p>
        </div>
        <div className="bg-gray-900 p-4 rounded-lg">
            <p className="text-gray-400 text-sm">S&P 500</p>
            <p className="text-2xl font-bold">${data.sp500}</p>
        </div>
    </div>
        )}
        </div>
    )
}