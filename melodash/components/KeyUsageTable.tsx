export function KeyUsageTable({ apiKeys }: { apiKeys: Record<string, any> }) {
  if (!apiKeys || Object.keys(apiKeys).length === 0) {
    return <div className="text-sm text-gray-500 py-4">No API key usage data available.</div>;
  }

  const keys = Object.entries(apiKeys)
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => b.requests - a.requests);

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-gray-400 uppercase bg-card/50 border-b border-border/50">
          <tr>
            <th className="px-4 py-3">API Key</th>
            <th className="px-4 py-3">Requests</th>
            <th className="px-4 py-3">Avg Latency</th>
            <th className="px-4 py-3">Errors</th>
            <th className="px-4 py-3">Error Rate</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.key} className="border-b border-border/50 hover:bg-card/30 transition-colors">
              <td className="px-4 py-3 font-medium font-mono text-xs">{k.key}</td>
              <td className="px-4 py-3">{k.requests}</td>
              <td className="px-4 py-3">{k.avgLatencyMs}ms</td>
              <td className="px-4 py-3 text-red-400">{k.errors}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span>{(k.errorRate * 100).toFixed(1)}%</span>
                  <div className="w-16 bg-gray-800 rounded-full h-1.5 hidden sm:block">
                    <div className="bg-red-500 h-1.5 rounded-full" style={{ width: `${Math.min(k.errorRate * 100, 100)}%` }}></div>
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
