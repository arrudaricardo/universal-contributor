import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-plugin";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir, homedir } from "os";
import { join } from "path";
import { spawn } from "child_process";

// Helper to run docker CLI commands
async function runDockerCommand(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    
    proc.stdout?.on("data", (data) => { stdout += data.toString(); });
    proc.stderr?.on("data", (data) => { stderr += data.toString(); });
    
    proc.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
    
    proc.on("error", (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
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
}

export const workspacesRoutes = new Elysia({ prefix: "/workspaces" })
  .use(dbPlugin)
  .get(
    "/",
    ({ db, query }) => {
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
      }>(
        `SELECT id, full_name, url, language FROM repositories WHERE id = ?`,
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

      // 4. Create initial workspace record
      const timeoutMinutes = body.timeout_minutes ?? 60;
      const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();
      const branchName = `fix/issue-${issue.github_issue_number}`;

      db.run(
        `INSERT INTO workspaces (agent_id, repository_id, issue_id, status, branch_name, base_branch, timeout_minutes, expires_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        body.agent_id,
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

      // 5. Verify Docker is available
      const dockerCheck = await runDockerCommand(["info"]);
      if (dockerCheck.exitCode !== 0) {
        setWorkspaceError("build_failed", {
          type: "build_failed",
          message: `Docker is not available: ${dockerCheck.stderr}`,
          details: { attempt: 0 },
          timestamp: new Date().toISOString(),
        });
        throw new Error(`Docker is not available: ${dockerCheck.stderr}`);
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
Runtime: ${repoEnv?.runtime || "auto-detect"}
Package Manager: ${repoEnv?.package_manager || "auto-detect"}
Setup Commands: ${repoEnv?.setup_commands || "auto-detect from project files"}
Test Commands: ${repoEnv?.test_commands || "auto-detect from project files"}

${lastBuildError ? `Previous build attempt failed with error:\n${lastBuildError}\n\nPlease fix the Dockerfile to address this error.\n` : ""}

Requirements:
1. Start from an appropriate base image for the detected language/runtime:
   - For Node.js: use node:20-slim
   - For Python: use python:3.12-slim
   - For Rust: use rust:latest
   - For Go: use golang:1.22
   - For Java: use eclipse-temurin:21
   - For other languages: use ubuntu:24.04

2. Set DEBIAN_FRONTEND=noninteractive

3. Install core utilities:
   - curl, wget, git, vim, sudo, ca-certificates, gnupg, unzip

4. Install GitHub CLI (gh):
   RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \\
       && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \\
       && apt-get update && apt-get install -y gh

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

9. Clone the repository:
   RUN git clone ${repo.url}.git /home/ubuntu/repo

10. Change to repo directory and install dependencies:
    WORKDIR /home/ubuntu/repo
    ${repoEnv?.setup_commands ? `RUN ${repoEnv.setup_commands}` : "# Dependencies will be installed based on detected project files"}

11. Set PATH to include OpenCode:
    ENV PATH="/home/ubuntu/.opencode/bin:$PATH"

12. Default command:
    CMD ["bash"]

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

      // 6. Build Docker image using docker CLI (more reliable for complex builds)
      const imageName = `uc-workspace-${repo.full_name.replace("/", "-").toLowerCase()}:${Date.now()}`;
      let buildDir: string | null = null;

      try {
        // Create temp directory for Dockerfile
        buildDir = await mkdtemp(join(tmpdir(), "workspace-"));
        await writeFile(join(buildDir, "Dockerfile"), dockerfile);

        console.log(`Building Docker image ${imageName}...`);
        
        // Build using docker CLI
        const buildResult = await runDockerCommand([
          "build",
          "-t", imageName,
          "-f", join(buildDir, "Dockerfile"),
          buildDir,
        ]);

        if (buildResult.exitCode !== 0) {
          throw new Error(buildResult.stderr || buildResult.stdout || "Build failed");
        }

        console.log("Docker build completed");

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown build error";
        console.error("Docker build failed:", errorMsg);
        
        setWorkspaceError("build_failed", {
          type: "build_failed",
          message: `Docker build failed: ${errorMsg}`,
          details: {
            attempt: buildAttempt,
            dockerfile: dockerfile,
            logs: errorMsg,
          },
          timestamp: new Date().toISOString(),
        });
        
        // Cleanup
        if (buildDir) {
          await rm(buildDir, { recursive: true }).catch(() => {});
        }
        
        throw new Error(`Docker build failed: ${errorMsg}`);
      }

      // Cleanup build directory
      if (buildDir) {
        await rm(buildDir, { recursive: true }).catch(() => {});
      }

      // 7. Create and start container using docker CLI
      let containerId: string | null = null;

      try {
        const containerName = `workspace-${workspace.id}`;
        const homeDir = homedir();

        // Create and run container
        const runResult = await runDockerCommand([
          "run",
          "-d",  // detached
          "--name", containerName,
          "-e", `GH_TOKEN=${process.env.GH_TOKEN || ""}`,
          "-v", `${homeDir}/.ssh/id_ed25519:/home/ubuntu/.ssh/id_ed25519:ro`,
          "-v", `${homeDir}/.local/share/opencode/auth.json:/home/ubuntu/.local/share/opencode/auth.json:ro`,
          "-v", `${homeDir}/.config/opencode:/home/ubuntu/.config/opencode:ro`,
          "--network", "host",
          "-u", "ubuntu",
          "-w", "/home/ubuntu/repo",
          "-t",  // TTY
          imageName,
          "tail", "-f", "/dev/null",  // Keep container running
        ]);

        if (runResult.exitCode !== 0) {
          throw new Error(runResult.stderr || runResult.stdout || "Container creation failed");
        }

        containerId = runResult.stdout.trim();

        if (!containerId) {
          throw new Error("Container created but no ID returned");
        }

        console.log(`Container ${containerId} started successfully`);

        // Update workspace with container ID
        db.run(
          `UPDATE workspaces SET container_id = ?, status = ? WHERE id = ?`,
          containerId,
          "running",
          workspace.id
        );

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

      // Return the updated workspace
      return db.get<Workspace>(
        `SELECT * FROM workspaces WHERE id = ?`,
        workspace.id
      );
    },
    {
      body: t.Object({
        issue_id: t.Number(),
        agent_id: t.Number(),
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
        // Stop and remove the container using docker CLI
        await runDockerCommand(["stop", workspace.container_id]);
        await runDockerCommand(["rm", "-f", workspace.container_id]);

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
  );
