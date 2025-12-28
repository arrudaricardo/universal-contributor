import { Elysia, t } from "elysia";

const OPENCODE_BASE_URL =
  process.env.OPENCODE_URL ?? "http://127.0.0.1:4096";

// Types based on OpenCode server API
export interface OpenCodeHealth {
  healthy: boolean;
  version: string;
}

export interface OpenCodeSession {
  id: string;
  title?: string;
  parentID?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenCodeMessage {
  info: {
    id: string;
    sessionID: string;
    role: string;
    createdAt: string;
  };
  parts: Array<{
    type: string;
    content?: string;
    [key: string]: unknown;
  }>;
}

export interface OpenCodeProject {
  id: string;
  path: string;
  name: string;
}

export interface OpenCodeAgent {
  id: string;
  name: string;
  description?: string;
}

async function opencodeFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${OPENCODE_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenCode API error: ${response.status} - ${error}`);
  }

  return response.json();
}

export const opencodeRoutes = new Elysia({ prefix: "/opencode" })
  // Health check - verify OpenCode server is running
  .get("/health", async () => {
    try {
      const health = await opencodeFetch<OpenCodeHealth>("/global/health");
      return {
        connected: true,
        ...health,
      };
    } catch (error) {
      return {
        connected: false,
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  })

  // Get current project
  .get("/project", async () => {
    return opencodeFetch<OpenCodeProject>("/project/current");
  })

  // List all projects
  .get("/projects", async () => {
    return opencodeFetch<OpenCodeProject[]>("/project");
  })

  // Get config
  .get("/config", async () => {
    return opencodeFetch("/config");
  })

  // List available agents
  .get("/agents", async () => {
    return opencodeFetch<OpenCodeAgent[]>("/agent");
  })

  // Session management
  .get("/sessions", async () => {
    return opencodeFetch<OpenCodeSession[]>("/session");
  })

  .get("/sessions/:id", async ({ params }) => {
    return opencodeFetch<OpenCodeSession>(`/session/${params.id}`);
  })

  .post(
    "/sessions",
    async ({ body }) => {
      return opencodeFetch<OpenCodeSession>("/session", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    {
      body: t.Object({
        parentID: t.Optional(t.String()),
        title: t.Optional(t.String()),
      }),
    }
  )

  .delete("/sessions/:id", async ({ params }) => {
    return opencodeFetch<boolean>(`/session/${params.id}`, {
      method: "DELETE",
    });
  })

  // Get session status for all sessions
  .get("/sessions/status", async () => {
    return opencodeFetch("/session/status");
  })

  // Abort a running session
  .post("/sessions/:id/abort", async ({ params }) => {
    return opencodeFetch<boolean>(`/session/${params.id}/abort`, {
      method: "POST",
    });
  })

  // Messages
  .get(
    "/sessions/:id/messages",
    async ({ params, query }) => {
      const limitParam = query.limit ? `?limit=${query.limit}` : "";
      return opencodeFetch<OpenCodeMessage[]>(
        `/session/${params.id}/message${limitParam}`
      );
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
      }),
    }
  )

  .post(
    "/sessions/:id/messages",
    async ({ params, body }) => {
      return opencodeFetch<OpenCodeMessage>(`/session/${params.id}/message`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    {
      body: t.Object({
        parts: t.Array(
          t.Object({
            type: t.String(),
            content: t.Optional(t.String()),
          })
        ),
        model: t.Optional(t.String()),
        agent: t.Optional(t.String()),
        messageID: t.Optional(t.String()),
        noReply: t.Optional(t.Boolean()),
        system: t.Optional(t.String()),
        tools: t.Optional(t.Array(t.String())),
      }),
    }
  )

  // Async prompt (non-blocking)
  .post(
    "/sessions/:id/prompt",
    async ({ params, body }) => {
      await fetch(`${OPENCODE_BASE_URL}/session/${params.id}/prompt_async`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { success: true };
    },
    {
      body: t.Object({
        parts: t.Array(
          t.Object({
            type: t.String(),
            content: t.Optional(t.String()),
          })
        ),
        model: t.Optional(t.String()),
        agent: t.Optional(t.String()),
      }),
    }
  )

  // Execute slash command
  .post(
    "/sessions/:id/command",
    async ({ params, body }) => {
      return opencodeFetch(`/session/${params.id}/command`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    {
      body: t.Object({
        command: t.String(),
        arguments: t.Optional(t.Record(t.String(), t.Unknown())),
        messageID: t.Optional(t.String()),
        agent: t.Optional(t.String()),
        model: t.Optional(t.String()),
      }),
    }
  )

  // Run shell command
  .post(
    "/sessions/:id/shell",
    async ({ params, body }) => {
      return opencodeFetch(`/session/${params.id}/shell`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    {
      body: t.Object({
        command: t.String(),
        agent: t.String(),
        model: t.Optional(t.String()),
      }),
    }
  )

  // Get session diff
  .get(
    "/sessions/:id/diff",
    async ({ params, query }) => {
      const messageParam = query.messageID
        ? `?messageID=${query.messageID}`
        : "";
      return opencodeFetch(`/session/${params.id}/diff${messageParam}`);
    },
    {
      query: t.Object({
        messageID: t.Optional(t.String()),
      }),
    }
  )

  // Get todo list for session
  .get("/sessions/:id/todo", async ({ params }) => {
    return opencodeFetch(`/session/${params.id}/todo`);
  })

  // File operations
  .get(
    "/files",
    async ({ query }) => {
      const pathParam = query.path ? `?path=${encodeURIComponent(query.path)}` : "";
      return opencodeFetch(`/file${pathParam}`);
    },
    {
      query: t.Object({
        path: t.Optional(t.String()),
      }),
    }
  )

  .get(
    "/files/content",
    async ({ query }) => {
      return opencodeFetch(
        `/file/content?path=${encodeURIComponent(query.path)}`
      );
    },
    {
      query: t.Object({
        path: t.String(),
      }),
    }
  )

  .get("/files/status", async () => {
    return opencodeFetch("/file/status");
  })

  // Search operations
  .get(
    "/find",
    async ({ query }) => {
      return opencodeFetch(
        `/find?pattern=${encodeURIComponent(query.pattern)}`
      );
    },
    {
      query: t.Object({
        pattern: t.String(),
      }),
    }
  )

  .get(
    "/find/file",
    async ({ query }) => {
      return opencodeFetch(`/find/file?query=${encodeURIComponent(query.query)}`);
    },
    {
      query: t.Object({
        query: t.String(),
      }),
    }
  )

  .get(
    "/find/symbol",
    async ({ query }) => {
      return opencodeFetch(
        `/find/symbol?query=${encodeURIComponent(query.query)}`
      );
    },
    {
      query: t.Object({
        query: t.String(),
      }),
    }
  )

  // Provider info
  .get("/providers", async () => {
    return opencodeFetch("/provider");
  })

  // Commands
  .get("/commands", async () => {
    return opencodeFetch("/command");
  })

  // MCP servers
  .get("/mcp", async () => {
    return opencodeFetch("/mcp");
  })

  // LSP status
  .get("/lsp", async () => {
    return opencodeFetch("/lsp");
  })

  // VCS info
  .get("/vcs", async () => {
    return opencodeFetch("/vcs");
  });
