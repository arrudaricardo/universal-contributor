import { useInfiniteQuery } from "@tanstack/react-query";
import { getIssues } from "../lib/api";
import { StatusBadge } from "./StatusBadge";
import { useEffect, useRef, useCallback } from "react";
import { CircleDot, Loader2 } from "lucide-react";

const PAGE_SIZE = 20;

export function IssueList() {
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["issues"],
    queryFn: ({ pageParam = 0 }) => getIssues({ offset: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (lastPage, allPages) => lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined,
    initialPageParam: 0,
    refetchInterval: 30000,
  });

  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const [entry] = entries;
    if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(handleObserver, { root: null, rootMargin: "100px", threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [handleObserver]);

  const issues = data?.pages.flatMap((page) => page.data) || [];
  const total = data?.pages[0]?.total || 0;

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString();

  const renderScore = (score: number | null, type: "complexity" | "solvability") => {
    if (score === null) return <span className="text-slate-400 text-xs">-</span>;
    let color = "bg-slate-100 text-slate-600";
    if (type === "solvability") {
      if (score >= 4) color = "bg-emerald-100 text-emerald-700";
      else if (score >= 3) color = "bg-amber-100 text-amber-700";
      else color = "bg-red-100 text-red-700";
    } else {
      if (score <= 2) color = "bg-emerald-100 text-emerald-700";
      else if (score <= 3) color = "bg-amber-100 text-amber-700";
      else color = "bg-red-100 text-red-700";
    }
    return <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${color}`}>{score}/5</span>;
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Issues</h1>
        <p className="text-sm text-slate-500">{total} discovered issues</p>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 divide-y divide-slate-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-4">
              <div className="h-4 bg-slate-100 rounded w-1/2 mb-2 skeleton"></div>
              <div className="h-3 bg-slate-100 rounded w-1/3 skeleton"></div>
            </div>
          ))}
        </div>
      ) : issues.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-slate-100 flex items-center justify-center">
            <CircleDot className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-base font-medium text-slate-900 mb-1">No issues discovered yet</h3>
          <p className="text-sm text-slate-500">Start an agent to find issues in trending repositories.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 divide-y divide-slate-100">
            {issues.map((issue) => (
              <div key={issue.id} className="p-4 hover:bg-slate-50/50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a href={issue.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
                        #{issue.githubIssueNumber}
                      </a>
                      <span className="text-xs text-slate-500">{issue.repoFullName}</span>
                      <StatusBadge status={issue.status} size="sm" />
                    </div>
                    <p className="text-sm text-slate-900 truncate mt-0.5">{issue.title}</p>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {issue.hasGoodFirstIssue && <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded">good first issue</span>}
                      {issue.hasHelpWanted && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">help wanted</span>}
                      {issue.hasBugLabel && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded">bug</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    <div className="text-center">
                      <p className="text-slate-400 mb-0.5">Solve</p>
                      {renderScore(issue.aiSolvabilityScore, "solvability")}
                    </div>
                    <div className="text-center">
                      <p className="text-slate-400 mb-0.5">Complexity</p>
                      {renderScore(issue.aiComplexityScore, "complexity")}
                    </div>
                    <span className="text-slate-400">{formatDate(issue.discoveredAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div ref={loadMoreRef} className="h-10 flex items-center justify-center mt-4">
            {isFetchingNextPage && <div className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading...</div>}
          </div>
        </>
      )}
    </div>
  );
}
