type RequestTrace = {
  timestamp?: string;
  totalTime?: number;
  steps?: Array<{ status?: string }>;
};

type OverviewPayload = {
  requests?: RequestTrace[];
};

type StatsPayload = {
  requests?: { perMinute?: number };
  latency?: { avgMs?: number };
  errors?: { rate?: number };
};

export type ServiceTelemetry = {
  rpm?: number;
  latencyAvgMs?: number;
  errorRatePercent?: number;
};

export type ChartSample = {
  timestamp: string;
  rpm: number;
  latencyAvg: number;
  errorRate: number;
};

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function traceFailed(trace: RequestTrace) {
  return trace.steps?.some((step) => step.status && step.status !== "success") ?? false;
}

function recentRequests(requests: RequestTrace[]) {
  const now = Date.now();
  return requests.filter((request) => {
    const time = request.timestamp ? new Date(request.timestamp).getTime() : 0;
    return time > 0 && now - time <= 60_000;
  });
}

export function telemetryFromStats(stats: StatsPayload | undefined): ServiceTelemetry {
  const errorRate = numeric(stats?.errors?.rate);

  return {
    rpm: numeric(stats?.requests?.perMinute),
    latencyAvgMs: numeric(stats?.latency?.avgMs),
    errorRatePercent: errorRate === undefined ? undefined : Number((errorRate * 100).toFixed(1)),
  };
}

export function telemetryFromOverview(overview: OverviewPayload | undefined): ServiceTelemetry {
  const requests = overview?.requests ?? [];
  const timedRequests = requests.filter((request) => typeof request.totalTime === "number");
  const failedRequests = requests.filter(traceFailed);
  const rpm = recentRequests(requests).length;
  const latencyAvgMs = timedRequests.length
    ? Math.round(timedRequests.reduce((sum, request) => sum + Number(request.totalTime), 0) / timedRequests.length)
    : undefined;
  const errorRatePercent = requests.length ? Number(((failedRequests.length / requests.length) * 100).toFixed(1)) : 0;

  return { rpm, latencyAvgMs, errorRatePercent };
}

export function mergeTelemetry(primary: ServiceTelemetry, fallback: ServiceTelemetry): ServiceTelemetry {
  return {
    rpm: primary.rpm ?? fallback.rpm,
    latencyAvgMs: primary.latencyAvgMs ?? fallback.latencyAvgMs,
    errorRatePercent: primary.errorRatePercent ?? fallback.errorRatePercent,
  };
}

export function chartSamplesFromOverview(overview: OverviewPayload | undefined): ChartSample[] {
  const requests = [...(overview?.requests ?? [])]
    .filter((request) => request.timestamp)
    .sort((a, b) => new Date(a.timestamp || "").getTime() - new Date(b.timestamp || "").getTime());

  return requests.map((request, index) => {
    const seen = requests.slice(0, index + 1);
    const failed = seen.filter(traceFailed).length;
    const timed = seen.filter((item) => typeof item.totalTime === "number");
    const timestamp = request.timestamp || new Date().toISOString();

    return {
      timestamp,
      rpm: recentRequests(seen).length,
      latencyAvg: timed.length ? Math.round(timed.reduce((sum, item) => sum + Number(item.totalTime), 0) / timed.length) : 0,
      errorRate: seen.length ? Number(((failed / seen.length) * 100).toFixed(1)) : 0,
    };
  });
}
