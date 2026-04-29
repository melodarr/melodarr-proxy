import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "healthy" | "degraded" | "down" | "loading";
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = {
    healthy: { label: "Healthy", class: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
    degraded: { label: "Degraded", class: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
    down: { label: "Down", class: "bg-red-500/10 text-red-500 border-red-500/20" },
    loading: { label: "Checking", class: "bg-gray-500/10 text-gray-400 border-gray-500/20 animate-pulse" }
  };

  const { label, class: className } = config[status];

  return (
    <div className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border", className)}>
      <div className={cn("w-1.5 h-1.5 rounded-full mr-1.5", status === "loading" ? "bg-gray-400" : `bg-${className.split(' ')[1].split('-')[1]}-500`)} />
      {label}
    </div>
  );
}
