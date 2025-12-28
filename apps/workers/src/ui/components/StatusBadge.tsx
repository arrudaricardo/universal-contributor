interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const baseClasses = size === "sm" 
    ? "px-1.5 py-0.5 text-xs" 
    : "px-2 py-1 text-xs";

  const statusConfig: Record<string, { bg: string; text: string; dot?: string }> = {
    idle: { bg: "bg-slate-100", text: "text-slate-700" },
    running: { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500" },
    stopped: { bg: "bg-slate-100", text: "text-slate-600" },
    suspended: { bg: "bg-amber-100", text: "text-amber-700" },
    error: { bg: "bg-red-100", text: "text-red-700" },
    failed: { bg: "bg-red-100", text: "text-red-700" },
    pending: { bg: "bg-blue-100", text: "text-blue-700" },
    creating: { bg: "bg-blue-100", text: "text-blue-700" },
    destroyed: { bg: "bg-slate-100", text: "text-slate-500" },
    open: { bg: "bg-emerald-100", text: "text-emerald-700" },
    merged: { bg: "bg-purple-100", text: "text-purple-700" },
    closed: { bg: "bg-red-100", text: "text-red-700" },
    draft: { bg: "bg-slate-100", text: "text-slate-600" },
    available: { bg: "bg-slate-100", text: "text-slate-600" },
    claimed: { bg: "bg-blue-100", text: "text-blue-700" },
    in_progress: { bg: "bg-amber-100", text: "text-amber-700" },
    completed: { bg: "bg-emerald-100", text: "text-emerald-700" },
    success: { bg: "bg-emerald-100", text: "text-emerald-700" },
    failure: { bg: "bg-red-100", text: "text-red-700" },
  };

  const config = statusConfig[status] || { bg: "bg-slate-100", text: "text-slate-700" };

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium rounded-full ${baseClasses} ${config.bg} ${config.text}`}>
      {config.dot && status === "running" && (
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot} animate-pulse`}></span>
      )}
      {status}
    </span>
  );
}
