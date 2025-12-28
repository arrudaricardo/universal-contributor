import type { Agent } from "../lib/types";
import { StatusBadge } from "./StatusBadge";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { startAgent, stopAgent } from "../lib/api";
import { Play, Square, ExternalLink } from "lucide-react";

interface AgentCardProps {
  agent: Agent;
  onClick: () => void;
}

export function AgentCard({ agent, onClick }: AgentCardProps) {
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: () => startAgent(agent.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => stopAgent(agent.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-slate-900">{agent.name}</h3>
            <StatusBadge status={agent.status} size="sm" />
          </div>
          <button
            onClick={onClick}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="text-xs text-slate-500 space-y-1 mb-3">
          <p>Priority: {agent.priority}</p>
          <p>Last active: {formatDate(agent.last_active_at)}</p>
        </div>

        <div className="flex gap-2">
          {(agent.status === "idle" || agent.status === "stopped") && (
            <button
              onClick={(e) => { e.stopPropagation(); startMutation.mutate(); }}
              disabled={startMutation.isPending}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
            >
              <Play className="w-3 h-3" />
              Start
            </button>
          )}
          {agent.status === "running" && (
            <button
              onClick={(e) => { e.stopPropagation(); stopMutation.mutate(); }}
              disabled={stopMutation.isPending}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
