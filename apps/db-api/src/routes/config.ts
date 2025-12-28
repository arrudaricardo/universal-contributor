import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-plugin";

export interface Config {
  key: string;
  value: string;
}

export const configRoutes = new Elysia({ prefix: "/config" })
  .use(dbPlugin)
  .get("/", ({ db }) => {
    return db.query<Config>(`SELECT * FROM config ORDER BY key`);
  })
  .get("/:key", ({ db, params }) => {
    const config = db.get<Config>(
      `SELECT * FROM config WHERE key = ?`,
      params.key
    );
    if (!config) {
      throw new Error("Config key not found");
    }
    return config;
  })
  .put(
    "/:key",
    ({ db, params, body }) => {
      db.run(
        `INSERT INTO config (key, value) VALUES (?, ?) 
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        params.key,
        body.value
      );
      return db.get<Config>(
        `SELECT * FROM config WHERE key = ?`,
        params.key
      );
    },
    {
      body: t.Object({
        value: t.String(),
      }),
    }
  )
  .delete("/:key", ({ db, params }) => {
    db.run(`DELETE FROM config WHERE key = ?`, params.key);
    return { success: true };
  });
