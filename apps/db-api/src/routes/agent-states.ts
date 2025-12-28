import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-plugin";

export interface AgentState {
  id: number;
  agent_id: number;
  agent_run_id: number | null;
  contribution_id: number | null;
  prompt_history: string | null;
  browser_context: string | null;
  step: string | null;
  suspended_at: string;
  resume_reason: string | null;
  resumed_at: string | null;
}

export const agentStatesRoutes = new Elysia({ prefix: "/agent-states" })
  .use(dbPlugin)
  .get(
    "/",
    ({ db, query }) => {
      if (query.agent_id) {
        if (query.suspended_only === "true") {
          return db.query<AgentState>(
            `SELECT * FROM agent_states WHERE agent_id = ? AND resumed_at IS NULL ORDER BY suspended_at DESC`,
            parseInt(query.agent_id)
          );
        }
        return db.query<AgentState>(
          `SELECT * FROM agent_states WHERE agent_id = ? ORDER BY suspended_at DESC`,
          parseInt(query.agent_id)
        );
      }
      return db.query<AgentState>(
        `SELECT * FROM agent_states ORDER BY suspended_at DESC`
      );
    },
    {
      query: t.Object({
        agent_id: t.Optional(t.String()),
        suspended_only: t.Optional(t.String()),
      }),
    }
  )
  .get("/:id", ({ db, params }) => {
    const state = db.get<AgentState>(
      `SELECT * FROM agent_states WHERE id = ?`,
      parseInt(params.id)
    );
    if (!state) {
      throw new Error("Agent state not found");
    }
    return state;
  })
  .post(
    "/",
    ({ db, body }) => {
      db.run(
        `INSERT INTO agent_states (agent_id, agent_run_id, contribution_id, prompt_history, browser_context, step, resume_reason) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        body.agent_id,
        body.agent_run_id ?? null,
        body.contribution_id ?? null,
        body.prompt_history ?? null,
        body.browser_context ?? null,
        body.step ?? null,
        body.resume_reason ?? null
      );
      const state = db.get<AgentState>(
        `SELECT * FROM agent_states WHERE id = last_insert_rowid()`
      );
      return state;
    },
    {
      body: t.Object({
        agent_id: t.Number(),
        agent_run_id: t.Optional(t.Number()),
        contribution_id: t.Optional(t.Number()),
        prompt_history: t.Optional(t.String()),
        browser_context: t.Optional(t.String()),
        step: t.Optional(t.String()),
        resume_reason: t.Optional(t.String()),
      }),
    }
  )
  .patch(
    "/:id",
    ({ db, params, body }) => {
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (body.prompt_history !== undefined) {
        updates.push("prompt_history = ?");
        values.push(body.prompt_history);
      }
      if (body.browser_context !== undefined) {
        updates.push("browser_context = ?");
        values.push(body.browser_context);
      }
      if (body.step !== undefined) {
        updates.push("step = ?");
        values.push(body.step);
      }
      if (body.resume_reason !== undefined) {
        updates.push("resume_reason = ?");
        values.push(body.resume_reason);
      }
      if (body.resumed_at !== undefined) {
        updates.push("resumed_at = ?");
        values.push(body.resumed_at);
      }

      if (updates.length === 0) {
        throw new Error("No fields to update");
      }

      values.push(parseInt(params.id));
      db.run(
        `UPDATE agent_states SET ${updates.join(", ")} WHERE id = ?`,
        ...values
      );

      return db.get<AgentState>(
        `SELECT * FROM agent_states WHERE id = ?`,
        parseInt(params.id)
      );
    },
    {
      body: t.Object({
        prompt_history: t.Optional(t.Nullable(t.String())),
        browser_context: t.Optional(t.Nullable(t.String())),
        step: t.Optional(t.Nullable(t.String())),
        resume_reason: t.Optional(t.Nullable(t.String())),
        resumed_at: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  .delete("/:id", ({ db, params }) => {
    db.run(
      `DELETE FROM agent_states WHERE id = ?`,
      parseInt(params.id)
    );
    return { success: true };
  });
