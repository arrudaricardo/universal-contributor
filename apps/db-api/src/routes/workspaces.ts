import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-plugin";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { homedir } from "os";
import {
  checkDockerAvailable,
  buildImageFromDockerfile,
  createAndStartContainer,
  stopAndRemoveContainer,
  execInContainer,
  createLineBufferedStream,
} from "@universal-contributor/shared/docker";

// Helper to sleep for a given number of milliseconds
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to extract PR URL from a log line
function extractPrUrl(line: string): { prUrl: string; prNumber: number } | null {
  const match = line.match(/https:\/\/github\.com\/[^\/\s]+\/[^\/\s]+\/pull\/(\d+)/);
  if (match && match[1]) {
    return {
      prUrl: match[0],
      prNumber: parseInt(match[1]),
    };
  }
  return null;
}

// Issue type for background execution
interface IssueForExecution {
  id: number;
  github_issue_number: number;
  title: string;
  body: string | null;
  ai_fix_prompt: string | null;
  existing_branch_name: string | null;
  existing_pr_url: string | null;
  // Fork info for PR creation
  original_repo_full_name: string;
  fork_full_name: string;
}

// Database interface for background execution
interface DbInterface {
  run(sql: string, ...params: (string | number | null)[]): void;
  get<T>(sql: string, ...params: (string | number | null)[]): T | null;
}

// Background execution function - runs OpenCode in the container asynchronously
async function executeOpenCodeInBackground(
  db: DbInterface,
  workspaceId: number,
  containerId: string,
  issue: IssueForExecution
): Promise<void> {
  // Build the prompt from the issue
  const isRerun = !!issue.existing_branch_name;
  const forkOwner = issue.fork_full_name.split("/")[0];
  
  let prompt: string;
  if (isRerun) {
    // Re-run: checkout existing branch and push updates
    prompt =
      issue.ai_fix_prompt ||
      `Fix GitHub issue #${issue.github_issue_number}: ${issue.title}

${issue.body || "No description provided"}

IMPORTANT: This is a RE-RUN of a previous fix attempt. A PR already exists.
- Existing branch: ${issue.existing_branch_name}
- Existing PR: ${issue.existing_pr_url || "unknown"}
- Original repository: ${issue.original_repo_full_name}
- Your fork: ${issue.fork_full_name}

Instructions:
1. Sync with upstream first: git fetch upstream && git rebase upstream/main
2. Checkout the existing branch '${issue.existing_branch_name}' (it should already exist on the remote)
3. Review any feedback or comments on the existing PR
4. Make additional changes to address the feedback or improve the fix
5. Run tests to verify the fix works
6. Commit your changes with a descriptive message
7. Push the changes to origin (your fork) - this will update the PR automatically
8. Do NOT create a new pull request - just push to the existing branch`;
  } else {
    // First run: create new branch and PR from fork
    prompt =
      issue.ai_fix_prompt ||
      `Fix GitHub issue #${issue.github_issue_number}: ${issue.title}

${issue.body || "No description provided"}

IMPORTANT SETUP INFO:
- Original repository: ${issue.original_repo_full_name}
- Your fork: ${issue.fork_full_name}
- The 'origin' remote points to YOUR FORK
- The 'upstream' remote points to the ORIGINAL repository

Instructions:
1. First, sync with upstream: git fetch upstream && git rebase upstream/main
2. Analyze the issue and understand what needs to be fixed
3. Find the relevant code in the repository
4. Make the necessary changes to fix the issue
5. Run tests to verify the fix works
6. Create a git branch named 'fix/issue-${issue.github_issue_number}'
7. Commit your changes with a descriptive message
8. Push the branch to origin (your fork): git push -u origin fix/issue-${issue.github_issue_number}
9. Create a pull request FROM your fork TO the original repository using:
   gh pr create --repo ${issue.original_repo_full_name} --head ${forkOwner}:fix/issue-${issue.github_issue_number} --title "Fix #${issue.github_issue_number}: <brief description>" --body "<description of the fix>"`;
  }

  console.log(`[Workspace ${workspaceId}] Starting OpenCode execution...`);
  
  // Log the start
  db.run(
    `INSERT INTO workspace_logs (workspace_id, line, stream) VALUES (?, ?, 'stdout')`,
    workspaceId,
    `[System] Starting OpenCode to fix issue #${issue.github_issue_number}...`
  );

  // Create line-buffered streams for stdout and stderr
  const { stream: stdoutStream, flush: flushStdout } = createLineBufferedStream((line) => {
    db.run(
      `INSERT INTO workspace_logs (workspace_id, line, stream) VALUES (?, ?, 'stdout')`,
      workspaceId,
      line
    );
    console.log(`[Workspace ${workspaceId}] stdout: ${line.slice(0, 100)}...`);

    // Check for PR URL and update workspace (always update with latest)
    const prInfo = extractPrUrl(line);
    if (prInfo) {
      db.run(
        `UPDATE workspaces SET pr_url = ? WHERE id = ?`,
        prInfo.prUrl,
        workspaceId
      );
      console.log(`[Workspace ${workspaceId}] Detected PR URL: ${prInfo.prUrl}`);
    }
  });

  const { stream: stderrStream, flush: flushStderr } = createLineBufferedStream((line) => {
    db.run(
      `INSERT INTO workspace_logs (workspace_id, line, stream) VALUES (?, ?, 'stderr')`,
      workspaceId,
      line
    );
    console.log(`[Workspace ${workspaceId}] stderr: ${line.slice(0, 100)}...`);
  });

  // Execute OpenCode in the container using Docker SDK
  // First, write the prompt to a file in the container to avoid shell escaping issues
  let exitCode = 1;
  try {
    // Write the prompt to a temp file using cat with heredoc (handles all special chars)
    await execInContainer({
      containerId,
      cmd: ["bash", "-c", `cat > /tmp/prompt.txt << 'PROMPT_EOF'\n${prompt}\nPROMPT_EOF`],
      stdout: stdoutStream,
      stderr: stderrStream,
    });

    // Run opencode with the prompt as a file attachment
    // Message must come before flags, or use -- to separate
    // Pipe output to tee so it also appears in Docker Desktop logs
    const result = await execInContainer({
      containerId,
      cmd: [
        "bash", "-c",
        `/home/ubuntu/.opencode/bin/opencode run "Fix the issue described in the attached file" -f /tmp/prompt.txt 2>&1 | tee -a /tmp/opencode.log`,
      ],
      stdout: stdoutStream,
      stderr: stderrStream,
    });
    exitCode = result.exitCode;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Workspace ${workspaceId}] Exec error: ${errorMsg}`);
    db.run(
      `INSERT INTO workspace_logs (workspace_id, line, stream) VALUES (?, ?, 'stderr')`,
      workspaceId,
      `[System] Exec error: ${errorMsg}`
    );
    
    const errorData: WorkspaceError = {
      type: "container_crashed",
      message: `Failed to execute OpenCode: ${errorMsg}`,
      details: {
        logs: errorMsg,
      },
      timestamp: new Date().toISOString(),
    };
    db.run(
      `UPDATE workspaces SET status = 'container_crashed', error_message = ? WHERE id = ?`,
      JSON.stringify(errorData),
      workspaceId
    );
    return;
  }

  // Flush any remaining buffered output
  flushStdout();
  flushStderr();

  console.log(`[Workspace ${workspaceId}] OpenCode exited with code ${exitCode}`);

  // Log completion
  db.run(
    `INSERT INTO workspace_logs (workspace_id, line, stream) VALUES (?, ?, 'stdout')`,
    workspaceId,
    `[System] OpenCode execution completed with exit code ${exitCode}`
  );

  // Update workspace status based on result
  if (exitCode === 0) {
    db.run(
      `UPDATE workspaces SET status = 'completed' WHERE id = ?`,
      workspaceId
    );
    console.log(`[Workspace ${workspaceId}] Marked as completed`);

    // Create or update contribution record on completion
    const completedWorkspace = db.get<Workspace>(
      `SELECT * FROM workspaces WHERE id = ?`,
      workspaceId
    );

    if (completedWorkspace?.issue_id && completedWorkspace.agent_run_id) {
      const prUrl = completedWorkspace.pr_url;
      const prNumberMatch = prUrl?.match(/\/pull\/(\d+)/);
      const prNumber = prNumberMatch?.[1] ? parseInt(prNumberMatch[1]) : null;

      // Check if contribution already exists for this issue
      const existingContribution = db.get<{ id: number }>(
        `SELECT id FROM contributions WHERE issue_id = ?`,
        completedWorkspace.issue_id
      );

      if (existingContribution) {
        // Update existing contribution with PR info (if available)
        if (prUrl) {
          db.run(
            `UPDATE contributions SET pr_url = ?, pr_number = ?, branch_name = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
            prUrl,
            prNumber,
            completedWorkspace.branch_name,
            "pr_open",
            existingContribution.id
          );
          console.log(`[Workspace ${workspaceId}] Updated contribution ${existingContribution.id} with PR ${prUrl}`);
        } else {
          // Update branch name and status even without PR URL
          db.run(
            `UPDATE contributions SET branch_name = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
            completedWorkspace.branch_name,
            "pr_open",
            existingContribution.id
          );
          console.log(`[Workspace ${workspaceId}] Updated contribution ${existingContribution.id} (no PR URL detected)`);
        }
      } else {
        // Create new contribution (even without PR URL - branch was pushed)
        db.run(
          `INSERT INTO contributions (agent_run_id, issue_id, pr_url, pr_number, branch_name, status) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          completedWorkspace.agent_run_id,
          completedWorkspace.issue_id,
          prUrl || null,
          prNumber,
          completedWorkspace.branch_name,
          "pr_open"
        );
        console.log(`[Workspace ${workspaceId}] Created contribution${prUrl ? ` with PR ${prUrl}` : ' (no PR URL detected)'}`);
      }

      // Always update issue status to 'pr_open' on successful completion
      db.run(
        `UPDATE issues SET status = 'pr_open' WHERE id = ?`,
        completedWorkspace.issue_id
      );
      console.log(`[Workspace ${workspaceId}] Updated issue ${completedWorkspace.issue_id} status to pr_open`);
    }
  } else {
    const errorData: WorkspaceError = {
      type: "container_crashed",
      message: `OpenCode exited with code ${exitCode}`,
      details: {
        logs: "See workspace logs for details",
      },
      timestamp: new Date().toISOString(),
    };
    db.run(
      `UPDATE workspaces SET status = 'container_crashed', error_message = ? WHERE id = ?`,
      JSON.stringify(errorData),
      workspaceId
    );
    console.log(`[Workspace ${workspaceId}] Marked as container_crashed`);
  }

  // Wait 60 seconds before destroying container (for final log flush)
  console.log(`[Workspace ${workspaceId}] Waiting 60 seconds before cleanup...`);
  db.run(
    `INSERT INTO workspace_logs (workspace_id, line, stream) VALUES (?, ?, 'stdout')`,
    workspaceId,
    `[System] Waiting 60 seconds before container cleanup...`
  );
  await sleep(60000);

  // Destroy the container using Docker SDK
  console.log(`[Workspace ${workspaceId}] Destroying container ${containerId}...`);
  try {
    await stopAndRemoveContainer(containerId);
    db.run(
      `UPDATE workspaces SET destroyed_at = datetime('now') WHERE id = ?`,
      workspaceId
    );
    db.run(
      `INSERT INTO workspace_logs (workspace_id, line, stream) VALUES (?, ?, 'stdout')`,
      workspaceId,
      `[System] Container destroyed successfully`
    );
    console.log(`[Workspace ${workspaceId}] Container destroyed`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Workspace ${workspaceId}] Failed to destroy container: ${errorMsg}`);
    db.run(
      `INSERT INTO workspace_logs (workspace_id, line, stream) VALUES (?, ?, 'stderr')`,
      workspaceId,
      `[System] Failed to destroy container: ${errorMsg}`
    );
  }
}

// Error type for structured error messages
export interface WorkspaceError {
  type: "build_failed" | "timeout" | "tests_failing" | "clone_failed" | "container_crashed";
  message: string;
  details: {
    attempt?: number;
    dockerfile?: string;
    logs?: string;
    testOutput?: string;
    sessionId?: string;
    duration?: number;
  };
  timestamp: string;
}

export interface Workspace {
  id: number;
  agent_id: number;
  agent_run_id: number | null;
  repository_id: number;
  issue_id: number | null;
  container_id: string | null;
  status: string;
  branch_name: string | null;
  base_branch: string;
  timeout_minutes: number;
  expires_at: string | null;
  created_at: string;
  destroyed_at: string | null;
  error_message: string | null;
  dockerfile: string | null;
  pr_url: string | null;
}

export interface WorkspaceLog {
  id: number;
  workspace_id: number;
  line: string;
  stream: "stdout" | "stderr";
  created_at: string;
}

export const workspacesRoutes = new Elysia({ prefix: "/workspaces" })
  .use(dbPlugin)
  .get(
    "/",
    ({ db, query }) => {
      if (query.issue_id) {
        return db.query<Workspace>(
          `SELECT * FROM workspaces WHERE issue_id = ? ORDER BY created_at DESC`,
          parseInt(query.issue_id)
        );
      }
      if (query.agent_id) {
        return db.query<Workspace>(
          `SELECT * FROM workspaces WHERE agent_id = ? ORDER BY created_at DESC`,
          parseInt(query.agent_id)
        );
      }
      if (query.status) {
        return db.query<Workspace>(
          `SELECT * FROM workspaces WHERE status = ? ORDER BY created_at DESC`,
          query.status
        );
      }
      return db.query<Workspace>(
        `SELECT * FROM workspaces ORDER BY created_at DESC`
      );
    },
    {
      query: t.Object({
        agent_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
        issue_id: t.Optional(t.String()),
      }),
    }
  )
  .get("/:id", ({ db, params }) => {
    const workspace = db.get<Workspace>(
      `SELECT * FROM workspaces WHERE id = ?`,
      parseInt(params.id)
    );
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    return workspace;
  })
  .post(
    "/",
    ({ db, body }) => {
      db.run(
        `INSERT INTO workspaces (agent_id, agent_run_id, repository_id, issue_id, container_id, status, branch_name, base_branch, timeout_minutes, expires_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        body.agent_id,
        body.agent_run_id ?? null,
        body.repository_id,
        body.issue_id ?? null,
        body.container_id ?? null,
        body.status ?? "pending",
        body.branch_name ?? null,
        body.base_branch ?? "main",
        body.timeout_minutes ?? 60,
        body.expires_at ?? null
      );
      const workspace = db.get<Workspace>(
        `SELECT * FROM workspaces WHERE id = last_insert_rowid()`
      );
      return workspace;
    },
    {
      body: t.Object({
        agent_id: t.Number(),
        agent_run_id: t.Optional(t.Number()),
        repository_id: t.Number(),
        issue_id: t.Optional(t.Number()),
        container_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
        branch_name: t.Optional(t.String()),
        base_branch: t.Optional(t.String()),
        timeout_minutes: t.Optional(t.Number()),
        expires_at: t.Optional(t.String()),
      }),
    }
  )
  .patch(
    "/:id",
    ({ db, params, body }) => {
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (body.container_id !== undefined) {
        updates.push("container_id = ?");
        values.push(body.container_id);
      }
      if (body.status !== undefined) {
        updates.push("status = ?");
        values.push(body.status);
      }
      if (body.branch_name !== undefined) {
        updates.push("branch_name = ?");
        values.push(body.branch_name);
      }
      if (body.expires_at !== undefined) {
        updates.push("expires_at = ?");
        values.push(body.expires_at);
      }
      if (body.destroyed_at !== undefined) {
        updates.push("destroyed_at = ?");
        values.push(body.destroyed_at);
      }
      if (body.error_message !== undefined) {
        updates.push("error_message = ?");
        values.push(body.error_message);
      }
      if (body.pr_url !== undefined) {
        updates.push("pr_url = ?");
        values.push(body.pr_url);
      }

      if (updates.length === 0) {
        throw new Error("No fields to update");
      }

      values.push(parseInt(params.id));
      db.run(
        `UPDATE workspaces SET ${updates.join(", ")} WHERE id = ?`,
        ...values
      );

      return db.get<Workspace>(
        `SELECT * FROM workspaces WHERE id = ?`,
        parseInt(params.id)
      );
    },
    {
      body: t.Object({
        container_id: t.Optional(t.Nullable(t.String())),
        status: t.Optional(t.String()),
        branch_name: t.Optional(t.Nullable(t.String())),
        expires_at: t.Optional(t.Nullable(t.String())),
        destroyed_at: t.Optional(t.Nullable(t.String())),
        error_message: t.Optional(t.Nullable(t.String())),
        pr_url: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  .delete("/:id", ({ db, params }) => {
    db.run(
      `DELETE FROM workspaces WHERE id = ?`,
      parseInt(params.id)
    );
    return { success: true };
  })
  // Spawn a new workspace with Docker container for fixing an issue
  .post(
    "/spawn",
    async ({ db, body }) => {
      const MAX_BUILD_RETRIES = 3;
      
      // 1. Fetch issue from database
      const issue = db.get<{
        id: number;
        repository_id: number;
        github_issue_number: number;
        title: string;
        body: string | null;
        labels: string | null;
        ai_fix_prompt: string | null;
      }>(
        `SELECT id, repository_id, github_issue_number, title, body, labels, ai_fix_prompt FROM issues WHERE id = ?`,
        body.issue_id
      );

      if (!issue) {
        throw new Error("Issue not found");
      }

      // 2. Fetch repository from database
      const repo = db.get<{
        id: number;
        full_name: string;
        url: string;
        language: string | null;
        fork_full_name: string | null;
        fork_url: string | null;
      }>(
        `SELECT id, full_name, url, language, fork_full_name, fork_url FROM repositories WHERE id = ?`,
        issue.repository_id
      );

      if (!repo) {
        throw new Error("Repository not found");
      }

      // 3. Fetch repository environment
      const repoEnv = db.get<{
        primary_language: string | null;
        runtime: string | null;
        runtime_version: string | null;
        package_manager: string | null;
        setup_commands: string | null;
        test_commands: string | null;
      }>(
        `SELECT primary_language, runtime, runtime_version, package_manager, setup_commands, test_commands 
         FROM repository_environments WHERE repository_id = ?`,
        repo.id
      );

      // 3.5. Check for existing open PR for this issue using gh CLI
      let existingOpenPrUrl: string | null = null;
      try {
        const ghCheckResult = await Bun.spawn([
          "gh", "pr", "list",
          "--repo", repo.full_name,
          "--search", `fix issue #${issue.github_issue_number} in:title`,
          "--state", "open",
          "--json", "number,url",
          "--limit", "1"
        ], {
          stdout: "pipe",
          stderr: "pipe",
        });
        
        const output = await new Response(ghCheckResult.stdout).text();
        const prs = JSON.parse(output || "[]");
        if (prs.length > 0) {
          existingOpenPrUrl = prs[0].url;
          console.log(`[Spawn] Found existing open PR for issue #${issue.github_issue_number}: ${existingOpenPrUrl}`);
        }
      } catch (err) {
        // Ignore errors checking for existing PRs - we'll proceed anyway
        console.log(`[Spawn] Could not check for existing PRs: ${err}`);
      }

      // 3.6. Check for existing contribution with branch (for re-runs)
      const existingContribution = db.get<{
        branch_name: string | null;
        pr_url: string | null;
      }>(
        `SELECT branch_name, pr_url FROM contributions WHERE issue_id = ? AND branch_name IS NOT NULL ORDER BY id DESC LIMIT 1`,
        issue.id
      );
      const existingBranchName = existingContribution?.branch_name || null;
      const existingPrUrl = existingContribution?.pr_url || existingOpenPrUrl || null;
      
      if (existingBranchName) {
        console.log(`[Spawn] Re-run detected - reusing existing branch: ${existingBranchName}`);
      }

      // 3.7. Create or get fork of the repository
      let forkFullName = repo.fork_full_name;
      let forkUrl = repo.fork_url;
      
      if (!forkFullName || !forkUrl) {
        console.log(`[Spawn] Creating fork of ${repo.full_name}...`);
        try {
          // Fork the repository using gh CLI
          const forkResult = await Bun.spawn([
            "gh", "repo", "fork", repo.full_name, "--clone=false"
          ], {
            stdout: "pipe",
            stderr: "pipe",
          });
          
          await forkResult.exited;
          const forkStderr = await new Response(forkResult.stderr).text();
          
          // gh repo fork outputs to stderr, check for success patterns
          // It says "Created fork owner/repo" or "owner/repo already exists"
          console.log(`[Spawn] Fork command output: ${forkStderr}`);
          
          // Get the current GitHub user to construct fork URL
          const userResult = await Bun.spawn([
            "gh", "api", "user", "--jq", ".login"
          ], {
            stdout: "pipe",
            stderr: "pipe",
          });
          
          const githubUser = (await new Response(userResult.stdout).text()).trim();
          if (!githubUser) {
            throw new Error("Could not determine GitHub username");
          }
          
          const repoName = repo.full_name.split("/")[1];
          forkFullName = `${githubUser}/${repoName}`;
          forkUrl = `https://github.com/${forkFullName}`;
          
          // Save fork info to database
          db.run(
            `UPDATE repositories SET fork_full_name = ?, fork_url = ? WHERE id = ?`,
            forkFullName,
            forkUrl,
            repo.id
          );
          
          console.log(`[Spawn] Fork created/found: ${forkFullName} (${forkUrl})`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unknown error";
          console.error(`[Spawn] Fork creation failed: ${errorMsg}`);
          throw new Error(`Failed to create fork: ${errorMsg}`);
        }
      } else {
        console.log(`[Spawn] Using existing fork: ${forkFullName}`);
      }

      // 4. Create initial workspace record
      const timeoutMinutes = body.timeout_minutes ?? 60;
      const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();
      const branchName = existingBranchName || `fix/issue-${issue.github_issue_number}`;

      db.run(
        `INSERT INTO workspaces (agent_id, agent_run_id, repository_id, issue_id, status, branch_name, base_branch, timeout_minutes, expires_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        body.agent_id,
        body.agent_run_id ?? null,
        repo.id,
        issue.id,
        "building",
        branchName,
        "main",
        timeoutMinutes,
        expiresAt
      );

      const workspace = db.get<Workspace>(
        `SELECT * FROM workspaces WHERE id = last_insert_rowid()`
      );

      if (!workspace) {
        throw new Error("Failed to create workspace");
      }

      // Helper function to update workspace error
      const setWorkspaceError = (
        status: string,
        errorData: WorkspaceError
      ) => {
        db.run(
          `UPDATE workspaces SET status = ?, error_message = ? WHERE id = ?`,
          status,
          JSON.stringify(errorData),
          workspace.id
        );
      };

      // 5. Verify Docker is available using SDK
      const dockerAvailable = await checkDockerAvailable();
      if (!dockerAvailable) {
        setWorkspaceError("build_failed", {
          type: "build_failed",
          message: "Docker is not available or not responding",
          details: { attempt: 0 },
          timestamp: new Date().toISOString(),
        });
        throw new Error("Docker is not available or not responding");
      }

      // 6. Generate Dockerfile using AI
      let dockerfile: string | null = null;
      let buildAttempt = 0;
      let lastBuildError: string | null = null;

      while (buildAttempt < MAX_BUILD_RETRIES && !dockerfile) {
        buildAttempt++;

        try {
          // Generate Dockerfile with AI
          const dockerfilePrompt = `Generate a Dockerfile for contributing to this GitHub repository:

Repository: ${repo.full_name}
URL: ${repo.url}
Primary Language: ${repoEnv?.primary_language || repo.language || "Unknown"}

${lastBuildError ? `Previous build attempt failed with error:\n${lastBuildError}\n\nPlease fix the Dockerfile to address this error.\n` : ""}

Requirements:
1. Start from an appropriate base image for the detected language/runtime:
   - For Node.js: use node:20
   - For Python: use python:3.12
   - For Rust: use rust:latest
   - For Go: use golang:1.22
   - For Java: use eclipse-temurin:21
   - For other languages: use ubuntu:24.04

2. Set DEBIAN_FRONTEND=noninteractive

3. Install core utilities (in a separate RUN layer, clean apt lists after):
   RUN apt-get update && apt-get install -y \\
       curl wget git vim sudo ca-certificates gnupg unzip \\
       && rm -rf /var/lib/apt/lists/*

4. Install GitHub CLI (gh) by downloading the latest release binary:
   RUN ARCH=$(dpkg --print-architecture) && \\
       GH_VERSION=$(curl -sL https://api.github.com/repos/cli/cli/releases/latest | grep '"tag_name"' | cut -d'"' -f4 | sed 's/^v//') && \\
       if [ "$ARCH" = "amd64" ]; then GH_ARCH="linux_amd64"; \\
       elif [ "$ARCH" = "arm64" ]; then GH_ARCH="linux_arm64"; \\
       else GH_ARCH="linux_amd64"; fi && \\
       curl -fsSL "https://github.com/cli/cli/releases/download/v\${GH_VERSION}/gh_\${GH_VERSION}_\${GH_ARCH}.tar.gz" -o /tmp/gh.tar.gz && \\
       tar -xzf /tmp/gh.tar.gz -C /tmp && \\
       mv /tmp/gh_*/bin/gh /usr/local/bin/gh && \\
       chmod +x /usr/local/bin/gh && \\
       rm -rf /tmp/gh.tar.gz /tmp/gh_*

5. Create a non-root user 'ubuntu' with passwordless sudo:
   RUN useradd -m -s /bin/bash ubuntu \\
       && usermod -aG sudo ubuntu \\
       && echo "ubuntu ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/ubuntu

6. Switch to ubuntu user and set up SSH for GitHub:
   USER ubuntu
   WORKDIR /home/ubuntu
   RUN mkdir -p ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts

7. Create OpenCode directories for volume mounts:
   RUN mkdir -p ~/.local/share/opencode ~/.config/opencode

8. Install OpenCode AI:
   RUN curl -fsSL https://opencode.ai/install | bash

9. Clone YOUR FORK of the repository (not the original):
   RUN git clone ${forkUrl}.git /home/ubuntu/repo

10. Set working directory to repo:
    WORKDIR /home/ubuntu/repo

11. Add upstream remote pointing to the original repository:
    RUN git remote add upstream ${repo.url}.git

12. Set PATH to include OpenCode:
    ENV PATH="/home/ubuntu/.opencode/bin:$PATH"

13. Default command:
    CMD ["bash"]

IMPORTANT: Do NOT install project dependencies (no npm install, pip install, etc). Dependencies will be installed at runtime.

Output ONLY the complete Dockerfile content, no explanations or markdown code blocks.`;

          const dockerfileResponse = await chat({
            adapter: openaiText("gpt-4o"),
            messages: [{ role: "user", content: dockerfilePrompt }],
            stream: false,
          });

          dockerfile = typeof dockerfileResponse === 'string' 
            ? dockerfileResponse 
            : String(dockerfileResponse);

          // Clean up the response - remove markdown code blocks if present
          dockerfile = dockerfile
            .replace(/^```dockerfile\n?/i, "")
            .replace(/^```\n?/, "")
            .replace(/\n?```$/g, "")
            .trim();

        } catch (err) {
          lastBuildError = err instanceof Error ? err.message : "Unknown error generating Dockerfile";
          console.error(`Dockerfile generation attempt ${buildAttempt} failed:`, lastBuildError);
          
          if (buildAttempt >= MAX_BUILD_RETRIES) {
            setWorkspaceError("build_failed", {
              type: "build_failed",
              message: `Failed to generate Dockerfile after ${MAX_BUILD_RETRIES} attempts`,
              details: {
                attempt: buildAttempt,
                logs: lastBuildError,
              },
              timestamp: new Date().toISOString(),
            });
            throw new Error(`Failed to generate Dockerfile: ${lastBuildError}`);
          }
        }
      }

      if (!dockerfile) {
        throw new Error("Failed to generate Dockerfile");
      }

      // 6. Build Docker image using SDK (creates tar archive in memory)
      const imageName = `uc-workspace-${repo.full_name.replace("/", "-").toLowerCase()}:${Date.now()}`;

      // Accumulate build logs for better error reporting
      const buildLogs: string[] = [];
      const MAX_LOG_LINES = 100;

      try {
        console.log(`Building Docker image ${imageName}...`);
        
        // Build using Docker SDK with tar-stream
        await buildImageFromDockerfile(dockerfile, imageName, (progress) => {
          console.log(`[Build] ${progress}`);
          // Keep last N lines for error reporting
          buildLogs.push(progress);
          if (buildLogs.length > MAX_LOG_LINES) {
            buildLogs.shift();
          }
        });

        console.log("Docker build completed");

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown build error";
        console.error("Docker build failed:", errorMsg);
        
        // Include recent build logs in error details for debugging
        const recentLogs = buildLogs.slice(-50).join("\n");
        
        setWorkspaceError("build_failed", {
          type: "build_failed",
          message: `Docker build failed: ${errorMsg}`,
          details: {
            attempt: buildAttempt,
            dockerfile: dockerfile,
            logs: recentLogs ? `${recentLogs}\n\nError: ${errorMsg}` : errorMsg,
          },
          timestamp: new Date().toISOString(),
        });
        
        throw new Error(`Docker build failed: ${errorMsg}`);
      }

      // 7. Create and start container using Docker SDK
      let containerId: string | null = null;

      try {
        const containerName = `workspace-${workspace.id}`;
        const homeDir = homedir();

        // Create and start container using SDK
        containerId = await createAndStartContainer({
          image: imageName,
          name: containerName,
          cmd: ["bash", "-c", "touch /tmp/opencode.log && tail -f /tmp/opencode.log"],  // Keep container running and show logs
          env: {
            GH_TOKEN: process.env.GH_TOKEN || "",
          },
          binds: [
            `${homeDir}/.ssh/id_ed25519:/home/ubuntu/.ssh/id_ed25519:ro`,
            `${homeDir}/.local/share/opencode/auth.json:/home/ubuntu/.local/share/opencode/auth.json:ro`,
            `${homeDir}/.config/opencode:/home/ubuntu/.config/opencode:ro`,
          ],
          networkMode: "host",
          user: "ubuntu",
          workingDir: "/home/ubuntu/repo",
          tty: true,
        });

        console.log(`Container ${containerId} started successfully`);

        // Update workspace with container ID and save dockerfile
        db.run(
          `UPDATE workspaces SET container_id = ?, status = ?, dockerfile = ? WHERE id = ?`,
          containerId,
          "running",
          dockerfile,
          workspace.id
        );

        // Start OpenCode execution in background (non-blocking)
        // This will update the workspace status and logs as it runs
        executeOpenCodeInBackground(db, workspace.id, containerId, {
          id: issue.id,
          github_issue_number: issue.github_issue_number,
          title: issue.title,
          body: issue.body,
          ai_fix_prompt: issue.ai_fix_prompt,
          existing_branch_name: existingBranchName,
          existing_pr_url: existingPrUrl,
          original_repo_full_name: repo.full_name,
          fork_full_name: forkFullName!,
        });

        console.log(`[Workspace ${workspace.id}] OpenCode execution started in background`);

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown container error";
        console.error("Container creation/start failed:", errorMsg);
        
        setWorkspaceError("container_crashed", {
          type: "container_crashed",
          message: `Failed to create/start container: ${errorMsg}`,
          details: {
            logs: errorMsg,
          },
          timestamp: new Date().toISOString(),
        });
        
        throw new Error(`Container creation failed: ${errorMsg}`);
      }

      // Return the updated workspace immediately (execution continues in background)
      return db.get<Workspace>(
        `SELECT * FROM workspaces WHERE id = ?`,
        workspace.id
      );
    },
    {
      body: t.Object({
        issue_id: t.Number(),
        agent_id: t.Number(),
        agent_run_id: t.Optional(t.Number()),
        timeout_minutes: t.Optional(t.Number()),
      }),
    }
  )
  // Destroy a workspace container
  .post(
    "/:id/destroy",
    async ({ db, params }) => {
      const workspaceId = parseInt(params.id);
      const workspace = db.get<Workspace>(
        `SELECT * FROM workspaces WHERE id = ?`,
        workspaceId
      );

      if (!workspace) {
        throw new Error("Workspace not found");
      }

      if (!workspace.container_id) {
        // No container to destroy, just update status
        db.run(
          `UPDATE workspaces SET status = ?, destroyed_at = datetime('now') WHERE id = ?`,
          "destroyed",
          workspaceId
        );
        return { success: true, message: "No container to destroy" };
      }

      try {
        // Stop and remove the container using Docker SDK
        await stopAndRemoveContainer(workspace.container_id);

        // Update workspace status
        db.run(
          `UPDATE workspaces SET status = ?, destroyed_at = datetime('now') WHERE id = ?`,
          "destroyed",
          workspaceId
        );

        return { success: true, message: "Container destroyed" };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        throw new Error(`Failed to destroy container: ${errorMsg}`);
      }
    }
  )
  // Get workspace logs with optional pagination
  .get(
    "/:id/logs",
    ({ db, params, query }) => {
      const workspaceId = parseInt(params.id);
      
      // Check if workspace exists
      const workspace = db.get<Workspace>(
        `SELECT id FROM workspaces WHERE id = ?`,
        workspaceId
      );
      
      if (!workspace) {
        throw new Error("Workspace not found");
      }
      
      // If after_id is provided, fetch only logs after that ID (for incremental updates)
      if (query.after_id) {
        const afterId = parseInt(query.after_id);
        return db.query<WorkspaceLog>(
          `SELECT * FROM workspace_logs WHERE workspace_id = ? AND id > ? ORDER BY id ASC`,
          workspaceId,
          afterId
        );
      }
      
      // Otherwise return all logs
      return db.query<WorkspaceLog>(
        `SELECT * FROM workspace_logs WHERE workspace_id = ? ORDER BY id ASC`,
        workspaceId
      );
    },
    {
      query: t.Object({
        after_id: t.Optional(t.String()),
      }),
    }
  )
  // Delete workspace logs (for cleanup)
  .delete(
    "/:id/logs",
    ({ db, params }) => {
      const workspaceId = parseInt(params.id);
      db.run(
        `DELETE FROM workspace_logs WHERE workspace_id = ?`,
        workspaceId
      );
      return { success: true };
    }
  )
  // Get PR information for a workspace
  .get(
    "/:id/pr",
    ({ db, params }) => {
      const workspaceId = parseInt(params.id);

      const workspace = db.get<{
        pr_url: string | null;
        branch_name: string | null;
        issue_id: number | null;
      }>(
        `SELECT pr_url, branch_name, issue_id FROM workspaces WHERE id = ?`,
        workspaceId
      );

      if (!workspace) {
        throw new Error("Workspace not found");
      }

      // If pr_url is stored on workspace, return it
      if (workspace.pr_url) {
        const prNumberMatch = workspace.pr_url.match(/\/pull\/(\d+)/);
        return {
          pr_url: workspace.pr_url,
          pr_number: prNumberMatch?.[1] ? parseInt(prNumberMatch[1]) : null,
          branch_name: workspace.branch_name,
          source: "workspace" as const,
        };
      }

      // Fallback: search logs for PR URL
      const logWithPr = db.get<{ line: string }>(
        `SELECT line FROM workspace_logs 
         WHERE workspace_id = ? AND line LIKE '%github.com%pull%' 
         ORDER BY id DESC LIMIT 1`,
        workspaceId
      );

      if (logWithPr) {
        const prInfo = extractPrUrl(logWithPr.line);
        if (prInfo) {
          return {
            pr_url: prInfo.prUrl,
            pr_number: prInfo.prNumber,
            branch_name: workspace.branch_name,
            source: "logs" as const,
          };
        }
      }

      // Check contributions table
      if (workspace.issue_id) {
        const contribution = db.get<{ pr_url: string | null; pr_number: number | null }>(
          `SELECT pr_url, pr_number FROM contributions WHERE issue_id = ? AND pr_url IS NOT NULL ORDER BY id DESC LIMIT 1`,
          workspace.issue_id
        );

        if (contribution?.pr_url) {
          return {
            pr_url: contribution.pr_url,
            pr_number: contribution.pr_number,
            branch_name: workspace.branch_name,
            source: "contribution" as const,
          };
        }
      }

      return {
        pr_url: null,
        pr_number: null,
        branch_name: workspace.branch_name,
        source: null,
      };
    }
  );
