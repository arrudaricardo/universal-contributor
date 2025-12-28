import { useInfiniteQuery } from "@tanstack/react-query";
import { getRepositories } from "../lib/api";
import { useEffect, useRef, useCallback } from "react";
import { FolderGit2, Star, Loader2 } from "lucide-react";

const PAGE_SIZE = 20;

export function RepositoryList() {
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["repositories"],
    queryFn: ({ pageParam = 0 }) => getRepositories({ offset: pageParam, limit: PAGE_SIZE }),
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

  const repositories = data?.pages.flatMap((page) => page.data) || [];
  const total = data?.pages[0]?.total || 0;

  const formatStars = (stars: number) => stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : stars.toString();
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString();

  const languageColors: Record<string, string> = {
    TypeScript: "bg-blue-500", JavaScript: "bg-yellow-400", Python: "bg-green-500", Rust: "bg-orange-500",
    Go: "bg-cyan-500", Java: "bg-red-500", Ruby: "bg-red-400", Swift: "bg-orange-400",
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Repositories</h1>
        <p className="text-sm text-slate-500">{total} discovered repositories</p>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 divide-y divide-slate-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-4">
              <div className="h-4 bg-slate-100 rounded w-1/3 mb-2 skeleton"></div>
              <div className="h-3 bg-slate-100 rounded w-2/3 skeleton"></div>
            </div>
          ))}
        </div>
      ) : repositories.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-slate-100 flex items-center justify-center">
            <FolderGit2 className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-base font-medium text-slate-900 mb-1">No repositories discovered yet</h3>
          <p className="text-sm text-slate-500">Start an agent to discover trending repositories.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 divide-y divide-slate-100">
            {repositories.map((repo) => (
              <div key={repo.id} className="p-4 hover:bg-slate-50/50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a href={repo.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-slate-900 hover:text-indigo-600 truncate">
                        {repo.fullName}
                      </a>
                      {repo.trendingRank && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">#{repo.trendingRank}</span>}
                    </div>
                    {repo.description && <p className="text-xs text-slate-500 truncate mt-0.5">{repo.description}</p>}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-slate-500 shrink-0">
                    {repo.language && (
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${languageColors[repo.language] || "bg-slate-400"}`}></div>
                        <span className="text-xs">{repo.language}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      <span className="text-xs">{formatStars(repo.stars)}</span>
                    </div>
                    <span className="text-xs text-slate-400">{formatDate(repo.discoveredAt)}</span>
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
