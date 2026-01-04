import { Elysia, t } from "elysia";
import { createHmac, timingSafeEqual } from "crypto";
import { dbPlugin } from "../db-plugin";

// GitHub webhook payload types
interface GitHubPullRequest {
  number: number;
  html_url: string;
  merged: boolean;
  state: string;
}

interface GitHubPullRequestPayload {
  action: string;
  pull_request: GitHubPullRequest;
  repository: {
    full_name: string;
  };
}

interface Contribution {
  id: number;
  issue_id: number;
  pr_url: string | null;
  pr_number: number | null;
  status: string;
}

// Verify GitHub webhook signature
function verifyGitHubSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  try {
    const expected =
      "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

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
  })
  .post(
    "/github",
    async ({ db, request, set }) => {
      const secret = process.env.GITHUB_WEBHOOK_SECRET;
      if (!secret) {
        console.error("[Webhook] GITHUB_WEBHOOK_SECRET not configured");
        set.status = 500;
        return { error: "Webhook secret not configured" };
      }

      // Get raw body for signature verification
      const rawBody = await request.text();

      // Verify signature
      const signature = request.headers.get("x-hub-signature-256");
      if (!verifyGitHubSignature(rawBody, signature ?? undefined, secret)) {
        console.error("[Webhook] Invalid signature");
        set.status = 401;
        return { error: "Invalid signature" };
      }

      // Parse payload
      let payload: GitHubPullRequestPayload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        console.error("[Webhook] Invalid JSON payload");
        set.status = 400;
        return { error: "Invalid JSON payload" };
      }

      // Get event type
      const eventType = request.headers.get("x-github-event");
      console.log(`[Webhook] Received ${eventType} event, action: ${payload.action}`);

      // Store webhook for auditing
      db.run(
        `INSERT INTO webhooks (event_type, payload, action) VALUES (?, ?, ?)`,
        eventType,
        rawBody,
        payload.action ?? null
      );

      // Handle pull_request events
      if (eventType === "pull_request") {
        const prNumber = payload.pull_request.number;
        const prUrl = payload.pull_request.html_url;
        const action = payload.action;
        const merged = payload.pull_request.merged;

        console.log(`[Webhook] PR #${prNumber} - action: ${action}, merged: ${merged}`);

        // Find contribution by PR URL or PR number
        const contribution = db.get<Contribution>(
          `SELECT * FROM contributions WHERE pr_url = ? OR pr_number = ?`,
          prUrl,
          prNumber
        );

        if (contribution) {
          console.log(`[Webhook] Found contribution ${contribution.id} for PR #${prNumber}`);

          if (action === "closed" && merged) {
            // PR was merged - update issue status to 'fixed' and contribution status to 'merged'
            db.run(
              `UPDATE issues SET status = 'fixed' WHERE id = ?`,
              contribution.issue_id
            );
            db.run(
              `UPDATE contributions SET status = 'merged', updated_at = datetime('now') WHERE id = ?`,
              contribution.id
            );
            console.log(`[Webhook] Issue ${contribution.issue_id} marked as fixed (PR merged)`);
          } else if (action === "closed" && !merged) {
            // PR was closed without merging
            db.run(
              `UPDATE contributions SET status = 'closed', updated_at = datetime('now') WHERE id = ?`,
              contribution.id
            );
            console.log(`[Webhook] Contribution ${contribution.id} marked as closed (PR closed without merge)`);
          }
        } else {
          console.log(`[Webhook] No contribution found for PR #${prNumber} (${prUrl})`);
        }
      }

      return { received: true };
    }
  );
