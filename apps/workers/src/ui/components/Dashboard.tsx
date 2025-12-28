import { useQuery } from "@tanstack/react-query";
import { getStats } from "../lib/api";
import { AgentList } from "./AgentList";
import { Monitor, GitPullRequest, FolderGit2, CircleDot } from "lucide-react";

export function Dashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
    refetchInterval: 5000,
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">Overview of your agents and contributions</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Monitor className="w-4.5 h-4.5 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Agents</p>
              <p className="text-xl font-semibold text-slate-900">
                {isLoading ? "-" : stats?.totalAgents || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
              <GitPullRequest className="w-4.5 h-4.5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Pull Requests</p>
              <p className="text-xl font-semibold text-slate-900">
                {isLoading ? "-" : stats?.totalContributions || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
              <FolderGit2 className="w-4.5 h-4.5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Repositories</p>
              <p className="text-xl font-semibold text-slate-900">
                {isLoading ? "-" : stats?.totalRepositories || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-rose-100 flex items-center justify-center">
              <CircleDot className="w-4.5 h-4.5 text-rose-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Issues</p>
              <p className="text-xl font-semibold text-slate-900">
                {isLoading ? "-" : stats?.totalIssues || 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Agent List */}
      <AgentList />
    </div>
  );
}
