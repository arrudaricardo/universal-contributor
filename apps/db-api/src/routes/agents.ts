import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-plugin";

export interface Agent {
  id: number;
  name: string;
  status: string;
  priority: number;
  rate_limit_remaining: number | null;
  rate_limit_reset_at: string | null;
  current_run_id: number | null;
  created_at: string;
  last_active_at: string | null;
}

export const agentsRoutes = new Elysia({ prefix: "/agents" })
  .use(dbPlugin)
  .get(
    "/",
    ({ db, query }) => {
      if (query.status) {
        return db.query<Agent>(
          `SELECT * FROM agents WHERE status = ? ORDER BY priority DESC, created_at ASC`,
          query.status
        );
      }
      return db.query<Agent>(
        `SELECT * FROM agents ORDER BY priority DESC, created_at ASC`
      );
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
      }),
    }
  )
  .get("/:id", ({ db, params }) => {
    const agent = db.get<Agent>(
      `SELECT * FROM agents WHERE id = ?`,
      parseInt(params.id)
    );
    if (!agent) {
      throw new Error("Agent not found");
    }
    return agent;
  })
  .post(
    "/",
    ({ db, body }) => {
      db.run(
        `INSERT INTO agents (name, status, priority) VALUES (?, ?, ?)`,
        body.name,
        body.status ?? "idle",
        body.priority ?? 0
      );
      const agent = db.get<Agent>(
        `SELECT * FROM agents WHERE name = ?`,
        body.name
      );
      return agent;
    },
    {
      body: t.Object({
        name: t.String(),
        status: t.Optional(t.String()),
        priority: t.Optional(t.Number()),
      }),
    }
  )
  .patch(
    "/:id",
    ({ db, params, body }) => {
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (body.name !== undefined) {
        updates.push("name = ?");
        values.push(body.name);
      }
      if (body.status !== undefined) {
        updates.push("status = ?");
        values.push(body.status);
      }
      if (body.priority !== undefined) {
        updates.push("priority = ?");
        values.push(body.priority);
      }
      if (body.rate_limit_remaining !== undefined) {
        updates.push("rate_limit_remaining = ?");
        values.push(body.rate_limit_remaining);
      }
      if (body.rate_limit_reset_at !== undefined) {
        updates.push("rate_limit_reset_at = ?");
        values.push(body.rate_limit_reset_at);
      }
      if (body.current_run_id !== undefined) {
        updates.push("current_run_id = ?");
        values.push(body.current_run_id);
      }
      if (body.last_active_at !== undefined) {
        updates.push("last_active_at = ?");
        values.push(body.last_active_at);
      }

      if (updates.length === 0) {
        throw new Error("No fields to update");
      }

      values.push(parseInt(params.id));
      db.run(
        `UPDATE agents SET ${updates.join(", ")} WHERE id = ?`,
        ...values
      );

      return db.get<Agent>(
        `SELECT * FROM agents WHERE id = ?`,
        parseInt(params.id)
      );
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        status: t.Optional(t.String()),
        priority: t.Optional(t.Number()),
        rate_limit_remaining: t.Optional(t.Nullable(t.Number())),
        rate_limit_reset_at: t.Optional(t.Nullable(t.String())),
        current_run_id: t.Optional(t.Nullable(t.Number())),
        last_active_at: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  .delete("/:id", ({ db, params }) => {
    db.run(`DELETE FROM agents WHERE id = ?`, parseInt(params.id));
    return { success: true };
  })
  .post("/:id/suspend", ({ db, params }) => {
    db.run(
      `UPDATE agents SET status = 'suspended' WHERE id = ?`,
      parseInt(params.id)
    );
    return db.get<Agent>(
      `SELECT * FROM agents WHERE id = ?`,
      parseInt(params.id)
    );
  })
  .post("/:id/resume", ({ db, params }) => {
    db.run(
      `UPDATE agents SET status = 'idle' WHERE id = ?`,
      parseInt(params.id)
    );
    return db.get<Agent>(
      `SELECT * FROM agents WHERE id = ?`,
      parseInt(params.id)
    );
  });
