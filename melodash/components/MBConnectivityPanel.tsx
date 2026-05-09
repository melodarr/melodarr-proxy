'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { fetchWithFallback } from '@/lib/proxy'

type UpstreamEntry = {
 ts: string
 path?: string
 failedStep: string | null
 error: { code: string | null; message: string | null } | null
 httpStatus: number | null
 durationMs: number
}

type UpstreamResponse = {
 entries: UpstreamEntry[]
 filteredCount: number
 totalCount: number
 maxSize: number
}

type ReadyResponse = {
 status: 'ok' | 'degraded' | 'down'
 upstream: string
 upstreamDetail?: {
 status: string
 probedProvider: string | null
 activeProviders: string[]
 lastCheckedAt: string | null
 lastError: { message: string; code: string | null; status: number | null } | null
 consecutiveFailures: number
 }
}

type NetworkProviderState = {
 provider: string
 policy: string
 family: number
 fallbackAllowed: boolean
 state: string
 ok: boolean
 failedStep: string | null
 checkedAt: string | null
 lastSuccessAt: string | null
 consecutiveFailures: number
 dns?: {
 aaaaAvailable: boolean
 addresses: Array<{ address: string; family: number }>
 errors: Record<string, string>
 }
 tcp?: { connected?: boolean; selectedAddress?: string | null; selectedFamily?: number | null } | null
 tls?: { protocol?: string | null; authorizationError?: string | null } | null
 http?: { status?: number | null; statusText?: string | null } | null
 timingsMs?: { dns?: number | null; tcp?: number | null; tls?: number | null; http?: number | null; total?: number | null } | null
 error?: { code?: string | null; message?: string | null } | null
 userAgent?: {
 valid: boolean
 contactType: string | null
 code: string | null
 message: string | null
 recommendation: string | null
 } | null
 recommendations: string[]
}

type NetworkResponse = {
 status: string
 checkedAt: string | null
 providers: {
 musicbrainz?: NetworkProviderState
 }
 summary: {
 musicbrainz?: {
 policy: string
 family: number
 fallbackAllowed: boolean
 state: string
 ok: boolean
 failedStep: string | null
 userAgentValid: boolean | null
 lastCheckedAt: string | null
 lastSuccessAt: string | null
 consecutiveFailures: number
 }
 }
}

const AFFECTED_KEY = 'mb.affectedArtists.v1'
const MAX_AFFECTED = 50

const fetcher = async (url: string) => {
 const r = await fetchWithFallback(url)
  if (!r.ok && r.status !== 503) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

function summarize (entries: UpstreamEntry[]) {
 if (entries.length === 0) {
 return { total: 0, success: 0, tls: 0, http: 0, dns: 0, tcp: 0, successRate: 0 }
 }
 let success = 0
 let tls = 0
 let http = 0
 let dns = 0
 let tcp = 0
 for (const e of entries) {
 if (!e.error && !e.failedStep) success++
 else if (e.failedStep === 'tls') tls++
 else if (e.failedStep === 'dns') dns++
 else if (e.failedStep === 'tcp') tcp++
 else http++
 }
 return {
 total: entries.length,
 success,
 tls,
 http,
 dns,
 tcp,
 successRate: success / entries.length
 }
}

function extractAffected (entries: UpstreamEntry[]): string[] {
 const out: string[] = []
 for (const e of entries) {
 if (!e.failedStep || !e.path) continue
 const m = /[?&]query=([^&]+)/.exec(e.path)
 if (!m) continue
 try {
 const name = decodeURIComponent(m[1]).trim()
 if (name && name !== 'test') out.push(name)
 } catch {
 // malformed encoding — skip
 }
 }
 return out
}

export default function MBConnectivityPanel () {
 const { data: upstream, error: upstreamErr } = useSWR<UpstreamResponse>(
 '/debug/upstream?provider=musicbrainz&limit=20',
 fetcher,
 { refreshInterval: 5000 }
 )

 const { data: network, error: networkErr, mutate: refreshNetwork } = useSWR<NetworkResponse>(
 '/debug/network',
 fetcher,
 { refreshInterval: 15000 }
 )

 const { data: ready, error: readyErr } = useSWR<ReadyResponse>(
 '/api/ready',
 fetcher,
 { refreshInterval: 5000 }
 )

 const prevReadyStatus = useRef<string | null>(null)
 const sawFailureSinceMount = useRef(false)
 const [affected, setAffected] = useState<string[]>([])
 const [hydrated, setHydrated] = useState(false)
 const [showCleanup, setShowCleanup] = useState(false)
 const [isRefreshingNetwork, setIsRefreshingNetwork] = useState(false)

 useEffect(() => {
 try {
 const raw = localStorage.getItem(AFFECTED_KEY)
 if (raw) {
 const parsed = JSON.parse(raw)
 if (Array.isArray(parsed)) setAffected(parsed.filter((s) => typeof s === 'string'))
 }
 } catch {
 // corrupt entry — ignore, will be overwritten on next merge
 }
 setHydrated(true)
 }, [])

 useEffect(() => {
 if (!hydrated || !upstream) return
 const fresh = extractAffected(upstream.entries)
 if (fresh.length === 0) return
 setAffected((prev) => {
 const merged = new Set(prev)
 for (const name of fresh) merged.add(name)
 const next = Array.from(merged).slice(-MAX_AFFECTED)
 try {
 localStorage.setItem(AFFECTED_KEY, JSON.stringify(next))
 } catch {
 // quota exceeded or disabled — non-fatal
 }
 return next
 })
 }, [upstream, hydrated])

 const clearAffected = () => {
 setAffected([])
 try {
 localStorage.removeItem(AFFECTED_KEY)
 } catch {
 // non-fatal
 }
 }

 const runNetworkRefresh = async () => {
 setIsRefreshingNetwork(true)
 try {
 const refreshed = await fetcher('/debug/network?refresh=1')
 await refreshNetwork(refreshed, { revalidate: false })
 } finally {
 setIsRefreshingNetwork(false)
 }
 }

 const readyUpstream = ready?.upstream ?? null
 const isHealthy = readyUpstream === 'healthy'
 const isNotApplicable = readyUpstream === 'not_applicable'

 if (readyUpstream && readyUpstream !== 'healthy' && readyUpstream !== 'not_applicable') {
 sawFailureSinceMount.current = true
 }

 const justRecovered =
 isHealthy &&
 sawFailureSinceMount.current &&
 prevReadyStatus.current !== null &&
 prevReadyStatus.current !== 'healthy'

 if (readyUpstream) {
 prevReadyStatus.current = readyUpstream
 }

 if (upstreamErr || readyErr) {
 return (
 <div className='rounded-xl border bg-card text-card-foreground shadow-sm p-6'>
 <h3 className='text-sm font-medium text-secondary mb-2'>MusicBrainz Connectivity</h3>
 <div className='text-red-600 dark:text-red-500 text-sm'>Failed to load status</div>
 </div>
 )
 }

 if (!ready || !upstream) {
 return (
 <div className='rounded-xl border bg-card text-card-foreground shadow-sm p-6'>
 <h3 className='text-sm font-medium text-secondary mb-2'>MusicBrainz Connectivity</h3>
 <div className='text-muted text-sm animate-pulse'>Loading…</div>
 </div>
 )
 }

 const stats = summarize(upstream.entries)
 const mbNetwork = network?.providers.musicbrainz
 const consecutiveFailures = ready.upstreamDetail?.consecutiveFailures ?? 0
 const lastError = ready.upstreamDetail?.lastError
 const lastCheckedAt = ready.upstreamDetail?.lastCheckedAt

 const statusLabel = isNotApplicable
 ? 'Not applicable'
 : isHealthy
 ? 'Healthy'
 : `Failing (${readyUpstream})`

 const statusClass = isNotApplicable
 ? 'bg-page0/10 text-secondary border-border/20'
 : isHealthy
 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-500 border-emerald-500/20'
 : 'bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/20'

 const cleanupCommand =
 'pct exec 163 -- bash -lc "cd /opt/melodarr-proxy && LIDARR_API_KEY=YOUR_KEY ./scripts/cleanup-lidarr-artists.sh"'

 const networkStateLabel = mbNetwork?.state ? mbNetwork.state.replace(/^MUSICBRAINZ_/, '').replace(/_/g, ' ') : 'UNKNOWN'
 const networkStatusClass = mbNetwork?.ok
 ? 'text-emerald-700 dark:text-emerald-400'
 : mbNetwork
 ? 'text-red-700 dark:text-red-400'
 : 'text-muted'
 const networkCheckedAt = mbNetwork?.checkedAt ? new Date(mbNetwork.checkedAt).toLocaleTimeString() : '—'
 const networkAddress = mbNetwork?.dns?.addresses?.find((entry) => entry.family === 6)?.address ?? '—'
 const userAgentStatus = mbNetwork?.userAgent

 return (
 <div className='rounded-xl border bg-card text-card-foreground shadow-sm p-6 flex flex-col gap-3'>
 <div className='flex items-center justify-between'>
 <h3 className='text-sm font-medium text-secondary'>MusicBrainz Connectivity</h3>
 <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusClass}`}>
 {statusLabel}
 </span>
 </div>

 {isNotApplicable && (
 <div className='text-xs text-muted'>
 MusicBrainz is not in the active <code>metadataProviders</code> set — probe disabled.
 </div>
 )}

 {!isNotApplicable && (
 <>
 <div className='grid grid-cols-2 gap-2 text-sm'>
 <div>
 <div className='text-secondary text-xs'>Success rate (last {stats.total})</div>
 <div className='text-2xl font-bold'>
 {stats.total === 0 ? '—' : `${(stats.successRate * 100).toFixed(0)}%`}
 </div>
 </div>
 <div>
 <div className='text-secondary text-xs'>Consecutive failures</div>
 <div className='text-2xl font-bold'>{consecutiveFailures}</div>
 </div>
 </div>

 <div className='text-xs text-muted'>
 ok: {stats.success} · tls: {stats.tls} · dns: {stats.dns} · tcp: {stats.tcp} · http: {stats.http}
 </div>

 <div className='border-t border-border/50 pt-3 mt-1 space-y-3'>
 <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
 <div>
 <div className='text-xs font-medium text-secondary'>Network diagnostics</div>
 <div className={`text-sm font-semibold ${networkStatusClass}`}>{networkStateLabel}</div>
 </div>
 <button
 type='button'
 onClick={runNetworkRefresh}
 disabled={isRefreshingNetwork}
 className='text-xs px-3 py-1 rounded border border-border text-secondary hover:text-primary hover:bg-page disabled:opacity-60'
 >
 {isRefreshingNetwork ? 'Checking…' : 'Recheck'}
 </button>
 </div>

 {networkErr && (
 <div className='text-xs text-red-700 dark:text-red-400'>
 Network diagnostics unavailable: {networkErr instanceof Error ? networkErr.message : 'unknown error'}
 </div>
 )}

 {!network && !networkErr && (
 <div className='text-xs text-muted'>Loading network diagnostics…</div>
 )}

 <div className='grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4'>
 <div>
 <div className='text-muted'>Policy</div>
 <div className='font-medium'>{mbNetwork?.policy ?? 'ipv6_only'}</div>
 </div>
 <div>
 <div className='text-muted'>Family</div>
 <div className='font-medium'>IPv{mbNetwork?.family ?? 6}</div>
 </div>
 <div>
 <div className='text-muted'>Fallback</div>
 <div className='font-medium'>{mbNetwork?.fallbackAllowed ? 'Allowed' : 'Disabled'}</div>
 </div>
 <div>
 <div className='text-muted'>Checked</div>
 <div className='font-medium'>{networkCheckedAt}</div>
 </div>
 <div>
 <div className='text-muted'>AAAA</div>
 <div className='font-medium'>{mbNetwork ? (mbNetwork.dns?.aaaaAvailable ? 'OK' : 'Missing') : '—'}</div>
 </div>
 <div>
 <div className='text-muted'>IPv6 address</div>
 <div className='truncate font-medium' title={networkAddress}>{networkAddress}</div>
 </div>
 <div>
 <div className='text-muted'>TCP</div>
 <div className='font-medium'>{mbNetwork ? (mbNetwork.tcp?.connected ? 'OK' : 'Failed') : '—'}</div>
 </div>
 <div>
 <div className='text-muted'>TLS</div>
 <div className='font-medium'>{mbNetwork ? (mbNetwork.tls?.protocol ?? (mbNetwork.ok ? 'OK' : 'Failed')) : '—'}</div>
 </div>
 <div>
 <div className='text-muted'>User-Agent</div>
 <div className={`font-medium ${userAgentStatus && !userAgentStatus.valid ? 'text-red-700 dark:text-red-400' : ''}`}>
 {userAgentStatus ? (userAgentStatus.valid ? 'OK' : 'Invalid contact') : '—'}
 </div>
 </div>
 </div>

 {userAgentStatus && !userAgentStatus.valid && (
 <div className='text-xs text-red-700 dark:text-red-400'>
 MusicBrainz identity: <code>{userAgentStatus.code ?? 'INVALID'}</code> — {userAgentStatus.message}
 </div>
 )}

 {mbNetwork?.error?.message && (
 <div className='text-xs text-red-700 dark:text-red-400'>
 Network error: <code>{mbNetwork.error.code ?? '?'}</code> — {mbNetwork.error.message}
 </div>
 )}

 {mbNetwork?.recommendations && mbNetwork.recommendations.length > 0 && !mbNetwork.ok && (
 <ul className='space-y-1 text-xs text-secondary'>
 {mbNetwork.recommendations.slice(0, 3).map((item) => (
 <li key={item}>· {item}</li>
 ))}
 </ul>
 )}
 </div>

 {lastError && (
 <div className='text-xs text-red-700 dark:text-red-400'>
 Last error: <code>{lastError.code ?? '?'}</code> — {lastError.message}
 </div>
 )}

 {lastCheckedAt && (
 <div className='text-xs text-muted'>
 Last probe: {new Date(lastCheckedAt).toLocaleTimeString()}
 </div>
 )}

 {!isHealthy && (
 <div className='text-yellow-700 dark:text-yellow-500 text-sm border-l-2 border-yellow-500/40 pl-3'>
 MB unavailable — new artists may be added without MBIDs.
 </div>
 )}

 {justRecovered && (
 <div className='text-emerald-700 dark:text-emerald-400 text-sm border-l-2 border-emerald-500/40 pl-3'>
 MB recovered — safe to run cleanup and re-add affected artists.
 </div>
 )}

 {affected.length > 0 && (
 <div className='border border-border/40 rounded-md p-3 mt-1'>
 <div className='flex items-center justify-between mb-2'>
 <div className='text-sm font-medium'>
 Likely affected artists{' '}
 <span className='text-xs text-muted'>(seen during MB failures)</span>
 </div>
 <button
 type='button'
 onClick={clearAffected}
 className='text-xs text-secondary hover:text-primary underline'
 >
 Clear list
 </button>
 </div>
 <ul className='text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-4'>
 {affected.slice(0, 20).map((name) => (
 <li key={name} className='truncate'>· {name}</li>
 ))}
 </ul>
 {affected.length > 20 && (
 <div className='text-xs text-muted mt-1'>
 …and {affected.length - 20} more
 </div>
 )}
 </div>
 )}

 <div className='mt-1'>
 <button
 type='button'
 onClick={() => setShowCleanup((v) => !v)}
 className='text-sm px-3 py-1 rounded border border-red-500/40 text-red-700 dark:text-red-400 hover:bg-red-500/10'
 >
 {showCleanup ? 'Hide cleanup runbook' : 'Show cleanup runbook'}
 </button>
 {showCleanup && (
 <div className='mt-2 text-xs bg-page dark:bg-card border border-border rounded p-3 font-mono whitespace-pre-wrap break-all'>
 {cleanupCommand}
 <div className='mt-2 text-secondary font-sans'>
 Dry run by default. Add <code>APPLY=1</code> to actually delete.
 This must be run on the Proxmox host — Melodash cannot execute it.
 </div>
 </div>
 )}
 </div>
 </>
 )}
 </div>
 )
}
