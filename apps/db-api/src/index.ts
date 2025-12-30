import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { Database } from "../../../packages/shared/src/db";
import { repositoriesRoutes } from "./routes/repositories";
import { issuesRoutes } from "./routes/issues";
import { agentsRoutes } from "./routes/agents";
import { agentRunsRoutes } from "./routes/agent-runs";
import { agentStatesRoutes } from "./routes/agent-states";
import { contributionsRoutes } from "./routes/contributions";
import { workspacesRoutes } from "./routes/workspaces";
import { webhooksRoutes } from "./routes/webhooks";
import { configRoutes } from "./routes/config";
import { opencodeRoutes } from "./routes/opencode";

import { existsSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

// OpenCode server configuration
const OPENCODE_PORT = process.env.OPENCODE_PORT ?? "4096";
const OPENCODE_HOSTNAME = process.env.OPENCODE_HOSTNAME ?? "127.0.0.1";
const OPENCODE_URL = `http://${OPENCODE_HOSTNAME}:${OPENCODE_PORT}`;

// PID file to track the OpenCode process we spawned
const OPENCODE_PID_FILE = join(import.meta.dir, "../data/.opencode.pid");

// Check if OpenCode server is already running
async function isOpencodeRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${OPENCODE_URL}/global/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// Check if a process with given PID is running
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Read PID from file
function readPidFile(): number | null {
  try {
    if (existsSync(OPENCODE_PID_FILE)) {
      const pid = parseInt(readFileSync(OPENCODE_PID_FILE, "utf-8").trim(), 10);
      return isNaN(pid) ? null : pid;
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

// Write PID to file
function writePidFile(pid: number): void {
  try {
    writeFileSync(OPENCODE_PID_FILE, pid.toString(), "utf-8");
  } catch (error) {
    console.error("Failed to write PID file:", error);
  }
}

// Remove PID file
function removePidFile(): void {
  try {
    if (existsSync(OPENCODE_PID_FILE)) {
      unlinkSync(OPENCODE_PID_FILE);
    }
  } catch {
    // Ignore removal errors
  }
}

// Wait for OpenCode server to be ready
async function waitForOpencode(
  maxAttempts = 30,
  delayMs = 1000
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isOpencodeRunning()) {
      return true;
    }
    await Bun.sleep(delayMs);
  }
  return false;
}

// Start OpenCode server as child process
let opencodeProcess: ReturnType<typeof Bun.spawn> | null = null;
let weSpawnedOpencode = false;

async function startOpencodeServer(): Promise<void> {
  // Check if OpenCode is already running
  const alreadyRunning = await isOpencodeRunning();

  if (alreadyRunning) {
    // Check if we previously spawned it (via PID file)
    const existingPid = readPidFile();
    if (existingPid && isProcessRunning(existingPid)) {
      console.log(
        `OpenCode server already running at ${OPENCODE_URL} (PID: ${existingPid}, spawned by us)`
      );
      weSpawnedOpencode = true;
    } else {
      console.log(
        `OpenCode server already running at ${OPENCODE_URL} (external instance)`
      );
      weSpawnedOpencode = false;
    }
    return;
  }

  // Check for stale PID file and clean up
  const stalePid = readPidFile();
  if (stalePid) {
    if (isProcessRunning(stalePid)) {
      // Process exists but OpenCode isn't responding - might be starting up
      console.log(`Found existing OpenCode process (PID: ${stalePid}), waiting...`);
      const ready = await waitForOpencode(10, 500);
      if (ready) {
        console.log(`OpenCode server is now ready at ${OPENCODE_URL}`);
        weSpawnedOpencode = true;
        return;
      }
      // Process exists but not responding - kill it
      console.log(`Killing unresponsive OpenCode process (PID: ${stalePid})`);
      try {
        process.kill(stalePid, "SIGTERM");
        await Bun.sleep(1000);
      } catch {
        // Process might have died
      }
    }
    removePidFile();
  }

  console.log(
    `Starting OpenCode server on ${OPENCODE_HOSTNAME}:${OPENCODE_PORT}...`
  );

  opencodeProcess = Bun.spawn(
    ["opencode", "serve", "--port", OPENCODE_PORT, "--hostname", OPENCODE_HOSTNAME],
    {
      stdout: "inherit",
      stderr: "inherit",
      onExit(proc, exitCode, signalCode, error) {
        if (error) {
          console.error("OpenCode server error:", error);
        } else if (exitCode !== 0 && exitCode !== null) {
          console.error(`OpenCode server exited with code ${exitCode}`);
        } else if (signalCode) {
          console.log(`OpenCode server killed with signal ${signalCode}`);
        }
        opencodeProcess = null;
        removePidFile();
      },
    }
  );

  // Write PID file so we can track it across hot reloads
  writePidFile(opencodeProcess.pid);
  weSpawnedOpencode = true;

  console.log(`OpenCode server spawned with PID: ${opencodeProcess.pid}`);

  // Wait for the server to be ready
  const ready = await waitForOpencode();
  if (ready) {
    console.log(`OpenCode server is ready at ${OPENCODE_URL}`);
  } else {
    console.error(
      "OpenCode server failed to start within timeout. Continuing anyway..."
    );
  }
}

// Graceful shutdown handler
function setupGracefulShutdown() {
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);

    // Only kill OpenCode if we spawned it and it's a final shutdown (not hot reload)
    // In watch mode, SIGTERM is sent but we want to keep OpenCode running
    // We only kill on SIGINT (Ctrl+C) which indicates user wants to stop everything
    if (signal === "SIGINT" && weSpawnedOpencode) {
      const pid = readPidFile();
      if (pid && isProcessRunning(pid)) {
        console.log(`Stopping OpenCode server (PID: ${pid})...`);
        try {
          process.kill(pid, "SIGTERM");
          // Wait a bit for it to die
          for (let i = 0; i < 10; i++) {
            await Bun.sleep(200);
            if (!isProcessRunning(pid)) break;
          }
        } catch {
          // Process might have already died
        }
        removePidFile();
        console.log("OpenCode server stopped");
      } else if (opencodeProcess && !opencodeProcess.killed) {
        console.log("Stopping OpenCode server...");
        opencodeProcess.kill("SIGTERM");
        await opencodeProcess.exited;
        console.log("OpenCode server stopped");
      }
    }

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Initialize database
const db = new Database("./data/db.sqlite");
db.init();

// Start OpenCode server
await startOpencodeServer();

// Setup graceful shutdown
setupGracefulShutdown();
console.log(process.env.OPENAI_API_KEY);


const app = new Elysia()
  .use(cors())
  .decorate("db", db)
  .use(repositoriesRoutes)
  .use(issuesRoutes)
  .use(agentsRoutes)
  .use(agentRunsRoutes)
  .use(agentStatesRoutes)
  .use(contributionsRoutes)
  .use(workspacesRoutes)
  .use(webhooksRoutes)
  .use(configRoutes)
  .use(opencodeRoutes)
  .get("/health", () => ({ status: "ok" }))
  .listen(3002);

console.log(`🦊 DB API running at http://localhost:${app.server?.port}`);

export type App = typeof app;
