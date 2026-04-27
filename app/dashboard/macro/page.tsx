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
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold text-white">🌐 Macroeconomic Data</h1>
      
      {spinner && (
        <div className="mt-6 flex items-center gap-2 text-gray-400">
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
          <p>Loading macro data...</p>
        </div>
      )}

      {data && (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <MacroCard label="GDP Growth" value={`${data.gdp_growth}%`} />
          <MacroCard label="Inflation (CPI)" value={data.inflation} />
          <MacroCard label="Fed Funds Rate" value={`${data.fed_funds}%`} />
          <MacroCard label="Unemployment" value={`${data.unemployment}%`} />
          <MacroCard label="10Y Treasury Yield" value={`${data.treasury_yield}%`} />

        </div>
      )}
    </div>
  )
}


function MacroCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 p-5 rounded-xl border border-gray-800 hover:border-gray-700 transition">
      <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
    </div>
  )
}