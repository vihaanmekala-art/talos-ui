"use client"

import React, { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { TooltipProps } from 'recharts'

interface ChartDataPoint {
  day: number
  [key: string]: number
}

interface MonteCarloChartProps {
  paths: number[][]
}

interface CustomTooltipProps extends TooltipProps<number, string> {
  active?: boolean
  payload?: Array<{
    value: number
    dataKey: string
    color: string
    payload: ChartDataPoint
  }>
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null

  const values = payload.map(p => p.value).filter(v => typeof v === 'number' && Number.isFinite(v))
  
  if (values.length === 0) return null

  const avg = values.reduce((sum, val) => sum + val, 0) / values.length
  const min = Math.min(...values)
  const max = Math.max(...values)

  return (
    <div className="rounded-lg border border-zinc-800 bg-black/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600 mb-1">
        Day {payload[0]?.payload?.day ?? '—'}
      </p>
      <div className="space-y-0.5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[9px] text-zinc-500">Avg</span>
          <span className="font-mono text-xs font-semibold text-blue-400">
            ${avg.toFixed(2)}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[9px] text-zinc-500">Range</span>
          <span className="font-mono text-[9px] text-zinc-400">
            ${min.toFixed(2)} – ${max.toFixed(2)}
          </span>
        </div>
        <div className="mt-1 pt-1 border-t border-zinc-800">
          <span className="font-mono text-[8px] text-zinc-700">
            {values.length} paths
          </span>
        </div>
      </div>
    </div>
  )
}

const MonteCarloChart: React.FC<MonteCarloChartProps> = ({ paths }) => {
  const chartData = useMemo(() => {
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return null
    }

    // Validate that we have at least one path with data
    const validPaths = paths.filter(path => Array.isArray(path) && path.length > 0)
    if (validPaths.length === 0) {
      return null
    }

    const numDays = validPaths[0].length
    const maxRenderPaths = 50

    // Pivot the data structure: from paths[simIndex][dayIndex] to chartData[dayIndex][pathKey]
    return Array.from({ length: numDays }, (_, dayIndex) => {
      const point: ChartDataPoint = { day: dayIndex + 1 }

      validPaths.slice(0, maxRenderPaths).forEach((path, simIndex) => {
        const value = path[dayIndex]
        if (typeof value === 'number' && Number.isFinite(value)) {
          point[`path${simIndex}`] = value
        }
      })

      return point
    })
  }, [paths])

  if (!chartData) {
    return (
      <div className="flex h-[280px] w-full items-center justify-center rounded-xl border border-white/5 bg-[#050505] p-4">
        <div className="text-center">
          <div className="mb-2 flex h-8 w-8 mx-auto items-center justify-center rounded-full border border-zinc-800 bg-zinc-900">
            <svg className="h-4 w-4 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-700">
            Initializing vectors
          </p>
        </div>
      </div>
    )
  }

  const pathKeys = Object.keys(chartData[0]).filter(key => key.startsWith('path'))
  const numPaths = pathKeys.length

  return (
    <div className="relative w-full rounded-xl border border-white/5 bg-[#050505] p-4 shadow-2xl">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded border border-blue-500/30 bg-blue-500/10">
            <svg className="h-3 w-3 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            30D Risk Manifold
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 font-mono text-[9px] font-bold text-blue-400">
            AGENTIC
          </span>
          <span className="font-mono text-[9px] text-zinc-600">
            N={paths.length.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, left: -35, bottom: 5 }}>
          <XAxis 
            dataKey="day" 
            hide 
          />
          <YAxis 
            domain={['auto', 'auto']} 
            hide 
          />
          <Tooltip 
            content={<CustomTooltip />}
            cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeOpacity: 0.2, strokeDasharray: '4 4' }}
          />

          {/* Render faint probability paths (the "fan") */}
          {pathKeys.map((pathKey, index) => (
            <Line
              key={pathKey}
              type="monotone"
              dataKey={pathKey}
              stroke="#3b82f6"
              strokeWidth={0.5}
              strokeOpacity={index === 0 ? 0.3 : 0.07} // First path slightly more visible
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}

          {/* Anchor line (median/representative path) */}
          <Line
            type="monotone"
            dataKey="path0"
            stroke="#3b82f6"
            strokeWidth={2}
            strokeOpacity={1}
            dot={false}
            isAnimationActive={true}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Footer info */}
      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="h-px w-3 bg-blue-500" />
            <span className="font-mono text-[9px] text-zinc-600">Median path</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-px w-3 bg-blue-500 opacity-20" />
            <span className="font-mono text-[9px] text-zinc-600">Simulated paths ({numPaths})</span>
          </div>
        </div>
        <span className="font-mono text-[8px] text-zinc-700">
          {chartData.length}d projection
        </span>
      </div>
    </div>
  )
}

export default MonteCarloChart