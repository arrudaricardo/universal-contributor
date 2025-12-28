import type { Workspace } from "../lib/types";
import { StatusBadge } from "./StatusBadge";
import { X } from "lucide-react";

interface WorkspaceCardProps {
  workspace: Workspace;
  onDestroy?: (id: number) => void;
}

export function WorkspaceCard({ workspace, onDestroy }: WorkspaceCardProps) {
  const isActive = ["pending", "creating", "running"].includes(workspace.status);
  const expiresAt = workspace.expiresAt ? new Date(workspace.expiresAt) : null;
  const isExpired = expiresAt && expiresAt < new Date();

  const getStatusGradient = () => {
    switch (workspace.status) {
      case "running":
        return "from-emerald-500 to-teal-500";
      case "creating":
      case "pending":
        return "from-amber-500 to-orange-500";
      case "destroyed":
        return "from-slate-400 to-slate-500";
      case "error":
        return "from-red-500 to-rose-500";
      default:
        return "from-slate-400 to-slate-500";
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-md transition-shadow">
      {/* Header with gradient accent */}
      <div className={`h-0.5 bg-gradient-to-r ${getStatusGradient()}`}></div>
      
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Status */}
            <div className="flex items-center gap-1.5 mb-2">
              <StatusBadge status={workspace.status} size="sm" />
              {isExpired && isActive && (
                <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                  Expired
                </span>
              )}
            </div>

            {/* Repository */}
            <h3 className="text-sm font-medium text-slate-900 truncate">
              {workspace.repoFullName || `Repository #${workspace.repositoryId}`}
            </h3>

            {/* Issue Title */}
            {workspace.issueTitle && (
              <p className="text-xs text-slate-500 truncate mt-0.5">
                {workspace.issueTitle}
              </p>
            )}

            {/* Meta Info */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mt-2">
              <span>{workspace.agentName || `Agent #${workspace.agentId}`}</span>
              {workspace.branchName && (
                <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 truncate max-w-[100px]" title={workspace.branchName}>
                  {workspace.branchName}
                </span>
              )}
            </div>

            {/* Container ID */}
            {workspace.containerId && (
              <p className="mt-1.5 text-xs font-mono text-slate-400">
                {workspace.containerId.slice(0, 12)}
              </p>
            )}

            {/* Error Message */}
            {workspace.errorMessage && (
              <p className="mt-2 text-xs text-red-600 line-clamp-2">
                {workspace.errorMessage}
              </p>
            )}

            {/* Timestamp */}
            <p className="mt-2 text-xs text-slate-400">
              {new Date(workspace.createdAt).toLocaleString()}
            </p>
          </div>

          {/* Destroy Button */}
          {isActive && onDestroy && (
            <button
              onClick={() => onDestroy(workspace.id)}
              className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors flex-shrink-0"
              title="Destroy"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
