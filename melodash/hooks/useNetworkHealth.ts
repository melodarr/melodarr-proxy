import useSWR from 'swr'
import { fetchJson } from '@/lib/fetcher'

type ProviderSummary = {
  ok?: boolean
  state?: string
  failedStep?: string | null
}

type NetworkPayload = {
  status?: string
  summary?: Record<string, ProviderSummary>
}

export function useNetworkHealth() {
  const { data, error } = useSWR<NetworkPayload>('/debug/network', fetchJson, { refreshInterval: 15000 })

  if (error) return { status: 'error', reason: 'offline' }
  if (!data) return { status: 'loading' }

  const musicbrainz = data.summary?.musicbrainz
  if (musicbrainz && !musicbrainz.ok && musicbrainz.state !== 'UNKNOWN') {
    return {
      status: 'error',
      reason: musicbrainz.state || musicbrainz.failedStep || 'musicbrainz-unreachable'
    }
  }

  return { status: 'ok' }
}
