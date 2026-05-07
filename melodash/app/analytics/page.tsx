"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { Activity, AlertTriangle, Clock, Database, Gauge, Radio } from "lucide-react";

type Overview = {
 health?: {
 status?: string;
 proxy?: string;
 upstream?: string;
 uptime?: number;
 redisConnected?: boolean;
 };
 cache?: {
 status?: { redis?: string; fallback?: string };
 stats?: { hits?: number; misses?: number; hitRate?: string; fallbackMapSize?: number };
 };
 requests?: Array<{ id?: string; query?: string; totalTime?: number; timestamp?: string }>;
 performance?: {
 avgLatencyPerQuery?: Record<string, number>;
 avgLatencyPerProvider?: Record<string, number>;
 slowestQueries?: Array<{ query: string; time: number; timestamp?: string }>;
 };
};

function metric(value: string | number | undefined) {
 return value ?? "--";
}

function StatCard({ title, value, note, icon }: { title: string; value: string | number; note: string; icon: React.ReactNode }) {
 return (
 <div className="rounded-lg border border-border bg-card p-5">
 <div className="flex items-start justify-between gap-4">
 <div>
 <p className="text-sm text-secondary">{title}</p>
 <p className="mt-2 text-2xl font-semibold">{value}</p>
 </div>
 <div className="rounded-md bg-blue-500/10 p-2 text-blue-700 dark:text-blue-400">{icon}</div>
 </div>
 <p className="mt-4 text-xs leading-5 text-muted">{note}</p>
 </div>
 );
}

function LatencyTable({ title, values }: { title: string; values: Record<string, number> }) {
 const rows = Object.entries(values).sort((a, b) => b[1] - a[1]);

 return (
 <section className="rounded-lg border border-border bg-card p-6">
 <h2 className="text-lg font-semibold">{title}</h2>
 <div className="mt-5 space-y-3">
 {rows.length === 0 ? (
 <p className="text-sm text-muted">No samples yet.</p>
 ) : rows.map(([name, value]) => (
 <div key={name} className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-b-0">
 <span className="truncate text-sm text-primary">{name}</span>
 <span className="font-mono text-sm text-secondary">{Math.round(value)}ms</span>
 </div>
 ))}
 </div>
 </section>
 );
}

export default function AnalyticsPage() {
 const { data, error, isLoading } = useSWR<Overview>("/debug/overview", fetcher, {
 refreshInterval: 5000,
 });

 const requests = data?.requests ?? [];
 const slowest = data?.performance?.slowestQueries ?? [];
 const cacheStats = data?.cache?.stats;
 const proxyRunning = data?.health?.proxy === "running" || data?.health?.status === "ok";

 return (
 <main className="container mx-auto max-w-screen-2xl space-y-8 p-8">
 <div>
 <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
 <p className="mt-2 text-secondary">Live proxy metrics based on debug traces and cache state.</p>
 </div>

 {error && (
 <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
 {error.message}
 </div>
 )}

 <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
 <StatCard title="Proxy State" value={isLoading ? "--" : proxyRunning ? "Running" : "Stopped"} note={`Upstream ${data?.health?.upstream ?? "--"}`} icon={<Radio className="h-5 w-5" />} />
 <StatCard title="Trace Count" value={requests.length} note="Recent requests retained for debugging." icon={<Activity className="h-5 w-5" />} />
 <StatCard title="Cache Hit Rate" value={metric(cacheStats?.hitRate)} note={`${cacheStats?.hits ?? 0} hits / ${cacheStats?.misses ?? 0} misses`} icon={<Database className="h-5 w-5" />} />
 <StatCard title="Slowest Query" value={slowest[0] ? `${Math.round(slowest[0].time)}ms` : "--"} note={slowest[0]?.query ?? "No request traces yet."} icon={<Clock className="h-5 w-5" />} />
 </section>

 <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
 <LatencyTable title="Provider Latency" values={data?.performance?.avgLatencyPerProvider ?? {}} />
 <LatencyTable title="Query Latency" values={data?.performance?.avgLatencyPerQuery ?? {}} />
 </section>

 <section className="rounded-lg border border-border bg-card p-6">
 <div className="flex items-center justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold">Slow Requests</h2>
 <p className="mt-1 text-sm text-muted">Highest latency traces observed by the proxy.</p>
 </div>
 <Gauge className="h-5 w-5 text-blue-700 dark:text-blue-400" />
 </div>
 <div className="mt-5 space-y-3">
 {slowest.length === 0 ? (
 <p className="text-sm text-muted">No request traces yet.</p>
 ) : slowest.map((item) => (
 <div key={`${item.query}-${item.timestamp}`} className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-b-0">
 <span className="truncate text-sm text-primary">{item.query}</span>
 <span className="font-mono text-sm text-orange-700 dark:text-orange-300">{Math.round(item.time)}ms</span>
 </div>
 ))}
 </div>
 </section>
 </main>
 );
}
