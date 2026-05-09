"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Activity, CheckCircle2, Clipboard, Download, Loader2, RefreshCw, ShieldAlert, Stethoscope, XCircle } from "lucide-react";
import { fetchJson } from "@/lib/fetcher";

type NetworkProviderState = {
 provider: string;
 label?: string;
 policy: string;
 family: number | string;
 fallbackAllowed: boolean;
 state: string;
 ok: boolean;
 failedStep: string | null;
 checkedAt: string | null;
 lastSuccessAt: string | null;
 consecutiveFailures: number;
 target?: { url?: string | null; hostname?: string | null } | null;
 dns?: {
 aAvailable?: boolean;
 aaaaAvailable?: boolean;
 addresses?: Array<{ address: string; family: number }>;
 errors?: Record<string, string>;
 };
 tcp?: { connected?: boolean; selectedAddress?: string | null; selectedFamily?: number | null } | null;
 tls?: { protocol?: string | null; authorizationError?: string | null } | null;
 http?: { status?: number | null; statusText?: string | null } | null;
 timingsMs?: { dns?: number | null; tcp?: number | null; tls?: number | null; http?: number | null; total?: number | null } | null;
 error?: { code?: string | null; message?: string | null } | null;
 userAgent?: {
 valid: boolean;
 contactType: string | null;
 code: string | null;
 message: string | null;
 recommendation: string | null;
 } | null;
 recommendations?: string[];
};

type NetworkResponse = {
 status: string;
 checkedAt: string | null;
 providers: Record<string, NetworkProviderState>;
 summary: Record<string, unknown>;
};

type ReadyResponse = {
 status: string;
 upstream?: string;
 upstreamDetail?: {
 activeProviders?: string[];
 lastError?: { message?: string; code?: string | null; status?: number | null } | null;
 consecutiveFailures?: number;
 };
};

type DebugBundle = {
 generatedAt: string;
 health?: unknown;
 ready?: unknown;
 network?: unknown;
 providersHealth?: unknown;
 providersMetrics?: unknown;
 upstreamMusicBrainz?: unknown;
 diagnostics?: Record<string, unknown>;
};

const PROVIDER_ORDER = ["musicbrainz", "itunes", "theaudiodb", "discogs", "lastfm"];

const fetcher = (url: string) => fetchJson<any>(url);

function formatState(state?: string) {
 return String(state || "UNKNOWN").replace(/^MUSICBRAINZ_/, "").replace(/_/g, " ");
}

function formatTime(value?: string | null) {
 return value ? new Date(value).toLocaleTimeString() : "—";
}

function formatFamily(value: number | string) {
 return typeof value === "number" ? `IPv${value}` : String(value || "auto");
}

function statusTone(provider?: NetworkProviderState) {
 if (!provider) return "border-border bg-card text-muted";
 if (provider.ok) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
 if (provider.state === "UNKNOWN") return "border-border bg-card text-muted";
 return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400";
}

function providerSort(providers: NetworkProviderState[]) {
 return [...providers].sort((a, b) => {
  const ai = PROVIDER_ORDER.indexOf(a.provider);
  const bi = PROVIDER_ORDER.indexOf(b.provider);
  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.provider.localeCompare(b.provider);
 });
}

function compactJson(value: unknown) {
 return JSON.stringify(value, null, 2);
}

function buildRunbooks(providers: NetworkProviderState[]) {
 const runbooks: Array<{ id: string; title: string; body: string; commands: string[] }> = [];
 const mb = providers.find((provider) => provider.provider === "musicbrainz");

 if (mb?.userAgent && !mb.userAgent.valid) {
  runbooks.push({
   id: "mb-contact",
   title: "MusicBrainz identity",
   body: "MusicBrainz requests need a real operator contact. Placeholder contacts are treated as invalid.",
   commands: [
    "APP_CONTACT=you@your-real-domain.com docker compose up -d --force-recreate proxy",
    "curl -s http://127.0.0.1:3055/debug/network?refresh=1 | jq '.providers.musicbrainz.userAgent'"
   ]
  });
 }

 if (mb?.state === "MUSICBRAINZ_IPV6_NO_ROUTE" || mb?.error?.code === "ENETUNREACH") {
  runbooks.push({
   id: "mb-route",
   title: "IPv6 route",
   body: "MusicBrainz is IPv6-only here. Fix the host, LXC, and Docker route instead of switching to IPv4.",
   commands: [
    "ip -6 addr && ip -6 route",
    "docker network inspect melodarr-ipv6",
    "docker compose -f docker-compose.yml -f docker-compose.ipv6.yml up -d --force-recreate"
   ]
  });
 }

 if (mb?.state === "MUSICBRAINZ_IPV6_TLS_FAILED") {
  runbooks.push({
   id: "mb-tls",
   title: "IPv6 TLS reset",
   body: "TCP reached MusicBrainz, but TLS did not complete. This usually points at MTU, PMTUD, firewall inspection, or upstream path reset behavior.",
   commands: [
    "curl -6 -v https://musicbrainz.org/",
    "tracepath6 musicbrainz.org",
    "curl -s http://127.0.0.1:3055/debug/diagnose?provider=musicbrainz | jq '.failedStep,.error,.timingsMs'"
   ]
  });
 }

 for (const provider of providers) {
  if (provider.provider === "musicbrainz") continue;
  if (provider.failedStep === "http") {
   runbooks.push({
    id: `${provider.provider}-http`,
    title: `${provider.label || provider.provider} HTTP/auth`,
    body: "The network path works, but the provider returned an HTTP error. Check token, quota, country, and provider status.",
    commands: [
     `curl -s "http://127.0.0.1:3055/debug/diagnose?provider=${provider.provider}" | jq '.http,.error'`,
     "curl -s http://127.0.0.1:3055/debug/providers/metrics | jq"
    ]
   });
  }
 }

 if (runbooks.length === 0) {
  runbooks.push({
   id: "healthy",
   title: "No active runbooks",
   body: "Provider diagnostics do not currently identify an operator action.",
   commands: [
    "curl -s http://127.0.0.1:3055/debug/network?refresh=1 | jq"
   ]
  });
 }

 return runbooks;
}

export default function DiagnosticsPage() {
 const { data: network, error: networkError, mutate: mutateNetwork, isLoading: networkLoading } = useSWR<NetworkResponse>(
  "/debug/network",
  fetcher,
  { refreshInterval: 15000 }
 );
 const { data: ready } = useSWR<ReadyResponse>("/api/ready", fetcher, { refreshInterval: 5000 });
 const { data: providerHealth } = useSWR<unknown>("/debug/providers/health", fetcher, { refreshInterval: 15000 });
 const { data: providerMetrics } = useSWR<unknown>("/debug/providers/metrics", fetcher, { refreshInterval: 15000 });

 const [refreshing, setRefreshing] = useState(false);
 const [bundleState, setBundleState] = useState<"idle" | "copying" | "copied" | "error">("idle");
 const [diagnosing, setDiagnosing] = useState<string | null>(null);
 const [diagnostics, setDiagnostics] = useState<Record<string, unknown>>({});

 const providers = useMemo(() => providerSort(Object.values(network?.providers || {})), [network]);
 const runbooks = useMemo(() => buildRunbooks(providers), [providers]);

 async function refreshNetwork() {
  setRefreshing(true);
  try {
   const refreshed = await fetchJson<NetworkResponse>("/debug/network?refresh=1");
   await mutateNetwork(refreshed, { revalidate: false });
  } finally {
   setRefreshing(false);
  }
 }

 async function runProviderProbe(provider: string) {
  setDiagnosing(provider);
  try {
   const result = await fetchJson(`/debug/diagnose?provider=${encodeURIComponent(provider)}`);
   setDiagnostics((current) => ({ ...current, [provider]: result }));
  } finally {
   setDiagnosing(null);
  }
 }

 async function copyDebugBundle() {
  setBundleState("copying");
  try {
   const providerNames = providers.map((provider) => provider.provider);
   const [health, readyPayload, networkPayload, providersHealth, providersMetrics, upstreamMusicBrainz, diagnoseResults] = await Promise.all([
    fetchJson("/api/health").catch((error) => ({ error: error.message })),
    fetchJson("/api/ready").catch((error) => ({ error: error.message })),
    fetchJson("/debug/network").catch((error) => ({ error: error.message })),
    fetchJson("/debug/providers/health").catch((error) => ({ error: error.message })),
    fetchJson("/debug/providers/metrics").catch((error) => ({ error: error.message })),
    fetchJson("/debug/upstream?provider=musicbrainz&limit=20").catch((error) => ({ error: error.message })),
    Promise.all(providerNames.map(async (provider) => {
     const result = await fetchJson(`/debug/diagnose?provider=${encodeURIComponent(provider)}`).catch((error) => ({ error: error.message }));
     return [provider, result] as const;
    }))
   ]);
   const bundle: DebugBundle = {
    generatedAt: new Date().toISOString(),
    health,
    ready: readyPayload,
    network: networkPayload,
    providersHealth,
    providersMetrics,
    upstreamMusicBrainz,
    diagnostics: Object.fromEntries(diagnoseResults)
   };
   await navigator.clipboard.writeText(compactJson(bundle));
   setBundleState("copied");
   window.setTimeout(() => setBundleState("idle"), 1600);
  } catch {
   setBundleState("error");
  }
 }

 return (
  <main className="container mx-auto max-w-screen-2xl p-8">
   <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div>
     <h1 className="text-3xl font-bold tracking-tight">Diagnostics</h1>
     <p className="mt-2 text-secondary">Provider transport state, runbooks, and exportable debug evidence.</p>
    </div>
    <div className="flex flex-wrap gap-2">
     <button
      type="button"
      onClick={refreshNetwork}
      disabled={refreshing}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-secondary transition-colors hover:text-primary disabled:opacity-60"
     >
      {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      Recheck
     </button>
     <button
      type="button"
      onClick={copyDebugBundle}
      disabled={bundleState === "copying"}
      className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
     >
      {bundleState === "copying" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {bundleState === "copied" ? "Copied" : "Copy bundle"}
     </button>
    </div>
   </div>

   <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
    <SummaryTile label="Proxy readiness" value={ready?.upstream || ready?.status || "—"} />
    <SummaryTile label="Active providers" value={(ready?.upstreamDetail?.activeProviders || []).join(", ") || "—"} />
    <SummaryTile label="Network check" value={network?.checkedAt ? formatTime(network.checkedAt) : networkLoading ? "Loading" : "—"} />
   </section>

   {networkError && (
    <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400">
     Failed to load network diagnostics: {networkError instanceof Error ? networkError.message : "unknown error"}
    </div>
   )}

   <section className="mb-8">
    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-secondary">
     <Activity className="h-4 w-4" />
     Provider Transport
    </div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
     {providers.map((provider) => (
      <ProviderCard
       key={provider.provider}
       provider={provider}
       diagnosis={diagnostics[provider.provider]}
       diagnosing={diagnosing === provider.provider}
       onProbe={() => runProviderProbe(provider.provider)}
      />
     ))}
    </div>
   </section>

   <section className="mb-8">
    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-secondary">
     <ShieldAlert className="h-4 w-4" />
     Runbooks
    </div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
     {runbooks.map((runbook) => (
      <div key={runbook.id} className="rounded-lg border border-border bg-card p-4">
       <h2 className="text-base font-semibold">{runbook.title}</h2>
       <p className="mt-2 text-sm text-secondary">{runbook.body}</p>
       <div className="mt-3 space-y-2">
        {runbook.commands.map((command) => (
         <code key={command} className="block overflow-x-auto rounded-md bg-page px-3 py-2 text-xs text-secondary">
          {command}
         </code>
        ))}
       </div>
      </div>
     ))}
    </div>
   </section>

   <section>
    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-secondary">
     <Stethoscope className="h-4 w-4" />
     Provider Health Snapshot
    </div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
     <JsonPanel title="Health" data={providerHealth} />
     <JsonPanel title="Metrics" data={providerMetrics} />
    </div>
   </section>
  </main>
 );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
 return (
  <div className="rounded-lg border border-border bg-card p-4">
   <div className="text-xs text-muted">{label}</div>
   <div className="mt-2 truncate text-lg font-semibold" title={value}>{value}</div>
  </div>
 );
}

function ProviderCard({
 provider,
 diagnosis,
 diagnosing,
 onProbe
}: {
 provider: NetworkProviderState;
 diagnosis?: unknown;
 diagnosing: boolean;
 onProbe: () => void;
}) {
 const healthy = provider.ok;
 const Icon = healthy ? CheckCircle2 : XCircle;
 const tls = provider.tls?.protocol || (healthy ? "OK" : provider.failedStep === "tls" ? "Failed" : "—");
 const http = provider.http?.status ? `${provider.http.status} ${provider.http.statusText || ""}`.trim() : "—";
 const userAgent = provider.userAgent ? (provider.userAgent.valid ? "OK" : provider.userAgent.code || "Invalid") : "—";

 return (
  <div className={`rounded-lg border p-4 ${statusTone(provider)}`}>
   <div className="flex items-start justify-between gap-3">
    <div>
     <div className="flex items-center gap-2">
      <Icon className="h-4 w-4" />
      <h2 className="text-lg font-semibold text-primary">{provider.label || provider.provider}</h2>
     </div>
     <div className="mt-1 text-xs text-secondary">{provider.provider}</div>
    </div>
    <button
     type="button"
     onClick={onProbe}
     disabled={diagnosing}
     className="inline-flex items-center gap-2 rounded-md border border-border bg-page px-3 py-1.5 text-xs text-secondary transition-colors hover:text-primary disabled:opacity-60"
    >
     {diagnosing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
     Probe
    </button>
   </div>

   <div className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
    <Metric label="State" value={formatState(provider.state)} />
    <Metric label="Policy" value={`${provider.policy} / ${formatFamily(provider.family)}`} />
    <Metric label="Fallback" value={provider.fallbackAllowed ? "Allowed" : "Disabled"} />
    <Metric label="Checked" value={formatTime(provider.checkedAt)} />
    <Metric label="DNS A" value={provider.dns?.aAvailable === undefined ? "—" : provider.dns.aAvailable ? "OK" : "Missing"} />
    <Metric label="DNS AAAA" value={provider.dns?.aaaaAvailable ? "OK" : "Missing"} />
    <Metric label="TCP" value={provider.tcp?.connected ? "OK" : provider.failedStep === "tcp" ? "Failed" : "—"} />
    <Metric label="TLS" value={tls} />
    <Metric label="HTTP" value={http} />
    <Metric label="User-Agent" value={userAgent} />
    <Metric label="Failures" value={String(provider.consecutiveFailures || 0)} />
    <Metric label="Total ms" value={provider.timingsMs?.total == null ? "—" : `${provider.timingsMs.total}`} />
   </div>

   {provider.error?.message && (
    <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-400">
     <code>{provider.error.code || "ERROR"}</code> — {provider.error.message}
    </div>
   )}

   {provider.userAgent && !provider.userAgent.valid && (
    <div className="mt-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400">
     <code>{provider.userAgent.code || "INVALID_CONTACT"}</code> — {provider.userAgent.message}
    </div>
   )}

   {provider.recommendations && provider.recommendations.length > 0 && (
    <ul className="mt-3 space-y-1 text-xs text-secondary">
     {provider.recommendations.slice(0, 4).map((item) => (
      <li key={item}>· {item}</li>
     ))}
    </ul>
   )}

   {diagnosis !== undefined && (
    <details className="mt-4 rounded-md border border-border bg-page p-3">
     <summary className="cursor-pointer text-xs font-medium text-secondary">Probe response</summary>
     <pre className="mt-3 max-h-72 overflow-auto text-xs text-secondary">{compactJson(diagnosis)}</pre>
    </details>
   )}
  </div>
 );
}

function Metric({ label, value }: { label: string; value: string }) {
 return (
  <div>
   <div className="text-muted">{label}</div>
   <div className="mt-1 truncate font-medium text-primary" title={value}>{value}</div>
  </div>
 );
}

function JsonPanel({ title, data }: { title: string; data: unknown }) {
 const [copied, setCopied] = useState(false);

 async function copy() {
  await navigator.clipboard.writeText(compactJson(data ?? null));
  setCopied(true);
  window.setTimeout(() => setCopied(false), 1400);
 }

 return (
  <div className="rounded-lg border border-border bg-card p-4">
   <div className="mb-3 flex items-center justify-between gap-3">
    <h2 className="text-sm font-semibold">{title}</h2>
    <button
     type="button"
     onClick={copy}
     className="inline-flex items-center gap-2 rounded-md border border-border bg-page px-2.5 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
    >
     <Clipboard className="h-3.5 w-3.5" />
     {copied ? "Copied" : "Copy"}
    </button>
   </div>
   <pre className="max-h-96 overflow-auto rounded-md bg-page p-3 text-xs text-secondary">{compactJson(data ?? null)}</pre>
  </div>
 );
}
