"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  Braces,
  Check,
  Copy,
  Database,
  GripVertical,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Save,
  Server,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TestTube2,
  X,
} from "lucide-react";
import { fetchJson, fetcher } from "@/lib/fetcher";
import { clearCsrfToken } from "@/lib/csrf";
import { fetchWithFallback } from "@/lib/proxy";

type RuntimeValue = string | number | boolean;

type RuntimeEntry = {
  value: RuntimeValue;
  source: string;
};

type SettingsStatus = {
  enabled?: boolean;
  setupRequired?: boolean;
  authenticated?: boolean;
  csrfToken?: string | null;
};

type SettingsPayload = {
  csrfToken?: string | null;
  config?: Record<string, RuntimeEntry>;
  admin?: {
    passwordConfigured?: boolean;
    envPasswordConfigured?: boolean;
    bootstrapAvailable?: boolean;
  };
  server?: Record<string, RuntimeEntry>;
};

type FormValues = Record<string, string>;
type Message = { type: "success" | "error"; text: string } | null;
type ProviderTestResult = {
  ok?: boolean;
  provider?: string;
  query?: string;
  durationMs?: number;
  artistName?: string;
  albumCount?: number;
  sampleAlbums?: Array<{ name: string; year?: number | null }>;
  error?: string;
  details?: Record<string, unknown>;
};
type CustomMapping = {
  artistName?: string;
  albums?: string;
  albumName?: string;
  year?: string;
  imageUrl?: string;
};
type CustomProviderResult = {
  raw?: unknown;
  mapped?: { artistName?: string; albums?: Array<{ name?: string; year?: number | null; imageUrl?: string }> };
  errors?: Array<{ field: string; message: string }>;
  warnings?: Array<{ field: string; message: string }>;
  details?: Record<string, unknown>;
};
type MappingField = keyof CustomMapping;

const providerOptions = [
  { id: "musicbrainz", label: "MusicBrainz", note: "Primary release and artist metadata." },
  { id: "itunes", label: "Apple Music", note: "Artwork and catalog enrichment." },
  { id: "theaudiodb", label: "TheAudioDB", note: "Artist images and summaries." },
  { id: "lastfm", label: "Last.fm", note: "Scrobbler metadata and tags." },
  { id: "discogs", label: "Discogs", note: "Disc and label metadata." },
];

const identityFields = [
  { key: "appName", label: "Product name", type: "text" },
  { key: "appVersion", label: "Version", type: "text" },
  { key: "appContact", label: "Contact for API User-Agent", type: "email" },
];

const cacheFields = [
  { key: "cacheTtlSeconds", label: "Cache TTL", type: "number", suffix: "seconds" },
  { key: "minRequestIntervalMs", label: "MusicBrainZ request interval", type: "number", suffix: "ms" },
  { key: "upstreamTimeoutMs", label: "Upstream timeout", type: "number", suffix: "ms" },
  { key: "slowRequestMs", label: "Slow request threshold", type: "number", suffix: "ms" },
];

const providerSettings: Record<string, Array<{ key: string; label: string; type: string; placeholder?: string }>> = {
  musicbrainz: [
    { key: "musicbrainzApiKey", label: "API key", type: "password" },
  ],
  itunes: [
    { key: "itunesCountry", label: "Country", type: "text" },
  ],
  theaudiodb: [
    { key: "theAudioDbApiKey", label: "API key", type: "password" },
  ],
  lastfm: [
    { key: "lastfmApiKey", label: "API key", type: "password" },
  ],
  discogs: [
    { key: "discogsToken", label: "Token", type: "password" },
  ],
};

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" }) {
  const toneClass = {
    neutral: "border-border/70 bg-white/5 text-gray-300",
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  }[tone];

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-md bg-blue-500/10 p-2 text-blue-400">{icon}</div>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function EmptyState({ title, body, icon }: { title: string; body: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-8">
      <div className="rounded-md bg-blue-500/10 p-3 text-blue-400 w-fit">{icon}</div>
      <h2 className="mt-5 text-xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">{body}</p>
    </div>
  );
}

function JsonTree({
  value,
  path = "$",
  depth = 0,
  onSelect,
}: {
  value: unknown;
  path?: string;
  depth?: number;
  onSelect: (path: string) => void;
}) {
  if (Array.isArray(value)) {
    const sample = value[0];

    return (
      <div>
        <button
          type="button"
          onClick={() => onSelect(`${path}[*]`)}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-blue-300 hover:bg-blue-500/10"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <span>{path.split(".").pop()}</span>
          <span className="text-gray-500">array[{value.length}]</span>
        </button>
        {sample !== undefined && <JsonTree value={sample} path={`${path}[*]`} depth={depth + 1} onSelect={onSelect} />}
      </div>
    );
  }

  if (value && typeof value === "object") {
    return (
      <div>
        {Object.entries(value as Record<string, unknown>).map(([key, child]) => {
          const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
          return (
            <div key={childPath}>
              <button
                type="button"
                onClick={() => onSelect(childPath)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-gray-300 hover:bg-white/5"
                style={{ paddingLeft: `${depth * 14 + 8}px` }}
              >
                <span>{key}</span>
                <span className="truncate text-gray-600">{Array.isArray(child) ? `array[${child.length}]` : typeof child}</span>
              </button>
              {Boolean(Array.isArray(child) || (child && typeof child === "object")) && (
                <JsonTree value={child} path={childPath} depth={depth + 1} onSelect={onSelect} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(path)}
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-gray-400 hover:bg-white/5"
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
    >
      <span>{path.split(".").pop()}</span>
      <span className="truncate text-gray-600">{String(value)}</span>
    </button>
  );
}

function inputClass() {
  return "w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-blue-500";
}

function normalizeValue(value: RuntimeValue | undefined) {
  return value === undefined || value === null ? "" : String(value);
}

function parseMapping(value: string | undefined): CustomMapping {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function normalizeJsonPath(path: string) {
  return path.replace(/\[\*\]$/, "");
}

function getRelativeAlbumPath(arrayPath: string | undefined, selectedPath: string) {
  if (!arrayPath || !selectedPath.startsWith(normalizeJsonPath(arrayPath))) {
    return selectedPath;
  }
  return selectedPath
    .slice(normalizeJsonPath(arrayPath).length)
    .replace(/^\[\*\]\.?/, "")
    .replace(/^\./, "");
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function readConfig(config: SettingsPayload["config"], key: string) {
  return normalizeValue(config?.[key]?.value);
}

async function postSettings(path: string, body?: Record<string, unknown>) {
  return fetchJson(path, {
    method: "POST",
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export default function SettingsPage() {
  const { data: status, mutate: mutateStatus, error: statusError, isLoading: statusLoading } = useSWR<SettingsStatus>(
    "/api/settings/status",
    fetcher,
    { refreshInterval: 5000 }
  );
  const {
    data: settings,
    mutate: mutateSettings,
    error: settingsError,
    isLoading: settingsLoading,
  } = useSWR<SettingsPayload>(status?.authenticated ? "/api/settings" : null, fetcher);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [form, setForm] = useState<FormValues>({});
  const [message, setMessage] = useState<Message>(null);
  const [saving, setSaving] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [generatingName, setGeneratingName] = useState(false);
  const [providerTestQuery, setProviderTestQuery] = useState("Radiohead");
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [providerTestResults, setProviderTestResults] = useState<Record<string, ProviderTestResult>>({});
  const [draggedProvider, setDraggedProvider] = useState<string | null>(null);
  const [copiedProvider, setCopiedProvider] = useState<string | null>(null);
  const [selectedMappingField, setSelectedMappingField] = useState<MappingField>("artistName");
  const [customMapping, setCustomMapping] = useState<CustomMapping>({});
  const [customResult, setCustomResult] = useState<CustomProviderResult | null>(null);
  const [testingCustomProvider, setTestingCustomProvider] = useState(false);
  const [copiedCustomLogs, setCopiedCustomLogs] = useState(false);

  const config = settings?.config ?? {};

  useEffect(() => {
    if (!settings?.config) return;

    const next: FormValues = {};
    for (const [key, info] of Object.entries(settings.config)) {
      next[key] = normalizeValue(info.value);
    }
    setForm(next);
    setCustomMapping(parseMapping(next.customProviderMapping));
  }, [settings]);

  const selectedProviders = useMemo(() => {
    return new Set((form.metadataProviders || "").split(",").map((item) => item.trim()).filter(Boolean));
  }, [form.metadataProviders]);

  const orderedProviders = useMemo(() => {
    const priority = (form.providerPriority || form.metadataProviders || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const byId = new Map(providerOptions.map((provider) => [provider.id, provider]));
    const ordered = priority
      .map((id) => byId.get(id))
      .filter((provider): provider is (typeof providerOptions)[number] => Boolean(provider));
    const missing = providerOptions.filter((provider) => !priority.includes(provider.id));

    return [...ordered, ...missing];
  }, [form.metadataProviders, form.providerPriority]);

  async function refreshAll() {
    await Promise.all([mutateStatus(), mutateSettings()]);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    if (status?.setupRequired && password !== confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match." });
      return;
    }

    setAuthBusy(true);
    try {
      await postSettings(status?.setupRequired ? "/api/settings/setup" : "/api/settings/login", { password });
      setPassword("");
      setConfirmPassword("");
      setMessage({ type: "success", text: status?.setupRequired ? "Admin password created." : "Signed in." });
      await refreshAll();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Authentication failed." });
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    setMessage(null);
    setAuthBusy(true);
    try {
      await postSettings("/api/settings/logout");
      clearCsrfToken();
      setForm({});
      await refreshAll();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Logout failed." });
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      if (form.customProviderBaseUrl && customResult?.errors?.length) {
        setMessage({ type: "error", text: "Fix custom provider mapping errors before saving." });
        return;
      }

      const updates: Record<string, string> = {};
      for (const key of Object.keys(config)) {
        updates[key] = form[key] ?? "";
      }
      updates.customProviderMapping = JSON.stringify(customMapping);

      const result = await fetchJson<{ applied?: Record<string, RuntimeValue>; skipped?: Record<string, string> }>("/api/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });

      const skipped = Object.entries(result.skipped ?? {});
      if (skipped.length > 0) {
        setMessage({ type: "error", text: skipped.map(([key, reason]) => `${key}: ${reason}`).join("; ") });
      } else {
        setMessage({ type: "success", text: "Settings saved." });
      }
      await mutateSettings();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Save failed." });
    } finally {
      setSaving(false);
    }
  }

  async function handleResetProvidersToEnv() {
    setMessage(null);
    setSaving(true);
    try {
      // PATCH with null clears the saved override; the proxy then falls back
      // to the env var (or built-in default) for these keys.
      await fetchJson("/api/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metadataProviders: null, providerPriority: null }),
      });
      setMessage({ type: "success", text: "Provider settings reset to env defaults." });
      await mutateSettings();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Reset failed." });
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateName() {
    setGeneratingName(true);
    setMessage(null);
    try {
      const result = await postSettings("/api/settings/generate-name") as { name?: string };
      if (result.name) {
        setForm((current) => ({ ...current, appName: result.name ?? "" }));
      }
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not generate a name." });
    } finally {
      setGeneratingName(false);
    }
  }

  function updateField(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleProvider(id: string) {
    const next = new Set(selectedProviders);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    updateField("metadataProviders", orderedProviders.filter((provider) => next.has(provider.id)).map((provider) => provider.id).join(","));
  }

  function reorderProvider(targetProviderId: string) {
    if (!draggedProvider || draggedProvider === targetProviderId) return;

    const current = orderedProviders.map((provider) => provider.id);
    const from = current.indexOf(draggedProvider);
    const to = current.indexOf(targetProviderId);

    if (from < 0 || to < 0) return;

    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    updateField("providerPriority", next.join(","));
    updateField("metadataProviders", next.filter((id) => selectedProviders.has(id)).join(","));
  }

  async function handleProviderTest(providerId: string) {
    setTestingProvider(providerId);
    setMessage(null);
    try {
      const response = await fetchWithFallback("/api/settings/providers/test", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: providerId, query: providerTestQuery }),
      });
      const result = await response.json() as ProviderTestResult;
      setProviderTestResults((current) => ({ ...current, [providerId]: result }));
    } catch (error) {
      setProviderTestResults((current) => ({
        ...current,
        [providerId]: {
          ok: false,
          provider: providerId,
          query: providerTestQuery,
          error: error instanceof Error ? error.message : "Provider test failed.",
        },
      }));
    } finally {
      setTestingProvider(null);
    }
  }

  async function handleSelectedProviderTests() {
    for (const provider of orderedProviders) {
      if (selectedProviders.has(provider.id)) {
        await handleProviderTest(provider.id);
      }
    }
  }

  async function copyProviderLogs(providerId: string, details: Record<string, unknown>) {
    await navigator.clipboard.writeText(JSON.stringify(details, null, 2));
    setCopiedProvider(providerId);
    window.setTimeout(() => setCopiedProvider(null), 1500);
  }

  function updateCustomMapping(field: MappingField, path: string) {
    const next = {
      ...customMapping,
      [field]: field === "artistName" || field === "albums" ? path : getRelativeAlbumPath(customMapping.albums, path),
    };
    setCustomMapping(next);
    updateField("customProviderMapping", JSON.stringify(next));
    if (customResult?.raw !== undefined) {
      void runCustomProviderTest(next);
    }
  }

  function handleJsonPathSelect(path: string) {
    updateCustomMapping(selectedMappingField, path);
  }

  async function runCustomProviderTest(mapping: CustomMapping) {
    setTestingCustomProvider(true);
    setMessage(null);
    try {
      const response = await fetchWithFallback("/debug/test-provider", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: form.customProviderBaseUrl,
          searchPath: form.customProviderSearchPath,
          queryParam: form.customProviderQueryParam,
          authType: form.customProviderAuthType || "none",
          token: form.customProviderToken,
          headerName: form.customProviderHeaderName,
          queryAuthName: form.customProviderQueryAuthName,
          query: providerTestQuery,
          mapping,
        }),
      });
      const result = await response.json() as CustomProviderResult;
      setCustomResult(result);
    } catch (error) {
      setCustomResult({
        raw: null,
        mapped: { artistName: "", albums: [] },
        errors: [{ field: "request", message: error instanceof Error ? error.message : "Custom provider test failed" }],
        warnings: [],
      });
    } finally {
      setTestingCustomProvider(false);
    }
  }

  async function testCustomProvider() {
    await runCustomProviderTest(customMapping);
  }

  async function copyCustomLogs() {
    await navigator.clipboard.writeText(formatJson(customResult?.details ?? customResult?.errors ?? []));
    setCopiedCustomLogs(true);
    window.setTimeout(() => setCopiedCustomLogs(false), 1500);
  }

  function renderField(field: { key: string; label: string; type: string; suffix?: string; placeholder?: string }) {
    const source = config[field.key]?.source;

    return (
      <label key={field.key} className="block">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-gray-300">{field.label}</span>
          {source && <span className="text-xs text-gray-500">{source}</span>}
        </div>
        <div className="relative">
          <input
            className={inputClass()}
            type={field.type}
            min={field.type === "number" ? 1 : undefined}
            placeholder={field.placeholder}
            value={form[field.key] ?? readConfig(config, field.key)}
            onChange={(event) => updateField(field.key, event.target.value)}
          />
          {field.suffix && <span className="pointer-events-none absolute right-3 top-2 text-sm text-gray-500">{field.suffix}</span>}
        </div>
      </label>
    );
  }

  function renderProviderSetting(field: { key: string; label: string; type: string; placeholder?: string }) {
    const source = config[field.key]?.source;

    return (
      <label key={field.key} className="block">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-gray-400">{field.label}</span>
          {source && <span className="text-xs text-gray-600">{source}</span>}
        </div>
        <input
          className={inputClass()}
          type={field.type}
          placeholder={field.placeholder}
          value={form[field.key] ?? readConfig(config, field.key)}
          onChange={(event) => updateField(field.key, event.target.value)}
        />
      </label>
    );
  }

  const isAuthenticated = Boolean(status?.authenticated);
  const needsSetup = Boolean(status?.setupRequired);

  return (
    <main className="container mx-auto max-w-screen-2xl space-y-8 p-8">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            {statusLoading ? (
              <Badge>Checking access</Badge>
            ) : isAuthenticated ? (
              <Badge tone="success">Signed in</Badge>
            ) : needsSetup ? (
              <Badge tone="warning">Setup required</Badge>
            ) : (
              <Badge>Login required</Badge>
            )}
          </div>
          <p className="mt-2 text-gray-400">Runtime configuration and administration for Melodarr Proxy.</p>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            <span className={`inline-flex items-center gap-2 text-sm ${message.type === "error" ? "text-red-300" : "text-emerald-300"}`}>
              {message.type === "error" ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {message.text}
            </span>
          )}
          {isAuthenticated && (
            <>
              <button
                type="button"
                onClick={() => refreshAll()}
                className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-card px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-white/5"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              <button
                type="button"
                onClick={handleLogout}
                disabled={authBusy}
                className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-card px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-white/5 disabled:opacity-60"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </>
          )}
        </div>
      </div>

      {(statusError || settingsError) && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {(statusError || settingsError)?.message}
        </div>
      )}

      {!isAuthenticated && (
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,480px)_1fr]">
          <form onSubmit={handleAuthSubmit} className="rounded-lg border border-border/60 bg-card p-6">
            <div className="mb-6 flex items-center gap-3">
              <div className="rounded-md bg-blue-500/10 p-2 text-blue-400">
                {needsSetup ? <Shield className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-lg font-semibold">{needsSetup ? "Create admin access" : "Sign in"}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {needsSetup ? "Set the local settings password before changing runtime configuration." : "Use the settings password configured for this proxy."}
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-300">Password</span>
                <input
                  className={inputClass()}
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              {needsSetup && (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-300">Confirm password</span>
                  <input
                    className={inputClass()}
                    type="password"
                    minLength={8}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                  />
                </label>
              )}
            </div>
            <button
              type="submit"
              disabled={authBusy}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
            >
              {authBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : needsSetup ? <Shield className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
              {needsSetup ? "Create settings password" : "Sign in"}
            </button>
          </form>
          <EmptyState
            title="Settings live here now"
            body="After setup or login, this page shows the editable runtime configuration, provider selection, API credentials, and read-only server values for Melodarr Proxy."
            icon={<SlidersHorizontal className="h-6 w-6" />}
          />
        </section>
      )}

      {isAuthenticated && (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-card p-5">
              <Shield className="h-5 w-5 text-blue-400" />
              <h2 className="mt-4 font-semibold">Access</h2>
              <p className="mt-2 text-sm text-gray-400">
                {settings?.admin?.envPasswordConfigured ? "Password configured by environment" : "Local settings session active"}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-card p-5">
              <SlidersHorizontal className="h-5 w-5 text-orange-400" />
              <h2 className="mt-4 font-semibold">Configuration</h2>
              <p className="mt-2 text-sm text-gray-400">{Object.keys(config).length || "--"} runtime values</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-card p-5">
              <KeyRound className="h-5 w-5 text-emerald-400" />
              <h2 className="mt-4 font-semibold">Provider credentials</h2>
              <p className="mt-2 text-sm text-gray-400">Saved with runtime settings and used by metadata providers.</p>
            </div>
          </section>

          {settingsLoading ? (
            <div className="rounded-lg border border-border/60 bg-card p-8 text-sm text-gray-400">Loading settings...</div>
          ) : (
            <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-6">
                <Section title="Identity" icon={<Sparkles className="h-5 w-5" />}>
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                    {identityFields.map(renderField)}
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateName}
                    disabled={generatingName}
                    className="mt-4 inline-flex items-center gap-2 rounded-md border border-border/70 bg-background px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-white/5 disabled:opacity-60"
                  >
                    {generatingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Generate product name
                  </button>
                </Section>

                <Section title="Providers" icon={<Database className="h-5 w-5" />}>
                  {(config.metadataProviders?.source === "saved" || config.providerPriority?.source === "saved") && (
                    <div className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm md:flex-row md:items-center md:justify-between">
                      <div className="text-amber-200">
                        Provider settings are saved overrides. Env vars (<code>METADATA_PROVIDERS</code>, <code>PROVIDER_PRIORITY</code>) are being shadowed.
                      </div>
                      <button
                        type="button"
                        onClick={handleResetProvidersToEnv}
                        disabled={saving}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100 transition-colors hover:bg-amber-500/20 disabled:opacity-60"
                      >
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Reset to env defaults
                      </button>
                    </div>
                  )}
                  <div className="mb-5 flex flex-col gap-3 rounded-lg border border-border/60 bg-background/40 p-4 md:flex-row md:items-end md:justify-between">
                    <label className="block md:min-w-80">
                      <span className="mb-2 block text-sm font-medium text-gray-300">Provider test artist</span>
                      <input
                        className={inputClass()}
                        type="text"
                        value={providerTestQuery}
                        onChange={(event) => setProviderTestQuery(event.target.value)}
                        placeholder="Radiohead"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleSelectedProviderTests}
                      disabled={Boolean(testingProvider) || selectedProviders.size === 0 || !providerTestQuery.trim()}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-border/70 bg-card px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-white/5 disabled:opacity-60"
                    >
                      {testingProvider ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
                      Test selected
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {orderedProviders.map((provider, index) => {
                      const checked = selectedProviders.has(provider.id);
                      const result = providerTestResults[provider.id];
                      return (
                        <div
                          key={provider.id}
                          draggable
                          onDragStart={() => setDraggedProvider(provider.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => {
                            reorderProvider(provider.id);
                            setDraggedProvider(null);
                          }}
                          onDragEnd={() => setDraggedProvider(null)}
                          className={`rounded-lg border p-4 transition-colors ${
                            checked ? "border-blue-500/50 bg-blue-500/10" : "border-border/60 bg-background/40 hover:bg-white/5"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <GripVertical className="h-5 w-5 shrink-0 cursor-grab text-gray-500" />
                              <input
                                id={`provider-${provider.id}`}
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleProvider(provider.id)}
                                className="h-4 w-4 rounded border-border bg-background"
                              />
                              <label htmlFor={`provider-${provider.id}`} className="cursor-pointer truncate font-medium text-gray-100">
                                {provider.label}
                              </label>
                            </div>
                            <span className="rounded-full border border-border/60 px-2 py-0.5 text-xs text-gray-500">#{index + 1}</span>
                          </div>
                          <p className="mt-2 text-sm leading-5 text-gray-500">{provider.note}</p>
                          <div className="mt-4 space-y-3">
                            {(providerSettings[provider.id] ?? []).map(renderProviderSetting)}
                          </div>
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => handleProviderTest(provider.id)}
                              disabled={testingProvider === provider.id || !providerTestQuery.trim()}
                              className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-card px-3 py-1.5 text-xs text-gray-200 transition-colors hover:bg-white/5 disabled:opacity-60"
                            >
                              {testingProvider === provider.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
                              Test
                            </button>
                            {result && (
                              <span className={`text-xs ${result.ok ? "text-emerald-300" : "text-red-300"}`}>
                                {result.ok ? `${result.albumCount ?? 0} albums in ${result.durationMs ?? 0}ms` : "Failed"}
                              </span>
                            )}
                          </div>
                          {result && (
                            <div className={`mt-3 rounded-md border p-3 text-xs ${
                              result.ok ? "border-emerald-500/20 bg-emerald-500/5 text-gray-300" : "border-red-500/20 bg-red-500/5 text-red-200"
                            }`}>
                              {result.ok ? (
                                <>
                                  <div className="font-medium text-gray-100">{result.artistName || result.query}</div>
                                  <div className="mt-1 text-gray-500">
                                    {(result.sampleAlbums ?? []).slice(0, 2).map((album) => album.year ? `${album.name} (${album.year})` : album.name).join(" / ") || "No album samples returned."}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div>{result.error || "Provider test failed."}</div>
                                  {result.details && (
                                    <details className="mt-3">
                                      <summary className="cursor-pointer text-red-100">Logs</summary>
                                      <button
                                        type="button"
                                        onClick={() => copyProviderLogs(provider.id, result.details || {})}
                                        className="mt-2 inline-flex items-center gap-2 rounded-md border border-red-400/30 bg-black/20 px-2.5 py-1 text-[11px] text-red-100 transition-colors hover:bg-red-500/10"
                                      >
                                        <Copy className="h-3 w-3" />
                                        {copiedProvider === provider.id ? "Copied" : "Copy logs"}
                                      </button>
                                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-3 text-[11px] leading-5 text-red-100">
                                        {JSON.stringify(result.details, null, 2)}
                                      </pre>
                                    </details>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Section>

                <Section title="Custom Provider Mapping" icon={<Braces className="h-5 w-5" />}>
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-gray-300">Name</span>
                      <input className={inputClass()} value={form.customProviderName ?? ""} onChange={(event) => updateField("customProviderName", event.target.value)} placeholder="Custom API" />
                    </label>
                    <label className="block xl:col-span-2">
                      <span className="mb-2 block text-sm font-medium text-gray-300">Base URL</span>
                      <input className={inputClass()} value={form.customProviderBaseUrl ?? ""} onChange={(event) => updateField("customProviderBaseUrl", event.target.value)} placeholder="https://api.example.com" />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-gray-300">Search path</span>
                      <input className={inputClass()} value={form.customProviderSearchPath ?? ""} onChange={(event) => updateField("customProviderSearchPath", event.target.value)} placeholder="/search" />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-gray-300">Query parameter</span>
                      <input className={inputClass()} value={form.customProviderQueryParam ?? "q"} onChange={(event) => updateField("customProviderQueryParam", event.target.value)} placeholder="q" />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-gray-300">Auth type</span>
                      <select className={inputClass()} value={form.customProviderAuthType || "none"} onChange={(event) => updateField("customProviderAuthType", event.target.value)}>
                        <option value="none">None</option>
                        <option value="bearer">Bearer token</option>
                        <option value="header">Header</option>
                        <option value="query">Query parameter</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-gray-300">Auth name</span>
                      <input
                        className={inputClass()}
                        value={form.customProviderAuthType === "query" ? (form.customProviderQueryAuthName ?? "") : (form.customProviderHeaderName ?? "")}
                        onChange={(event) => updateField(form.customProviderAuthType === "query" ? "customProviderQueryAuthName" : "customProviderHeaderName", event.target.value)}
                        placeholder={form.customProviderAuthType === "query" ? "api_key" : "X-API-Key"}
                        disabled={!["header", "query"].includes(form.customProviderAuthType || "none")}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-gray-300">Token</span>
                      <input className={inputClass()} type="password" value={form.customProviderToken ?? ""} onChange={(event) => updateField("customProviderToken", event.target.value)} />
                    </label>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={testCustomProvider}
                      disabled={testingCustomProvider || !form.customProviderBaseUrl}
                      className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
                    >
                      {testingCustomProvider ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
                      Test API
                    </button>
                    {customResult?.errors?.length ? (
                      <span className="inline-flex items-center gap-2 text-sm text-red-300">
                        <AlertTriangle className="h-4 w-4" />
                        {customResult.errors.length} mapping issue{customResult.errors.length === 1 ? "" : "s"}
                      </span>
                    ) : customResult?.mapped ? (
                      <span className="text-sm text-emerald-300">Mapping preview is valid.</span>
                    ) : null}
                    {customResult?.warnings?.length ? (
                      <span className="text-sm text-amber-300">{customResult.warnings[0]?.message}</span>
                    ) : null}
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <div className="rounded-lg border border-border/60 bg-background/40 p-4">
                      <h3 className="text-sm font-semibold text-gray-200">Raw JSON</h3>
                      <p className="mt-1 text-xs text-gray-500">Select a mapping field, then click a JSON field.</p>
                      <div className="mt-4 max-h-[520px] overflow-auto rounded-md border border-border/50 bg-black/20 p-2">
                        {customResult?.raw ? (
                          <JsonTree value={customResult.raw} onSelect={handleJsonPathSelect} />
                        ) : (
                          <div className="p-4 text-sm text-gray-500">Run Test API to load a response.</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-background/40 p-4">
                      <h3 className="text-sm font-semibold text-gray-200">Mapping</h3>
                      <div className="mt-4 space-y-3">
                        {([
                          ["artistName", "Artist name"],
                          ["albums", "Albums array"],
                          ["albumName", "Album name"],
                          ["year", "Year"],
                          ["imageUrl", "Image URL"],
                        ] as Array<[MappingField, string]>).map(([field, label]) => (
                          <button
                            key={field}
                            type="button"
                            onClick={() => setSelectedMappingField(field)}
                            className={`w-full rounded-md border p-3 text-left transition-colors ${
                              selectedMappingField === field ? "border-blue-500/60 bg-blue-500/10" : "border-border/60 bg-card hover:bg-white/5"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-gray-200">{label}</span>
                              {customResult?.errors?.some((error) => error.field === field) && <span className="text-xs text-red-300">Invalid</span>}
                            </div>
                            <div className="mt-1 truncate font-mono text-xs text-gray-500">{customMapping[field] || "Click a field in the JSON tree"}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-background/40 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-gray-200">Preview</h3>
                        {customResult?.details && (
                          <button type="button" onClick={copyCustomLogs} className="inline-flex items-center gap-2 rounded-md border border-border/70 px-2.5 py-1 text-xs text-gray-300 hover:bg-white/5">
                            <Copy className="h-3 w-3" />
                            {copiedCustomLogs ? "Copied" : "Copy logs"}
                          </button>
                        )}
                      </div>
                      <div className="mt-4 max-h-[520px] overflow-auto rounded-md border border-border/50 bg-black/20 p-3">
                        {customResult ? (
                          <>
                            {customResult.errors?.length ? (
                              <div className="mb-3 space-y-2">
                                {customResult.errors.map((error) => (
                                  <div key={`${error.field}-${error.message}`} className="rounded border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-200">
                                    {error.field}: {error.message}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            <pre className="whitespace-pre-wrap text-xs leading-5 text-gray-300">{formatJson(customResult.mapped ?? {})}</pre>
                            {customResult.details && (
                              <details className="mt-4 text-xs text-gray-400">
                                <summary className="cursor-pointer">Logs</summary>
                                <pre className="mt-2 whitespace-pre-wrap rounded bg-black/30 p-3">{formatJson(customResult.details)}</pre>
                              </details>
                            )}
                          </>
                        ) : (
                          <div className="text-sm text-gray-500">Mapped output appears here after a test.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </Section>

                <Section title="Cache and timing" icon={<SlidersHorizontal className="h-5 w-5" />}>
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    {cacheFields.map(renderField)}
                  </div>
                </Section>
              </div>

              <aside className="space-y-6">
                <Section title="Server" icon={<Server className="h-5 w-5" />}>
                  <div className="space-y-3">
                    {Object.entries(settings?.server ?? {}).map(([key, info]) => (
                      <div key={key} className="rounded-md border border-border/50 bg-background/40 p-4">
                        <div className="text-xs uppercase tracking-wide text-gray-500">{key}</div>
                        <div className="mt-2 break-all font-mono text-sm text-gray-200">{String(info.value)}</div>
                        <div className="mt-2 text-xs text-gray-500">{info.source}</div>
                      </div>
                    ))}
                  </div>
                </Section>

                <section className="rounded-lg border border-border/60 bg-card p-6">
                  <h2 className="text-lg font-semibold">Save changes</h2>
                  <p className="mt-2 text-sm leading-6 text-gray-500">
                    Saved runtime values override defaults immediately. Environment defaults remain visible when a value has not been saved.
                  </p>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save settings
                  </button>
                </section>
              </aside>
            </section>
          )}
        </>
      )}
    </main>
  );
}
