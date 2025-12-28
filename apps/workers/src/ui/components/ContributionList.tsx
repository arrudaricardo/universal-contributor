import { useInfiniteQuery } from "@tanstack/react-query";
import { getContributions } from "../lib/api";
import { ContributionCard } from "./ContributionCard";
import { useEffect, useRef, useCallback } from "react";
import { GitPullRequest, Loader2 } from "lucide-react";

const PAGE_SIZE = 20;

export function ContributionList() {
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ["contributions"],
    queryFn: ({ pageParam = 0 }) => getContributions({ offset: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined,
    initialPageParam: 0,
    refetchInterval: 10000,
  });

  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const [entry] = entries;
    if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: "100px",
      threshold: 0,
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [handleObserver]);

  const contributions = data?.pages.flatMap((page) => page.data) || [];
  const total = data?.pages[0]?.total || 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Pull Requests</h1>
        <p className="text-sm text-slate-500">{total} total contributions</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
              <div className="h-4 bg-slate-100 rounded w-1/4 mb-2 skeleton"></div>
              <div className="h-3 bg-slate-100 rounded w-1/2 skeleton"></div>
            </div>
          ))}
        </div>
      ) : contributions.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-slate-100 flex items-center justify-center">
            <GitPullRequest className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-base font-medium text-slate-900 mb-1">No pull requests yet</h3>
          <p className="text-sm text-slate-500">Agents will create PRs when they find and fix issues.</p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {contributions.map((contribution) => (
              <ContributionCard key={contribution.id} contribution={contribution} />
            ))}
          </div>

          <div ref={loadMoreRef} className="h-10 flex items-center justify-center mt-4">
            {isFetchingNextPage && (
              <div className="flex items-center gap-2 text-slate-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading more...
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
