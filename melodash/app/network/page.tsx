"use client";

import useSWR from "swr";
import {
 Activity,
 AlertTriangle,
 CheckCircle2,
 Clock,
 Globe,
 Loader2,
 RefreshCw,
 Server,
 Shield,
 XCircle,
} from "lucide-react";
import { fetchJson } from "@/lib/fetcher";

type ProviderSummary = {
 policy?: string;
 family?: string | number;
 fallbackAllowed?: boolean;
 state?: string;
 ok?: boolean;
 failedStep?: string | null;
 userAgentValid?: boolean | null;
 lastCheckedAt?: string | null;
 lastSuccessAt?: string | null;
 consecutiveFailures?: number;
};

type ProviderDetails = {
 provider?: string;
 label?: string;
 policy?: string;
 family?: string | number;
 fallbackAllowed?: boolean;
 state?: string;
 ok?: boolean;
 failedStep?: string | null;
 checkedAt?: string | null;
 lastSuccessAt?: string | null;
 consecutiveFailures?: number;
 dns?: {
  aAvailable?: boolean;
  aaaaAvailable?: boolean;
  addresses?: Array<{ address?: string; family?: number }>;
 };
 tcp?: { connected?: boolean; selectedAddress?: string; selectedFamily?: number } | null;
 tls?: { protocol?: string | null; authorized?: boolean | null } | null;
 http?: { status?: number | null } | null;
 timingsMs?: { total?: number | null; dns?: number | null; tcp?: number | null; tls?: number | null; http?: number | null } | null;
 error?: { code?: string | null; message?: string | null } | null;
 userAgent?: { valid?: boolean; application?: string | null; contactPresent?: boolean } | null;
 recommendations?: string[];
};

type NetworkPayload = {
 status?: string;
 checkedAt?: string | null;
 summary?: Record<string, ProviderSummary>;
 providers?: Record<string, ProviderDetails>;
};

const fetcher = (url: string) => fetchJson<NetworkPayload>(url);

function statusTone(ok?: boolean, state?: string) {
 if (ok) return "text-emerald-600 dark:text-emerald-400";
 if (!state || state === "UNKNOWN") return "text-amber-500";
 return "text-red-600 dark:text-red-400";
}

function StatusIcon({ ok, state }: { ok?: boolean; state?: string }) {
 if (ok) return <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />;
 if (!state || state === "UNKNOWN") return <AlertTriangle className="h-6 w-6 text-amber-500" />;
 return <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />;
}

function DetailRow({ label, value, tone }: { label: string; value: string | number | null | undefined; tone?: string }) {
 return (
  <div className="flex items-center justify-between gap-3 text-sm">
   <span className="text-secondary">{label}</span>
   <span className={`truncate text-right font-medium ${tone || "text-primary"}`}>{value ?? "-"}</span>
  </div>
 );
}

function ProviderCard({ provider }: { provider?: ProviderDetails }) {
 const label = provider?.label || provider?.provider || "provider";
 const tone = statusTone(provider?.ok, provider?.state);

 return (
  <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
   <div className="mb-4 flex items-center justify-between gap-3">
    <h2 className="flex items-center gap-2 text-lg font-semibold">
     <Activity className="h-5 w-5 text-indigo-500" />
     {label}
    </h2>
    <StatusIcon ok={provider?.ok} state={provider?.state} />
   </div>
   <div className="space-y-2 rounded-md border border-border/50 bg-page p-3">
    <DetailRow label="State" value={provider?.state || "UNKNOWN"} tone={tone} />
    <DetailRow label="Policy" value={provider?.policy || "auto"} />
    <DetailRow label="Family" value={provider?.family || "auto"} />
    <DetailRow label="Fallback" value={provider?.fallbackAllowed === false ? "disabled" : "allowed"} />
    <DetailRow label="Failures" value={provider?.consecutiveFailures ?? 0} />
    <DetailRow label="Last success" value={provider?.lastSuccessAt ? new Date(provider.lastSuccessAt).toLocaleString() : "never"} />
   </div>
   {provider?.error?.message && (
    <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
     {provider.error.code ? `${provider.error.code}: ` : ""}
     {provider.error.message}
    </div>
   )}
  </div>
 );
}

export default function NetworkDiagnosticsPage() {
 const {
  data: network,
  error: networkError,
  mutate: mutateNetwork,
  isValidating: networkLoading,
 } = useSWR("/debug/network", fetcher, { refreshInterval: 15000 });

 async function handleRefresh() {
  await mutateNetwork(fetcher("/debug/network?refresh=1"), { revalidate: false });
 }

 const musicbrainz = network?.providers?.musicbrainz;
 const genericProviders = Object.entries(network?.providers || {}).filter(([name]) => name !== "musicbrainz");
 const musicbrainzTone = statusTone(musicbrainz?.ok, musicbrainz?.state);
 const isLoading = networkLoading && !network;

 return (
  <main className="container mx-auto max-w-screen-2xl p-8">
   <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div>
     <h1 className="text-3xl font-bold tracking-tight">Network Diagnostics</h1>
     <p className="mt-2 text-secondary">
      Provider transport policy, IPv6-only MusicBrainz status, and runtime troubleshooting guidance from the proxy.
     </p>
    </div>
    <button
     type="button"
     onClick={handleRefresh}
     disabled={networkLoading}
     className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-secondary transition-colors hover:text-primary disabled:opacity-60"
    >
     {networkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
     Refresh
    </button>
   </div>

   {networkError && (
    <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
     Unable to load network diagnostics: {String(networkError.message || networkError)}
    </div>
   )}

   {isLoading ? (
    <div className="rounded-lg border border-border bg-card p-8 text-sm text-secondary">
     <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
     Loading network diagnostics...
    </div>
   ) : (
    <>
     <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm lg:col-span-2">
       <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
         <Globe className="h-5 w-5 text-blue-500" />
         MusicBrainz IPv6 Transport
        </h2>
        <StatusIcon ok={musicbrainz?.ok} state={musicbrainz?.state} />
       </div>
       <p className="mb-4 text-sm text-secondary">
        MusicBrainz is treated as IPv6-only. IPv4 fallback is intentionally disabled for this provider.
       </p>
       <div className="grid gap-3 rounded-md border border-border/50 bg-page p-3 md:grid-cols-2">
        <DetailRow label="State" value={musicbrainz?.state || "UNKNOWN"} tone={musicbrainzTone} />
        <DetailRow label="Policy" value={musicbrainz?.policy || "ipv6_only"} />
        <DetailRow label="Family" value={musicbrainz?.family || 6} />
        <DetailRow label="Fallback" value={musicbrainz?.fallbackAllowed === false ? "disabled" : "allowed"} />
        <DetailRow label="AAAA" value={musicbrainz?.dns?.aaaaAvailable ? "available" : "missing"} />
        <DetailRow label="Failed step" value={musicbrainz?.failedStep || "-"} />
        <DetailRow label="User-Agent" value={musicbrainz?.userAgent?.valid === false ? "invalid" : "valid"} />
        <DetailRow label="Total latency" value={musicbrainz?.timingsMs?.total ? `${musicbrainz.timingsMs.total}ms` : "-"} />
       </div>
       {musicbrainz?.recommendations?.length ? (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
         <h3 className="mb-2 text-sm font-semibold text-amber-700 dark:text-amber-300">Recommended checks</h3>
         <ul className="space-y-2 text-sm text-amber-900 dark:text-amber-100">
          {musicbrainz.recommendations.map((recommendation) => (
           <li key={recommendation}>{recommendation}</li>
          ))}
         </ul>
        </div>
       ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
       <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
         <Shield className="h-5 w-5 text-emerald-500" />
         Proxy Network
        </h2>
        <StatusIcon ok={network?.status === "ok"} state={network?.status || "UNKNOWN"} />
       </div>
       <div className="space-y-2 rounded-md border border-border/50 bg-page p-3">
        <DetailRow label="Status" value={network?.status || "unknown"} tone={network?.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-500"} />
        <DetailRow label="Checked" value={network?.checkedAt ? new Date(network.checkedAt).toLocaleString() : "-"} />
        <DetailRow label="Providers" value={Object.keys(network?.providers || {}).length} />
       </div>
      </div>
     </div>

     <section className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      {genericProviders.map(([name, provider]) => (
       <ProviderCard key={name} provider={provider} />
      ))}
     </section>

     <section className="mt-8">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-secondary">
       <Server className="h-5 w-5" />
       Raw Diagnostic Data
      </h3>
      <div className="rounded-lg border border-border bg-card">
       <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2 font-mono text-xs text-secondary">
        <span>/debug/network</span>
        <span className="inline-flex items-center gap-1">
         <Clock className="h-3 w-3" />
         {network?.checkedAt ? new Date(network.checkedAt).toLocaleTimeString() : "not checked"}
        </span>
       </div>
       <pre className="max-h-[520px] overflow-auto p-4 text-xs leading-5">
        {JSON.stringify(network || {}, null, 2)}
       </pre>
      </div>
     </section>
    </>
   )}
  </main>
 );
}
