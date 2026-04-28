import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// This interface defines each row in our chart (one per day)
interface ChartDataPoint {
  day: number;
  [key: string]: number; // The "Index Signature" fixes the assignability error
}

interface MonteCarloChartProps {
  paths: number[][]; // This matches your backend output exactly
}

const MonteCarloChart: React.FC<MonteCarloChartProps> = ({ paths }) => {
  // 1. Safety Check: Ensure paths is a valid 2D array
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return <div className="text-gray-500 font-mono text-[10px] p-4 uppercase">Initializing Vectors...</div>;
  }

  // 2. Data Transformation (Pivot Logic)
  // We turn [[p1, p2], [p1, p2]] into [{day: 1, path0: p1, path1: p1}]
  const chartData: ChartDataPoint[] = paths[0].map((_, dayIndex) => {
    const point: ChartDataPoint = { day: dayIndex + 1 };
    
    // We only render 50 paths to keep the UI snappy
    paths.slice(0, 50).forEach((path, simIndex) => {
      point[`path${simIndex}`] = path[dayIndex];
    });
    
    return point;
  });

  return (
    <div className="w-full h-full bg-[#050505] p-4 rounded-xl border border-white/5 shadow-2xl">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-gray-500 font-mono text-[10px] uppercase tracking-[0.2em]">30D Risk Manifold</h3>
        <div className="flex gap-2">
           <span className="text-[9px] text-blue-400 font-bold px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">AGENTIC</span>
           <span className="text-[9px] text-gray-500 font-mono px-2 py-0.5">N=1,000</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, left: -35, bottom: 5 }}>
          <XAxis dataKey="day" hide />
          <YAxis domain={['auto', 'auto']} hide />
          
          <Tooltip 
            contentStyle={{ backgroundColor: '#000', border: '1px solid #222', fontSize: '10px', fontFamily: 'monospace' }}
            itemStyle={{ color: '#3b82f6' }}
            cursor={{ stroke: '#333', strokeWidth: 1 }}
          />

          {/* THE FAN: Render the 50 faint "probability" paths */}
          {paths.slice(0, 50).map((_, i) => (
            <Line
              key={i}
              type="monotone"
              dataKey={`path${i}`}
              stroke="#3b82f6"
              strokeWidth={0.5}
              strokeOpacity={0.07} // This creates the professional "cloud" look
              dot={false}
              isAnimationActive={false}
            />
          ))}

          {/* THE ANCHOR: A solid line for the median path */}
          <Line
            type="monotone"
            dataKey="path0"
            stroke="#3b82f6"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={true}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default MonteCarloChart;