export type Page = "dashboard" | "agents" | "contributions" | "repositories" | "issues" | "workspaces";

export interface Agent {
  id: number;
  name: string;
  status: string;
  priority: number;
  created_at: string;
  last_active_at: string | null;
}

export interface Contribution {
  id: number;
  agentId: number;
  agentName: string;
  issueId: number;
  issueNumber: number;
  issueTitle: string;
  repoFullName: string;
  status: string;
  prNumber: number | null;
  prUrl: string | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  filesChanged: number | null;
  aiSolutionSummary: string | null;
  createdAt: string;
  updatedAt: string;
  webhooks: Webhook[];
}

export interface Webhook {
  id: number;
  eventType: string;
  action: string | null;
  commentBody: string | null;
  checkStatus: string | null;
  processed: boolean;
  receivedAt: string;
}

export interface Repository {
  id: number;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  source: string;
  trendingRank: number | null;
  discoveredAt: string;
}

export interface Issue {
  id: number;
  githubIssueNumber: number;
  repoFullName: string;
  url: string;
  title: string;
  status: string;
  hasGoodFirstIssue: boolean;
  hasHelpWanted: boolean;
  hasBugLabel: boolean;
  aiSolvabilityScore: number | null;
  aiComplexityScore: number | null;
  claimedByAgentName: string | null;
  discoveredAt: string;
}

export interface Workspace {
  id: number;
  agentId: number;
  agentName: string | null;
  repositoryId: number;
  repoFullName: string | null;
  issueId: number | null;
  issueTitle: string | null;
  status: string;
  containerId: string | null;
  branchName: string | null;
  errorMessage: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface Stats {
  totalAgents: number;
  runningAgents: number;
  totalContributions: number;
  totalRepositories: number;
  totalIssues: number;
}

export interface WorkspaceStats {
  activeWorkspaces: number;
  expiredWorkspaces: number;
  totalDestroyed: number;
  totalErrors: number;
  dockerAvailable: boolean;
  imageExists: boolean;
}

export interface Config {
  githubToken: string;
  anthropicApiKey: string;
  maxConcurrentAgents: number;
  discoveryIntervalMinutes: number;
}
