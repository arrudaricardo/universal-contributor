
import { Database as BunDatabase, type SQLQueryBindings } from "bun:sqlite";

export class Database {
  private db: BunDatabase;

  constructor(path: string = "db.sqlite") {
    this.db = new BunDatabase(path, { create: true, strict: true });
    this.db.run("PRAGMA foreign_keys = ON");
  }

  init() {
    // Agents: isolated workers with rate limit tracking and scheduling
    // status: idle, running, suspended, stopped
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

    // Repositories: discovered from trending/searches
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
        last_checked_at TEXT
      )
    `);

    // Issues: with claim locking + selection metadata
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

    // Agent runs: each execution session
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

    // Contributions: PR lifecycle
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

    // Webhooks: GitHub events for feedback loop
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

    // Config: global settings (e.g., max_concurrent_agents)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Agent states: suspension/resumption with prompt history
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

    // Repository environments: detected build/runtime info
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

    // Workspaces: Docker containers for isolated agent work
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
        error_message TEXT
      )
    `);

    // Default config values
    this.db.run(`INSERT OR IGNORE INTO config (key, value) VALUES ('max_concurrent_agents', '1')`);
    this.db.run(`INSERT OR IGNORE INTO config (key, value) VALUES ('workspace_timeout_minutes', '60')`);
    this.db.run(`INSERT OR IGNORE INTO config (key, value) VALUES ('workspace_default_memory_mb', '2048')`);
    this.db.run(`INSERT OR IGNORE INTO config (key, value) VALUES ('workspace_default_cpu_cores', '1.0')`);

    // Indexes for performance
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_issues_claimed_by ON issues(claimed_by_agent_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_contributions_status ON contributions(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_webhooks_unprocessed ON webhooks(contribution_id, processed)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_repositories_source ON repositories(source)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_agent_states_suspended ON agent_states(agent_id, resumed_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_workspaces_agent ON workspaces(agent_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_workspaces_expires ON workspaces(expires_at)`);
  }

  query<T>(sql: string, ...params: SQLQueryBindings[]): T[] {
    const stmt = this.db.prepare(sql);
    return params.length ? (stmt.all(...params) as T[]) : (stmt.all() as T[]);
  }

  run(sql: string, ...params: SQLQueryBindings[]) {
    const stmt = this.db.prepare(sql);
    return params.length ? stmt.run(...params) : stmt.run();
  }

  get<T>(sql: string, ...params: SQLQueryBindings[]): T | null {
    const stmt = this.db.prepare(sql);
    return (params.length ? stmt.get(...params) : stmt.get()) as T | null;
  }

  close() {
    this.db.close();
  }
}
