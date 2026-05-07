"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";

import {
  Activity,
  AlertTriangle,
  ArrowDown,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  ClipboardCheck,
  Clock,

  Disc3,
  GitCompare,
  Layers,
  List,
  Loader2,
  MousePointerClick,
  RotateCcw,
  Search,
  Pencil,
  Send,
  Server,
  UserRound,
  X,
  Zap,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
   Quick Test Presets
   ──────────────────────────────────────────────────────────────────────── */

type Preset = { label: string; values: Record<string, string> };

const PRESETS: Record<string, Preset[]> = {
  "artist-lookup": [
    { label: "Radiohead", values: { term: "Radiohead" } },
    { label: "Backstreet Boys", values: { term: "Backstreet Boys" } },
    { label: "Björk (unicode)", values: { term: "Björk" } },
    { label: "zzz-nonexistent", values: { term: "zzz-nonexistent-artist-12345" } },
  ],
  "artist-by-id": [
    { label: "Radiohead", values: { id: "a74b1b7f-71a5-4011-9441-d0b5e4122711" } },
    { label: "Backstreet Boys", values: { id: "8e931ed2-7b22-4f26-8e94-49fabb3024ef" } },
    { label: "Invalid MBID", values: { id: "00000000-0000-0000-0000-000000000000" } },
  ],
  "album-by-id": [
    { label: "OK Computer", values: { id: "b1392450-e666-3926-a536-22c65f834433" } },
  ],
};

/* ────────────────────────────────────────────────────────────────────────────
   Clipboard helper
   ──────────────────────────────────────────────────────────────────────── */

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────────── */

type ViewMode = "raw" | "formatted";

type EndpointResult = {
  data: unknown;
  timing: number;
  headers: Record<string, string>;
  error: string | null;
};

type ContractField = {
  key: string;
  present: boolean;
  required: boolean;
};

/* ────────────────────────────────────────────────────────────────────────────
   Contract field definitions per endpoint
   ──────────────────────────────────────────────────────────────────────── */

const ARTIST_LOOKUP_FIELDS: Array<{ key: string; required: boolean }> = [
  { key: "artistName", required: true },
  { key: "foreignArtistId", required: true },
  { key: "overview", required: false },
  { key: "images", required: false },
  { key: "albums", required: false },
  { key: "ratings", required: false },
];

const ARTIST_BY_ID_FIELDS: Array<{ key: string; required: boolean }> = [
  { key: "artistName", required: true },
  { key: "foreignArtistId", required: true },
  { key: "overview", required: false },
  { key: "images", required: true },
  { key: "albums", required: true },
  { key: "rating", required: false },
  { key: "links", required: false },
  { key: "genres", required: false },
];

// NOTE: No ALBUM_FIELDS needed — there is no /api/v1/album?artistId= route.
// Albums are embedded in the Artist by ID response.
// Album by ID uses ALBUM_BY_ID_FIELDS below.

const ALBUM_BY_ID_FIELDS: Array<{ key: string; required: boolean }> = [
  { key: "title", required: true },
  { key: "foreignAlbumId", required: true },
  { key: "media", required: false },
  { key: "releases", required: false },
  { key: "artist", required: false },
  { key: "images", required: false },
  { key: "ratings", required: false },
];

const RELEASE_FIELDS: Array<{ key: string; required: boolean }> = [
  { key: "guid", required: false },
  { key: "title", required: false },
  { key: "approved", required: false },
  { key: "rejections", required: false },
];

const QUEUE_FIELDS: Array<{ key: string; required: boolean }> = [
  { key: "artistId", required: false },
  { key: "albumId", required: false },
  { key: "status", required: false },
  { key: "trackedDownloadStatus", required: false },
];

/* ────────────────────────────────────────────────────────────────────────────
   Contract summary
   ──────────────────────────────────────────────────────────────────────── */

function ContractSummaryBanner({ fields }: { fields: ContractField[] }) {
  if (fields.length === 0) return null;
  const missingRequired = fields.filter((f) => f.required && !f.present);
  const allPresent = fields.every((f) => f.present);

  if (missingRequired.length > 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm">
        <X className="h-4 w-4 text-red-400" />
        <span className="text-red-300">
          Missing required: {missingRequired.map((f) => f.key).join(", ")}
        </span>
      </div>
    );
  }

  if (allPresent) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm">
        <Check className="h-4 w-4 text-emerald-400" />
        <span className="text-emerald-300">Contract OK — all fields present</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
      <AlertTriangle className="h-4 w-4 text-amber-400" />
      <span className="text-amber-300">Contract OK — some optional fields missing</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────────── */

function evaluateContract(
  data: unknown,
  fieldDefs: Array<{ key: string; required: boolean }>
): ContractField[] {
  if (!data || typeof data !== "object") {
    return fieldDefs.map((f) => ({ ...f, present: false }));
  }

  // If response is an array, check the first item
  const target = Array.isArray(data) ? (data[0] ?? {}) : data;
  const obj = target as Record<string, unknown>;

  return fieldDefs.map((f) => ({
    key: f.key,
    required: f.required,
    present: obj[f.key] !== undefined && obj[f.key] !== null,
  }));
}

function extractResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  const interesting = [
    "content-type",
    "x-providers",
    "x-request-id",
    "x-response-time",
    "x-cache",
    "cache-control",
  ];

  headers.forEach((value, key) => {
    if (interesting.includes(key.toLowerCase())) {
      result[key] = value;
    }
  });

  return result;
}

function ContractIndicators({ fields }: { fields: ContractField[] }) {
  if (fields.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {fields.map((field) => {
        let icon: React.ReactNode;
        let colorClass: string;

        if (field.present) {
          icon = <Check className="h-3 w-3" />;
          colorClass = "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
        } else if (field.required) {
          icon = <X className="h-3 w-3" />;
          colorClass = "text-red-400 border-red-500/30 bg-red-500/10";
        } else {
          icon = <AlertTriangle className="h-3 w-3" />;
          colorClass = "text-amber-400 border-amber-500/30 bg-amber-500/10";
        }

        return (
          <span
            key={field.key}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono ${colorClass}`}
          >
            {icon}
            {field.key}
          </span>
        );
      })}
    </div>
  );
}

function ResponseMeta({
  result,
  showHeaders,
  onToggleHeaders,
}: {
  result: EndpointResult;
  showHeaders: boolean;
  onToggleHeaders: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {result.timing}ms
      </span>
      {result.data !== null && (
        <span className="inline-flex items-center gap-1">
          {Array.isArray(result.data) ? (
            <>
              <List className="h-3 w-3" />
              {result.data.length} items
            </>
          ) : (
            <>
              <Braces className="h-3 w-3" />
              object
            </>
          )}
        </span>
      )}
      <button
        type="button"
        onClick={onToggleHeaders}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors hover:bg-white/5 hover:text-white"
      >
        <Server className="h-3 w-3" />
        Headers
        {showHeaders ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}

function FormattedArrayView({ data }: { data: unknown[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-border/40 bg-background/40 p-4 text-sm text-gray-500">
        Empty array — no items returned.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((item, index) => {
        const obj = item as Record<string, unknown>;
        const label =
          (obj.artistName as string) ||
          (obj.title as string) ||
          (obj.name as string) ||
          (obj.guid as string) ||
          `Item ${index + 1}`;

        return (
          <details
            key={index}
            className="group rounded-md border border-border/40 bg-background/40"
          >
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm hover:bg-white/5">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
              <span className="truncate font-medium text-gray-200">{label}</span>
              <span className="ml-auto shrink-0 text-xs text-gray-600">
                {Object.keys(obj).length} fields
              </span>
            </summary>
            <div className="border-t border-border/30 px-4 py-3">
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(obj).map(([key, value]) => (
                    <tr key={key} className="border-b border-border/20 last:border-0">
                      <td className="py-1.5 pr-4 align-top font-mono text-blue-300 whitespace-nowrap">
                        {key}
                      </td>
                      <td className="py-1.5 text-gray-300 break-all">
                        {value === null ? (
                          <span className="text-gray-600">null</span>
                        ) : value === undefined ? (
                          <span className="text-gray-600">undefined</span>
                        ) : typeof value === "object" ? (
                          <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/20 px-2 py-1 text-gray-400">
                            {JSON.stringify(value, null, 2)}
                          </pre>
                        ) : typeof value === "boolean" ? (
                          <span
                            className={
                              value ? "text-emerald-400" : "text-red-400"
                            }
                          >
                            {String(value)}
                          </span>
                        ) : (
                          String(value)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </div>
  );
}

function FormattedObjectView({ data }: { data: Record<string, unknown> }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {Object.entries(data).map(([key, value]) => (
          <tr key={key} className="border-b border-border/20 last:border-0">
            <td className="py-1.5 pr-4 align-top font-mono text-blue-300 whitespace-nowrap">
              {key}
            </td>
            <td className="py-1.5 text-gray-300 break-all">
              {value === null ? (
                <span className="text-gray-600">null</span>
              ) : value === undefined ? (
                <span className="text-gray-600">undefined</span>
              ) : typeof value === "object" ? (
                <details className="group/nested">
                  <summary className="cursor-pointer text-gray-400 hover:text-white">
                    {Array.isArray(value)
                      ? `[${value.length} items]`
                      : `{${Object.keys(value as object).length} fields}`}
                  </summary>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/20 px-2 py-1 text-gray-400">
                    {JSON.stringify(value, null, 2)}
                  </pre>
                </details>
              ) : typeof value === "boolean" ? (
                <span
                  className={value ? "text-emerald-400" : "text-red-400"}
                >
                  {String(value)}
                </span>
              ) : (
                String(value)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   EndpointSection — reusable section for each Lidarr API group
   ──────────────────────────────────────────────────────────────────────── */

function EndpointSection({
  id,
  title,
  description,
  method,
  path,
  icon: Icon,
  inputs,
  contractFields,
  buildUrl,
  onResultData,
  externalValues,
  inputHint,
  renderAfterResult,
  autoExecuteTrigger,
}: {
  id: string;
  title: string;
  description: string;
  method: string;
  path: string;
  icon: typeof Search;
  inputs: Array<{
    name: string;
    label: string;
    placeholder: string;
    required?: boolean;
  }>;
  contractFields: Array<{ key: string; required: boolean }>;
  buildUrl: (values: Record<string, string>) => string | null;
  onResultData?: (data: unknown) => void;
  externalValues?: Record<string, string>;
  inputHint?: string;
  renderAfterResult?: (result: EndpointResult) => React.ReactNode;
  autoExecuteTrigger?: number;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("formatted");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EndpointResult | null>(null);
  const [prevResult, setPrevResult] = useState<EndpointResult | null>(null);
  const [showHeaders, setShowHeaders] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [autoFilledKeys, setAutoFilledKeys] = useState<Set<string>>(new Set());
  const [overrideMode, setOverrideMode] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pendingAutoExecRef = useRef(0);

  const presets = PRESETS[id] || [];

  // Sync externally-pushed values (auto-fill from other sections)
  useEffect(() => {
    if (externalValues && Object.keys(externalValues).length > 0) {
      setValues((prev) => ({ ...prev, ...externalValues }));
      setAutoFilledKeys(new Set(Object.keys(externalValues)));
      setOverrideMode(false);
    }
  }, [externalValues]);

  // Auto-execute when trigger counter increments
  useEffect(() => {
    if (autoExecuteTrigger && autoExecuteTrigger > 0) {
      pendingAutoExecRef.current = autoExecuteTrigger;
    }
  }, [autoExecuteTrigger]);

  // Deferred auto-execute: runs after values are synced
  useEffect(() => {
    if (pendingAutoExecRef.current > 0 && externalValues) {
      const merged = { ...values, ...externalValues };
      const url = buildUrl(merged);
      if (url) {
        pendingAutoExecRef.current = 0;
        // Small delay to ensure DOM has settled
        const timer = setTimeout(() => {
          setCollapsed(false);
          // Execute with merged values directly
          const doExec = async () => {
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            setLoading(true);
            if (result) setPrevResult(result);
            setResult(null);
            setLastUrl(url);
            setShowDiff(false);
            const start = performance.now();
            try {
              const res = await fetch(url, { signal: controller.signal, credentials: "include" });
              const timing = Math.round(performance.now() - start);
              const headers = extractResponseHeaders(res.headers);
              const contentType = res.headers.get("content-type") || "";
              const body = await res.text();
              const isJson = contentType.includes("application/json");
              const data = isJson && body ? JSON.parse(body) : body || null;
              setResult({ data, timing, headers, error: res.ok ? null : `HTTP ${res.status} ${res.statusText}` });
            } catch (err: any) {
              if (err.name === "AbortError") return;
              const timing = Math.round(performance.now() - start);
              setResult({ data: null, timing, headers: {}, error: err.message || "Request failed" });
            } finally {
              setLoading(false);
            }
          };
          doExec();
        }, 150);
        return () => clearTimeout(timer);
      }
    }
  }, [values, externalValues, autoExecuteTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Emit result data upstream for cross-section communication
  useEffect(() => {
    if (result?.data && !result.error && onResultData) {
      onResultData(result.data);
    }
  }, [result, onResultData]);

  const handleCopy = useCallback(async () => {
    if (!result?.data) return;
    const ok = await copyToClipboard(JSON.stringify(result.data, null, 2));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [result]);

  const execute = useCallback(
    async (urlOverride?: string) => {
      const url = urlOverride ?? buildUrl(values);
      if (!url) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      if (result) setPrevResult(result);
      setResult(null);
      setLastUrl(url);
      setShowDiff(false);

      const start = performance.now();
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          credentials: "include",
        });
        const timing = Math.round(performance.now() - start);
        const headers = extractResponseHeaders(res.headers);
        const contentType = res.headers.get("content-type") || "";
        const body = await res.text();
        const isJson = contentType.includes("application/json");
        const data = isJson && body ? JSON.parse(body) : body || null;

        setResult({
          data,
          timing,
          headers,
          error: res.ok ? null : `HTTP ${res.status} ${res.statusText}`,
        });
      } catch (err: any) {
        if (err.name === "AbortError") return;
        const timing = Math.round(performance.now() - start);
        setResult({
          data: null,
          timing,
          headers: {},
          error: err.message || "Request failed",
        });
      } finally {
        setLoading(false);
      }
    },
    [values, buildUrl, result]
  );

  const replay = useCallback(async () => {
    if (!lastUrl) return;
    await execute(lastUrl);
  }, [lastUrl, execute]);

  const contract = result?.data
    ? evaluateContract(result.data, contractFields)
    : [];

  return (
    <section
      id={id}
      className="rounded-lg border border-border/60 bg-card transition-colors"
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.02]"
      >
        <Icon className="h-5 w-5 shrink-0 text-blue-400" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-gray-100">{title}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{description}</p>
        </div>
        <span className="shrink-0 rounded-md border border-border/50 bg-background px-2.5 py-1 font-mono text-xs text-gray-400">
          {method} {path}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${
            collapsed ? "-rotate-90" : ""
          }`}
        />
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="space-y-4 border-t border-border/40 px-5 py-4">
          {/* Presets */}
          {presets.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Quick test:</span>
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setValues(preset.values)}
                  className="rounded-full border border-border/50 px-2.5 py-0.5 text-[11px] text-gray-400 transition-colors hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-300"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          {/* Input fields */}
          <div className="flex flex-wrap items-end gap-3">
            {inputs.map((input) => {
              const isAutoFilled = autoFilledKeys.has(input.name) && !overrideMode;
              return (
                <div key={input.name} className="min-w-[200px] flex-1">
                  <label
                    htmlFor={`${id}-${input.name}`}
                    className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-400"
                  >
                    {input.label}
                    {input.required && (
                      <span className="ml-1 text-red-400">*</span>
                    )}
                    {isAutoFilled && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
                        <Zap className="h-2.5 w-2.5" />
                        Auto-selected
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      id={`${id}-${input.name}`}
                      value={values[input.name] || ""}
                      readOnly={isAutoFilled}
                      onChange={(e) => {
                        setAutoFilledKeys((prev) => {
                          const next = new Set(prev);
                          next.delete(input.name);
                          return next;
                        });
                        setValues((prev) => ({
                          ...prev,
                          [input.name]: e.target.value,
                        }));
                      }}
                      placeholder={input.placeholder}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") execute();
                      }}
                      className={`w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors ${
                        isAutoFilled
                          ? "border-blue-500/30 bg-blue-500/5 text-blue-200 cursor-default"
                          : "border-border/60 bg-background focus:border-blue-500"
                      }`}
                    />
                    {isAutoFilled && (
                      <button
                        type="button"
                        title="Override auto-fill"
                        onClick={() => setOverrideMode(true)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-blue-400/50 transition-colors hover:bg-blue-500/10 hover:text-blue-300"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => execute()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Execute
            </button>
            {lastUrl && !loading && (
              <button
                type="button"
                onClick={replay}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Replay
              </button>
            )}
          </div>

          {/* Auto-fill hint */}
          {inputHint && (
            <div className="flex items-center gap-1.5 text-xs text-blue-400/70">
              <MousePointerClick className="h-3 w-3" />
              {inputHint}
            </div>
          )}

          {/* Result area */}
          {result && (
            <div className="space-y-3">
              {/* Error */}
              {result.error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {result.error}
                </div>
              )}

              {/* Meta bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ResponseMeta
                  result={result}
                  showHeaders={showHeaders}
                  onToggleHeaders={() => setShowHeaders(!showHeaders)}
                />
                <div className="flex items-center gap-2">
                  {/* Copy */}
                  {result.data !== null && (
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
                    >
                      {copied ? (
                        <ClipboardCheck className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Clipboard className="h-3 w-3" />
                      )}
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  )}
                  {/* Diff toggle */}
                  {prevResult && (
                    <button
                      type="button"
                      onClick={() => setShowDiff(!showDiff)}
                      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                        showDiff
                          ? "bg-purple-500/20 text-purple-300"
                          : "text-gray-400 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <GitCompare className="h-3 w-3" />
                      Diff
                    </button>
                  )}
                  {/* View mode toggle */}
                  <div className="inline-flex rounded-md border border-border/70 bg-background p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode("formatted")}
                      className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs transition-colors ${
                        viewMode === "formatted"
                          ? "bg-white/10 text-white"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      <Layers className="h-3 w-3" />
                      Formatted
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("raw")}
                      className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs transition-colors ${
                        viewMode === "raw"
                          ? "bg-white/10 text-white"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      <Braces className="h-3 w-3" />
                      Raw JSON
                    </button>
                  </div>
                </div>
              </div>

              {/* Response headers */}
              {showHeaders && Object.keys(result.headers).length > 0 && (
                <div className="rounded-md border border-border/40 bg-background/40 px-4 py-3">
                  <h4 className="mb-2 text-xs font-medium text-gray-400">
                    Response Headers
                  </h4>
                  <div className="space-y-1 font-mono text-xs">
                    {Object.entries(result.headers).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="text-blue-300">{key}:</span>
                        <span className="text-gray-300 break-all">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Contract summary banner */}
              <ContractSummaryBanner fields={contract} />

              {/* Contract field indicators */}
              {contract.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-medium text-gray-400">
                    Contract Coverage
                  </h4>
                  <ContractIndicators fields={contract} />
                </div>
              )}

              {/* Diff view */}
              {showDiff && prevResult?.data !== null && result.data !== null && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <h4 className="mb-1.5 text-xs font-medium text-gray-500">
                      Previous ({prevResult?.timing}ms)
                    </h4>
                    <pre className="max-h-[400px] overflow-auto rounded-md border border-border/40 bg-black/20 p-3 text-xs text-gray-500">
                      {JSON.stringify(prevResult?.data, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <h4 className="mb-1.5 text-xs font-medium text-gray-300">
                      Current ({result.timing}ms)
                    </h4>
                    <pre className="max-h-[400px] overflow-auto rounded-md border border-border/40 bg-black/30 p-3 text-xs text-gray-300">
                      {JSON.stringify(result.data, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {/* Data view */}
              {!showDiff && result.data !== null && (
                <div>
                  {viewMode === "raw" ? (
                    <pre className="max-h-[600px] overflow-auto rounded-md bg-black/30 p-4 text-xs text-gray-300">
                      {JSON.stringify(result.data, null, 2)}
                    </pre>
                  ) : Array.isArray(result.data) ? (
                    <FormattedArrayView data={result.data} />
                  ) : typeof result.data === "object" ? (
                    <FormattedObjectView
                      data={result.data as Record<string, unknown>}
                    />
                  ) : (
                    <pre className="rounded-md bg-black/30 p-4 text-xs text-gray-300">
                      {String(result.data)}
                    </pre>
                  )}
                </div>
              )}

              {/* Picker slot for cross-section selection */}
              {renderAfterResult && renderAfterResult(result)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Flow Arrow  — visual connector between sections
   ──────────────────────────────────────────────────────────────────────── */

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1">
      <ArrowDown className="h-4 w-4 text-blue-500/50" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-blue-500/50">
        {label}
      </span>
      <ArrowDown className="h-4 w-4 text-blue-500/50" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Artist Picker — selectable rows from lookup results
   ──────────────────────────────────────────────────────────────────────── */

function ArtistPicker({
  result,
  onSelect,
}: {
  result: EndpointResult;
  onSelect: (id: string, name: string) => void;
}) {
  const autoSelectedRef = useRef(false);

  const artists = (!result.data || result.error) ? [] : (Array.isArray(result.data) ? result.data : []);
  const validArtists = artists.filter((a: Record<string, unknown>) => String(a.foreignArtistId || ""));

  // Auto-select when exactly one result
  useEffect(() => {
    if (validArtists.length === 1 && !autoSelectedRef.current) {
      autoSelectedRef.current = true;
      const artist = validArtists[0] as Record<string, unknown>;
      const id = String(artist.foreignArtistId || "");
      const name = String(artist.artistName || artist.name || "Unknown");
      if (id) onSelect(id, name);
    } else if (validArtists.length !== 1) {
      autoSelectedRef.current = false;
    }
  }, [validArtists.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (validArtists.length === 0) return null;

  // Single result — show auto-selected confirmation
  if (validArtists.length === 1) {
    const artist = validArtists[0] as Record<string, unknown>;
    const name = String(artist.artistName || artist.name || "Unknown");
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-4 py-2.5 text-sm">
        <Zap className="h-3.5 w-3.5 text-blue-400" />
        <span className="text-blue-200">Auto-selected:</span>
        <span className="font-medium text-blue-100">{name}</span>
        <span className="text-[10px] text-blue-400/60">— single result</span>
      </div>
    );
  }

  // Multiple results — show selectable list
  return (
    <div className="mt-3 rounded-md border border-blue-500/20 bg-blue-500/5 p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-blue-300">
        <MousePointerClick className="h-3 w-3" />
        {validArtists.length} artists found — select one to continue
      </h4>
      <div className="max-h-[200px] space-y-1 overflow-y-auto">
        {validArtists.slice(0, 20).map((artist: Record<string, unknown>, i: number) => {
          const id = String(artist.foreignArtistId || "");
          const name = String(artist.artistName || artist.name || "Unknown");
          const disambiguation = artist.disambiguation
            ? ` (${String(artist.disambiguation)})`
            : "";
          return (
            <button
              key={`${id}-${i}`}
              type="button"
              onClick={() => onSelect(id, name)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-blue-500/10"
            >
              <UserRound className="h-3.5 w-3.5 shrink-0 text-blue-400/60" />
              <span className="min-w-0 flex-1 truncate text-gray-200">
                {name}
                <span className="text-gray-500">{disambiguation}</span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-gray-500">
                {id.slice(0, 8)}…
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Album Picker — selectable rows from artist-by-id embedded albums
   ──────────────────────────────────────────────────────────────────────── */

function AlbumPicker({
  result,
  onSelect,
}: {
  result: EndpointResult;
  onSelect: (id: string, title: string) => void;
}) {
  const autoSelectedRef = useRef(false);

  const albums = (!result.data || result.error)
    ? []
    : (Array.isArray((result.data as Record<string, unknown>).albums)
      ? ((result.data as Record<string, unknown>).albums as Record<string, unknown>[])
      : []);
  const validAlbums = albums.filter((a) => String(a.foreignAlbumId || ""));

  // Auto-select when exactly one album
  useEffect(() => {
    if (validAlbums.length === 1 && !autoSelectedRef.current) {
      autoSelectedRef.current = true;
      const album = validAlbums[0];
      const id = String(album.foreignAlbumId || "");
      const title = String(album.title || "Untitled");
      if (id) onSelect(id, title);
    } else if (validAlbums.length !== 1) {
      autoSelectedRef.current = false;
    }
  }, [validAlbums.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (validAlbums.length === 0) return null;

  // Single album — show auto-selected confirmation
  if (validAlbums.length === 1) {
    const album = validAlbums[0];
    const title = String(album.title || "Untitled");
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-sm">
        <Zap className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-emerald-200">Auto-selected:</span>
        <span className="font-medium text-emerald-100">{title}</span>
        <span className="text-[10px] text-emerald-400/60">— single album</span>
      </div>
    );
  }

  // Multiple albums — show selectable list
  return (
    <div className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-300">
        <MousePointerClick className="h-3 w-3" />
        {validAlbums.length} albums found — select one to continue
      </h4>
      <div className="max-h-[240px] space-y-1 overflow-y-auto">
        {validAlbums.slice(0, 30).map((album: Record<string, unknown>, i: number) => {
          const id = String(album.foreignAlbumId || "");
          const title = String(album.title || "Untitled");
          const year = album.releaseDate
            ? new Date(String(album.releaseDate)).getFullYear()
            : null;
          return (
            <button
              key={`${id}-${i}`}
              type="button"
              onClick={() => onSelect(id, title)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-emerald-500/10"
            >
              <Disc3 className="h-3.5 w-3.5 shrink-0 text-emerald-400/60" />
              <span className="min-w-0 flex-1 truncate text-gray-200">
                {title}
                {year && (
                  <span className="ml-1.5 text-gray-500">({year})</span>
                )}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-gray-500">
                {id.slice(0, 8)}…
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────────── */

export default function LidarrMirrorPage() {
  // Cross-section auto-fill state
  const [selectedArtistId, setSelectedArtistId] = useState("");
  const [selectedAlbumId, setSelectedAlbumId] = useState("");
  const [selectedArtistName, setSelectedArtistName] = useState("");
  const [selectedAlbumTitle, setSelectedAlbumTitle] = useState("");

  // Auto-execute triggers (increment to fire)
  const [artistByIdTrigger, setArtistByIdTrigger] = useState(0);
  const [albumByIdTrigger, setAlbumByIdTrigger] = useState(0);

  const handleSelectArtist = useCallback((id: string, name: string) => {
    setSelectedArtistId(id);
    setSelectedArtistName(name);
    // Reset downstream: clear album selection when artist changes
    setSelectedAlbumId("");
    setSelectedAlbumTitle("");
    // Auto-trigger Artist by ID request
    setArtistByIdTrigger((prev) => prev + 1);
    // Scroll to artist-by-id section
    document.getElementById("artist-by-id")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleSelectAlbum = useCallback((id: string, title: string) => {
    setSelectedAlbumId(id);
    setSelectedAlbumTitle(title);
    // Auto-trigger Album by ID request
    setAlbumByIdTrigger((prev) => prev + 1);
    document.getElementById("album-by-id")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Stable references for external values (avoids infinite re-render loops)
  const artistExternal = useMemo(
    () => (selectedArtistId ? { id: selectedArtistId } : undefined),
    [selectedArtistId],
  );
  const albumExternal = useMemo(
    () => (selectedAlbumId ? { id: selectedAlbumId } : undefined),
    [selectedAlbumId],
  );
  const releaseExternal = useMemo(
    () =>
      selectedArtistId || selectedAlbumId
        ? {
            ...(selectedArtistId ? { artistId: selectedArtistId } : {}),
            ...(selectedAlbumId ? { albumId: selectedAlbumId } : {}),
          }
        : undefined,
    [selectedArtistId, selectedAlbumId],
  );
  const queueExternal = useMemo(
    () => (selectedArtistId ? { artistId: selectedArtistId } : undefined),
    [selectedArtistId],
  );

  return (
    <main className="container mx-auto max-w-screen-2xl space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Lidarr Mirror</h1>
        <p className="mt-2 text-gray-400">
          Read-only verification panel — mirrors exact Lidarr API calls to
          visually confirm proxy correctness and contract coverage.
        </p>
        <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm text-blue-300">
          <p className="font-medium">⚡ Auto-Guided Flow: Search → auto-selects single results → auto-executes downstream requests → full chain in one click</p>
          <p className="mt-1 text-xs text-blue-400/70">Single results are auto-selected. Multiple results show a picker. Each selection auto-triggers the next request. Override any auto-fill with the ✏️ button.</p>
        </div>

        {/* Selection state indicator */}
        {(selectedArtistName || selectedAlbumTitle) && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border/40 bg-card px-4 py-2.5 text-sm">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-500">Active selection:</span>
            {selectedArtistName && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs text-blue-300">
                <UserRound className="h-3 w-3" />
                {selectedArtistName}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedArtistId("");
                    setSelectedArtistName("");
                    // Cascade: clearing artist also clears album
                    setSelectedAlbumId("");
                    setSelectedAlbumTitle("");
                  }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-blue-500/20"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            )}
            {selectedAlbumTitle && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                <Disc3 className="h-3 w-3" />
                {selectedAlbumTitle}
                <button
                  type="button"
                  onClick={() => { setSelectedAlbumId(""); setSelectedAlbumTitle(""); }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-500/20"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* 1 — Artist Lookup */}
      <EndpointSection
        id="artist-lookup"
        title="Artist Lookup"
        description="Search for artists by name — returns candidates with scores."
        method="GET"
        path="/api/v1/artist/lookup"
        icon={Search}
        inputs={[
          {
            name: "term",
            label: "Artist Name",
            placeholder: "e.g. Radiohead",
            required: true,
          },
        ]}
        contractFields={ARTIST_LOOKUP_FIELDS}
        buildUrl={(v) =>
          v.term?.trim()
            ? `/api/v1/artist/lookup?term=${encodeURIComponent(v.term.trim())}`
            : null
        }
        renderAfterResult={(res) => (
          <ArtistPicker result={res} onSelect={handleSelectArtist} />
        )}
      />

      <FlowArrow label={selectedArtistId ? "auto-executing ⚡" : "select artist"} />

      {/* 2 — Artist by ID */}
      <EndpointSection
        id="artist-by-id"
        title="Artist by ID"
        description="Fetch full artist metadata by foreignArtistId (MusicBrainz MBID)."
        method="GET"
        path="/api/v1/artist/{id}"
        icon={UserRound}
        inputs={[
          {
            name: "id",
            label: "foreignArtistId",
            placeholder: "e.g. a74b1b7f-71a5-4011-9441-d0b5e4122711",
            required: true,
          },
        ]}
        contractFields={ARTIST_BY_ID_FIELDS}
        buildUrl={(v) =>
          v.id?.trim() ? `/api/v1/artist/${encodeURIComponent(v.id.trim())}` : null
        }
        externalValues={artistExternal}
        autoExecuteTrigger={artistByIdTrigger}
        inputHint={selectedArtistName ? `Auto-filled from "${selectedArtistName}"` : undefined}
        renderAfterResult={(res) => (
          <AlbumPicker result={res} onSelect={handleSelectAlbum} />
        )}
      />

      {/* NOTE: There is no /api/v1/album?artistId= route on this proxy.
         Albums are embedded in the Artist by ID response.
         The proxy uses /v1/album/:foreignAlbumId for individual album lookup. */}

      <FlowArrow label={selectedAlbumId ? "auto-executing ⚡" : "select album"} />

      {/* 3 — Album by ID */}
      <EndpointSection
        id="album-by-id"
        title="Album by ID"
        description="Fetch full album structure including tracks, media, and releases."
        method="GET"
        path="/api/v1/album/{id}"
        icon={Disc3}
        inputs={[
          {
            name: "id",
            label: "Album ID (foreignAlbumId)",
            placeholder: "e.g. 2d256b55-1265-337a-a7f1-050827a1a8ad",
            required: true,
          },
        ]}
        contractFields={ALBUM_BY_ID_FIELDS}
        buildUrl={(v) =>
          v.id?.trim() ? `/api/v1/album/${encodeURIComponent(v.id.trim())}` : null
        }
        externalValues={albumExternal}
        autoExecuteTrigger={albumByIdTrigger}
        inputHint={selectedAlbumTitle ? `Auto-filled from "${selectedAlbumTitle}"` : undefined}
      />

      <FlowArrow label="auto-filled" />

      {/* 4 — Release Search */}
      <EndpointSection
        id="release-search"
        title="Release Search"
        description="Search for release candidates by foreignArtistId (MBID) or foreignAlbumId (MBID)."
        method="GET"
        path="/api/v1/release"
        icon={Layers}
        inputs={[
          {
            name: "artistId",
            label: "foreignArtistId (MBID)",
            placeholder: "e.g. a74b1b7f-71a5-4011-9441-d0b5e4122711",
          },
          {
            name: "albumId",
            label: "foreignAlbumId (MBID)",
            placeholder: "e.g. b1392450-e666-3926-a536-22c65f834433",
          },
        ]}
        contractFields={RELEASE_FIELDS}
        buildUrl={(v) => {
          const params = new URLSearchParams();
          if (v.artistId?.trim()) params.set("artistId", v.artistId.trim());
          if (v.albumId?.trim()) params.set("albumId", v.albumId.trim());
          return params.toString() ? `/api/v1/release?${params}` : null;
        }}
        externalValues={releaseExternal}
        inputHint={
          selectedArtistName || selectedAlbumTitle
            ? `Auto-filled from selections`
            : undefined
        }
      />

      {/* 5 — Queue Details */}
      <EndpointSection
        id="queue-details"
        title="Queue Details"
        description="View download queue entries — typically returns empty array for metadata proxy."
        method="GET"
        path="/api/v1/queue/details"
        icon={Activity}
        inputs={[
          {
            name: "artistId",
            label: "foreignArtistId (optional, MBID)",
            placeholder: "e.g. a74b1b7f-71a5-4011-9441-d0b5e4122711",
          },
        ]}
        contractFields={QUEUE_FIELDS}
        buildUrl={(v) => {
          const params = new URLSearchParams();
          if (v.artistId?.trim()) params.set("artistId", v.artistId.trim());
          return `/api/v1/queue/details${params.toString() ? `?${params}` : ""}`;
        }}
        externalValues={queueExternal}
        inputHint={selectedArtistName ? `Auto-filled from "${selectedArtistName}"` : undefined}
      />
    </main>
  );
}

