"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export function ProviderStatsChart({ providers }: { providers: Record<string, any> }) {
  if (!providers || Object.keys(providers).length === 0) {
    return <div className="text-sm text-gray-500 py-4 h-[250px] flex items-center justify-center">No provider data available.</div>;
  }

  const data = Object.entries(providers).map(([name, stats]) => ({
    name,
    latency: stats.avgLatencyMs,
    successRate: Number(((1 - stats.errorRate) * 100).toFixed(1)),
    calls: stats.calls
  })).sort((a, b) => b.calls - a.calls);

  return (
    <div className="h-[250px] w-full mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
          <XAxis dataKey="name" stroke="#888" fontSize={12} tickLine={false} />
          <YAxis yAxisId="left" orientation="left" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis yAxisId="right" orientation="right" stroke="#888" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px' }}
            itemStyle={{ color: '#fff' }}
            labelStyle={{ color: '#888', marginBottom: '4px', textTransform: 'capitalize' }}
          />
          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
          <Bar yAxisId="left" dataKey="latency" name="Latency (ms)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          <Bar yAxisId="right" dataKey="successRate" name="Success Rate (%)" fill="#10b981" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
