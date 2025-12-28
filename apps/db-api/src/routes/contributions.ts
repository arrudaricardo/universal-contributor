import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-plugin";

export interface Contribution {
  id: number;
  agent_run_id: number;
  issue_id: number;
  pr_url: string | null;
  pr_number: number | null;
  branch_name: string | null;
  status: string;
  ai_solution_summary: string | null;
  files_changed: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  created_at: string;
  updated_at: string;
}

export const contributionsRoutes = new Elysia({ prefix: "/contributions" })
  .use(dbPlugin)
  .get(
    "/",
    ({ db, query }) => {
      if (query.issue_id) {
        return db.query<Contribution>(
          `SELECT * FROM contributions WHERE issue_id = ? ORDER BY created_at DESC`,
          parseInt(query.issue_id)
        );
      }
      if (query.status) {
        return db.query<Contribution>(
          `SELECT * FROM contributions WHERE status = ? ORDER BY created_at DESC`,
          query.status
        );
      }
      return db.query<Contribution>(
        `SELECT * FROM contributions ORDER BY created_at DESC`
      );
    },
    {
      query: t.Object({
        issue_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .get("/:id", ({ db, params }) => {
    const contribution = db.get<Contribution>(
      `SELECT * FROM contributions WHERE id = ?`,
      parseInt(params.id)
    );
    if (!contribution) {
      throw new Error("Contribution not found");
    }
    return contribution;
  })
  .post(
    "/",
    ({ db, body }) => {
      db.run(
        `INSERT INTO contributions (agent_run_id, issue_id, pr_url, pr_number, branch_name, status, ai_solution_summary, files_changed, lines_added, lines_removed) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        body.agent_run_id,
        body.issue_id,
        body.pr_url ?? null,
        body.pr_number ?? null,
        body.branch_name ?? null,
        body.status ?? "pending",
        body.ai_solution_summary ?? null,
        body.files_changed ?? null,
        body.lines_added ?? null,
        body.lines_removed ?? null
      );
      const contribution = db.get<Contribution>(
        `SELECT * FROM contributions WHERE id = last_insert_rowid()`
      );
      return contribution;
    },
    {
      body: t.Object({
        agent_run_id: t.Number(),
        issue_id: t.Number(),
        pr_url: t.Optional(t.String()),
        pr_number: t.Optional(t.Number()),
        branch_name: t.Optional(t.String()),
        status: t.Optional(t.String()),
        ai_solution_summary: t.Optional(t.String()),
        files_changed: t.Optional(t.Number()),
        lines_added: t.Optional(t.Number()),
        lines_removed: t.Optional(t.Number()),
      }),
    }
  )
  .patch(
    "/:id",
    ({ db, params, body }) => {
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (body.pr_url !== undefined) {
        updates.push("pr_url = ?");
        values.push(body.pr_url);
      }
      if (body.pr_number !== undefined) {
        updates.push("pr_number = ?");
        values.push(body.pr_number);
      }
      if (body.branch_name !== undefined) {
        updates.push("branch_name = ?");
        values.push(body.branch_name);
      }
      if (body.status !== undefined) {
        updates.push("status = ?");
        values.push(body.status);
      }
      if (body.ai_solution_summary !== undefined) {
        updates.push("ai_solution_summary = ?");
        values.push(body.ai_solution_summary);
      }
      if (body.files_changed !== undefined) {
        updates.push("files_changed = ?");
        values.push(body.files_changed);
      }
      if (body.lines_added !== undefined) {
        updates.push("lines_added = ?");
        values.push(body.lines_added);
      }
      if (body.lines_removed !== undefined) {
        updates.push("lines_removed = ?");
        values.push(body.lines_removed);
      }

      // Always update updated_at
      updates.push("updated_at = datetime('now')");

      if (updates.length === 1) {
        throw new Error("No fields to update");
      }

      values.push(parseInt(params.id));
      db.run(
        `UPDATE contributions SET ${updates.join(", ")} WHERE id = ?`,
        ...values
      );

      return db.get<Contribution>(
        `SELECT * FROM contributions WHERE id = ?`,
        parseInt(params.id)
      );
    },
    {
      body: t.Object({
        pr_url: t.Optional(t.Nullable(t.String())),
        pr_number: t.Optional(t.Nullable(t.Number())),
        branch_name: t.Optional(t.Nullable(t.String())),
        status: t.Optional(t.String()),
        ai_solution_summary: t.Optional(t.Nullable(t.String())),
        files_changed: t.Optional(t.Nullable(t.Number())),
        lines_added: t.Optional(t.Nullable(t.Number())),
        lines_removed: t.Optional(t.Nullable(t.Number())),
      }),
    }
  )
  .delete("/:id", ({ db, params }) => {
    db.run(
      `DELETE FROM contributions WHERE id = ?`,
      parseInt(params.id)
    );
    return { success: true };
  });
