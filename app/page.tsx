import Link from "next/link"

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
      <h1 className="text-5xl font-bold">Talos v2.0</h1>
      <p className="text-gray-400 mt-4"> A NextJS-powered stock analysis hub packing technical indicators, DCF valuation, Monte Carlo simulations, and AI commentary into one financial dashboard.</p>
      <Link href="/dashboard">
        <button className="mt-8 px-6 py-3 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition">
          Launch App
        </button>
      </Link>
    </main>
  )
}