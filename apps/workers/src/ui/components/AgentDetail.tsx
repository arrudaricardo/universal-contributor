import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAgent, deleteAgent, stopAgent, startAgent, resumeAgent } from "../lib/api";
import { StatusBadge } from "./StatusBadge";
import { X } from "lucide-react";

interface AgentDetailProps {
  agentId: number;
  onClose: () => void;
}

export function AgentDetail({ agentId, onClose }: AgentDetailProps) {
  const queryClient = useQueryClient();

  const { data: agent, isLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => getAgent(agentId),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      onClose();
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => stopAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const startMutation = useMutation({
    mutationFn: () => startAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumeAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {isLoading ? "Loading..." : agent?.name}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {isLoading ? (
            <div className="space-y-3">
              <div className="h-5 bg-slate-100 rounded w-1/4 skeleton"></div>
              <div className="h-20 bg-slate-100 rounded-lg skeleton"></div>
            </div>
          ) : agent ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <StatusBadge status={agent.status} />
                <span className="text-sm text-slate-500">Priority: {agent.priority}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500 mb-0.5">Created</p>
                  <p className="text-sm text-slate-900">{formatDate(agent.created_at)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500 mb-0.5">Last Active</p>
                  <p className="text-sm text-slate-900">{formatDate(agent.last_active_at)}</p>
                </div>
              </div>

              {agent.currentIssue && (
                <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-100">
                  <h3 className="text-xs font-medium text-slate-700 mb-2">Current Task</h3>
                  <div className="space-y-1.5 text-sm">
                    <div>
                      <span className="text-slate-500">Repo: </span>
                      <a href={agent.currentIssue.url.replace(/\/issues\/\d+$/, "")} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                        {agent.currentIssue.repoFullName}
                      </a>
                    </div>
                    <div>
                      <span className="text-slate-500">Issue: </span>
                      <a href={agent.currentIssue.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                        #{agent.currentIssue.id}: {agent.currentIssue.title}
                      </a>
                    </div>
                    {agent.state?.step && (
                      <div>
                        <span className="text-slate-500">Step: </span>
                        <span className="font-mono text-slate-900">{agent.state.step}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {agent.currentContribution?.prUrl && (
                <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                  <h3 className="text-xs font-medium text-slate-700 mb-2">Pull Request</h3>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={agent.currentContribution.status} size="sm" />
                    <a href={agent.currentContribution.prUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-emerald-600 hover:underline">
                      PR #{agent.currentContribution.prNumber}
                    </a>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-slate-500">Agent not found</p>
            </div>
          )}
        </div>

        {agent && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50">
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={agent.status === "running" || deleteMutation.isPending}
              className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Delete
            </button>
            <div className="flex gap-2">
              {(agent.status === "idle" || agent.status === "stopped") && (
                <button
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {agent.status === "stopped" ? "Restart" : "Start"}
                </button>
              )}
              {agent.status === "running" && (
                <button
                  onClick={() => stopMutation.mutate()}
                  disabled={stopMutation.isPending}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                  Stop
                </button>
              )}
              {agent.status === "suspended" && (
                <button
                  onClick={() => resumeMutation.mutate()}
                  disabled={resumeMutation.isPending}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                  Resume
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
