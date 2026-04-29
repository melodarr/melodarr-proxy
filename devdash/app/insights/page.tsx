"use client";

import useSWR from "swr";
import type { ReactNode } from "react";
import { fetcher } from "@/lib/fetcher";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Gauge,
  Radio,
  Server,
} from "lucide-react";

type Alert = {
  type: string;
  message: string;
  traceId?: string;
  timestamp?: string;
};

type SlowQuery = {
  id?: string;
  query: string;
  time: number;
  timestamp?: string;
};

type Overview = {
  health?: {
    status?: string;
    proxy?: string;
    upstream?: string;
    uptime?: number;
    instanceId?: string;
    redisConnected?: boolean;
    cache?: string;
    mode?: string;
  };
  performance?: {
    avgLatencyPerQuery?: Record<string, number>;
    avgLatencyPerProvider?: Record<string, number>;
    slowestQueries?: SlowQuery[];
  };
  providers?: {
    providers?: Array<{ name: string; status: string }>;
  };
  cache?: {
    health?: string;
    status?: {
      redis?: string;
      fallback?: string;
    };
    isReady?: boolean;
    redisConnected?: boolean;
    stats?: {
      hits?: number;
      misses?: number;
      hitRate?: string;
      fallbackMapSize?: number;
    };
  };
  requests?: SlowQuery[];
};

type AlertsPayload = {
  alerts?: Alert[];
};

function formatMs(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return `${Math.round(value)}ms`;
}

function formatUptime(seconds?: number) {
  if (typeof seconds !== "number") return "--";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTimestamp(value?: string) {
  if (!value) return "No timestamp";
  return value.replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function StatTile({
  title,
  value,
  detail,
  icon,
  tone = "blue",
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
  tone?: "blue" | "green" | "orange" | "red";
}) {
  const tones = {
    blue: "bg-blue-500/10 text-blue-400",
    green: "bg-emerald-500/10 text-emerald-400",
    orange: "bg-orange-500/10 text-orange-400",
    red: "bg-red-500/10 text-red-400",
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-gray-400">{title}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
        </div>
        <div className={`rounded-md p-2 ${tones[tone]}`}>{icon}</div>
      </div>
      <p className="mt-4 text-xs leading-5 text-gray-500">{detail}</p>
    </div>
  );
}

function LatencyList({ data }: { data: Record<string, number> }) {
  const rows = Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const max = Math.max(...rows.map(([, value]) => value), 1);

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">No latency samples yet.</p>;
  }

  return (
    <div className="space-y-4">
      {rows.map(([name, value]) => (
        <div key={name}>
          <div className="mb-1 flex items-center justify-between gap-4 text-sm">
            <span className="truncate text-gray-300">{name}</span>
            <span className="font-mono text-gray-400">{formatMs(value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-blue-500"
              style={{ width: `${Math.max(6, Math.round((value / max) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function InsightsPage() {
  const { data, error, isLoading } = useSWR<Overview>("/debug/overview", fetcher, {
    refreshInterval: 5000,
  });
  const { data: alertsData } = useSWR<AlertsPayload>("/debug/alerts", fetcher, {
    refreshInterval: 5000,
  });

  const alerts = alertsData?.alerts ?? [];
  const slowestQueries = data?.performance?.slowestQueries ?? [];
  const providers = data?.providers?.providers ?? [];
  const providerLatency = data?.performance?.avgLatencyPerProvider ?? {};
  const queryLatency = data?.performance?.avgLatencyPerQuery ?? {};
  const requestCount = Array.isArray(data?.requests) ? data.requests.length : 0;
  const redisConnected = data?.cache?.status?.redis === "connected" || data?.cache?.redisConnected;
  const proxyRunning = data?.health?.proxy === "running" || data?.health?.status === "ok";
  const proxyHealthy = data?.health?.status === "ok";
  const proxyValue = isLoading ? "--" : proxyHealthy ? "Healthy" : proxyRunning ? "Degraded" : "Offline";

  return (
    <main className="container mx-auto max-w-screen-2xl space-y-8 p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Insights</h1>
          <p className="mt-2 text-gray-400">Operational health, cache state, latency, and request signals.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs text-gray-400">
          <span className={`h-2 w-2 rounded-full ${error ? "bg-red-500" : "bg-emerald-500"}`} />
          {error ? "Telemetry unavailable" : "Live telemetry"}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error.message}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          title="Proxy"
          value={proxyValue}
          detail={`Upstream ${data?.health?.upstream ?? "--"} - Uptime ${formatUptime(data?.health?.uptime)}`}
          icon={<Radio className="h-5 w-5" />}
          tone={proxyHealthy ? "green" : proxyRunning ? "orange" : "red"}
        />
        <StatTile
          title="Redis"
          value={isLoading ? "--" : redisConnected ? "Connected" : "Disconnected"}
          detail={`Fallback ${data?.cache?.status?.fallback ?? "--"} - Hit rate ${data?.cache?.stats?.hitRate ?? "--"}`}
          icon={<Database className="h-5 w-5" />}
          tone={redisConnected ? "green" : "red"}
        />
        <StatTile
          title="Requests"
          value={requestCount}
          detail="Recent traces retained by the proxy debug store."
          icon={<Activity className="h-5 w-5" />}
        />
        <StatTile
          title="Providers"
          value={providers.filter((provider) => provider.status === "active").length}
          detail={`${providers.length} configured upstream metadata sources.`}
          icon={<Server className="h-5 w-5" />}
          tone="orange"
        />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-card p-6 xl:col-span-2">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Slowest Requests</h2>
              <p className="mt-1 text-sm text-gray-500">Recent traces sorted by total request time.</p>
            </div>
            <Clock className="h-5 w-5 text-orange-400" />
          </div>

          {slowestQueries.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-gray-500">
              No request traces yet. Run a search through the proxy to populate this table.
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-border/60">
              <div className="grid grid-cols-[1fr_120px_180px] gap-4 border-b border-border/60 bg-white/[0.03] px-4 py-3 text-xs uppercase tracking-wide text-gray-500">
                <span>Query</span>
                <span>Time</span>
                <span>Recorded</span>
              </div>
              {slowestQueries.map((query) => (
                <div key={query.id ?? `${query.query}-${query.timestamp}`} className="grid grid-cols-[1fr_120px_180px] gap-4 border-b border-border/40 px-4 py-3 text-sm last:border-b-0">
                  <span className="truncate text-gray-200">{query.query}</span>
                  <span className="font-mono text-orange-300">{formatMs(query.time)}</span>
                  <span className="truncate text-xs text-gray-500">{formatTimestamp(query.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border/60 bg-card p-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Alerts</h2>
              <p className="mt-1 text-sm text-gray-500">Latency, provider, and empty-result warnings.</p>
            </div>
            {alerts.length > 0 ? (
              <AlertTriangle className="h-5 w-5 text-red-400" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            )}
          </div>

          {alerts.length === 0 ? (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-300">
              No active alerts.
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.slice(0, 6).map((alert, index) => (
                <div key={`${alert.traceId ?? index}-${alert.type}`} className="rounded-md border border-red-500/20 bg-red-500/5 p-4">
                  <div className="text-sm font-medium capitalize text-red-300">{alert.type.replace(/_/g, " ")}</div>
                  <p className="mt-1 text-sm text-gray-300">{alert.message}</p>
                  <p className="mt-2 text-xs text-gray-500">{formatTimestamp(alert.timestamp)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-card p-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Provider Latency</h2>
              <p className="mt-1 text-sm text-gray-500">Average trace latency grouped by provider.</p>
            </div>
            <Gauge className="h-5 w-5 text-blue-400" />
          </div>
          <LatencyList data={providerLatency} />
        </div>

        <div className="rounded-lg border border-border/60 bg-card p-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Query Latency</h2>
              <p className="mt-1 text-sm text-gray-500">Average latency for recently observed queries.</p>
            </div>
            <Gauge className="h-5 w-5 text-blue-400" />
          </div>
          <LatencyList data={queryLatency} />
        </div>
      </section>
    </main>
  );
}
