"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { StatusBadge } from "./StatusBadge";
import Link from "next/link";
import { Activity, Clock, AlertTriangle, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { mergeTelemetry, telemetryFromOverview, telemetryFromStats } from "@/lib/telemetry";

type Health = {
 status?: string;
 proxy?: string;
 service?: string;
 version?: string;
 instanceId?: string;
 cache?: string;
 memory?: { status?: string };
};

export function ServiceCard({ service }: { service: { name: string } }) {
 const { data: liveness, error: healthError } = useSWR<Health>("/api/health", fetcher, { refreshInterval: 5000 });
 const { data: readiness } = useSWR<Health>("/api/ready", fetcher, { refreshInterval: 5000 });
 const { data: stats } = useSWR("/api/stats", fetcher, { refreshInterval: 10000 });
 const { data: overview } = useSWR("/debug/overview", fetcher, { refreshInterval: 5000 });
 const [updatedAt, setUpdatedAt] = useState<string>("--");
 const health = readiness ?? liveness;

 useEffect(() => {
 const update = () => setUpdatedAt(new Date().toLocaleTimeString());

 update();
 const interval = window.setInterval(update, 10000);

 return () => window.clearInterval(interval);
 }, []);

 const isUnreachable = Boolean(healthError);
 const isDown = !isUnreachable && health && health.proxy && health.proxy !== "running";
 const isDegraded = !isDown && !isUnreachable && health && (health.cache === "degraded" || health.memory?.status === "warning");
 const isLoading = !health && !healthError;

 const status = isUnreachable
 ? "down"
 : isLoading
 ? "loading"
 : isDown
 ? "down"
 : isDegraded
 ? "degraded"
 : "healthy";

 const telemetry = mergeTelemetry(telemetryFromStats(stats), telemetryFromOverview(overview));
 const rpm = telemetry.rpm ?? "--";
 const latency = telemetry.latencyAvgMs === undefined ? "--" : `${telemetry.latencyAvgMs}ms`;
 const errorRate = telemetry.errorRatePercent === undefined ? "--" : `${telemetry.errorRatePercent}%`;

 const errorMessage = healthError instanceof Error ? healthError.message : null;
 const versionLabel = health?.version ? `v${health.version}` : null;

 return (
 <Link href={`/service/${service.name}`} className="block">
 <div className="rounded-xl border bg-card text-card-foreground shadow-sm hover:border-blue-500/50 transition-all hover:shadow-md hover:shadow-blue-500/10 h-full p-6 flex flex-col justify-between">
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <h3 className="font-semibold tracking-tight text-lg">{service.name}</h3>
 <StatusBadge status={status} />
 </div>

 {isUnreachable ? (
 <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">
 <div className="flex items-center gap-2 font-medium">
 <AlertCircle className="w-4 h-4" /> Proxy unreachable
 </div>
 {errorMessage && (
 <p className="mt-1 break-words text-xs text-red-700 dark:text-red-300/80">{errorMessage}</p>
 )}
 <p className="mt-2 text-xs text-muted">
 Configure <code>NEXT_PUBLIC_PROXY_BASE_URL</code> or set up a reverse proxy from this origin to the proxy.
 </p>
 </div>
 ) : (
 <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
 <div>
 <p className="text-xs text-muted flex items-center gap-1.5 mb-1 text-secondary">
 <Activity className="w-3 h-3" /> Requests/min
 </p>
 <p className="text-xl font-medium">{rpm}</p>
 </div>
 <div>
 <p className="text-xs text-muted flex items-center gap-1.5 mb-1 text-secondary">
 <Clock className="w-3 h-3" /> Latency (avg)
 </p>
 <p className="text-xl font-medium">{latency}</p>
 </div>
 <div>
 <p className="text-xs text-muted flex items-center gap-1.5 mb-1 text-secondary">
 <AlertTriangle className="w-3 h-3" /> Error rate
 </p>
 <p className="text-xl font-medium">{errorRate}</p>
 </div>
 </div>
 )}
 </div>

 <div className="mt-6 pt-4 border-t border-border flex items-center justify-between gap-2 text-xs text-muted">
 <span className="truncate">
 {versionLabel ? versionLabel : "—"}
 {health?.instanceId ? ` · ${health.instanceId}` : ""}
 </span>
 <span>Updated: {updatedAt}</span>
 </div>
 </div>
 </Link>
 );
}
