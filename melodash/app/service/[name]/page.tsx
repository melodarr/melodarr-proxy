"use client";

import { use } from "react";
import { services } from "@/lib/services";
import { fetcher } from "@/lib/fetcher";
import useSWR from "swr";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricsChart } from "@/components/MetricsChart";
import { ControlPanel } from "@/components/ControlPanel";
import Link from "next/link";
import { ArrowLeft, Server, Activity, Database, Clock } from "lucide-react";
import { notFound } from "next/navigation";
import { chartSamplesFromOverview, mergeTelemetry, telemetryFromOverview, telemetryFromStats } from "@/lib/telemetry";

export default function ServiceDetail({ params }: { params: Promise<{ name: string }> }) {
 const { name } = use(params);
 const service = services.find(s => s.name === name);
 if (!service) return notFound();

 const { data: liveness, error: healthError } = useSWR("/api/health", fetcher, { refreshInterval: 5000 });
 const { data: readiness } = useSWR("/api/ready", fetcher, { refreshInterval: 5000 });
 const { data: stats } = useSWR("/api/stats", fetcher, { refreshInterval: 10000 });
 const { data: overview } = useSWR("/debug/overview", fetcher, { refreshInterval: 5000 });
 const { data: version } = useSWR("/api/version", fetcher);
 const health = readiness ?? liveness;

 const isUnreachable = Boolean(healthError);
 const isDown = !isUnreachable && health && health.proxy && health.proxy !== "running";
 const isDegraded = !isDown && !isUnreachable && health && (health.cache === "degraded" || health.memory?.status === "warning");
 const isLoading = !health && !healthError;
 const status = isUnreachable ? "down" : isLoading ? "loading" : isDown ? "down" : isDegraded ? "degraded" : "healthy";
 const healthErrorMessage = healthError instanceof Error ? healthError.message : null;
 const versionLabel = version?.version ?? health?.version;
 const providerStats = stats?.providers && typeof stats.providers === "object" ? stats.providers : {};
 const telemetry = mergeTelemetry(telemetryFromStats(stats), telemetryFromOverview(overview));
 const chartData = chartSamplesFromOverview(overview);
 const rpm = telemetry.rpm ?? "--";
 const latency = telemetry.latencyAvgMs === undefined ? "--" : `${telemetry.latencyAvgMs}ms`;
 const errorRate = telemetry.errorRatePercent === undefined ? "--" : `${telemetry.errorRatePercent}%`;

 return (
 <main className="container mx-auto p-8 max-w-screen-2xl">
 <Link href="/dashboard" className="inline-flex items-center text-sm text-secondary hover:text-black dark:hover:text-white mb-6 transition-colors">
 <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
 </Link>
 
 <div className="flex items-start justify-between mb-8">
 <div>
 <h1 className="text-3xl font-bold tracking-tight mb-2">{service.name}</h1>
 <div className="flex items-center gap-4 text-sm text-secondary">
 <span className="flex items-center gap-1.5"><Server className="w-4 h-4" /> {service.name}</span>
 {versionLabel && <span className="flex items-center gap-1.5">v{versionLabel}</span>}
 {health?.instanceId && <span className="text-xs text-muted">· {health.instanceId}</span>}
 </div>
 {isUnreachable && (
 <div className="mt-3 inline-flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
 <span className="font-medium">Proxy unreachable.</span>
 {healthErrorMessage && (
 <span className="text-red-700 dark:text-red-300/80">{healthErrorMessage}</span>
 )}
 </div>
 )}
 </div>
 <StatusBadge status={status} />
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6">
 
 {/* Left Column: Overview & Controls */}
 <div className="space-y-6">
 <div className="rounded-xl border bg-card p-6">
 <h3 className="font-semibold text-lg mb-4">Overview</h3>
 <div className="space-y-4">
 <div className="flex justify-between items-center pb-3 border-b border-border">
 <span className="text-secondary text-sm flex items-center gap-2"><Clock className="w-4 h-4" /> Uptime</span>
 <span className="font-medium">{health?.uptime ? `${Math.floor(health.uptime / 60)}m` : '--'}</span>
 </div>
 <div className="flex justify-between items-center pb-3 border-b border-border">
 <span className="text-secondary text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> Requests/min</span>
 <span className="font-medium">{rpm}</span>
 </div>
 <div className="flex justify-between items-center pb-3 border-b border-border">
 <span className="text-secondary text-sm flex items-center gap-2"><Clock className="w-4 h-4" /> Latency</span>
 <span className="font-medium">{latency}</span>
 </div>
 <div className="flex justify-between items-center pb-3 border-b border-border">
 <span className="text-secondary text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> Error rate</span>
 <span className="font-medium">{errorRate}</span>
 </div>
 <div className="flex justify-between items-center pb-3 border-b border-border">
 <span className="text-secondary text-sm flex items-center gap-2"><Database className="w-4 h-4" /> Redis</span>
 <span className="font-medium">{health?.redisConnected ? 'Connected' : 'Disconnected'}</span>
 </div>
 <div className="flex justify-between items-center pb-3 border-b border-border">
 <span className="text-secondary text-sm flex items-center gap-2"><Server className="w-4 h-4" /> Upstream</span>
 <span className={`font-medium ${health?.upstream === 'reachable' ? 'text-emerald-700 dark:text-emerald-400' : 'text-orange-700 dark:text-orange-300'}`}>
 {health?.upstream === 'reachable' ? 'Reachable' : 'Unreachable'}
 </span>
 </div>
 <div className="flex justify-between items-center">
 <span className="text-secondary text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> Memory</span>
 <span className="font-medium">{health?.memory?.usageMb ? `${health.memory.usageMb}MB` : '--'}</span>
 </div>
 </div>
 </div>

 {Object.keys(providerStats).length > 0 && (
 <div className="rounded-xl border bg-card p-6">
 <h3 className="font-semibold text-lg mb-4">Providers</h3>
 <div className="space-y-4">
 {Object.entries(providerStats).map(([name, pStats]: [string, any]) => (
 <div key={name} className="flex flex-col pb-3 border-b border-border">
 <div className="flex justify-between items-center mb-1">
 <span className="font-medium capitalize">{name}</span>
 <span className={`text-xs px-2 py-0.5 rounded-full ${pStats.errorRate > 0.5 ? 'bg-red-500/10 text-red-600 dark:text-red-500' : pStats.errorRate > 0 ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-500' : 'bg-green-500/10 text-green-500'}`}>
 {pStats.errorRate === 0 ? 'Healthy' : pStats.errorRate < 1 ? 'Degraded' : 'Failing'}
 </span>
 </div>
 <div className="flex justify-between items-center text-xs text-secondary">
 <span>{pStats.calls} calls</span>
 <span>{pStats.avgLatencyMs}ms avg</span>
 <span className="text-blue-700 dark:text-blue-400 font-medium">Score: {health?.providers?.[name] !== undefined ? `${health.providers[name]}/100` : '--'}</span>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}

 <ControlPanel />
 </div>

 {/* Right Column: Charts */}
 <div className="lg:col-span-2 xl:col-span-3 space-y-6">
 <div className="rounded-xl border bg-card p-6">
 <h3 className="font-semibold text-lg mb-2">Requests per Minute</h3>
 <p className="text-sm text-secondary mb-4">Volume of traffic hitting the service.</p>
 <MetricsChart data={chartData} dataKey="rpm" color="#3b82f6" name="RPM" />
 </div>

 <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
 <div className="rounded-xl border bg-card p-6">
 <h3 className="font-semibold text-lg mb-2">Latency (ms)</h3>
 <p className="text-sm text-secondary mb-4">Average response time.</p>
 <MetricsChart data={chartData} dataKey="latencyAvg" color="#10b981" name="Avg Latency" />
 </div>
 
 <div className="rounded-xl border bg-card p-6">
 <h3 className="font-semibold text-lg mb-2">Error Rate (%)</h3>
 <p className="text-sm text-secondary mb-4">Percentage of failed requests.</p>
 <MetricsChart data={chartData} dataKey="errorRate" color="#ef4444" name="Error Rate" />
 </div>
 </div>
 </div>

 </div>
 </main>
 );
}
