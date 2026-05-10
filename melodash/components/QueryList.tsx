export function QueryList({ queries }: { queries: any[] }) {
 if (!queries || queries.length === 0) {
 return <div className="text-sm text-muted py-4">No recent query data.</div>;
 }

 return (
 <div className="w-full">
 <div className="grid grid-cols-2 text-xs text-secondary uppercase bg-card px-4 py-2 border-b border-border">
 <div>Query Term</div>
 <div className="text-right">Frequency</div>
 </div>
 <ul className="divide-y divide-border/50">
 {queries.map((q, idx) => (
 <li key={idx} className="grid grid-cols-2 px-4 py-3 hover:bg-card transition-colors">
 <div className="font-medium text-sm truncate">{q.query}</div>
 <div className="text-right text-sm">{q.count}</div>
 </li>
 ))}
 </ul>
 </div>
 );
}
