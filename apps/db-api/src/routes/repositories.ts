import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-plugin";

export interface Repository {
  id: number;
  full_name: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  source: string;
  trending_rank: number | null;
  discovered_at: string;
  last_checked_at: string | null;
  fork_full_name: string | null;
  fork_url: string | null;
}

export const repositoriesRoutes = new Elysia({ prefix: "/repositories" })
  .use(dbPlugin)
  .get(
    "/",
    ({ db, query }) => {
      if (query.full_name) {
        const repo = db.get<Repository>(
          `SELECT * FROM repositories WHERE full_name = ?`,
          query.full_name
        );
        return repo ? [repo] : [];
      }
      return db.query<Repository>(
        `SELECT * FROM repositories ORDER BY discovered_at DESC`
      );
    },
    {
      query: t.Object({
        full_name: t.Optional(t.String()),
      }),
    }
  )
  .get("/:id", ({ db, params }) => {
    const repo = db.get<Repository>(
      `SELECT * FROM repositories WHERE id = ?`,
      parseInt(params.id)
    );
    if (!repo) {
      throw new Error("Repository not found");
    }
    return repo;
  })
  .post(
    "/",
    ({ db, body }) => {
      db.run(
        `INSERT INTO repositories (full_name, url, description, stars, forks, language, source, trending_rank) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        body.full_name,
        body.url,
        body.description ?? null,
        body.stars ?? 0,
        body.forks ?? 0,
        body.language ?? null,
        body.source,
        body.trending_rank ?? null
      );
      const repo = db.get<Repository>(
        `SELECT * FROM repositories WHERE full_name = ?`,
        body.full_name
      );
      return repo;
    },
    {
      body: t.Object({
        full_name: t.String(),
        url: t.String(),
        description: t.Optional(t.String()),
        stars: t.Optional(t.Number()),
        forks: t.Optional(t.Number()),
        language: t.Optional(t.String()),
        source: t.String(),
        trending_rank: t.Optional(t.Number()),
      }),
    }
  )
  .patch(
    "/:id",
    ({ db, params, body }) => {
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (body.description !== undefined) {
        updates.push("description = ?");
        values.push(body.description);
      }
      if (body.stars !== undefined) {
        updates.push("stars = ?");
        values.push(body.stars);
      }
      if (body.forks !== undefined) {
        updates.push("forks = ?");
        values.push(body.forks);
      }
      if (body.language !== undefined) {
        updates.push("language = ?");
        values.push(body.language);
      }
      if (body.last_checked_at !== undefined) {
        updates.push("last_checked_at = ?");
        values.push(body.last_checked_at);
      }

      if (updates.length === 0) {
        throw new Error("No fields to update");
      }

      values.push(parseInt(params.id));
      db.run(
        `UPDATE repositories SET ${updates.join(", ")} WHERE id = ?`,
        ...values
      );

      return db.get<Repository>(
        `SELECT * FROM repositories WHERE id = ?`,
        parseInt(params.id)
      );
    },
    {
      body: t.Object({
        description: t.Optional(t.String()),
        stars: t.Optional(t.Number()),
        forks: t.Optional(t.Number()),
        language: t.Optional(t.String()),
        last_checked_at: t.Optional(t.String()),
      }),
    }
  )
  .delete("/:id", ({ db, params }) => {
    db.run(
      `DELETE FROM repositories WHERE id = ?`,
      parseInt(params.id)
    );
    return { success: true };
  });
