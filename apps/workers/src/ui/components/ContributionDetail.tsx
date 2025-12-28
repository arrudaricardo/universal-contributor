import { useQuery } from "@tanstack/react-query";
import { getContribution } from "../lib/api";
import { StatusBadge } from "./StatusBadge";
import { X, Plus, Minus, FileText, ExternalLink } from "lucide-react";

interface ContributionDetailProps {
  contributionId: number;
  onClose: () => void;
}

export function ContributionDetail({ contributionId, onClose }: ContributionDetailProps) {
  const { data: contribution, isLoading } = useQuery({
    queryKey: ["contribution", contributionId],
    queryFn: () => getContribution(contributionId),
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {isLoading ? "Loading..." : `PR #${contribution?.prNumber || "Pending"}`}
          </h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {isLoading ? (
            <div className="space-y-3">
              <div className="h-5 bg-slate-100 rounded w-1/2 skeleton"></div>
              <div className="h-20 bg-slate-100 rounded-lg skeleton"></div>
            </div>
          ) : contribution ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <StatusBadge status={contribution.status} />
                <span className="text-sm text-slate-500">by {contribution.agentName}</span>
              </div>

              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-sm font-medium text-slate-900">{contribution.repoFullName}</p>
                <p className="text-sm text-slate-600 mt-1">#{contribution.issueNumber}: {contribution.issueTitle}</p>
              </div>

              {contribution.prUrl && (
                <a href={contribution.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open PR #{contribution.prNumber} on GitHub
                </a>
              )}

              {(contribution.linesAdded !== null || contribution.filesChanged !== null) && (
                <div className="flex items-center gap-3">
                  {contribution.linesAdded !== null && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded text-sm">
                      <Plus className="w-3.5 h-3.5" /> {contribution.linesAdded}
                    </div>
                  )}
                  {contribution.linesRemoved !== null && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-red-50 text-red-700 rounded text-sm">
                      <Minus className="w-3.5 h-3.5" /> {contribution.linesRemoved}
                    </div>
                  )}
                  {contribution.filesChanged !== null && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-700 rounded text-sm">
                      <FileText className="w-3.5 h-3.5" /> {contribution.filesChanged} files
                    </div>
                  )}
                </div>
              )}

              {contribution.aiSolutionSummary && (
                <div>
                  <h3 className="text-xs font-medium text-slate-500 mb-2">AI Summary</h3>
                  <div className="bg-purple-50 rounded-lg p-3 text-sm text-slate-700 border border-purple-100">
                    {contribution.aiSolutionSummary}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500 mb-0.5">Created</p>
                  <p className="text-sm text-slate-900">{formatDate(contribution.createdAt)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500 mb-0.5">Updated</p>
                  <p className="text-sm text-slate-900">{formatDate(contribution.updatedAt)}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-slate-500">Contribution not found</p>
            </div>
          )}
        </div>

        {contribution?.prUrl && (
          <div className="flex items-center justify-end px-5 py-3 border-t border-slate-100 bg-slate-50">
            <a href={contribution.prUrl} target="_blank" rel="noopener noreferrer" className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5" /> Open on GitHub
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
