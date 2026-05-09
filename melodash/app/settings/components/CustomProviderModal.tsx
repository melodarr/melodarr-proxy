import { useState } from "react";
import {
 AlertTriangle,
 Copy,
 Eye,
 EyeOff,
 Loader2,
 TestTube2,
 X,
} from "lucide-react";
import { fetchWithFallback } from "@/lib/proxy";
import { JsonTree } from "./JsonTree";
import {
 CustomProviderConfig,
 CustomProviderResult,
 MappingField,
 CustomMapping,
} from "../types";
import { inputClass, getRelativeAlbumPath, formatJson } from "../utils";

export function CustomProviderModal({
 provider,
 testQuery,
 onClose,
 onSave,
}: {
 provider: CustomProviderConfig;
 testQuery: string;
 onClose: () => void;
 onSave: (provider: CustomProviderConfig) => void;
}) {
 const [form, setForm] = useState<CustomProviderConfig>(provider);
 const [selectedMappingField, setSelectedMappingField] = useState<MappingField>("artistName");
 const [customResult, setCustomResult] = useState<CustomProviderResult | null>(null);
 const [testingCustomProvider, setTestingCustomProvider] = useState(false);
 const [copiedCustomLogs, setCopiedCustomLogs] = useState(false);
 const [tokenVisible, setTokenVisible] = useState(false);

 function updateField<K extends keyof CustomProviderConfig>(key: K, value: CustomProviderConfig[K]) {
  setForm((current) => ({ ...current, [key]: value }));
 }

 function updateCustomMapping(field: MappingField, path: string) {
  const nextMapping = {
   ...form.mapping,
   [field]:
    field === "artistName" || field === "albums"
     ? path
     : getRelativeAlbumPath(form.mapping.albums, path),
  };
  setForm((f) => ({ ...f, mapping: nextMapping }));
  if (customResult?.raw !== undefined) {
   void runCustomProviderTest(nextMapping);
  }
 }

 function handleJsonPathSelect(path: string) {
  updateCustomMapping(selectedMappingField, path);
 }

 async function runCustomProviderTest(mapping: CustomMapping) {
 setTestingCustomProvider(true);
 try {
 const response = await fetchWithFallback("/debug/test-provider", {
 method: "POST",
 credentials: "include",
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 baseUrl: form.baseUrl,
 searchPath: form.searchPath,
 queryParam: form.queryParam,
 authType: form.authType || "none",
 token: form.token,
 headerName: form.headerName,
 queryAuthName: form.queryAuthName,
 query: testQuery || "Radiohead",
 mapping,
 minRequestIntervalMs: form.minRequestIntervalMs,
 ipFamily: form.ipFamily,
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
 await runCustomProviderTest(form.mapping);
 }

 async function copyCustomLogs() {
 await navigator.clipboard.writeText(formatJson(customResult?.details ?? customResult?.errors ?? []));
 setCopiedCustomLogs(true);
 window.setTimeout(() => setCopiedCustomLogs(false), 1500);
 }

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-page dark:bg-card border border-border p-4 backdrop-blur-sm overflow-y-auto">
 <div className="relative w-full max-w-6xl rounded-xl border border-border bg-card shadow-2xl my-auto">
 <div className="flex items-center justify-between border-b border-border px-6 py-4">
 <h2 className="text-xl font-semibold text-primary">{form.name || "Edit Custom Provider"}</h2>
 <button onClick={onClose} className="rounded-md p-2 text-secondary hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5 hover:text-black dark:hover:text-white">
 <X className="h-5 w-5" />
 </button>
 </div>
 <div className="p-6">
 <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
 <label className="block">
 <span className="mb-2 block text-sm font-medium text-secondary ">Name</span>
 <input className={inputClass()} value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="Custom API" />
 </label>
 <label className="block xl:col-span-2">
 <span className="mb-2 block text-sm font-medium text-secondary ">Base URL</span>
 <input className={inputClass()} value={form.baseUrl} onChange={(e) => updateField("baseUrl", e.target.value)} placeholder="https://api.example.com" />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-medium text-secondary ">Search path</span>
 <input className={inputClass()} value={form.searchPath} onChange={(e) => updateField("searchPath", e.target.value)} placeholder="/search" />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-medium text-secondary ">Query parameter</span>
 <input className={inputClass()} value={form.queryParam} onChange={(e) => updateField("queryParam", e.target.value)} placeholder="q" />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-medium text-secondary ">Auth type</span>
 <select className={inputClass()} value={form.authType} onChange={(e) => updateField("authType", e.target.value as any)}>
 <option value="none">None</option>
 <option value="bearer">Bearer token</option>
 <option value="header">Header</option>
 <option value="query">Query parameter</option>
 </select>
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-medium text-secondary ">Auth name</span>
 <input
 className={inputClass()}
 value={form.authType === "query" ? (form.queryAuthName ?? "") : (form.headerName ?? "")}
 onChange={(e) => updateField(form.authType === "query" ? "queryAuthName" : "headerName", e.target.value)}
 placeholder={form.authType === "query" ? "api_key" : "X-API-Key"}
 disabled={!["header", "query"].includes(form.authType)}
 />
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-medium text-secondary ">Token</span>
 <div className="relative">
 <input className={inputClass()} type={tokenVisible ? "text" : "password"} value={form.token ?? ""} onChange={(e) => updateField("token", e.target.value)} style={{ paddingRight: "2.5rem" }} />
 <button
  type="button"
  tabIndex={-1}
  onClick={() => setTokenVisible((v) => !v)}
  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors hover:text-primary"
  aria-label={tokenVisible ? "Hide token" : "Show token"}
 >
  {tokenVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
 </button>
 </div>
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-medium text-secondary ">IP family</span>
 <select className={inputClass()} value={form.ipFamily || "auto"} onChange={(e) => updateField("ipFamily", e.target.value as any)}>
 <option value="auto">Auto</option>
 <option value="4">IPv4</option>
 <option value="6">IPv6</option>
 </select>
 </label>
 <label className="block">
 <span className="mb-2 block text-sm font-medium text-secondary ">Request interval</span>
 <div className="relative">
 <input
 className={inputClass()}
 type="number"
 min={1}
 value={form.minRequestIntervalMs ?? ""}
 onChange={(e) => {
 const val = parseInt(e.target.value, 10);
 updateField("minRequestIntervalMs", isNaN(val) ? undefined : val);
 }}
 placeholder="e.g. 1000"
 style={{ paddingRight: "2.5rem" }}
 />
 <span className="pointer-events-none absolute right-3 top-2 text-sm text-muted">ms</span>
 </div>
 </label>
 </div>

 <div className="mt-5 flex flex-wrap items-center gap-3">
 <button
 type="button"
 onClick={testCustomProvider}
 disabled={testingCustomProvider || !form.baseUrl}
 className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
 >
 {testingCustomProvider ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
 Test API
 </button>
 {customResult?.errors?.length ? (
 <span className="inline-flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
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
 <div className="rounded-lg border border-border bg-page p-4">
 <h3 className="text-sm font-semibold text-primary">Raw JSON</h3>
 <p className="mt-1 text-xs text-muted">Select a mapping field, then click a JSON field.</p>
 <div className="mt-4 max-h-[500px] overflow-auto rounded-md border border-border bg-page dark:bg-card border border-border p-2">
 {customResult?.raw ? (
 <JsonTree value={customResult.raw} onSelect={handleJsonPathSelect} />
 ) : (
 <div className="p-4 text-sm text-muted">Run Test API to load a response.</div>
 )}
 </div>
 </div>

 <div className="rounded-lg border border-border bg-page p-4">
 <h3 className="text-sm font-semibold text-primary">Mapping</h3>
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
 selectedMappingField === field ? "border-blue-500/60 bg-blue-500/10" : "border-border bg-card hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5"
 }`}
 >
 <div className="flex items-center justify-between gap-3">
 <span className="text-sm font-medium text-primary">{label}</span>
 {customResult?.errors?.some((error) => error.field === field) && <span className="text-xs text-red-700 dark:text-red-300">Invalid</span>}
 </div>
 <div className="mt-1 truncate font-mono text-xs text-muted">{form.mapping[field] || "Click a field in the JSON tree"}</div>
 </button>
 ))}
 </div>
 </div>

 <div className="rounded-lg border border-border bg-page p-4">
 <div className="flex items-center justify-between gap-3">
 <h3 className="text-sm font-semibold text-primary">Preview</h3>
 {customResult?.details && (
 <button type="button" onClick={copyCustomLogs} className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs text-secondary hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5">
 <Copy className="h-3 w-3" />
 {copiedCustomLogs ? "Copied" : "Copy logs"}
 </button>
 )}
 </div>
 <div className="mt-4 max-h-[500px] overflow-auto rounded-md border border-border bg-page dark:bg-card border border-border p-3">
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
 <pre className="whitespace-pre-wrap text-xs leading-5 text-secondary ">{formatJson(customResult.mapped ?? {})}</pre>
 {customResult.details && (
 <details className="mt-4 text-xs text-secondary">
 <summary className="cursor-pointer">Logs</summary>
 <pre className="mt-2 whitespace-pre-wrap rounded bg-black/30 p-3">{formatJson(customResult.details)}</pre>
 </details>
 )}
 </>
 ) : (
 <div className="text-sm text-muted">Mapped output appears here after a test.</div>
 )}
 </div>
 </div>
 </div>
 </div>
 <div className="flex items-center justify-end gap-3 border-t border-border p-4 bg-page rounded-b-xl">
 <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-secondary hover:text-black dark:hover:text-white transition-colors">Cancel</button>
 <button
 onClick={() => onSave(form)}
 disabled={!!customResult?.errors?.length && form.baseUrl !== ""}
 className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
 >
 Save Provider
 </button>
 </div>
 </div>
 </div>
 );
}
