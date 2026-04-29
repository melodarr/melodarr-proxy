export function QueryList({ queries }: { queries: any[] }) {
  if (!queries || queries.length === 0) {
    return <div className="text-sm text-gray-500 py-4">No recent query data.</div>;
  }

  return (
    <div className="w-full">
      <div className="grid grid-cols-2 text-xs text-gray-400 uppercase bg-card/50 px-4 py-2 border-b border-border/50">
        <div>Query Term</div>
        <div className="text-right">Frequency</div>
      </div>
      <ul className="divide-y divide-border/50">
        {queries.map((q, idx) => (
          <li key={idx} className="grid grid-cols-2 px-4 py-3 hover:bg-card/30 transition-colors">
            <div className="font-medium text-sm truncate">{q.query}</div>
            <div className="text-right text-sm">{q.count}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
