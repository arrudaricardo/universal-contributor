import { useQuery } from "@tanstack/react-query";
import { getAgents } from "../lib/api";
import { AgentCard } from "./AgentCard";
import { useState } from "react";
import { CreateAgentModal } from "./CreateAgentModal";
import { AgentDetail } from "./AgentDetail";
import { Plus, Monitor } from "lucide-react";

export function AgentList() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);

  const { data: agents, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: getAgents,
    refetchInterval: 5000,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-900">Agents</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Agent
        </button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-4 border border-slate-100">
              <div className="h-4 bg-slate-100 rounded w-1/3 mb-3 skeleton"></div>
              <div className="h-3 bg-slate-100 rounded w-1/2 mb-2 skeleton"></div>
              <div className="h-3 bg-slate-100 rounded w-2/3 skeleton"></div>
            </div>
          ))}
        </div>
      ) : !agents?.length ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-slate-100 flex items-center justify-center">
            <Monitor className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-base font-medium text-slate-900 mb-1">No agents yet</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mb-4">
            Create your first agent to start contributing to open source.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          >
            Create Agent
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onClick={() => setSelectedAgentId(agent.id)}
            />
          ))}
        </div>
      )}

      {showCreate && <CreateAgentModal onClose={() => setShowCreate(false)} />}
      {selectedAgentId && (
        <AgentDetail agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} />
      )}
    </div>
  );
}
