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
    <div className="flex flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">AI Trade Auditor (Type Help For Help)</p>
          <p className="mt-0.5 font-mono text-xs text-zinc-400">{ticker}</p>
        </div>
        <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em] text-blue-400">
          QWEN3-32B BY GROQ
        </span>
      </div>

      {/* Textarea */}
      <div>
        <label className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
          Trade Thesis
        </label>
        <textarea
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-3 font-mono text-xs leading-relaxed text-zinc-100 outline-none transition placeholder:text-zinc-700 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600/50 resize-none"
          placeholder={`e.g., "Buying breakout at $150 with stop loss at $145. Target is $180 based on..."`}
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          rows={4}
        />
      </div>

      {/* Button */}
      <button
        onClick={handleAudit}
        disabled={loading || !thesis}
        className="flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-500 font-mono text-xs font-bold tracking-wide text-white transition hover:bg-blue-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? (
          <>
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"/>
            <span>ANALYZING…</span>
          </>
        ) : (
          "RUN AUDIT"
        )}
      </button>

      {/* Analysis Results */}
      {analysis && (
        <div className="space-y-4 border-t border-zinc-800 pt-5">
          {/* Risk Rating */}
          <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
              Risk Rating
            </span>
            <span className={`font-mono text-xl font-bold ${
              analysis.rating > 7 ? 'text-green-400' : analysis.rating > 4 ? 'text-amber-400' : 'text-red-400'
            }`}>
              {analysis.rating}<span className="text-sm text-zinc-600">/10</span>
            </span>
          </div>

          {/* Critique */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <p className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
              Analysis
            </p>
            <p className="font-mono text-xs leading-relaxed text-zinc-300">
              {analysis.critique}
            </p>
          </div>

          {/* Suggestion */}
          {analysis.suggestion && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-950/20 p-4">
              <div className="mb-1.5 flex items-center gap-2">
                <svg className="h-3 w-3 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-blue-400">
                  Strategist Suggestion
                </p>
              </div>
              <p className="font-mono text-xs leading-relaxed text-blue-200">
                {analysis.suggestion}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}