import { Elysia, t } from "elysia";
import { z } from "zod";
import { dbPlugin } from "../db-plugin";
import { BrowserUseClient } from "browser-use-sdk";

export interface Issue {
  id: number;
  repository_id: number;
  github_issue_number: number;
  title: string;
  url: string;
  body: string | null;
  labels: string | null;
  has_good_first_issue: number;
  has_help_wanted: number;
  has_bug_label: number;
  ai_complexity_score: number | null;
  ai_solvability_score: number | null;
  ai_analysis: string | null;
  status: string;
  claimed_by_agent_id: number | null;
  claimed_at: string | null;
  discovered_at: string;
}

export const issuesRoutes = new Elysia({ prefix: "/issues" })
  .use(dbPlugin)
  .get(
    "/",
    ({ db, query }) => {
      if (query.repository_id && query.github_issue_number) {
        const issue = db.get<Issue>(
          `SELECT * FROM issues WHERE repository_id = ? AND github_issue_number = ?`,
          parseInt(query.repository_id),
          parseInt(query.github_issue_number)
        );
        return issue ? [issue] : [];
      }
      if (query.repository_id) {
        return db.query<Issue>(
          `SELECT * FROM issues WHERE repository_id = ? ORDER BY discovered_at DESC`,
          parseInt(query.repository_id)
        );
      }
      if (query.status) {
        return db.query<Issue>(
          `SELECT * FROM issues WHERE status = ? ORDER BY discovered_at DESC`,
          query.status
        );
      }
      return db.query<Issue>(
        `SELECT * FROM issues ORDER BY discovered_at DESC`
      );
    },
    {
      query: t.Object({
        repository_id: t.Optional(t.String()),
        github_issue_number: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .get("/:id", ({ db, params }) => {
    const issue = db.get<Issue>(
      `SELECT * FROM issues WHERE id = ?`,
      parseInt(params.id)
    );
    if (!issue) {
      throw new Error("Issue not found");
    }
    return issue;
  })
  .post(
    "/",
    ({ db, body }) => {
      db.run(
        `INSERT INTO issues (repository_id, github_issue_number, title, url, body, labels, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        body.repository_id,
        body.github_issue_number,
        body.title,
        body.url,
        body.body ?? null,
        body.labels ?? null,
        body.status ?? "pending"
      );
      const issue = db.get<Issue>(
        `SELECT * FROM issues WHERE repository_id = ? AND github_issue_number = ?`,
        body.repository_id,
        body.github_issue_number
      );
      return issue;
    },
    {
      body: t.Object({
        repository_id: t.Number(),
        github_issue_number: t.Number(),
        title: t.String(),
        url: t.String(),
        body: t.Optional(t.String()),
        labels: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .patch(
    "/:id",
    ({ db, params, body }) => {
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (body.title !== undefined) {
        updates.push("title = ?");
        values.push(body.title);
      }
      if (body.body !== undefined) {
        updates.push("body = ?");
        values.push(body.body);
      }
      if (body.labels !== undefined) {
        updates.push("labels = ?");
        values.push(body.labels);
      }
      if (body.status !== undefined) {
        updates.push("status = ?");
        values.push(body.status);
      }
      if (body.ai_analysis !== undefined) {
        updates.push("ai_analysis = ?");
        values.push(body.ai_analysis);
      }
      if (body.ai_complexity_score !== undefined) {
        updates.push("ai_complexity_score = ?");
        values.push(body.ai_complexity_score);
      }
      if (body.ai_solvability_score !== undefined) {
        updates.push("ai_solvability_score = ?");
        values.push(body.ai_solvability_score);
      }
      if (body.claimed_by_agent_id !== undefined) {
        updates.push("claimed_by_agent_id = ?");
        values.push(body.claimed_by_agent_id);
      }
      if (body.claimed_at !== undefined) {
        updates.push("claimed_at = ?");
        values.push(body.claimed_at);
      }

      if (updates.length === 0) {
        throw new Error("No fields to update");
      }

      values.push(parseInt(params.id));
      db.run(
        `UPDATE issues SET ${updates.join(", ")} WHERE id = ?`,
        ...values
      );

      return db.get<Issue>(
        `SELECT * FROM issues WHERE id = ?`,
        parseInt(params.id)
      );
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        body: t.Optional(t.String()),
        labels: t.Optional(t.String()),
        status: t.Optional(t.String()),
        ai_analysis: t.Optional(t.String()),
        ai_complexity_score: t.Optional(t.Number()),
        ai_solvability_score: t.Optional(t.Number()),
        claimed_by_agent_id: t.Optional(t.Nullable(t.Number())),
        claimed_at: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  .delete("/:id", ({ db, params }) => {
    db.run(`DELETE FROM issues WHERE id = ?`, parseInt(params.id));
    return { success: true };
  })
  .post(
    "/:id/extract",
    async ({ db, params }) => {
      const issueId = parseInt(params.id);
      const issue = db.get<Issue>(
        `SELECT * FROM issues WHERE id = ?`,
        issueId
      );

      if (!issue) {
        throw new Error("Issue not found");
      }

      // Get repository info
      const repo = db.get<{ id: number; full_name: string }>(
        `SELECT id, full_name FROM repositories WHERE id = ?`,
        issue.repository_id
      );

      if (!repo) {
        throw new Error("Repository not found");
      }

      // Update status to 'extracting'
      db.run(
        `UPDATE issues SET status = ? WHERE id = ?`,
        "extracting",
        issueId
      );

      try {
        const client = new BrowserUseClient({
          apiKey: process.env.BROWSER_USE_API_KEY!,
        });

        // Define the schema for issue extraction
        const IssueDataSchema = z.object({
          title: z.string(),
          body: z.string(),
          labels: z.array(z.string()),
          state: z.string(),
          author: z.string(),
          createdAt: z.string(),
        });

        // Define the schema for repository extraction
        const RepoDataSchema = z.object({
          description: z.string().nullable(),
          stars: z.number(),
          forks: z.number(),
          language: z.string().nullable(),
        });

        // Extract issue data
        const issueTask = await client.tasks.createTask({
          task: `Go to ${issue.url} and extract the following information from the GitHub issue page:
            - title: The issue title
            - body: The full issue description/body text
            - labels: Array of label names (e.g., ["bug", "help wanted"])
            - state: The issue state (open or closed)
            - author: The GitHub username who created the issue
            - createdAt: When the issue was created`,
          schema: IssueDataSchema,
        });

        const issueResult = await issueTask.complete();

        // Extract repository data
        const repoUrl = `https://github.com/${repo.full_name}`;
        const repoTask = await client.tasks.createTask({
          task: `Go to ${repoUrl} and extract the following information from the GitHub repository page:
            - description: The repository description (can be null if none)
            - stars: Number of stars (as a number)
            - forks: Number of forks (as a number)
            - language: Primary programming language (can be null)`,
          schema: RepoDataSchema,
        });

        const repoResult = await repoTask.complete();

        // Update issue with extracted data
        const labelsJson = JSON.stringify(issueResult.parsed?.labels);
        db.run(
          `UPDATE issues SET title = ?, body = ?, labels = ?, status = ? WHERE id = ?`,
          issueResult.parsed?.title || "",
          issueResult.parsed?.body || "",
          labelsJson,
          issueResult.parsed?.state || "",
          issueId
        );

        // Update repository with extracted data
        db.run(
          `UPDATE repositories SET description = ?, stars = ?, forks = ?, language = ?, last_checked_at = datetime('now') WHERE id = ?`,
          repoResult.parsed?.description || "",
          repoResult.parsed?.stars || 0,
          repoResult.parsed?.forks || 0,
          repoResult.parsed?.language || "",
          repo.id
        );

        return { success: true };
      } catch (error) {
        // Update status to 'error' on failure
        db.run(
          `UPDATE issues SET status = ?, ai_analysis = ? WHERE id = ?`,
          "error",
          error instanceof Error ? error.message : "Unknown error during extraction",
          issueId
        );
        throw error;
      }
    }
  )
  .post(
    "/:id/claim",
    ({ db, params, body }) => {
      db.run(
        `UPDATE issues SET claimed_by_agent_id = ?, claimed_at = datetime('now'), status = 'claimed' WHERE id = ?`,
        body.agent_id,
        parseInt(params.id)
      );
      return db.get<Issue>(
        `SELECT * FROM issues WHERE id = ?`,
        parseInt(params.id)
      );
    },
    {
      body: t.Object({
        agent_id: t.Number(),
      }),
    }
  );
