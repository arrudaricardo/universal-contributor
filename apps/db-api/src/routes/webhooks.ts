import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-plugin";

export interface Webhook {
  id: number;
  contribution_id: number | null;
  event_type: string;
  payload: string;
  action: string | null;
  comment_body: string | null;
  check_status: string | null;
  processed: number;
  processed_at: string | null;
  received_at: string;
}

export const webhooksRoutes = new Elysia({ prefix: "/webhooks" })
  .use(dbPlugin)
  .get(
    "/",
    ({ db, query }) => {
      if (query.contribution_id) {
        return db.query<Webhook>(
          `SELECT * FROM webhooks WHERE contribution_id = ? ORDER BY received_at DESC`,
          parseInt(query.contribution_id)
        );
      }
      if (query.unprocessed === "true") {
        return db.query<Webhook>(
          `SELECT * FROM webhooks WHERE processed = 0 ORDER BY received_at ASC`
        );
      }
      return db.query<Webhook>(
        `SELECT * FROM webhooks ORDER BY received_at DESC`
      );
    },
    {
      query: t.Object({
        contribution_id: t.Optional(t.String()),
        unprocessed: t.Optional(t.String()),
      }),
    }
  )
  .get("/:id", ({ db, params }) => {
    const webhook = db.get<Webhook>(
      `SELECT * FROM webhooks WHERE id = ?`,
      parseInt(params.id)
    );
    if (!webhook) {
      throw new Error("Webhook not found");
    }
    return webhook;
  })
  .post(
    "/",
    ({ db, body }) => {
      db.run(
        `INSERT INTO webhooks (contribution_id, event_type, payload, action, comment_body, check_status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        body.contribution_id ?? null,
        body.event_type,
        body.payload,
        body.action ?? null,
        body.comment_body ?? null,
        body.check_status ?? null
      );
      const webhook = db.get<Webhook>(
        `SELECT * FROM webhooks WHERE id = last_insert_rowid()`
      );
      return webhook;
    },
    {
      body: t.Object({
        contribution_id: t.Optional(t.Number()),
        event_type: t.String(),
        payload: t.String(),
        action: t.Optional(t.String()),
        comment_body: t.Optional(t.String()),
        check_status: t.Optional(t.String()),
      }),
    }
  )
  .patch(
    "/:id",
    ({ db, params, body }) => {
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (body.processed !== undefined) {
        updates.push("processed = ?");
        values.push(body.processed ? 1 : 0);
      }
      if (body.processed_at !== undefined) {
        updates.push("processed_at = ?");
        values.push(body.processed_at);
      }
      if (body.check_status !== undefined) {
        updates.push("check_status = ?");
        values.push(body.check_status);
      }

      if (updates.length === 0) {
        throw new Error("No fields to update");
      }

      values.push(parseInt(params.id));
      db.run(
        `UPDATE webhooks SET ${updates.join(", ")} WHERE id = ?`,
        ...values
      );

      return db.get<Webhook>(
        `SELECT * FROM webhooks WHERE id = ?`,
        parseInt(params.id)
      );
    },
    {
      body: t.Object({
        processed: t.Optional(t.Boolean()),
        processed_at: t.Optional(t.Nullable(t.String())),
        check_status: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  .delete("/:id", ({ db, params }) => {
    db.run(
      `DELETE FROM webhooks WHERE id = ?`,
      parseInt(params.id)
    );
    return { success: true };
  })
  .post("/:id/process", ({ db, params }) => {
    db.run(
      `UPDATE webhooks SET processed = 1, processed_at = datetime('now') WHERE id = ?`,
      parseInt(params.id)
    );
    return db.get<Webhook>(
      `SELECT * FROM webhooks WHERE id = ?`,
      parseInt(params.id)
    );
  });
