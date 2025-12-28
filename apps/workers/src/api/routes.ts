// Database interface - matches @universal-contributor/shared/db
interface Database {
  query<T>(sql: string, ...params: (string | number | bigint | null)[]): T[];
  run(sql: string, ...params: (string | number | bigint | null)[]): { lastInsertRowid: number | bigint };
  get<T>(sql: string, ...params: (string | number | bigint | null)[]): T | null;
}

interface RouteHandler {
  handle(req: Request, path: string): Promise<Response>;
}

export function createRoutes(db: Database): RouteHandler {
  return {
    async handle(req: Request, path: string): Promise<Response> {
      const method = req.method;
      const url = new URL(req.url);

      // Stats
      if (path === "/stats" && method === "GET") {
        const agents = db.query<{ id: number; status: string }>("SELECT id, status FROM agents");
        const contributions = db.query<{ id: number }>("SELECT id FROM contributions");
        const repositories = db.query<{ id: number }>("SELECT id FROM repositories");
        const issues = db.query<{ id: number }>("SELECT id FROM issues");

        return Response.json({
          totalAgents: agents.length,
          runningAgents: agents.filter((a: { status: string }) => a.status === "running").length,
          totalContributions: contributions.length,
          totalRepositories: repositories.length,
          totalIssues: issues.length,
        });
      }

      // Agents
      if (path === "/agents" && method === "GET") {
        const agents = db.query<{
          id: number;
          name: string;
          status: string;
          priority: number;
          created_at: string;
          last_active_at: string | null;
        }>("SELECT id, name, status, priority, created_at, last_active_at FROM agents ORDER BY priority DESC, id");

        return Response.json(
          agents.map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status,
            priority: a.priority,
            created_at: a.created_at,
            last_active_at: a.last_active_at,
          }))
        );
      }

      if (path === "/agents" && method === "POST") {
        const body = (await req.json()) as { name: string; priority?: number };
        if (!body.name) {
          return Response.json({ error: "Name is required" }, { status: 400 });
        }

        try {
          const result = db.run(
            "INSERT INTO agents (name, priority) VALUES (?, ?)",
            body.name,
            body.priority ?? 0
          );
          const agent = db.get<{
            id: number;
            name: string;
            status: string;
            priority: number;
            created_at: string;
            last_active_at: string | null;
          }>("SELECT id, name, status, priority, created_at, last_active_at FROM agents WHERE id = ?", result.lastInsertRowid);
          return Response.json(agent, { status: 201 });
        } catch (error: unknown) {
          if (error instanceof Error && error.message.includes("UNIQUE")) {
            return Response.json({ error: "Agent name already exists" }, { status: 409 });
          }
          throw error;
        }
      }

      const agentMatch = path.match(/^\/agents\/(\d+)$/);
      if (agentMatch && agentMatch[1]) {
        const agentId = parseInt(agentMatch[1]);

        if (method === "GET") {
          const agent = db.get<{
            id: number;
            name: string;
            status: string;
            priority: number;
            created_at: string;
            last_active_at: string | null;
            current_run_id: number | null;
          }>(
            "SELECT id, name, status, priority, created_at, last_active_at, current_run_id FROM agents WHERE id = ?",
            agentId
          );

          if (!agent) {
            return Response.json({ error: "Agent not found" }, { status: 404 });
          }

          // Get current issue from run
          let currentIssue = null;
          let currentContribution = null;
          if (agent.current_run_id) {
            const run = db.get<{ issue_id: number | null }>(
              "SELECT issue_id FROM agent_runs WHERE id = ?",
              agent.current_run_id
            );
            if (run?.issue_id) {
              const issue = db.get<{
                id: number;
                title: string;
                url: string;
                repository_id: number;
              }>("SELECT id, title, url, repository_id FROM issues WHERE id = ?", run.issue_id);
              if (issue) {
                const repo = db.get<{ full_name: string }>(
                  "SELECT full_name FROM repositories WHERE id = ?",
                  issue.repository_id
                );
                currentIssue = {
                  id: issue.id,
                  title: issue.title,
                  url: issue.url,
                  repoFullName: repo?.full_name ?? "",
                };

                const contribution = db.get<{
                  status: string;
                  pr_number: number | null;
                  pr_url: string | null;
                }>(
                  "SELECT status, pr_number, pr_url FROM contributions WHERE issue_id = ? ORDER BY id DESC LIMIT 1",
                  issue.id
                );
                if (contribution) {
                  currentContribution = {
                    status: contribution.status,
                    prNumber: contribution.pr_number,
                    prUrl: contribution.pr_url,
                  };
                }
              }
            }
          }

          // Get agent state for prompt history
          const state = db.get<{ step: string | null; prompt_history: string | null }>(
            "SELECT step, prompt_history FROM agent_states WHERE agent_id = ? ORDER BY id DESC LIMIT 1",
            agentId
          );

          return Response.json({
            id: agent.id,
            name: agent.name,
            status: agent.status,
            priority: agent.priority,
            created_at: agent.created_at,
            last_active_at: agent.last_active_at,
            currentIssue,
            currentContribution,
            state: state
              ? {
                  step: state.step,
                  promptHistory: state.prompt_history ? JSON.parse(state.prompt_history) : [],
                }
              : undefined,
          });
        }

        if (method === "DELETE") {
          const agent = db.get<{ id: number }>("SELECT id FROM agents WHERE id = ?", agentId);
          if (!agent) {
            return Response.json({ error: "Agent not found" }, { status: 404 });
          }
          db.run("DELETE FROM agents WHERE id = ?", agentId);
          return new Response(null, { status: 204 });
        }
      }

      // Agent actions
      const agentActionMatch = path.match(/^\/agents\/(\d+)\/(start|stop|resume)$/);
      if (agentActionMatch && agentActionMatch[1] && method === "POST") {
        const agentId = parseInt(agentActionMatch[1]);
        const action = agentActionMatch[2];

        const agent = db.get<{ id: number; status: string }>(
          "SELECT id, status FROM agents WHERE id = ?",
          agentId
        );
        if (!agent) {
          return Response.json({ error: "Agent not found" }, { status: 404 });
        }

        if (action === "start") {
          db.run("UPDATE agents SET status = 'running', last_active_at = datetime('now') WHERE id = ?", agentId);
        } else if (action === "stop") {
          db.run("UPDATE agents SET status = 'stopped' WHERE id = ?", agentId);
        } else if (action === "resume") {
          db.run("UPDATE agents SET status = 'running', last_active_at = datetime('now') WHERE id = ?", agentId);
        }

        return new Response(null, { status: 204 });
      }

      // Contributions
      if (path === "/contributions" && method === "GET") {
        const offset = parseInt(url.searchParams.get("offset") || "0");
        const limit = parseInt(url.searchParams.get("limit") || "20");

        const contributions = db.query<{
          id: number;
          agent_run_id: number;
          issue_id: number;
          pr_url: string | null;
          pr_number: number | null;
          status: string;
          ai_solution_summary: string | null;
          files_changed: number | null;
          lines_added: number | null;
          lines_removed: number | null;
          created_at: string;
          updated_at: string;
        }>(
          "SELECT * FROM contributions ORDER BY created_at DESC LIMIT ? OFFSET ?",
          limit,
          offset
        );

        const totalResult = db.get<{ count: number }>("SELECT COUNT(*) as count FROM contributions");
        const total = totalResult?.count ?? 0;

        // Enrich with agent and issue data
        const enriched = contributions.map((c) => {
          const run = db.get<{ agent_id: number }>(
            "SELECT agent_id FROM agent_runs WHERE id = ?",
            c.agent_run_id
          );
          const agent = run
            ? db.get<{ name: string }>("SELECT name FROM agents WHERE id = ?", run.agent_id)
            : null;
          const issue = db.get<{
            github_issue_number: number;
            title: string;
            repository_id: number;
          }>("SELECT github_issue_number, title, repository_id FROM issues WHERE id = ?", c.issue_id);
          const repo = issue
            ? db.get<{ full_name: string }>("SELECT full_name FROM repositories WHERE id = ?", issue.repository_id)
            : null;

          const webhooks = db.query<{
            id: number;
            event_type: string;
            action: string | null;
            comment_body: string | null;
            check_status: string | null;
            processed: number;
            received_at: string;
          }>("SELECT id, event_type, action, comment_body, check_status, processed, received_at FROM webhooks WHERE contribution_id = ?", c.id);

          return {
            id: c.id,
            agentId: run?.agent_id,
            agentName: agent?.name ?? "Unknown",
            issueId: c.issue_id,
            issueNumber: issue?.github_issue_number ?? 0,
            issueTitle: issue?.title ?? "Unknown",
            repoFullName: repo?.full_name ?? "Unknown",
            status: c.status,
            prNumber: c.pr_number,
            prUrl: c.pr_url,
            linesAdded: c.lines_added,
            linesRemoved: c.lines_removed,
            filesChanged: c.files_changed,
            aiSolutionSummary: c.ai_solution_summary,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
            webhooks: webhooks.map((w) => ({
              id: w.id,
              eventType: w.event_type,
              action: w.action,
              commentBody: w.comment_body,
              checkStatus: w.check_status,
              processed: !!w.processed,
              receivedAt: w.received_at,
            })),
          };
        });

        return Response.json({
          data: enriched,
          total,
          hasMore: offset + contributions.length < total,
        });
      }

      const contributionMatch = path.match(/^\/contributions\/(\d+)$/);
      if (contributionMatch && contributionMatch[1] && method === "GET") {
        const id = parseInt(contributionMatch[1]);
        const c = db.get<{
          id: number;
          agent_run_id: number;
          issue_id: number;
          pr_url: string | null;
          pr_number: number | null;
          status: string;
          ai_solution_summary: string | null;
          files_changed: number | null;
          lines_added: number | null;
          lines_removed: number | null;
          created_at: string;
          updated_at: string;
        }>("SELECT * FROM contributions WHERE id = ?", id);

        if (!c) {
          return Response.json({ error: "Contribution not found" }, { status: 404 });
        }

        const run = db.get<{ agent_id: number }>("SELECT agent_id FROM agent_runs WHERE id = ?", c.agent_run_id);
        const agent = run ? db.get<{ name: string }>("SELECT name FROM agents WHERE id = ?", run.agent_id) : null;
        const issue = db.get<{ github_issue_number: number; title: string; repository_id: number }>(
          "SELECT github_issue_number, title, repository_id FROM issues WHERE id = ?",
          c.issue_id
        );
        const repo = issue
          ? db.get<{ full_name: string }>("SELECT full_name FROM repositories WHERE id = ?", issue.repository_id)
          : null;

        const webhooks = db.query<{
          id: number;
          event_type: string;
          action: string | null;
          comment_body: string | null;
          check_status: string | null;
          processed: number;
          received_at: string;
        }>("SELECT id, event_type, action, comment_body, check_status, processed, received_at FROM webhooks WHERE contribution_id = ?", c.id);

        return Response.json({
          id: c.id,
          agentId: run?.agent_id,
          agentName: agent?.name ?? "Unknown",
          issueId: c.issue_id,
          issueNumber: issue?.github_issue_number ?? 0,
          issueTitle: issue?.title ?? "Unknown",
          repoFullName: repo?.full_name ?? "Unknown",
          status: c.status,
          prNumber: c.pr_number,
          prUrl: c.pr_url,
          linesAdded: c.lines_added,
          linesRemoved: c.lines_removed,
          filesChanged: c.files_changed,
          aiSolutionSummary: c.ai_solution_summary,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          webhooks: webhooks.map((w) => ({
            id: w.id,
            eventType: w.event_type,
            action: w.action,
            commentBody: w.comment_body,
            checkStatus: w.check_status,
            processed: !!w.processed,
            receivedAt: w.received_at,
          })),
        });
      }

      // Repositories
      if (path === "/repositories" && method === "GET") {
        const offset = parseInt(url.searchParams.get("offset") || "0");
        const limit = parseInt(url.searchParams.get("limit") || "20");

        const repos = db.query<{
          id: number;
          full_name: string;
          url: string;
          description: string | null;
          language: string | null;
          stars: number;
          source: string;
          trending_rank: number | null;
          discovered_at: string;
        }>("SELECT * FROM repositories ORDER BY stars DESC LIMIT ? OFFSET ?", limit, offset);

        const totalResult = db.get<{ count: number }>("SELECT COUNT(*) as count FROM repositories");
        const total = totalResult?.count ?? 0;

        return Response.json({
          data: repos.map((r) => ({
            id: r.id,
            fullName: r.full_name,
            url: r.url,
            description: r.description,
            language: r.language,
            stars: r.stars,
            source: r.source,
            trendingRank: r.trending_rank,
            discoveredAt: r.discovered_at,
          })),
          total,
          hasMore: offset + repos.length < total,
        });
      }

      // Issues
      if (path === "/issues" && method === "GET") {
        const offset = parseInt(url.searchParams.get("offset") || "0");
        const limit = parseInt(url.searchParams.get("limit") || "20");

        const issues = db.query<{
          id: number;
          repository_id: number;
          github_issue_number: number;
          url: string;
          title: string;
          status: string;
          has_good_first_issue: number;
          has_help_wanted: number;
          has_bug_label: number;
          ai_solvability_score: number | null;
          ai_complexity_score: number | null;
          claimed_by_agent_id: number | null;
          discovered_at: string;
        }>(
          "SELECT * FROM issues ORDER BY ai_solvability_score DESC NULLS LAST, discovered_at DESC LIMIT ? OFFSET ?",
          limit,
          offset
        );

        const totalResult = db.get<{ count: number }>("SELECT COUNT(*) as count FROM issues");
        const total = totalResult?.count ?? 0;

        const enriched = issues.map((i) => {
          const repo = db.get<{ full_name: string }>("SELECT full_name FROM repositories WHERE id = ?", i.repository_id);
          const agent = i.claimed_by_agent_id
            ? db.get<{ name: string }>("SELECT name FROM agents WHERE id = ?", i.claimed_by_agent_id)
            : null;

          return {
            id: i.id,
            githubIssueNumber: i.github_issue_number,
            repoFullName: repo?.full_name ?? "Unknown",
            url: i.url,
            title: i.title,
            status: i.status,
            hasGoodFirstIssue: !!i.has_good_first_issue,
            hasHelpWanted: !!i.has_help_wanted,
            hasBugLabel: !!i.has_bug_label,
            aiSolvabilityScore: i.ai_solvability_score,
            aiComplexityScore: i.ai_complexity_score,
            claimedByAgentName: agent?.name ?? null,
            discoveredAt: i.discovered_at,
          };
        });

        return Response.json({
          data: enriched,
          total,
          hasMore: offset + issues.length < total,
        });
      }

      // Workspaces
      if (path === "/workspaces" && method === "GET") {
        const offset = parseInt(url.searchParams.get("offset") || "0");
        const limit = parseInt(url.searchParams.get("limit") || "20");

        const workspaces = db.query<{
          id: number;
          agent_id: number;
          repository_id: number;
          issue_id: number | null;
          container_id: string | null;
          status: string;
          branch_name: string | null;
          expires_at: string | null;
          created_at: string;
          error_message: string | null;
        }>("SELECT * FROM workspaces ORDER BY created_at DESC LIMIT ? OFFSET ?", limit, offset);

        const totalResult = db.get<{ count: number }>("SELECT COUNT(*) as count FROM workspaces");
        const total = totalResult?.count ?? 0;

        const enriched = workspaces.map((w) => {
          const agent = db.get<{ name: string }>("SELECT name FROM agents WHERE id = ?", w.agent_id);
          const repo = db.get<{ full_name: string }>("SELECT full_name FROM repositories WHERE id = ?", w.repository_id);
          const issue = w.issue_id
            ? db.get<{ title: string }>("SELECT title FROM issues WHERE id = ?", w.issue_id)
            : null;

          return {
            id: w.id,
            agentId: w.agent_id,
            agentName: agent?.name ?? null,
            repositoryId: w.repository_id,
            repoFullName: repo?.full_name ?? null,
            issueId: w.issue_id,
            issueTitle: issue?.title ?? null,
            status: w.status,
            containerId: w.container_id,
            branchName: w.branch_name,
            errorMessage: w.error_message,
            expiresAt: w.expires_at,
            createdAt: w.created_at,
          };
        });

        return Response.json({
          data: enriched,
          total,
          hasMore: offset + workspaces.length < total,
        });
      }

      if (path === "/workspaces/stats" && method === "GET") {
        const activeCount = db.get<{ count: number }>(
          "SELECT COUNT(*) as count FROM workspaces WHERE status = 'active'"
        );
        const expiredCount = db.get<{ count: number }>(
          "SELECT COUNT(*) as count FROM workspaces WHERE status = 'expired'"
        );
        const destroyedCount = db.get<{ count: number }>(
          "SELECT COUNT(*) as count FROM workspaces WHERE destroyed_at IS NOT NULL"
        );
        const errorCount = db.get<{ count: number }>(
          "SELECT COUNT(*) as count FROM workspaces WHERE status = 'error'"
        );

        return Response.json({
          activeWorkspaces: activeCount?.count ?? 0,
          expiredWorkspaces: expiredCount?.count ?? 0,
          totalDestroyed: destroyedCount?.count ?? 0,
          totalErrors: errorCount?.count ?? 0,
          dockerAvailable: true, // TODO: check actual docker availability
          imageExists: true, // TODO: check if workspace image exists
        });
      }

      const workspaceDeleteMatch = path.match(/^\/workspaces\/(\d+)$/);
      if (workspaceDeleteMatch && workspaceDeleteMatch[1] && method === "DELETE") {
        const id = parseInt(workspaceDeleteMatch[1]);
        const workspace = db.get<{ id: number }>("SELECT id FROM workspaces WHERE id = ?", id);
        if (!workspace) {
          return Response.json({ error: "Workspace not found" }, { status: 404 });
        }
        db.run("UPDATE workspaces SET status = 'destroyed', destroyed_at = datetime('now') WHERE id = ?", id);
        return new Response(null, { status: 204 });
      }

      if (path === "/workspaces/cleanup" && method === "POST") {
        db.run(
          "UPDATE workspaces SET status = 'expired' WHERE status = 'active' AND expires_at < datetime('now')"
        );
        return new Response(null, { status: 204 });
      }

      // Config
      if (path === "/config" && method === "GET") {
        const configs = db.query<{ key: string; value: string }>("SELECT key, value FROM config");
        const configMap: Record<string, string> = {};
        for (const c of configs) {
          configMap[c.key] = c.value;
        }

        return Response.json({
          githubToken: process.env.GITHUB_TOKEN ? "***" : "",
          anthropicApiKey: process.env.ANTHROPIC_API_KEY ? "***" : "",
          maxConcurrentAgents: parseInt(configMap.max_concurrent_agents || "1"),
          discoveryIntervalMinutes: parseInt(configMap.discovery_interval_minutes || "30"),
        });
      }

      if (path === "/config" && method === "PUT") {
        const body = (await req.json()) as { maxConcurrentAgents?: number; discoveryIntervalMinutes?: number };

        if (body.maxConcurrentAgents !== undefined) {
          db.run(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('max_concurrent_agents', ?)",
            String(body.maxConcurrentAgents)
          );
        }
        if (body.discoveryIntervalMinutes !== undefined) {
          db.run(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('discovery_interval_minutes', ?)",
            String(body.discoveryIntervalMinutes)
          );
        }

        return new Response(null, { status: 204 });
      }

      // 404 for unmatched routes
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  };
}
