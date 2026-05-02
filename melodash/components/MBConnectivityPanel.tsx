'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'

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

const AFFECTED_KEY = 'mb.affectedArtists.v1'
const MAX_AFFECTED = 50

const fetcher = async (url: string) => {
  const r = await fetch(url)
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
        <h3 className='text-sm font-medium text-gray-400 mb-2'>MusicBrainz Connectivity</h3>
        <div className='text-red-500 text-sm'>Failed to load status</div>
      </div>
    )
  }

  if (!ready || !upstream) {
    return (
      <div className='rounded-xl border bg-card text-card-foreground shadow-sm p-6'>
        <h3 className='text-sm font-medium text-gray-400 mb-2'>MusicBrainz Connectivity</h3>
        <div className='text-gray-500 text-sm animate-pulse'>Loading…</div>
      </div>
    )
  }

  const stats = summarize(upstream.entries)
  const consecutiveFailures = ready.upstreamDetail?.consecutiveFailures ?? 0
  const lastError = ready.upstreamDetail?.lastError
  const lastCheckedAt = ready.upstreamDetail?.lastCheckedAt

  const statusLabel = isNotApplicable
    ? 'Not applicable'
    : isHealthy
      ? 'Healthy'
      : `Failing (${readyUpstream})`

  const statusClass = isNotApplicable
    ? 'bg-gray-500/10 text-gray-400 border-gray-500/20'
    : isHealthy
      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
      : 'bg-red-500/10 text-red-500 border-red-500/20'

  const cleanupCommand =
    'pct exec 163 -- bash -lc "cd /opt/melodarr-proxy && LIDARR_API_KEY=YOUR_KEY ./scripts/cleanup-lidarr-artists.sh"'

  return (
    <div className='rounded-xl border bg-card text-card-foreground shadow-sm p-6 flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <h3 className='text-sm font-medium text-gray-400'>MusicBrainz Connectivity</h3>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      {isNotApplicable && (
        <div className='text-xs text-gray-500'>
          MusicBrainz is not in the active <code>metadataProviders</code> set — probe disabled.
        </div>
      )}

      {!isNotApplicable && (
        <>
          <div className='grid grid-cols-2 gap-2 text-sm'>
            <div>
              <div className='text-gray-400 text-xs'>Success rate (last {stats.total})</div>
              <div className='text-2xl font-bold'>
                {stats.total === 0 ? '—' : `${(stats.successRate * 100).toFixed(0)}%`}
              </div>
            </div>
            <div>
              <div className='text-gray-400 text-xs'>Consecutive failures</div>
              <div className='text-2xl font-bold'>{consecutiveFailures}</div>
            </div>
          </div>

          <div className='text-xs text-gray-500'>
            ok: {stats.success} · tls: {stats.tls} · dns: {stats.dns} · tcp: {stats.tcp} · http: {stats.http}
          </div>

          {lastError && (
            <div className='text-xs text-red-400'>
              Last error: <code>{lastError.code ?? '?'}</code> — {lastError.message}
            </div>
          )}

          {lastCheckedAt && (
            <div className='text-xs text-gray-500'>
              Last probe: {new Date(lastCheckedAt).toLocaleTimeString()}
            </div>
          )}

          {!isHealthy && (
            <div className='text-yellow-500 text-sm border-l-2 border-yellow-500/40 pl-3'>
              MB unavailable — new artists may be added without MBIDs.
            </div>
          )}

          {justRecovered && (
            <div className='text-emerald-400 text-sm border-l-2 border-emerald-500/40 pl-3'>
              MB recovered — safe to run cleanup and re-add affected artists.
            </div>
          )}

          {affected.length > 0 && (
            <div className='border border-gray-700/40 rounded-md p-3 mt-1'>
              <div className='flex items-center justify-between mb-2'>
                <div className='text-sm font-medium'>
                  Likely affected artists{' '}
                  <span className='text-xs text-gray-500'>(seen during MB failures)</span>
                </div>
                <button
                  type='button'
                  onClick={clearAffected}
                  className='text-xs text-gray-400 hover:text-gray-200 underline'
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
                <div className='text-xs text-gray-500 mt-1'>
                  …and {affected.length - 20} more
                </div>
              )}
            </div>
          )}

          <div className='mt-1'>
            <button
              type='button'
              onClick={() => setShowCleanup((v) => !v)}
              className='text-sm px-3 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10'
            >
              {showCleanup ? 'Hide cleanup runbook' : 'Show cleanup runbook'}
            </button>
            {showCleanup && (
              <div className='mt-2 text-xs bg-black/30 border border-gray-700/50 rounded p-3 font-mono whitespace-pre-wrap break-all'>
                {cleanupCommand}
                <div className='mt-2 text-gray-400 font-sans'>
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
