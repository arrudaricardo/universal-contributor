import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getConfig, updateConfig } from "../lib/api";
import { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";

interface ConfigPanelProps {
  onClose: () => void;
}

export function ConfigPanel({ onClose }: ConfigPanelProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    githubToken: "",
    anthropicApiKey: "",
    maxConcurrentAgents: 3,
    discoveryIntervalMinutes: 60,
  });

  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
  });

  useEffect(() => {
    if (config) {
      setFormData({
        githubToken: config.githubToken || "",
        anthropicApiKey: config.anthropicApiKey || "",
        maxConcurrentAgents: config.maxConcurrentAgents || 3,
        discoveryIntervalMinutes: config.discoveryIntervalMinutes || 60,
      });
    }
  }, [config]);

  const mutation = useMutation({
    mutationFn: updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  GitHub Token
                </label>
                <input
                  type="password"
                  value={formData.githubToken}
                  onChange={(e) => setFormData({ ...formData, githubToken: e.target.value })}
                  placeholder="ghp_..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Anthropic API Key
                </label>
                <input
                  type="password"
                  value={formData.anthropicApiKey}
                  onChange={(e) => setFormData({ ...formData, anthropicApiKey: e.target.value })}
                  placeholder="sk-ant-..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Max Concurrent Agents
                </label>
                <input
                  type="number"
                  value={formData.maxConcurrentAgents}
                  onChange={(e) => setFormData({ ...formData, maxConcurrentAgents: parseInt(e.target.value) || 1 })}
                  min={1}
                  max={10}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Discovery Interval (minutes)
                </label>
                <input
                  type="number"
                  value={formData.discoveryIntervalMinutes}
                  onChange={(e) => setFormData({ ...formData, discoveryIntervalMinutes: parseInt(e.target.value) || 60 })}
                  min={5}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                {mutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {mutation.isPending ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
