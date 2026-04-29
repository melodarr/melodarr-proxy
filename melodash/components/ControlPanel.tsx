"use client";

import { useState } from "react";
import { Play, Square, Trash2 } from "lucide-react";

interface ControlPanelProps {
  baseUrl: string;
}

export function ControlPanel({ baseUrl }: ControlPanelProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleAction = async (action: string, endpoint: string) => {
    setLoading(action);
    try {
      await fetch(`${baseUrl}${endpoint}`, { method: 'POST' });
    } catch (e) {
      console.error(`Failed to ${action}`, e);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-6 flex flex-col gap-4">
      <h3 className="font-semibold text-lg">Control Panel</h3>
      <div className="grid grid-cols-1 gap-3">
        <button 
          onClick={() => handleAction('start', '/api/proxy/start')}
          disabled={loading !== null}
          className="flex items-center justify-center gap-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Play className="w-4 h-4" /> Start Service
        </button>
        <button 
          onClick={() => handleAction('stop', '/api/proxy/stop')}
          disabled={loading !== null}
          className="flex items-center justify-center gap-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Square className="w-4 h-4" /> Stop Service
        </button>
        <button 
          onClick={() => handleAction('clear', '/api/cache/clear')}
          disabled={loading !== null}
          className="flex items-center justify-center gap-2 bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" /> Clear Cache
        </button>
      </div>
    </div>
  );
}
