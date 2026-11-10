/**
 * The HTTP surface. One Hono app, shared byte-for-byte between the
 * local dev server (src/localServer.ts) and the Lambda handler
 * (src/lambda.ts), so what is verified locally is what is deployed.
 *
 * Routes:
 *   GET  /health  — unauthenticated liveness check (no MCP framing).
 *   ALL  /mcp     — the MCP endpoint, bearer-token authenticated.
 *                   Stateless streamable HTTP: a fresh McpServer and
 *                   transport per request (no session store), and
 *                   `enableJsonResponse: true` so every response is a
 *                   single JSON body rather than an SSE stream — the
 *                   shape a buffered Lambda-proxy response can carry.
 *                   The tools read and write orchestration/state.json
 *                   of the coordinating repository through the GitHub
 *                   App (src/stateTools.ts).
 *   GET  /view/sign-in, POST /view/sign-in, GET /view, GET /view/node/*,
 *   GET  /view/task/*
 *                 — the web view: server-rendered pages of the state
 *                   file at one commit, behind the view cookie, never
 *                   the MCP bearer token. See src/view/routes.ts.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import type { LambdaContext } from "hono/aws-lambda";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { requireBearerToken } from "./auth.js";
import { parseInvokedQualifier } from "./lambdaQualifier.js";
import { createMcpServer } from "./mcpServer.js";
import type { CreateMcpServerOptions } from "./mcpServer.js";
import { getServiceIdentity } from "./serviceInfo.js";
import type { InvokedQualifierInfo } from "./serviceInfo.js";
import { isViewPath, registerViewRoutes } from "./view/routes.js";
import type { ViewOptions } from "./view/routes.js";

export interface CreateAppOptions {
  /** Test-only: the state tools' store and clock (src/stateTools.ts). */
  state?: CreateMcpServerOptions["state"];
  /** Test-only: the web view's reader and clock (src/view/routes.ts). */
  view?: ViewOptions;
}

/** The shape `hono/aws-lambda`'s `handle()` puts on `c.env`. Neither
 * the local dev server nor `app.request()` calls with no third `env`
 * argument ever populate this: `c.env` is `{}` for both. */
interface LambdaEnvBindings {
  lambdaContext?: LambdaContext;
}

/** The invoked Lambda qualifier, for `service_identity`; undefined
 * when there is no Lambda context at all. */
function invokedQualifier(c: Context): InvokedQualifierInfo | undefined {
  const invokedFunctionArn = (c.env as LambdaEnvBindings | undefined)
    ?.lambdaContext?.invokedFunctionArn;
  if (!invokedFunctionArn) return undefined;
  return { qualifier: parseInvokedQualifier(invokedFunctionArn) ?? "$LATEST" };
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const app = new Hono();

  const corsMiddleware = cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "mcp-session-id",
      "mcp-protocol-version",
    ],
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
  });
  // The web view is same-origin pages, not a cross-origin API: it gets
  // no CORS headers.
  app.use("*", (c, next) =>
    isViewPath(c.req.path) ? next() : corsMiddleware(c, next),
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
        state: options.state,
        lambdaQualifier: invokedQualifier(c),
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

  registerViewRoutes(app, options.view);

  return app;
}
