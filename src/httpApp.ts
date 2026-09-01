/**
 * The HTTP surface — chunk 1 child B, node P2-N008. One Hono app,
 * shared byte-for-byte between the local dev server (src/localServer.ts)
 * and the Lambda handler (src/lambda.ts), so what is verified locally
 * is what is deployed (no separate code path to drift).
 *
 * Routes:
 *   GET  /health  — unauthenticated liveness check (no MCP framing;
 *                   for isolating "is anything listening" from "is
 *                   MCP answering" while working through the runbook).
 *   ALL  /mcp     — the MCP endpoint, bearer-token authenticated.
 *                   Stateless streamable HTTP: a fresh McpServer and
 *                   transport per request (no session store), and
 *                   `enableJsonResponse: true` so every response is a
 *                   single JSON body rather than an SSE stream — the
 *                   shape a buffered Lambda-proxy response can carry.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { requireBearerToken } from "./auth.js";
import { createMcpServer } from "./mcpServer.js";
import type { CreateMcpServerOptions } from "./mcpServer.js";
import { getServiceIdentity } from "./serviceInfo.js";

export interface CreateAppOptions {
  /** Forwarded to createMcpServer — test-only, see src/mcpServer.ts. */
  planRegisterFetcher?: CreateMcpServerOptions["planRegisterFetcher"];
  /** Forwarded to createMcpServer — test-only, see src/mcpServer.ts. */
  planLeaseBackend?: CreateMcpServerOptions["planLeaseBackend"];
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "mcp-session-id",
        "mcp-protocol-version",
      ],
      exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
    }),
  );

  app.get("/health", (c) => {
    const identity = getServiceIdentity();
    return c.json({
      status: "ok",
      service: identity.service,
      version: identity.version,
    });
  });

  app.all(
    "/mcp",
    requireBearerToken(() => process.env.MCP_AUTH_TOKEN),
    async (c) => {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: no session store
        enableJsonResponse: true, // single JSON response, not SSE
      });
      const server = createMcpServer({
        planRegisterFetcher: options.planRegisterFetcher,
        planLeaseBackend: options.planLeaseBackend,
      });
      await server.connect(transport);
      try {
        return await transport.handleRequest(c.req.raw);
      } finally {
        await transport.close();
        await server.close();
      }
    },
  );

  return app;
}
