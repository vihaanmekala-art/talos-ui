'use client'
import { useState } from "react"

export default function TradeJournal({ ticker }: { ticker: string }) {
  const [thesis, setThesis] = useState("")
  const [analysis, setAnalysis] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  async function handleAudit() {
    if (!thesis) return
    setLoading(true)
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const res = await fetch(`${API_BASE}/journal/review?ticker=${ticker}&thesis=${encodeURIComponent(thesis)}`, {
        method: 'POST',
      })
      const data = await res.json()
      setAnalysis(data)
    } catch (err) {
      console.error("Audit failed", err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 bg-gray-900/40 p-5 rounded-2xl border border-white/5 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white uppercase tracking-tighter">AI Trade Auditor</h3>
        <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-mono">Llama-3.3-70B</span>
      </div>

      <textarea
        className="w-full h-28 bg-black/40 border border-white/5 rounded-xl p-3 text-sm text-gray-300 placeholder:text-gray-600 focus:ring-1 focus:ring-blue-500/30 outline-none resize-none transition"
        placeholder={`Thesis for ${ticker}... (e.g., "Buying breakout at $150, stop loss at $145")`}
        value={thesis}
        onChange={(e) => setThesis(e.target.value)}
      />

      <button
        onClick={handleAudit}
        disabled={loading || !thesis}
        className="w-full py-2.5 bg-white text-black text-xs font-bold rounded-lg hover:bg-gray-200 disabled:opacity-30 transition-all flex items-center justify-center gap-2"
      >
        {loading ? <div className="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin"/> : "RUN AUDIT"}
      </button>

      {analysis && (
        <div className="mt-2 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center justify-between border-t border-white/5 pt-3">
            <span className="text-[10px] text-gray-500 uppercase font-bold">Risk Rating</span>
            <span className={`text-sm font-bold ${analysis.rating > 7 ? 'text-emerald-400' : 'text-orange-400'}`}>
              {analysis.rating}/10
            </span>
          </div>
          <p className="text-xs leading-relaxed text-gray-400 italic">"{analysis.critique}"</p>
          <div className="bg-blue-500/5 p-3 rounded-lg border border-blue-500/10">
            <p className="text-[9px] text-blue-400 font-bold uppercase mb-1">Strategist Suggestion</p>
            <p className="text-xs text-blue-200">{analysis.suggestion || "No specific adjustment needed."}</p>
          </div>
        </div>
      )}
    </div>
  )
}