"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { CheckCircle2, Clock, Copy, Database, ListChecks, Radio, XCircle } from "lucide-react";

type TraceStep = {
 name: string;
 status: string;
 duration?: number;
};

type Trace = {
 id: string;
 query: string;
 totalTime: number;
 timestamp: string;
 startTime?: number;
 cacheHit?: boolean;
 providersUsed?: string[];
 steps?: TraceStep[];
};

function formatTimestamp(timestamp?: string) {
 if (!timestamp) return "--";
 return timestamp.replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function statusClass(status: string) {
 if (status === "success" || status === "hit") return "text-emerald-300";
 if (status === "error" || status === "miss") return "text-red-700 dark:text-red-300";
 return "text-primary";
}

function JsonBlock({ trace }: { trace: Trace }) {
 const [copied, setCopied] = useState(false);
 const raw = JSON.stringify(trace, null, 2);

 async function copyRaw() {
 await navigator.clipboard.writeText(raw);
 setCopied(true);
 window.setTimeout(() => setCopied(false), 1500);
 }

 return (
 <div className="rounded-lg border border-border bg-page p-4">
 <div className="flex items-center justify-between gap-3">
 <h3 className="text-sm font-semibold text-primary">Raw trace</h3>
 <button
 type="button"
 onClick={copyRaw}
 className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs text-primary hover:bg-card dark:hover:bg-card"
 >
 <Copy className="h-3.5 w-3.5" />
 {copied ? "Copied" : "Copy"}
 </button>
 </div>
 <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-xs leading-5 text-primary">
 {raw}
 </pre>
 </div>
 );
}

function TraceDetail({ trace }: { trace: Trace }) {
 const steps = trace.steps ?? [];
 const slowestStep = steps.reduce<TraceStep | null>((slowest, step) => {
 if (!slowest) return step;
 return (step.duration ?? 0) > (slowest.duration ?? 0) ? step : slowest;
 }, null);

 return (
 <aside className="space-y-4 rounded-lg border border-border bg-card p-5">
 <div>
 <h2 className="text-xl font-semibold">{trace.query}</h2>
 <p className="mt-1 break-all font-mono text-xs text-muted">{trace.id}</p>
 </div>

 <div className="grid grid-cols-2 gap-3">
 <div className="rounded-md border border-border bg-page p-3">
 <div className="text-xs text-muted">Total time</div>
 <div className="mt-1 font-mono text-lg text-orange-700 dark:text-orange-300">{Math.round(trace.totalTime)}ms</div>
 </div>
 <div className="rounded-md border border-border bg-page p-3">
 <div className="text-xs text-muted">Cache</div>
 <div className={`mt-1 text-lg ${trace.cacheHit ? "text-emerald-300" : "text-primary"}`}>
 {trace.cacheHit ? "Hit" : "Miss"}
 </div>
 </div>
 </div>

 <div className="rounded-lg border border-border bg-page p-4">
 <div className="flex items-center gap-2 text-sm font-semibold text-primary">
 <Radio className="h-4 w-4 text-blue-700 dark:text-blue-400" />
 Providers
 </div>
 <div className="mt-3 flex flex-wrap gap-2">
 {(trace.providersUsed ?? []).length === 0 ? (
 <span className="text-sm text-muted">No providers recorded.</span>
 ) : (
 trace.providersUsed?.map((provider) => (
 <span key={provider} className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">
 {provider}
 </span>
 ))
 )}
 </div>
 </div>

 <div className="rounded-lg border border-border bg-page p-4">
 <div className="flex items-center gap-2 text-sm font-semibold text-primary">
 <Clock className="h-4 w-4 text-blue-700 dark:text-blue-400" />
 Step timing
 </div>
 <div className="mt-4 space-y-3">
 {steps.length === 0 ? (
 <div className="text-sm text-muted">No step timings recorded.</div>
 ) : (
 steps.map((step) => {
 const width = trace.totalTime > 0 ? Math.max(4, Math.round(((step.duration ?? 0) / trace.totalTime) * 100)) : 0;
 return (
 <div key={`${step.name}-${step.duration}-${step.status}`}>
 <div className="flex items-center justify-between gap-3 text-sm">
 <div className="flex items-center gap-2">
 {step.status === "success" || step.status === "hit" ? (
 <CheckCircle2 className="h-4 w-4 text-emerald-300" />
 ) : (
 <XCircle className="h-4 w-4 text-red-700 dark:text-red-300" />
 )}
 <span className="text-primary">{step.name}</span>
 <span className={`text-xs ${statusClass(step.status)}`}>{step.status}</span>
 </div>
 <span className="font-mono text-xs text-secondary">{step.duration ?? 0}ms</span>
 </div>
 <div className="mt-2 h-1.5 rounded-full bg-black/5 dark:bg-card/5">
 <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${width}%` }} />
 </div>
 </div>
 );
 })
 )}
 </div>
 {slowestStep && (
 <div className="mt-4 rounded-md border border-orange-500/20 bg-orange-500/10 p-3 text-xs text-orange-200">
 Slowest step: {slowestStep.name} at {slowestStep.duration ?? 0}ms.
 </div>
 )}
 </div>

 <div className="rounded-lg border border-border bg-page p-4 text-sm">
 <div className="flex items-center gap-2 font-semibold text-primary">
 <Database className="h-4 w-4 text-blue-700 dark:text-blue-400" />
 Timing metadata
 </div>
 <dl className="mt-3 space-y-2 text-xs">
 <div className="flex justify-between gap-4">
 <dt className="text-muted">Timestamp</dt>
 <dd className="text-right text-primary">{formatTimestamp(trace.timestamp)}</dd>
 </div>
 <div className="flex justify-between gap-4">
 <dt className="text-muted">Start time</dt>
 <dd className="text-right font-mono text-primary">{trace.startTime ?? "--"}</dd>
 </div>
 </dl>
 </div>

 <JsonBlock trace={trace} />
 </aside>
 );
}

export default function RequestsPage() {
 const { data, error, isLoading } = useSWR<Trace[]>("/debug/requests", fetcher, {
 refreshInterval: 5000,
 });
 const traces = data ?? [];
 const [selectedId, setSelectedId] = useState<string | null>(null);
 const selectedTrace = useMemo(() => {
 return traces.find((trace) => trace.id === selectedId) ?? traces[0] ?? null;
 }, [selectedId, traces]);

 return (
 <main className="container mx-auto max-w-screen-2xl space-y-8 p-8">
 <div>
 <h1 className="text-3xl font-bold tracking-tight">Requests</h1>
 <p className="mt-2 text-secondary">Recent proxy traces, provider calls, cache behavior, and execution timing.</p>
 </div>

 {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{error.message}</div>}

 <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_520px]">
 <div className="rounded-lg border border-border bg-card">
 <div className="flex items-center gap-2 border-b border-border p-5">
 <ListChecks className="h-5 w-5 text-blue-700 dark:text-blue-400" />
 <h2 className="font-semibold">Recent Traces</h2>
 </div>
 {isLoading ? (
 <div className="p-8 text-sm text-muted">Loading traces...</div>
 ) : traces.length === 0 ? (
 <div className="p-8 text-sm text-muted">No requests have been recorded yet.</div>
 ) : (
 <div className="divide-y divide-border/50">
 {traces.map((trace) => {
 const selected = selectedTrace?.id === trace.id;
 return (
 <button
 key={trace.id}
 type="button"
 onClick={() => setSelectedId(trace.id)}
 className={`grid w-full grid-cols-1 gap-3 p-5 text-left transition-colors hover:bg-card dark:hover:bg-card md:grid-cols-[1fr_120px_180px] ${
 selected ? "bg-blue-500/10" : ""
 }`}
 >
 <div>
 <div className="font-medium">{trace.query}</div>
 <div className="mt-1 font-mono text-xs text-muted">{trace.id}</div>
 <div className="mt-2 flex flex-wrap gap-2">
 {trace.cacheHit && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">cache hit</span>}
 {(trace.providersUsed ?? []).map((provider) => (
 <span key={provider} className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-200">{provider}</span>
 ))}
 </div>
 </div>
 <div className="flex items-center gap-2 font-mono text-sm text-orange-700 dark:text-orange-300">
 <Clock className="h-4 w-4" />
 {Math.round(trace.totalTime)}ms
 </div>
 <div className="text-sm text-muted">{formatTimestamp(trace.timestamp)}</div>
 </button>
 );
 })}
 </div>
 )}
 </div>

 {selectedTrace ? (
 <TraceDetail trace={selectedTrace} />
 ) : (
 <div className="rounded-lg border border-border bg-card p-8 text-sm text-muted">Select a trace to view details.</div>
 )}
 </section>
 </main>
 );
}
