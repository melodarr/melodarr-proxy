"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Rocket } from "lucide-react";
import { fetchJson, fetcher } from "@/lib/fetcher";

type UpdateStatus = {
  currentVersion?: string;
  latest?: {
    version?: string;
    tagName?: string;
    name?: string;
    publishedAt?: string;
    changelog?: string;
    htmlUrl?: string;
    repository?: string;
  } | null;
  updateAvailable?: boolean;
  checkedAt?: string;
  runner?: {
    enabled?: boolean;
    reason?: string | null;
    projectDir?: string;
    gitAvailable?: boolean;
    dockerAvailable?: boolean;
    hasGitCheckout?: boolean;
  };
  error?: string | null;
};

type UpdateResult = {
  ok?: boolean;
  message?: string;
  error?: string;
  previousCommit?: string;
  steps?: Array<{ name?: string; command?: string; stdout?: string; stderr?: string }>;
};

function formatDate(value?: string) {
  if (!value) return "--";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function Changelog({ body }: { body?: string }) {
  if (!body) {
    return <p className="text-sm text-gray-500">No changelog was provided for this release.</p>;
  }

  return (
    <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background p-4 text-sm leading-6 text-gray-300">
      {body}
    </pre>
  );
}

export default function UpdatesPage() {
  const { data, error, isLoading, mutate } = useSWR<UpdateStatus>("/api/update/status", fetcher);
  const [isUpdating, setIsUpdating] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);

  const updateAvailable = Boolean(data?.updateAvailable);
  const runnerEnabled = Boolean(data?.runner?.enabled);

  async function applyUpdate() {
    setIsUpdating(true);
    setResult(null);
    try {
      const response = await fetchJson<UpdateResult>("/api/update/apply", { method: "POST" });
      setResult(response);
      await mutate();
    } catch (updateError) {
      setResult({ ok: false, error: updateError instanceof Error ? updateError.message : "Update failed" });
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <main className="container mx-auto max-w-screen-2xl space-y-8 p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Updates</h1>
          <p className="mt-2 text-gray-400">Review releases, read the changelog, and apply updates from DevDash.</p>
        </div>
        <button
          type="button"
          onClick={() => mutate()}
          className="inline-flex items-center gap-2 rounded-md border border-border/70 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-white/5"
        >
          <RefreshCw className="h-4 w-4" />
          Check again
        </button>
      </div>

      {(error || data?.error) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          {error?.message || data?.error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-card p-6">
          <p className="text-sm text-gray-400">Installed</p>
          <p className="mt-2 text-3xl font-semibold">v{data?.currentVersion ?? "--"}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-card p-6">
          <p className="text-sm text-gray-400">Latest release</p>
          <p className="mt-2 text-3xl font-semibold">v{data?.latest?.version ?? "--"}</p>
          <p className="mt-2 text-xs text-gray-500">{formatDate(data?.latest?.publishedAt)}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-card p-6">
          <p className="text-sm text-gray-400">Status</p>
          <div className="mt-3 flex items-center gap-3">
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
            ) : updateAvailable ? (
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            )}
            <p className="text-xl font-semibold">
              {isLoading ? "Checking" : updateAvailable ? "Update available" : "Up to date"}
            </p>
          </div>
          <p className="mt-3 text-xs text-gray-500">Checked {formatDate(data?.checkedAt)}</p>
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Release notes</h2>
            <p className="mt-1 text-sm text-gray-400">{data?.latest?.name || data?.latest?.tagName || "Latest release"}</p>
          </div>
          {data?.latest?.htmlUrl && (
            <a
              href={data.latest.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-border/70 px-4 py-2 text-sm text-gray-200 hover:bg-white/5"
            >
              Open release
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
        <div className="mt-5">
          <Changelog body={data?.latest?.changelog} />
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Apply update</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
              DevDash will fetch the release, fast-forward the local checkout, rebuild the Compose stack, and restart services.
            </p>
            {!runnerEnabled && (
              <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                {data?.runner?.reason || "Update runner is unavailable in this environment."}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={applyUpdate}
            disabled={!updateAvailable || !runnerEnabled || isUpdating}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
          >
            {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {isUpdating ? "Updating" : "Update now"}
          </button>
        </div>

        {result && (
          <div className={`mt-5 rounded-lg border p-4 text-sm ${result.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`}>
            <p className="font-semibold">{result.ok ? result.message || "Update completed" : result.error || "Update failed"}</p>
            {result.steps && result.steps.length > 0 && (
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs text-gray-300">
                {JSON.stringify(result.steps, null, 2)}
              </pre>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
