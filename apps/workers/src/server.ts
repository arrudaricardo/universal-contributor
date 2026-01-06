import { createRoutes } from "./api/routes";

const PORT = Number(process.env.PORT) || 3000;

// Database class - simplified inline version for now
// This matches the interface expected by routes.ts
import { Database as BunDatabase } from "bun:sqlite";

class Database {
  private db: BunDatabase;

  constructor(path: string = "db.sqlite") {
    this.db = new BunDatabase(path, { create: true, strict: true });
    this.db.run("PRAGMA foreign_keys = ON");
  }

  init() {
    // Agents
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'idle',
        priority INTEGER NOT NULL DEFAULT 0,
        rate_limit_remaining INTEGER,
        rate_limit_reset_at TEXT,
        current_run_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_active_at TEXT
      )
    `);

    // Repositories
    this.db.run(`
      CREATE TABLE IF NOT EXISTS repositories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        description TEXT,
        stars INTEGER DEFAULT 0,
        forks INTEGER DEFAULT 0,
        language TEXT,
        source TEXT NOT NULL,
        trending_rank INTEGER,
        discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_checked_at TEXT,
        fork_full_name TEXT,
        fork_url TEXT
      )
    `);

    // Issues
    this.db.run(`
      CREATE TABLE IF NOT EXISTS issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_id INTEGER NOT NULL REFERENCES repositories(id),
        github_issue_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        body TEXT,
        labels TEXT,
        has_good_first_issue INTEGER DEFAULT 0,
        has_help_wanted INTEGER DEFAULT 0,
        has_bug_label INTEGER DEFAULT 0,
        ai_complexity_score INTEGER,
        ai_solvability_score INTEGER,
        ai_analysis TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        claimed_by_agent_id INTEGER REFERENCES agents(id),
        claimed_at TEXT,
        discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(repository_id, github_issue_number)
      )
    `);

    // Agent runs
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL REFERENCES agents(id),
        repository_id INTEGER REFERENCES repositories(id),
        issue_id INTEGER REFERENCES issues(id),
        status TEXT NOT NULL DEFAULT 'started',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        error_message TEXT
      )
    `);

    // Contributions
    this.db.run(`
      CREATE TABLE IF NOT EXISTS contributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_run_id INTEGER NOT NULL REFERENCES agent_runs(id),
        issue_id INTEGER NOT NULL REFERENCES issues(id),
        pr_url TEXT,
        pr_number INTEGER,
        branch_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        ai_solution_summary TEXT,
        files_changed INTEGER,
        lines_added INTEGER,
        lines_removed INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Webhooks
    this.db.run(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contribution_id INTEGER REFERENCES contributions(id),
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        action TEXT,
        comment_body TEXT,
        check_status TEXT,
        processed INTEGER DEFAULT 0,
        processed_at TEXT,
        received_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Config
    this.db.run(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Agent states
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agent_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL REFERENCES agents(id),
        agent_run_id INTEGER REFERENCES agent_runs(id),
        contribution_id INTEGER REFERENCES contributions(id),
        prompt_history TEXT,
        browser_context TEXT,
        step TEXT,
        suspended_at TEXT NOT NULL DEFAULT (datetime('now')),
        resume_reason TEXT,
        resumed_at TEXT
      )
    `);

    // Repository environments
    this.db.run(`
      CREATE TABLE IF NOT EXISTS repository_environments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_id INTEGER NOT NULL UNIQUE REFERENCES repositories(id),
        primary_language TEXT,
        runtime TEXT,
        runtime_version TEXT,
        package_manager TEXT,
        setup_commands TEXT,
        test_commands TEXT,
        memory_mb INTEGER DEFAULT 2048,
        cpu_cores REAL DEFAULT 1.0,
        disk_mb INTEGER DEFAULT 5000,
        docker_image TEXT,
        discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_updated_at TEXT
      )
    `);

    // Workspaces
    this.db.run(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL REFERENCES agents(id),
        agent_run_id INTEGER REFERENCES agent_runs(id),
        repository_id INTEGER NOT NULL REFERENCES repositories(id),
        issue_id INTEGER REFERENCES issues(id),
        container_id TEXT,
        status TEXT DEFAULT 'pending',
        branch_name TEXT,
        base_branch TEXT DEFAULT 'main',
        timeout_minutes INTEGER DEFAULT 60,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        destroyed_at TEXT,
        error_message TEXT,
        pr_url TEXT
      )
    `);

    // Default config
    this.db.run(`INSERT OR IGNORE INTO config (key, value) VALUES ('max_concurrent_agents', '1')`);
    this.db.run(`INSERT OR IGNORE INTO config (key, value) VALUES ('workspace_timeout_minutes', '60')`);

    // Indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_contributions_status ON contributions(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces(status)`);
  }

  query<T>(sql: string, ...params: (string | number | bigint | null)[]): T[] {
    const stmt = this.db.prepare(sql);
    return params.length ? (stmt.all(...params) as T[]) : (stmt.all() as T[]);
  }

  run(sql: string, ...params: (string | number | bigint | null)[]) {
    const stmt = this.db.prepare(sql);
    return params.length ? stmt.run(...params) : stmt.run();
  }

  get<T>(sql: string, ...params: (string | number | bigint | null)[]): T | null {
    const stmt = this.db.prepare(sql);
    return (params.length ? stmt.get(...params) : stmt.get()) as T | null;
  }

  close() {
    this.db.close();
  }
}

// Initialize database
const db = new Database(process.env.DATABASE_PATH || "db.sqlite");
db.init();

// Create router
const routes = createRoutes(db);

// Serve static files from UI build
async function serveUI(path: string): Promise<Response | null> {
  const file = Bun.file(`./dist${path === "/" ? "/index.html" : path}`);
  if (await file.exists()) {
    const contentType = path.endsWith(".js")
      ? "application/javascript"
      : path.endsWith(".css")
        ? "text/css"
        : path.endsWith(".html") || path === "/"
          ? "text/html"
          : "application/octet-stream";
    return new Response(file, { headers: { "Content-Type": contentType } });
  }
  // SPA fallback
  const index = Bun.file("./dist/index.html");
  if (await index.exists()) {
    return new Response(index, { headers: { "Content-Type": "text/html" } });
  }
  return null;
}

// Main server
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS headers for development
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // API routes
    if (path.startsWith("/api/")) {
      try {
        const apiPath = path.slice(4); // Remove /api prefix
        const response = await routes.handle(req, apiPath);
        // Add CORS headers to API responses
        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(corsHeaders)) {
          headers.set(key, value);
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        console.error("API error:", error);
        return Response.json(
          { error: error instanceof Error ? error.message : "Internal server error" },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Serve static UI files
    const uiResponse = await serveUI(path);
    if (uiResponse) return uiResponse;

    // 404
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running on http://localhost:${server.port}`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  db.close();
  process.exit(0);
});
