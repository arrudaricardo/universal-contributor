import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-plugin";

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
  });
