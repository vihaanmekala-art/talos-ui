import React from 'react'
import Link from 'next/link'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-black text-white">
      <aside className="w-64 bg-gray-900 p-6 flex flex-col gap-4">
        <h2 className="text-xl font-bold mb-4">Talos v2.0</h2>
        <Link href="/dashboard">🏠 Home</Link>
        <Link href="/dashboard/stocks">📈 Stock Analysis</Link>
        <Link href="/dashboard/portfolio">⚖️ Portfolio Optimizer</Link>
        <Link href="/dashboard/macro">🌐 Macroeconomic Data</Link>
        <Link href="/dashboard/options">📊 Options Chain</Link>
      </aside>
      <main className="flex-1 p-8 pt-4">{children}</main>
    </div>
  )
}