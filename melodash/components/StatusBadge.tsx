import { cn } from "@/lib/utils";

interface StatusBadgeProps {
 status: "healthy" | "degraded" | "down" | "loading";
}

export function StatusBadge({ status }: StatusBadgeProps) {
 const config = {
 healthy: { 
   label: "Healthy", 
   class: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-500 border-emerald-500/20",
   dotClass: "bg-emerald-500"
 },
 degraded: { 
   label: "Degraded", 
   class: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 border-yellow-500/20",
   dotClass: "bg-yellow-500"
 },
 down: { 
   label: "Down", 
   class: "bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/20",
   dotClass: "bg-red-500"
 },
 loading: { 
   label: "Checking", 
   class: "bg-muted/10 text-secondary border-border/20 animate-pulse",
   dotClass: "bg-gray-400"
 }
 };

 const { label, class: className, dotClass } = config[status];

 return (
 <div className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border", className)}>
 <div className={cn("w-1.5 h-1.5 rounded-full mr-1.5", dotClass)} />
 {label}
 </div>
 );
}
