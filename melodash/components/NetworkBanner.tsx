'use client'

import { useNetworkHealth } from '@/hooks/useNetworkHealth'
import { AlertCircle } from 'lucide-react'

export function NetworkBanner() {
  const { status, reason } = useNetworkHealth()

  if (status !== 'error') return null

  const message = reason === 'offline'
    ? 'Proxy network diagnostics are unreachable.'
    : `MusicBrainz IPv6 diagnostics are degraded (${reason}).`

  return (
    <div className="bg-destructive/15 text-destructive px-4 py-2 flex items-center justify-center gap-2 text-sm font-medium border-b border-destructive/20">
      <AlertCircle className="w-4 h-4" />
      <span>{message}</span>
    </div>
  )
}
