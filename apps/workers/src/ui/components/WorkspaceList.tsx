import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkspaces, destroyWorkspace, getWorkspaceStats, runWorkspaceCleanup } from "../lib/api";
import { WorkspaceCard } from "./WorkspaceCard";
import { Database, Trash2, Loader2 } from "lucide-react";

export function WorkspaceList() {
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ["workspaceStats"],
    queryFn: getWorkspaceStats,
    refetchInterval: 10000,
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteQuery({
    queryKey: ["workspaces"],
    queryFn: ({ pageParam = 0 }) => getWorkspaces({ offset: pageParam, limit: 20 }),
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((acc, page) => acc + page.data.length, 0);
    },
    initialPageParam: 0,
    refetchInterval: 10000,
  });

  const destroyMutation = useMutation({
    mutationFn: destroyWorkspace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["workspaceStats"] });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: runWorkspaceCleanup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["workspaceStats"] });
    },
  });

  const workspaces = data?.pages.flatMap((page) => page.data) ?? [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-slate-100 rounded w-1/4 skeleton"></div>
        <div className="grid grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-lg p-3 border border-slate-100">
              <div className="h-3 bg-slate-100 rounded w-1/2 mb-2 skeleton"></div>
              <div className="h-6 bg-slate-100 rounded skeleton"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 rounded-xl p-8 text-center border border-red-100">
        <p className="text-red-700 font-medium">Error loading workspaces</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Workspaces</h1>
            <p className="text-sm text-slate-500">Docker container environments</p>
          </div>
          <button
            onClick={() => cleanupMutation.mutate()}
            disabled={cleanupMutation.isPending}
            className="px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {cleanupMutation.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Cleaning...
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                Run Cleanup
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white rounded-lg p-3 border border-slate-100">
            <p className="text-xs text-slate-500 mb-0.5">Active</p>
            <p className="text-xl font-semibold text-slate-900">{stats.activeWorkspaces}</p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-slate-100">
            <p className="text-xs text-slate-500 mb-0.5">Expired</p>
            <p className="text-xl font-semibold text-amber-600">{stats.expiredWorkspaces}</p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-slate-100">
            <p className="text-xs text-slate-500 mb-0.5">Destroyed</p>
            <p className="text-xl font-semibold text-slate-500">{stats.totalDestroyed}</p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-slate-100">
            <p className="text-xs text-slate-500 mb-0.5">Errors</p>
            <p className="text-xl font-semibold text-red-600">{stats.totalErrors}</p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-slate-100">
            <p className="text-xs text-slate-500 mb-0.5">Docker</p>
            <p className={`text-sm font-medium ${stats.dockerAvailable ? "text-emerald-600" : "text-red-600"}`}>
              {stats.dockerAvailable ? "Available" : "Unavailable"}
            </p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-slate-100">
            <p className="text-xs text-slate-500 mb-0.5">Image</p>
            <p className={`text-sm font-medium ${stats.imageExists ? "text-emerald-600" : "text-amber-600"}`}>
              {stats.imageExists ? "Ready" : "Not Built"}
            </p>
          </div>
        </div>
      )}

      {/* Workspace Grid */}
      {workspaces.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-slate-100 flex items-center justify-center">
            <Database className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-base font-medium text-slate-900 mb-1">No workspaces found</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            Workspaces are created when agents start working on issues.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((workspace) => (
            <WorkspaceCard
              key={workspace.id}
              workspace={workspace}
              onDestroy={(id) => destroyMutation.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Load More */}
      {hasNextPage && (
        <div className="mt-6 text-center">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="px-4 py-2 text-sm text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors disabled:opacity-50"
          >
            {isFetchingNextPage ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
