import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-plugin";

export interface AgentRun {
  id: number;
  agent_id: number;
  repository_id: number | null;
  issue_id: number | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export const agentRunsRoutes = new Elysia({ prefix: "/agent-runs" })
  .use(dbPlugin)
  .get(
    "/",
    ({ db, query }) => {
      if (query.agent_id) {
        return db.query<AgentRun>(
          `SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC`,
          parseInt(query.agent_id)
        );
      }
      if (query.status) {
        return db.query<AgentRun>(
          `SELECT * FROM agent_runs WHERE status = ? ORDER BY started_at DESC`,
          query.status
        );
      }
      return db.query<AgentRun>(
        `SELECT * FROM agent_runs ORDER BY started_at DESC`
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
    const run = db.get<AgentRun>(
      `SELECT * FROM agent_runs WHERE id = ?`,
      parseInt(params.id)
    );
    if (!run) {
      throw new Error("Agent run not found");
    }
    return run;
  })
  .post(
    "/",
    ({ db, body }) => {
      db.run(
        `INSERT INTO agent_runs (agent_id, repository_id, issue_id, status) VALUES (?, ?, ?, ?)`,
        body.agent_id,
        body.repository_id ?? null,
        body.issue_id ?? null,
        body.status ?? "started"
      );
      const run = db.get<AgentRun>(
        `SELECT * FROM agent_runs WHERE id = last_insert_rowid()`
      );
      return run;
    },
    {
      body: t.Object({
        agent_id: t.Number(),
        repository_id: t.Optional(t.Number()),
        issue_id: t.Optional(t.Number()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .patch(
    "/:id",
    ({ db, params, body }) => {
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (body.status !== undefined) {
        updates.push("status = ?");
        values.push(body.status);
      }
      if (body.completed_at !== undefined) {
        updates.push("completed_at = ?");
        values.push(body.completed_at);
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
        `UPDATE agent_runs SET ${updates.join(", ")} WHERE id = ?`,
        ...values
      );

      return db.get<AgentRun>(
        `SELECT * FROM agent_runs WHERE id = ?`,
        parseInt(params.id)
      );
    },
    {
      body: t.Object({
        status: t.Optional(t.String()),
        completed_at: t.Optional(t.Nullable(t.String())),
        error_message: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  .delete("/:id", ({ db, params }) => {
    db.run(
      `DELETE FROM agent_runs WHERE id = ?`,
      parseInt(params.id)
    );
    return { success: true };
  });
