"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { StatusBadge } from "./StatusBadge";
import Link from "next/link";
import { Activity, Clock, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { mergeTelemetry, telemetryFromOverview, telemetryFromStats } from "@/lib/telemetry";

export function ServiceCard({ service }: { service: { name: string; baseUrl: string } }) {
  const { data: health, error: healthError } = useSWR(`${service.baseUrl}/api/health`, fetcher, { refreshInterval: 5000 });
  const { data: stats } = useSWR(`${service.baseUrl}/api/stats`, fetcher, { refreshInterval: 10000 });
  const { data: overview } = useSWR(`${service.baseUrl}/debug/overview`, fetcher, { refreshInterval: 5000 });
  const [updatedAt, setUpdatedAt] = useState<string>("--");

  useEffect(() => {
    const update = () => setUpdatedAt(new Date().toLocaleTimeString());

    update();
    const interval = window.setInterval(update, 10000);

    return () => window.clearInterval(interval);
  }, []);

  const isDown = healthError || (health && health.proxy && health.proxy !== "running");
  const isDegraded = !isDown && health && (health.cache === "degraded" || health.memory?.status === "warning");
  const isLoading = !health && !healthError;

  const status = isLoading ? "loading" : isDown ? "down" : isDegraded ? "degraded" : "healthy";
  const telemetry = mergeTelemetry(telemetryFromStats(stats), telemetryFromOverview(overview));
  const rpm = telemetry.rpm ?? "--";
  const latency = telemetry.latencyAvgMs === undefined ? "--" : `${telemetry.latencyAvgMs}ms`;
  const errorRate = telemetry.errorRatePercent === undefined ? "--" : `${telemetry.errorRatePercent}%`;

  return (
    <Link href={`/service/${service.name}`} className="block">
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm hover:border-blue-500/50 transition-all hover:shadow-md hover:shadow-blue-500/10 h-full p-6 flex flex-col justify-between">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold tracking-tight text-lg">{service.name}</h3>
            <StatusBadge status={status} />
          </div>
          
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border/50">
            <div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1 text-gray-400">
                <Activity className="w-3 h-3" /> Requests/min
              </p>
              <p className="text-xl font-medium">{rpm}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1 text-gray-400">
                <Clock className="w-3 h-3" /> Latency (avg)
              </p>
              <p className="text-xl font-medium">{latency}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1 text-gray-400">
                <AlertTriangle className="w-3 h-3" /> Error rate
              </p>
              <p className="text-xl font-medium">{errorRate}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border/50 flex items-center justify-between text-xs text-gray-500">
          <span>{service.baseUrl}</span>
          <span>Updated: {updatedAt}</span>
        </div>
      </div>
    </Link>
  );
}
