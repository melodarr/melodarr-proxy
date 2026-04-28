"use client";

import { services } from "@/lib/services";
import { fetcher } from "@/lib/fetcher";
import useSWR from "swr";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricsChart } from "@/components/MetricsChart";
import { ControlPanel } from "@/components/ControlPanel";
import Link from "next/link";
import { ArrowLeft, Server, Activity, Database, Clock } from "lucide-react";
import { notFound } from "next/navigation";

export default function ServiceDetail({ params }: { params: { name: string } }) {
  const service = services.find(s => s.name === params.name);
  if (!service) return notFound();

  const { data: health, error: healthError } = useSWR(`${service.baseUrl}/api/health`, fetcher, { refreshInterval: 5000 });
  const { data: stats, error: statsError } = useSWR(`${service.baseUrl}/api/stats`, fetcher, { refreshInterval: 10000 });
  const { data: version } = useSWR(`${service.baseUrl}/api/version`, fetcher);
  const { data: history } = useSWR(`${service.baseUrl}/api/stats/history`, fetcher, { refreshInterval: 30000 });

  const isDown = healthError || (health && health.status !== "ok");
  const isDegraded = !isDown && (statsError || (stats && stats.errorRate > 5));
  const isLoading = !health && !healthError;
  const status = isLoading ? "loading" : isDown ? "down" : isDegraded ? "degraded" : "healthy";

  return (
    <main className="container mx-auto p-8 max-w-screen-2xl">
      <Link href="/dashboard" className="inline-flex items-center text-sm text-gray-400 hover:text-white mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
      </Link>
      
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">{service.name}</h1>
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <span className="flex items-center gap-1.5"><Server className="w-4 h-4" /> {service.baseUrl}</span>
            {version?.version && <span className="flex items-center gap-1.5">v{version.version}</span>}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        
        {/* Left Column: Overview & Controls */}
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-6">
            <h3 className="font-semibold text-lg mb-4">Overview</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-border/50">
                <span className="text-gray-400 text-sm flex items-center gap-2"><Clock className="w-4 h-4" /> Uptime</span>
                <span className="font-medium">{health?.uptime ? `${Math.floor(health.uptime / 60)}m` : '--'}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-border/50">
                <span className="text-gray-400 text-sm flex items-center gap-2"><Database className="w-4 h-4" /> Redis</span>
                <span className="font-medium">{health?.redis === 'connected' ? 'Connected' : 'Disconnected'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> Memory</span>
                <span className="font-medium">{health?.memoryUsage?.rss ? `${Math.round(health.memoryUsage.rss / 1024 / 1024)}MB` : '--'}</span>
              </div>
            </div>
          </div>

          {stats?.providers && Object.keys(stats.providers).length > 0 && (
            <div className="rounded-xl border bg-card p-6">
              <h3 className="font-semibold text-lg mb-4">Providers</h3>
              <div className="space-y-4">
                {Object.entries(stats.providers).map(([name, pStats]: [string, any]) => (
                  <div key={name} className="flex flex-col pb-3 border-b border-border/50">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-medium capitalize">{name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${pStats.errorRate > 0.5 ? 'bg-red-500/10 text-red-500' : pStats.errorRate > 0 ? 'bg-yellow-500/10 text-yellow-500' : 'bg-green-500/10 text-green-500'}`}>
                        {pStats.errorRate === 0 ? 'Healthy' : pStats.errorRate < 1 ? 'Degraded' : 'Failing'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-gray-400">
                      <span>{pStats.calls} calls</span>
                      <span>{pStats.avgLatencyMs}ms avg</span>
                      <span className="text-blue-400 font-medium">Score: {health?.providers?.[name] !== undefined ? `${health.providers[name]}/100` : '--'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <ControlPanel baseUrl={service.baseUrl} />
        </div>

        {/* Right Column: Charts */}
        <div className="lg:col-span-2 xl:col-span-3 space-y-6">
          <div className="rounded-xl border bg-card p-6">
            <h3 className="font-semibold text-lg mb-2">Requests per Minute</h3>
            <p className="text-sm text-gray-400 mb-4">Volume of traffic hitting the service.</p>
            {history ? <MetricsChart data={history} dataKey="rpm" color="#3b82f6" name="RPM" /> : <div className="h-[250px] flex items-center justify-center text-gray-500">Loading...</div>}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="rounded-xl border bg-card p-6">
              <h3 className="font-semibold text-lg mb-2">Latency (ms)</h3>
              <p className="text-sm text-gray-400 mb-4">Average response time.</p>
              {history ? <MetricsChart data={history} dataKey="latencyAvg" color="#10b981" name="Avg Latency" /> : <div className="h-[250px] flex items-center justify-center text-gray-500">Loading...</div>}
            </div>
            
            <div className="rounded-xl border bg-card p-6">
              <h3 className="font-semibold text-lg mb-2">Error Rate (%)</h3>
              <p className="text-sm text-gray-400 mb-4">Percentage of failed requests.</p>
              {history ? <MetricsChart data={history} dataKey="errorRate" color="#ef4444" name="Error Rate" /> : <div className="h-[250px] flex items-center justify-center text-gray-500">Loading...</div>}
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
