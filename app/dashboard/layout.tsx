import React from "react"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-black text-white">
      <aside className="w-64 bg-gray-900 p-6 flex flex-col gap-4">
        <h2 className="text-xl font-bold mb-4">Talos v2.0</h2>
        <a href="/dashboard">🏠 Home</a>
        <a href="/dashboard/stocks">📈 Stock Analysis</a>
        <a href="/dashboard/portfolio">⚖️ Portfolio Optimizer</a>
        <a href="/dashboard/intrinsic">📊 Intrinsic Value</a>
        <a href="/dashboard/macro">🌐 Macro</a>
        <a href="/dashboard/options">📊 Options Chain</a>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}