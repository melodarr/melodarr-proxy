"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
 AlertTriangle,
 Braces,
 Check,
 Copy,
 Database,
 Eye,
 EyeOff,
 GripVertical,
 Dices,
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
 Trash2,
 X,
} from "lucide-react";
import { fetchJson, fetcher } from "@/lib/fetcher";
import { clearCsrfToken } from "@/lib/csrf";
import { fetchWithFallback } from "@/lib/proxy";

const TEST_ARTISTS = [
  "Radiohead", "The Beatles", "Pink Floyd", "Daft Punk", "Miles Davis",
  "Kendrick Lamar", "David Bowie", "Kanye West", "Nirvana", "Led Zeppelin",
  "The Velvet Underground", "The Rolling Stones", "Fleetwood Mac", "Michael Jackson", "Bob Dylan",
  "Wu-Tang Clan", "OutKast", "The Beach Boys", "The Smiths", "Prince",
  "Black Sabbath", "Talking Heads", "The Cure", "Joy Division", "Frank Ocean",
  "Björk", "A Tribe Called Quest", "Stevie Wonder", "Nas", "The Clash",
  "Neil Young", "Jimi Hendrix", "Depeche Mode", "Gorillaz", "R.E.M.",
  "Queen", "Nine Inch Nails", "Tame Impala", "Portishead", "Massive Attack",
  "Fiona Apple", "Aphex Twin", "Arcade Fire", "Beastie Boys", "Johnny Cash",
  "The Strokes", "Eminem", "Smashing Pumpkins", "Tool", "D'Angelo",
  "Red Hot Chili Peppers", "MF DOOM", "Madvillain", "Sufjan Stevens", "LCD Soundsystem",
  "My Bloody Valentine", "Pixies", "Pavement", "Modest Mouse", "Vampire Weekend",
  "The National", "Elliott Smith", "Ariel Pink", "Animal Collective", "The White Stripes",
  "Tyler, The Creator", "Arctic Monkeys", "Frank Sinatra", "Kraftwerk", "Duran Duran",
  "Tears for Fears", "New Order", "The Police", "Kate Bush", "Cocteau Twins",
  "Sonic Youth", "Ween", "The Smashing Pumpkins", "Pearl Jam", "Soundgarden",
  "Alice in Chains", "Stone Temple Pilots", "Green Day", "Blink-182", "The Offspring",
  "The Killers", "Kings of Leon", "Muse", "Coldplay", "Florence + The Machine",
  "Adele", "Beyoncé", "Rihanna", "Drake", "The Weeknd",
  "Dua Lipa", "Billie Eilish", "Lana Del Rey", "Lorde", "FKA twigs"
];

import {
  RuntimeValue,
  SettingsStatus,
  SettingsPayload,
  FormValues,
  Message,
  ProviderTestResult,
  SettingsField,
  CustomProviderConfig,
  ProxyApiKeysPayload,
  CreatedProxyApiKey,
} from "./types";
import {
  inputClass,
  normalizeValue,
  generateId,
} from "./utils";
import { CustomProviderModal } from "./components/CustomProviderModal";

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
 { key: "appContact", label: "Contact for API User-Agent", type: "text", placeholder: "e.g., admin@domain.com or https://..." },
];

const cacheFields = [
 { key: "cacheTtlSeconds", label: "Cache TTL", type: "number", suffix: "seconds" },
 { key: "minRequestIntervalMs", label: "MusicBrainz request interval", type: "number", suffix: "ms" },
 { key: "providerMinRequestIntervalMs", label: "Default provider request interval", type: "number", suffix: "ms" },
 { key: "upstreamTimeoutMs", label: "Upstream timeout", type: "number", suffix: "ms" },
 { key: "slowRequestMs", label: "Slow request threshold", type: "number", suffix: "ms" },
];

const ipFamilyOptions = [
 { value: "auto", label: "Auto" },
 { value: "4", label: "IPv4" },
 { value: "6", label: "IPv6" },
];

const providerSettings: Record<string, SettingsField[]> = {
 musicbrainz: [
 { key: "musicbrainzIpFamily", label: "IP family", type: "select", options: [
 { value: "6", label: "IPv6 only" },
 ] },
 ],
 itunes: [
 { key: "itunesCountry", label: "Country", type: "text" },
 { key: "itunesMinRequestIntervalMs", label: "Request interval", type: "number", suffix: "ms" },
 { key: "itunesIpFamily", label: "IP family", type: "select", options: ipFamilyOptions },
 ],
 theaudiodb: [
 { key: "theAudioDbMinRequestIntervalMs", label: "Request interval", type: "number", suffix: "ms" },
 { key: "theAudioDbIpFamily", label: "IP family", type: "select", options: ipFamilyOptions },
 ],
 lastfm: [
 { key: "lastfmMinRequestIntervalMs", label: "Request interval", type: "number", suffix: "ms" },
 { key: "lastfmIpFamily", label: "IP family", type: "select", options: ipFamilyOptions },
 ],
 discogs: [
 { key: "discogsMinRequestIntervalMs", label: "Request interval", type: "number", suffix: "ms" },
 { key: "discogsIpFamily", label: "IP family", type: "select", options: ipFamilyOptions },
 ],
};

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" }) {
 const toneClass = {
 neutral: "border-border bg-black/5 dark:bg-black/5 dark:bg-card/5 text-secondary ",
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
 <section className="rounded-lg border border-border bg-card p-6">
 <div className="mb-6 flex items-center gap-3">
 <div className="rounded-md bg-blue-500/10 p-2 text-blue-700 dark:text-blue-400">{icon}</div>
 <h2 className="text-lg font-semibold">{title}</h2>
 </div>
 {children}
 </section>
 );
}

function EmptyState({ title, body, icon }: { title: string; body: string; icon: ReactNode }) {
 return (
 <div className="rounded-lg border border-border bg-card p-8">
 <div className="rounded-md bg-blue-500/10 p-3 text-blue-700 dark:text-blue-400 w-fit">{icon}</div>
 <h2 className="mt-5 text-xl font-semibold">{title}</h2>
 <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">{body}</p>
 </div>
 );
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
 const { mutate: mutateGlobal } = useSWRConfig();
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
 const {
 data: apiKeys,
 mutate: mutateApiKeys,
 isLoading: apiKeysLoading,
 } = useSWR<ProxyApiKeysPayload>(status?.authenticated ? "/api/admin/keys" : null, fetcher);

 const [password, setPassword] = useState("");
 const [confirmPassword, setConfirmPassword] = useState("");
 const [form, setForm] = useState<FormValues>({});
 const [message, setMessage] = useState<Message>(null);
 const [saving, setSaving] = useState(false);
 const [authBusy, setAuthBusy] = useState(false);
 const [refreshing, setRefreshing] = useState(false);
 const [generatingName, setGeneratingName] = useState(false);
 const [providerTestQuery, setProviderTestQuery] = useState("Radiohead");
 const [testingProvider, setTestingProvider] = useState<string | null>(null);
 const [providerTestResults, setProviderTestResults] = useState<Record<string, ProviderTestResult>>({});
 const [draggedProvider, setDraggedProvider] = useState<string | null>(null);
 const [copiedProvider, setCopiedProvider] = useState<string | null>(null);
 const [copiedProxyKey, setCopiedProxyKey] = useState(false);
 const [apiKeyBusy, setApiKeyBusy] = useState(false);
 const [newApiKeyName, setNewApiKeyName] = useState("Lidarr");
 const [newApiKeyQuota, setNewApiKeyQuota] = useState("60");
 const [createdApiKey, setCreatedApiKey] = useState<CreatedProxyApiKey | null>(null);
 const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());

 const togglePasswordVisibility = useCallback((fieldKey: string) => {
  setVisiblePasswords((prev) => {
   const next = new Set(prev);
   if (next.has(fieldKey)) next.delete(fieldKey);
   else next.add(fieldKey);
   return next;
  });
 }, []);

 const [customProviders, setCustomProviders] = useState<CustomProviderConfig[]>([]);
 const [editingProvider, setEditingProvider] = useState<CustomProviderConfig | null>(null);
 const [activeTab, setActiveTab] = useState<"general" | "providers" | "api-keys" | "system">("general");

 const config = settings?.config ?? {};

 useEffect(() => {
 if (!settings?.config) return;

 const next: FormValues = {};
 for (const [key, info] of Object.entries(settings.config)) {
 next[key] = normalizeValue(info.value);
 }
 setForm(next);
 
 try {
 setCustomProviders(JSON.parse(next.customProviders || "[]"));
 } catch {
 setCustomProviders([]);
 }
 }, [settings]);

 const selectedProviders = useMemo(() => {
 return new Set((form.metadataProviders || "").split(",").map((item) => item.trim()).filter(Boolean));
 }, [form.metadataProviders]);

 const allAvailableProviders = useMemo(() => {
 return [
 ...providerOptions,
 ...customProviders.map(cp => ({
 id: cp.id,
 label: cp.name || cp.id,
 note: "Custom API Provider"
 }))
 ];
 }, [customProviders]);

 const orderedProviders = useMemo(() => {
 const priority = (form.providerPriority || form.metadataProviders || "")
 .split(",")
 .map((item) => item.trim())
 .filter(Boolean);
 const byId = new Map(allAvailableProviders.map((provider) => [provider.id, provider]));
 const ordered = priority
 .map((id) => byId.get(id))
 .filter((provider): provider is (typeof allAvailableProviders)[number] => Boolean(provider));
 const missing = allAvailableProviders.filter((provider) => !priority.includes(provider.id));

 return [...ordered, ...missing];
 }, [form.metadataProviders, form.providerPriority, allAvailableProviders]);

 async function refreshAll() {
 setRefreshing(true);
 try {
 const nextStatus = await mutateStatus();
 const effectiveStatus = nextStatus ?? status;
 if (effectiveStatus?.authenticated) {
 await mutateGlobal("/api/settings");
 } else {
 await mutateSettings(undefined, { revalidate: false });
 }
 } catch (error) {
 setMessage({ type: "error", text: error instanceof Error ? error.message : "Refresh failed." });
 } finally {
 setRefreshing(false);
 }
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
 const updates: Record<string, string> = {};
 for (const key of Object.keys(config)) {
 updates[key] = form[key] ?? "";
 }
 updates.customProviders = JSON.stringify(customProviders);

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

 async function handleCreateProxyApiKey(event: FormEvent<HTMLFormElement>) {
 event.preventDefault();
 setApiKeyBusy(true);
 setMessage(null);
 setCreatedApiKey(null);

 try {
 const created = await fetchJson<CreatedProxyApiKey>("/api/admin/keys/create", {
 method: "POST",
 credentials: "include",
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 name: newApiKeyName.trim() || "Lidarr",
 quota: Number(newApiKeyQuota) || 60,
 }),
 });
 setCreatedApiKey(created);
 setMessage({ type: "success", text: "Proxy API key created. Store it now; it is shown once." });
 await mutateApiKeys();
 } catch (error) {
 setMessage({ type: "error", text: error instanceof Error ? error.message : "API key creation failed." });
 } finally {
 setApiKeyBusy(false);
 }
 }

 async function handleRevokeProxyApiKey(id: string) {
 setApiKeyBusy(true);
 setMessage(null);

 try {
 await fetchJson(`/api/admin/keys/${encodeURIComponent(id)}`, {
 method: "DELETE",
 credentials: "include",
 });
 setMessage({ type: "success", text: "Proxy API key revoked." });
 if (createdApiKey?.id === id) setCreatedApiKey(null);
 await mutateApiKeys();
 } catch (error) {
 setMessage({ type: "error", text: error instanceof Error ? error.message : "API key revoke failed." });
 } finally {
 setApiKeyBusy(false);
 }
 }

 async function copyProxyKey(value: string) {
 await navigator.clipboard.writeText(value);
 setCopiedProxyKey(true);
 window.setTimeout(() => setCopiedProxyKey(false), 1500);
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

 function cycleTestArtist() {
  const currentIndex = TEST_ARTISTS.indexOf(providerTestQuery);
  const nextIndex = currentIndex === -1 || currentIndex === TEST_ARTISTS.length - 1 ? 0 : currentIndex + 1;
  setProviderTestQuery(TEST_ARTISTS[nextIndex]);
 }

 function renderField(field: SettingsField) {
 const source = config[field.key]?.source;
 const isPassword = field.type === "password";
 const revealed = isPassword && visiblePasswords.has(field.key);

 return (
 <label key={field.key} className="block">
 <div className="mb-2 flex items-center justify-between gap-3">
 <span className="text-sm font-medium text-secondary ">{field.label}</span>
 {source && <span className="text-xs text-muted">{source}</span>}
 </div>
 <div className="relative">
 <input
 className={inputClass()}
 type={isPassword && !revealed ? "password" : field.type === "password" ? "text" : field.type}
 min={field.type === "number" ? 1 : undefined}
 placeholder={field.placeholder}
 value={form[field.key] ?? readConfig(config, field.key)}
 onChange={(event) => updateField(field.key, event.target.value)}
 style={isPassword ? { paddingRight: "2.5rem" } : undefined}
 />
 {isPassword && (
 <button
 type="button"
 tabIndex={-1}
 onClick={() => togglePasswordVisibility(field.key)}
 className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors hover:text-primary"
 aria-label={revealed ? "Hide value" : "Show value"}
 >
 {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
 </button>
 )}
 {field.suffix && <span className="pointer-events-none absolute right-3 top-2 text-sm text-muted">{field.suffix}</span>}
 </div>
 </label>
 );
 }

 function renderProviderSetting(field: SettingsField) {
 const source = config[field.key]?.source;
 const value = form[field.key] ?? readConfig(config, field.key);
 const isPassword = field.type === "password";
 const revealed = isPassword && visiblePasswords.has(field.key);

 return (
 <label key={field.key} className="block">
 <div className="mb-2 flex items-center justify-between gap-3">
 <span className="text-xs font-medium text-secondary">{field.label}</span>
 {source && <span className="text-xs text-secondary">{source}</span>}
 </div>
 {field.type === "select" ? (
 <select
 className={inputClass()}
 value={value}
 onChange={(event) => updateField(field.key, event.target.value)}
 >
 {(field.options ?? []).map((option) => (
 <option key={option.value} value={option.value}>{option.label}</option>
 ))}
 </select>
 ) : (
 <div className="relative">
 <input
 className={inputClass()}
 type={isPassword && !revealed ? "password" : field.type === "password" ? "text" : field.type}
 min={field.type === "number" ? 1 : undefined}
 placeholder={field.placeholder}
 value={value}
 onChange={(event) => updateField(field.key, event.target.value)}
 style={isPassword || field.suffix ? { paddingRight: isPassword ? "2.5rem" : "3.5rem" } : undefined}
 />
 {isPassword && (
 <button
 type="button"
 tabIndex={-1}
 onClick={() => togglePasswordVisibility(field.key)}
 className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors hover:text-primary"
 aria-label={revealed ? "Hide value" : "Show value"}
 >
 {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
 </button>
 )}
 {field.suffix && !isPassword && <span className="pointer-events-none absolute right-3 top-2 text-sm text-muted">{field.suffix}</span>}
 </div>
 )}
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
 <p className="mt-2 text-secondary">Runtime configuration and administration for Melodarr Proxy.</p>
 </div>
 <div className="flex items-center gap-3">
 {message && (
 <span className={`inline-flex items-center gap-2 text-sm ${message.type === "error" ? "text-red-700 dark:text-red-300" : "text-emerald-300"}`}>
 {message.type === "error" ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
 {message.text}
 </span>
 )}
 {isAuthenticated && (
 <>
 <button
 type="button"
 onClick={refreshAll}
 disabled={refreshing || statusLoading || settingsLoading}
 className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm text-primary transition-colors hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5 disabled:opacity-60"
 >
 <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
 {refreshing ? "Refreshing" : "Refresh"}
 </button>
 <button
 type="button"
 onClick={handleLogout}
 disabled={authBusy}
 className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm text-primary transition-colors hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5 disabled:opacity-60"
 >
 <LogOut className="h-4 w-4" />
 Logout
 </button>
 </>
 )}
 </div>
 </div>

 {(statusError || settingsError) && (
 <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
 {(statusError || settingsError)?.message}
 </div>
 )}

 {!isAuthenticated && (
 <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,480px)_1fr]">
 <form onSubmit={handleAuthSubmit} className="rounded-lg border border-border bg-card p-6">
 <div className="mb-6 flex items-center gap-3">
 <div className="rounded-md bg-blue-500/10 p-2 text-blue-700 dark:text-blue-400">
 {needsSetup ? <Shield className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
 </div>
 <div>
 <h2 className="text-lg font-semibold">{needsSetup ? "Create admin access" : "Sign in"}</h2>
 <p className="mt-1 text-sm text-muted">
 {needsSetup ? "Set the local settings password before changing runtime configuration." : "Use the settings password configured for this proxy."}
 </p>
 </div>
 </div>
 <div className="space-y-4">
 <label className="block">
 <span className="mb-2 block text-sm font-medium text-secondary ">Password</span>
 <div className="relative">
 <input
 className={inputClass()}
 type={visiblePasswords.has("_login") ? "text" : "password"}
 minLength={8}
 value={password}
 onChange={(event) => setPassword(event.target.value)}
 required
 style={{ paddingRight: "2.5rem" }}
 />
 <button
 type="button"
 tabIndex={-1}
 onClick={() => togglePasswordVisibility("_login")}
 className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors hover:text-primary"
 aria-label={visiblePasswords.has("_login") ? "Hide password" : "Show password"}
 >
 {visiblePasswords.has("_login") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
 </button>
 </div>
 </label>
 {needsSetup && (
 <label className="block">
 <span className="mb-2 block text-sm font-medium text-secondary ">Confirm password</span>
 <div className="relative">
 <input
 className={inputClass()}
 type={visiblePasswords.has("_confirm") ? "text" : "password"}
 minLength={8}
 value={confirmPassword}
 onChange={(event) => setConfirmPassword(event.target.value)}
 required
 style={{ paddingRight: "2.5rem" }}
 />
 <button
 type="button"
 tabIndex={-1}
 onClick={() => togglePasswordVisibility("_confirm")}
 className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors hover:text-primary"
 aria-label={visiblePasswords.has("_confirm") ? "Hide password" : "Show password"}
 >
 {visiblePasswords.has("_confirm") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
 </button>
 </div>
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
 <div className="rounded-lg border border-border bg-card p-5">
 <Shield className="h-5 w-5 text-blue-700 dark:text-blue-400" />
 <h2 className="mt-4 font-semibold">Access</h2>
 <p className="mt-2 text-sm text-secondary">
 {settings?.admin?.envPasswordConfigured ? "Password configured by environment" : "Local settings session active"}
 </p>
 </div>
 <div className="rounded-lg border border-border bg-card p-5">
 <SlidersHorizontal className="h-5 w-5 text-orange-400" />
 <h2 className="mt-4 font-semibold">Configuration</h2>
 <p className="mt-2 text-sm text-secondary">{Object.keys(config).length || "--"} runtime values</p>
 </div>
 <div className="rounded-lg border border-border bg-card p-5">
 <KeyRound className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
 <h2 className="mt-4 font-semibold">Provider credentials</h2>
 <p className="mt-2 text-sm text-secondary">Saved with runtime settings and used by metadata providers.</p>
 </div>
 </section>

 {settingsLoading ? (
 <div className="rounded-lg border border-border bg-card p-8 text-sm text-secondary">Loading settings...</div>
 ) : (
 <div className="space-y-6">
  <div className="flex space-x-1 border-b border-border overflow-x-auto">
    {(
      [
        { id: "general", label: "General" },
        { id: "providers", label: "Providers" },
        { id: "api-keys", label: "API Keys" },
        { id: "system", label: "System" }
      ] as const
    ).map((tab) => (
      <button
        key={tab.id}
        onClick={() => setActiveTab(tab.id)}
        className={`whitespace-nowrap px-4 py-2 border-b-2 font-medium text-sm transition-colors -mb-px ${
          activeTab === tab.id
            ? "border-blue-500 text-blue-500"
            : "border-transparent text-secondary hover:text-primary hover:border-border"
        }`}
      >
        {tab.label}
      </button>
    ))}
  </div>

  {activeTab === "general" && (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
 <Section title="Identity" icon={<Sparkles className="h-5 w-5" />}>
 <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
 {identityFields.map(renderField)}
 </div>
 <button
 type="button"
 onClick={handleGenerateName}
 disabled={generatingName}
 className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-page px-4 py-2 text-sm text-primary transition-colors hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5 disabled:opacity-60"
 >
 {generatingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
 Generate product name
 </button>
 </Section>

 </div>
  )}

  {activeTab === "providers" && (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
 <div className="mb-5 flex flex-col gap-3 rounded-lg border border-border bg-page p-4 md:flex-row md:items-end md:justify-between">
 <label className="block flex-1">
 <span className="mb-2 block text-sm font-medium text-secondary ">Provider test artist</span>
 <div className="relative flex items-center">
 <input
 className={inputClass()}
 type="text"
 value={providerTestQuery}
 onChange={(event) => setProviderTestQuery(event.target.value)}
 placeholder="Radiohead"
 style={{ paddingRight: "2.5rem" }}
 />
 <button
 type="button"
 onClick={cycleTestArtist}
 className="absolute right-2 p-1 text-muted transition-colors hover:text-primary rounded"
 title="Next artist"
 aria-label="Next artist"
 >
 <Dices className="h-4 w-4" />
 </button>
 </div>
 </label>
 <button
 type="button"
 onClick={handleSelectedProviderTests}
 disabled={Boolean(testingProvider) || selectedProviders.size === 0 || !providerTestQuery.trim()}
 className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm text-primary transition-colors hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5 disabled:opacity-60"
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
 checked ? "border-blue-500/50 bg-blue-500/10" : "border-border bg-page hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5"
 }`}
 >
 <div className="flex items-start justify-between gap-3">
 <div className="flex min-w-0 items-center gap-3">
 <GripVertical className="h-5 w-5 shrink-0 cursor-grab text-muted" />
 <input
 id={`provider-${provider.id}`}
 type="checkbox"
 checked={checked}
 onChange={() => toggleProvider(provider.id)}
 className="h-4 w-4 rounded border-border bg-page"
 />
 <label htmlFor={`provider-${provider.id}`} className="cursor-pointer truncate font-medium text-primary">
 {provider.label}
 </label>
 </div>
 <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">#{index + 1}</span>
 </div>
 <p className="mt-2 text-sm leading-5 text-muted">{provider.note}</p>
 <div className="mt-4 space-y-3">
 {(providerSettings[provider.id] ?? []).map(renderProviderSetting)}
 </div>
 <div className="mt-4 flex items-center justify-between gap-3">
 <button
 type="button"
 onClick={() => handleProviderTest(provider.id)}
 disabled={testingProvider === provider.id || !providerTestQuery.trim()}
 className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-primary transition-colors hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5 disabled:opacity-60"
 >
 {testingProvider === provider.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
 Test
 </button>
 {result && (
 <span className={`text-xs ${result.ok ? "text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
 {result.ok ? `${result.albumCount ?? 0} albums in ${result.durationMs ?? 0}ms` : "Failed"}
 </span>
 )}
 </div>
 {result && (
 <div className={`mt-3 rounded-md border p-3 text-xs ${
 result.ok ? "border-emerald-500/20 bg-emerald-500/5 text-secondary " : "border-red-500/20 bg-red-500/5 text-red-200"
 }`}>
 {result.ok ? (
 <>
 <div className="font-medium text-primary">{result.artistName || result.query}</div>
 <div className="mt-1 text-muted">
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
 className="mt-2 inline-flex items-center gap-2 rounded-md border border-red-400/30 bg-page dark:bg-card border border-border px-2.5 py-1 text-[11px] text-red-100 transition-colors hover:bg-red-500/10"
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

 <Section title="Custom Providers" icon={<Braces className="h-5 w-5" />}>
 <div className="mb-6 rounded-lg border border-border bg-page p-4">
 {renderProviderSetting({
 key: "customProviderIpFamily",
 label: "Global Custom Provider IP family",
 type: "select",
 options: ipFamilyOptions
 })}
 {renderProviderSetting({
 key: "customProviderMinRequestIntervalMs",
 label: "Custom provider request interval",
 type: "number",
 suffix: "ms"
 })}
 </div>
 <div className="space-y-4">
 {customProviders.map((cp) => (
 <div key={cp.id} className="flex items-center justify-between rounded-lg border border-border bg-page p-4">
 <div>
 <div className="font-medium text-primary">{cp.name || cp.id}</div>
 <div className="text-sm text-muted">{cp.baseUrl}</div>
 </div>
 <div className="flex gap-2">
 <button
 type="button"
 onClick={() => setEditingProvider(cp)}
 className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-primary transition-colors hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5"
 >
 Edit
 </button>
 <button
 type="button"
 onClick={() => {
 const next = customProviders.filter(p => p.id !== cp.id);
 setCustomProviders(next);
 }}
 className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-700 dark:text-red-300 transition-colors hover:bg-red-500/20"
 >
 Delete
 </button>
 </div>
 </div>
 ))}
 <button
 type="button"
 onClick={() => setEditingProvider({
 id: generateId(),
 name: "New Custom Provider",
 baseUrl: "",
 searchPath: "",
 queryParam: "q",
 authType: "none",
 mapping: {},
 ipFamily: "auto"
 })}
 className="inline-flex items-center gap-2 rounded-md border border-dashed border-border bg-page px-4 py-3 text-sm text-secondary transition-colors hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5 w-full justify-center"
 >
 <Sparkles className="h-4 w-4" />
 Add Custom Provider
 </button>
 </div>
 </Section>

 </div>
  )}

  {activeTab === "general" && (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Section title="Cache and timing" icon={<SlidersHorizontal className="h-5 w-5" />}>
 <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
 {cacheFields.map(renderField)}
 </div>
 </Section>
 </div>
  )}

  {activeTab === "api-keys" && (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Section title="Proxy API Keys" icon={<KeyRound className="h-5 w-5" />}>
        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
          Lidarr calls <code>/api/search</code> and SkyHook metadata endpoints directly. If proxy API keys exist, Lidarr must send one as an <code>X-Api-Key</code> header, <code>api_key</code> query parameter, or path key.
        </div>
        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-page p-4">
            <div className="text-xs uppercase tracking-wide text-muted">Proxy auth</div>
            <div className={`mt-2 text-sm font-medium ${settings?.apiAuth?.requireApiKey ? "text-amber-300" : "text-emerald-300"}`}>
              {settings?.apiAuth?.requireApiKey ? "API key required" : "No key required"}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-page p-4">
            <div className="text-xs uppercase tracking-wide text-muted">Configured keys</div>
            <div className="mt-2 text-sm font-medium text-primary">{apiKeys?.keys?.length ?? 0}</div>
          </div>
          <div className="rounded-lg border border-border bg-page p-4">
            <div className="text-xs uppercase tracking-wide text-muted">Lidarr status</div>
            <div className={`mt-2 text-sm font-medium ${settings?.apiAuth?.unauthenticatedAllowed ? "text-emerald-300" : "text-amber-300"}`}>
              {settings?.apiAuth?.unauthenticatedAllowed ? "Unauthenticated calls allowed" : "Configure Lidarr key"}
            </div>
          </div>
        </div>

        <form onSubmit={handleCreateProxyApiKey} className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-page p-4 md:grid-cols-[minmax(0,1fr)_160px_auto] md:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-secondary">Key name</span>
            <input
              className={inputClass()}
              value={newApiKeyName}
              onChange={(event) => setNewApiKeyName(event.target.value)}
              placeholder="Lidarr"
              required
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-secondary">Quota/min</span>
            <input
              className={inputClass()}
              type="number"
              min={1}
              value={newApiKeyQuota}
              onChange={(event) => setNewApiKeyQuota(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={apiKeyBusy}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
          >
            {apiKeyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Create key
          </button>
        </form>

        {createdApiKey && (
          <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="mb-2 text-sm font-medium text-emerald-100">New key shown once</div>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-emerald-500/20 bg-black/30 px-3 py-2 text-xs text-emerald-100">{createdApiKey.key}</code>
              <button
                type="button"
                onClick={() => copyProxyKey(createdApiKey.key)}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 transition-colors hover:bg-emerald-500/20"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedProxyKey ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="mt-3 space-y-1 text-xs leading-5 text-emerald-100/80">
              <div>Header: <code>X-Api-Key: {createdApiKey.key}</code></div>
              <div>Query: <code>/api/search?type=all&amp;query=Radiohead&amp;api_key={createdApiKey.key}</code></div>
              <div>Path-key base for Lidarr: <code>{typeof window !== "undefined" ? window.location.origin : ""}/api/{createdApiKey.key}</code></div>
            </div>
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_120px_120px_auto] gap-3 border-b border-border bg-page px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted">
            <div>Name</div>
            <div>Quota/min</div>
            <div>Usage</div>
            <div>Last used</div>
            <div></div>
          </div>
          {apiKeysLoading ? (
            <div className="px-4 py-5 text-sm text-secondary">Loading proxy API keys...</div>
          ) : (apiKeys?.keys ?? []).length === 0 ? (
            <div className="px-4 py-5 text-sm leading-6 text-secondary">
              No proxy API keys are configured. Unless <code>REQUIRE_API_KEY=true</code> is forcing auth, proxy requests are accepted without a key.
            </div>
          ) : (
            (apiKeys?.keys ?? []).map((key) => (
              <div key={key.id} className="grid grid-cols-[minmax(0,1fr)_120px_120px_120px_auto] items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate font-medium text-primary">{key.name}</div>
                  <div className="mt-1 font-mono text-xs text-muted">{key.id}</div>
                </div>
                <div className="text-secondary">{key.quotaPerMinute}</div>
                <div className="text-secondary">{key.usage}</div>
                <div className="truncate text-xs text-muted">{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}</div>
                <button
                  type="button"
                  onClick={() => handleRevokeProxyApiKey(key.id)}
                  disabled={apiKeyBusy}
                  className="inline-flex items-center justify-center rounded-md border border-red-500/30 bg-red-500/10 p-2 text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-300 disabled:opacity-60"
                  aria-label={`Revoke ${key.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </Section>

      <Section title="Provider API Keys" icon={<KeyRound className="h-5 w-5" />}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {renderField({ key: "musicbrainzApiKey", label: "MusicBrainz API Key", type: "password" })}
          {renderField({ key: "theAudioDbApiKey", label: "TheAudioDB API Key", type: "password" })}
          {renderField({ key: "lastfmApiKey", label: "Last.fm API Key", type: "password" })}
          {renderField({ key: "discogsToken", label: "Discogs Token", type: "password" })}
        </div>
      </Section>
    </div>
  )}

  {activeTab === "system" && (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Section title="Server" icon={<Server className="h-5 w-5" />}>
 <div className="space-y-3">
 {Object.entries(settings?.server ?? {}).map(([key, info]) => (
 <div key={key} className="rounded-md border border-border bg-page p-4">
 <div className="text-xs uppercase tracking-wide text-muted">{key}</div>
 <div className="mt-2 break-all font-mono text-sm text-primary">{String(info.value)}</div>
 <div className="mt-2 text-xs text-muted">{info.source}</div>
 </div>
 ))}
 </div>
 </Section>
 </div>
 )}

  <section className="rounded-lg border border-border bg-card p-6 mt-8">
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold">Save changes</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          Saved runtime values override defaults immediately. Environment defaults remain visible when a value has not been saved.
        </p>
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save settings
      </button>
    </div>
  </section>
  </div>
  )}
  </>
  )}

 {editingProvider && (
 <CustomProviderModal
 provider={editingProvider}
 testQuery={providerTestQuery}
 onClose={() => setEditingProvider(null)}
 onSave={(updated) => {
 const exists = customProviders.some(cp => cp.id === updated.id);
 if (exists) {
 setCustomProviders(customProviders.map(cp => cp.id === updated.id ? updated : cp));
 } else {
 setCustomProviders([...customProviders, updated]);
 // Also auto-enable it
 const nextSelected = new Set(selectedProviders);
 nextSelected.add(updated.id);
 updateField("metadataProviders", allAvailableProviders.map(p => p.id).filter(id => nextSelected.has(id)).concat([updated.id]).join(","));
 }
 setEditingProvider(null);
 }}
 />
 )}
 </main>
 );
}
