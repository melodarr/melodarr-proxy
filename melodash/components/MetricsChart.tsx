"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface MetricsChartProps {
 data: unknown;
 dataKey: string;
 color: string;
 name: string;
}

export function MetricsChart({ data, dataKey, color, name }: MetricsChartProps) {
 const chartData = Array.isArray(data) ? data : [];

 if (chartData.length === 0) {
 return (
 <div className="h-[250px] w-full mt-4 flex items-center justify-center rounded-md border border-border bg-page text-sm text-muted">
 No telemetry samples yet.
 </div>
 );
 }

 return (
 <div className="h-[250px] w-full mt-4">
 <ResponsiveContainer width="100%" height="100%">
 <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
 <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
 <XAxis 
 dataKey="timestamp" 
 stroke="#888" 
 fontSize={12} 
 tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 
 />
 <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
 <Tooltip 
 contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px' }}
 itemStyle={{ color: '#fff' }}
 labelStyle={{ color: '#888', marginBottom: '4px' }}
 labelFormatter={(val) => new Date(val).toLocaleTimeString()}
 />
 <Line 
 type="monotone" 
 dataKey={dataKey} 
 name={name}
 stroke={color} 
 strokeWidth={2} 
 dot={false}
 activeDot={{ r: 4 }}
 />
 </LineChart>
 </ResponsiveContainer>
 </div>
 );
}
