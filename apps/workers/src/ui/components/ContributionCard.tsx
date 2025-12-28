import type { Contribution } from "../lib/types";
import { StatusBadge } from "./StatusBadge";
import { useState } from "react";
import { ContributionDetail } from "./ContributionDetail";
import { ExternalLink, Plus, Minus, FileText } from "lucide-react";

interface ContributionCardProps {
  contribution: Contribution;
}

export function ContributionCard({ contribution }: ContributionCardProps) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <div 
        onClick={() => setShowDetail(true)}
        className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 hover:shadow-md transition-shadow cursor-pointer"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge status={contribution.status} size="sm" />
              {contribution.prNumber && (
                <a
                  href={contribution.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  PR #{contribution.prNumber}
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            
            <p className="text-sm text-slate-900 truncate">{contribution.issueTitle}</p>
            <p className="text-xs text-slate-500 mt-0.5">{contribution.repoFullName}</p>
          </div>

          {(contribution.linesAdded !== null || contribution.filesChanged !== null) && (
            <div className="flex items-center gap-2 text-xs">
              {contribution.linesAdded !== null && (
                <span className="flex items-center gap-0.5 text-emerald-600">
                  <Plus className="w-3 h-3" />
                  {contribution.linesAdded}
                </span>
              )}
              {contribution.linesRemoved !== null && (
                <span className="flex items-center gap-0.5 text-red-600">
                  <Minus className="w-3 h-3" />
                  {contribution.linesRemoved}
                </span>
              )}
              {contribution.filesChanged !== null && (
                <span className="flex items-center gap-0.5 text-slate-500">
                  <FileText className="w-3 h-3" />
                  {contribution.filesChanged}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {showDetail && (
        <ContributionDetail
          contributionId={contribution.id}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  );
}
