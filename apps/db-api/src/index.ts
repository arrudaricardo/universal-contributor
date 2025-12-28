import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { Database } from "../../../packages/shared/src/db";
import { repositoriesRoutes } from "./routes/repositories";
import { issuesRoutes } from "./routes/issues";
import { agentsRoutes } from "./routes/agents";
import { agentRunsRoutes } from "./routes/agent-runs";
import { agentStatesRoutes } from "./routes/agent-states";
import { contributionsRoutes } from "./routes/contributions";
import { workspacesRoutes } from "./routes/workspaces";
import { webhooksRoutes } from "./routes/webhooks";
import { configRoutes } from "./routes/config";

// Initialize database
const db = new Database("./data/db.sqlite");
db.init();

const app = new Elysia()
  .use(cors())
  .decorate("db", db)
  .use(repositoriesRoutes)
  .use(issuesRoutes)
  .use(agentsRoutes)
  .use(agentRunsRoutes)
  .use(agentStatesRoutes)
  .use(contributionsRoutes)
  .use(workspacesRoutes)
  .use(webhooksRoutes)
  .use(configRoutes)
  .get("/health", () => ({ status: "ok" }))
  .listen(3002);

console.log(`🦊 DB API running at http://localhost:${app.server?.port}`);

export type App = typeof app;
