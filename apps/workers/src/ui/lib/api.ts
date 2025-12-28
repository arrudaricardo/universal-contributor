import type { Agent, Contribution, Repository, Issue, Workspace, Stats, WorkspaceStats, Config } from "./types";

const API_BASE = "/api";

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || "Request failed");
  }

  return response.json();
}

// Stats
export async function getStats(): Promise<Stats> {
  return fetchApi<Stats>("/stats");
}

// Agents
export async function getAgents(): Promise<Agent[]> {
  return fetchApi<Agent[]>("/agents");
}

export async function getAgent(id: number): Promise<Agent & { 
  currentIssue?: { id: number; title: string; url: string; repoFullName: string };
  currentContribution?: { status: string; prNumber: number | null; prUrl: string | null };
  state?: { step?: string; promptHistory?: { role: string; content: string }[] };
}> {
  return fetchApi(`/agents/${id}`);
}

export async function createAgent(data: { name: string; priority: number }): Promise<Agent> {
  return fetchApi<Agent>("/agents", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteAgent(id: number): Promise<void> {
  await fetchApi(`/agents/${id}`, { method: "DELETE" });
}

export async function startAgent(id: number): Promise<void> {
  await fetchApi(`/agents/${id}/start`, { method: "POST" });
}

export async function stopAgent(id: number): Promise<void> {
  await fetchApi(`/agents/${id}/stop`, { method: "POST" });
}

export async function resumeAgent(id: number): Promise<void> {
  await fetchApi(`/agents/${id}/resume`, { method: "POST" });
}

// Contributions
export async function getContributions(params: { offset: number; limit: number }): Promise<{
  data: Contribution[];
  total: number;
  hasMore: boolean;
}> {
  return fetchApi(`/contributions?offset=${params.offset}&limit=${params.limit}`);
}

export async function getContribution(id: number): Promise<Contribution> {
  return fetchApi(`/contributions/${id}`);
}

// Repositories
export async function getRepositories(params: { offset: number; limit: number }): Promise<{
  data: Repository[];
  total: number;
  hasMore: boolean;
}> {
  return fetchApi(`/repositories?offset=${params.offset}&limit=${params.limit}`);
}

// Issues
export async function getIssues(params: { offset: number; limit: number }): Promise<{
  data: Issue[];
  total: number;
  hasMore: boolean;
}> {
  return fetchApi(`/issues?offset=${params.offset}&limit=${params.limit}`);
}

// Workspaces
export async function getWorkspaces(params: { offset: number; limit: number }): Promise<{
  data: Workspace[];
  total: number;
  hasMore: boolean;
}> {
  return fetchApi(`/workspaces?offset=${params.offset}&limit=${params.limit}`);
}

export async function getWorkspaceStats(): Promise<WorkspaceStats> {
  return fetchApi<WorkspaceStats>("/workspaces/stats");
}

export async function destroyWorkspace(id: number): Promise<void> {
  await fetchApi(`/workspaces/${id}`, { method: "DELETE" });
}

export async function runWorkspaceCleanup(): Promise<void> {
  await fetchApi("/workspaces/cleanup", { method: "POST" });
}

// Config
export async function getConfig(): Promise<Config> {
  return fetchApi<Config>("/config");
}

export async function updateConfig(data: Partial<Config>): Promise<void> {
  await fetchApi("/config", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
