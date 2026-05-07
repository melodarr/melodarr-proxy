import { ReactNode } from "react";

interface AnalyticsCardProps {
 title: string;
 value: string | number;
 subtitle?: string;
 icon?: ReactNode;
}

export function AnalyticsCard({ title, value, subtitle, icon }: AnalyticsCardProps) {
 return (
 <div className="rounded-xl border bg-card text-card-foreground shadow-sm p-6 flex flex-col justify-between h-full">
 <div className="flex flex-row items-center justify-between pb-2">
 <h3 className="tracking-tight text-sm font-medium text-secondary">{title}</h3>
 {icon && <div className="text-secondary">{icon}</div>}
 </div>
 <div>
 <div className="text-2xl font-bold">{value}</div>
 {subtitle && <p className="text-xs text-muted mt-1 text-muted">{subtitle}</p>}
 </div>
 </div>
 );
}
