import { spawn } from "child_process";

// Configuration
const DB_API_URL = process.env.DB_API_URL ?? "http://localhost:3002";
const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://localhost:4096";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "30000", 10);
const AGENT_NAME = process.env.AGENT_NAME ?? "default-agent";

// Types matching the DB API
interface Issue {
  id: number;
  repository_id: number;
  github_issue_number: number;
  title: string;
  url: string;
  body: string | null;
  labels: string | null;
  ai_fix_prompt: string | null;
  status: string;
}

interface Workspace {
  id: number;
  agent_id: number;
  repository_id: number;
  issue_id: number | null;
  container_id: string | null;
  status: string;
  branch_name: string | null;
  error_message: string | null;
}

interface Agent {
  id: number;
  name: string;
  status: string;
}

// Helper to make API requests
async function apiRequest<T>(
  path: string,
  options?: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  try {
    const response = await fetch(`${DB_API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { data: null, error: `API error ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    return { data: data as T, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// Run a command and return output
async function runCommand(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      process.stdout.write(chunk); // Stream output to console
    });

    proc.stderr?.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      process.stderr.write(chunk); // Stream output to console
    });

    proc.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });

    proc.on("error", (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
}

// Get or create agent
async function getOrCreateAgent(): Promise<Agent | null> {
  // Try to find existing agent
  const { data: agents } = await apiRequest<Agent[]>("/agents");
  
  if (agents && agents.length > 0) {
    const existingAgent = agents.find((a) => a.name === AGENT_NAME);
    if (existingAgent) {
      console.log(`Using existing agent: ${existingAgent.name} (id: ${existingAgent.id})`);
      return existingAgent;
    }
  }

  // Create new agent
  const { data: newAgent, error } = await apiRequest<Agent>("/agents", {
    method: "POST",
    body: JSON.stringify({ name: AGENT_NAME }),
  });

  if (error || !newAgent) {
    console.error("Failed to create agent:", error);
    return null;
  }

  console.log(`Created new agent: ${newAgent.name} (id: ${newAgent.id})`);
  return newAgent;
}

// Process a single issue
async function processIssue(issue: Issue, agentId: number): Promise<boolean> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Processing issue #${issue.github_issue_number}: ${issue.title}`);
  console.log(`URL: ${issue.url}`);
  console.log(`${"=".repeat(60)}\n`);

  // 1. Update issue status to 'fixing'
  await apiRequest(`/issues/${issue.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "fixing" }),
  });

  // 2. Spawn workspace
  console.log("Spawning workspace with Docker container...");
  const { data: workspace, error: spawnError } = await apiRequest<Workspace>(
    "/workspaces/spawn",
    {
      method: "POST",
      body: JSON.stringify({
        issue_id: issue.id,
        agent_id: agentId,
        timeout_minutes: 60,
      }),
    }
  );

  if (spawnError || !workspace) {
    console.error(`Failed to spawn workspace: ${spawnError}`);
    await apiRequest(`/issues/${issue.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "error" }),
    });
    return false;
  }

  console.log(`Workspace ${workspace.id} created with container ${workspace.container_id}`);

  if (!workspace.container_id) {
    console.error("No container ID in workspace");
    return false;
  }

  // 3. Execute OpenCode inside container
  const prompt =
    issue.ai_fix_prompt ||
    `Fix GitHub issue #${issue.github_issue_number}: ${issue.title}

${issue.body || "No description provided"}

Instructions:
1. Analyze the issue and understand what needs to be fixed
2. Find the relevant code in the repository
3. Make the necessary changes to fix the issue
4. Run tests to verify the fix works
5. Create a git branch named 'fix/issue-${issue.github_issue_number}'
6. Commit your changes with a descriptive message
7. Push the branch and create a pull request`;

  console.log("\nExecuting OpenCode to fix the issue...\n");
  console.log(`Prompt:\n${prompt.slice(0, 500)}${prompt.length > 500 ? "..." : ""}\n`);

  const startTime = Date.now();
  const result = await runCommand("docker", [
    "exec",
    workspace.container_id,
    "/home/ubuntu/.opencode/bin/opencode",
    "run",
    "--attach",
    OPENCODE_URL,
    prompt,
  ]);
  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log(`\nOpenCode completed in ${duration}s with exit code ${result.exitCode}`);

  // 4. Update workspace and issue status based on result
  if (result.exitCode === 0) {
    // Success!
    await apiRequest(`/workspaces/${workspace.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });
    await apiRequest(`/issues/${issue.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "fixed" }),
    });
    console.log(`Issue ${issue.id} fixed successfully!`);
  } else {
    // Failed
    const errorMessage = JSON.stringify({
      type: "container_crashed",
      message: `OpenCode exited with code ${result.exitCode}`,
      details: {
        logs: (result.stderr || result.stdout).slice(-5000),
        duration,
      },
      timestamp: new Date().toISOString(),
    });

    await apiRequest(`/workspaces/${workspace.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "container_crashed",
        error_message: errorMessage,
      }),
    });
    await apiRequest(`/issues/${issue.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "error" }),
    });
    console.error(`Issue ${issue.id} failed with exit code ${result.exitCode}`);
  }

  // 5. Cleanup container
  console.log("\nCleaning up container...");
  await apiRequest(`/workspaces/${workspace.id}/destroy`, { method: "POST" });
  console.log("Container destroyed");

  return result.exitCode === 0;
}

// Main loop
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           Universal Contributor Agent                         ║
╠══════════════════════════════════════════════════════════════╣
║  DB API:     ${DB_API_URL.padEnd(45)}║
║  OpenCode:   ${OPENCODE_URL.padEnd(45)}║
║  Poll:       ${(POLL_INTERVAL_MS / 1000 + "s").padEnd(45)}║
╚══════════════════════════════════════════════════════════════╝
`);

  // Get or create agent
  const agent = await getOrCreateAgent();
  if (!agent) {
    console.error("Failed to initialize agent. Exiting.");
    process.exit(1);
  }

  // Update agent status to running
  await apiRequest(`/agents/${agent.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "running" }),
  });

  let successCount = 0;
  let failureCount = 0;

  // Main polling loop
  while (true) {
    try {
      // Fetch issues ready to be fixed (status = 'open' and has ai_fix_prompt)
      const { data: issues, error } = await apiRequest<Issue[]>(
        "/issues?status=open"
      );

      if (error) {
        console.error("Error fetching issues:", error);
        await Bun.sleep(POLL_INTERVAL_MS);
        continue;
      }

      // Filter to issues with ai_fix_prompt
      const readyIssues = (issues || []).filter(
        (issue) => issue.ai_fix_prompt && issue.status === "open"
      );

      if (readyIssues.length > 0) {
        console.log(`\nFound ${readyIssues.length} issue(s) ready to fix`);

        // Process one issue at a time
        const issue = readyIssues[0];
        const success = await processIssue(issue, agent.id);

        if (success) {
          successCount++;
        } else {
          failureCount++;
        }

        console.log(
          `\nStats: ${successCount} successful, ${failureCount} failed`
        );
      } else {
        const now = new Date().toLocaleTimeString();
        console.log(`[${now}] No issues ready to fix. Waiting ${POLL_INTERVAL_MS / 1000}s...`);
      }
    } catch (err) {
      console.error("Error in main loop:", err);
    }

    // Wait before next poll
    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nReceived SIGINT, shutting down...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nReceived SIGTERM, shutting down...");
  process.exit(0);
});

// Start the agent
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
