/**
 * The HTTP surface. One Hono app, shared byte-for-byte between the
 * local dev server (src/localServer.ts) and the Lambda handler
 * (src/lambda.ts), so what is verified locally is what is deployed.
 *
 * Routes:
 *   GET  /health  — unauthenticated liveness check (no MCP framing).
 *   ALL  /mcp/:owner/:repo, ALL /mcp
 *                   — the MCP endpoint, bearer-token authenticated.
 *                   `/mcp/<owner>/<repo>` names the project the call
 *                   is for, resolved against the deployment's project
 *                   list (MCP_PROJECTS / MCP_PROJECT, src/projects.ts)
 *                   before any tool runs; a path outside the list is
 *                   refused and nothing is read (P2-N054, design 1).
 *                   The bare `/mcp` serves the list's first project,
 *                   so every repository enlisted against it keeps
 *                   working until P2-N059 retires the bare path.
 *                   Stateless streamable HTTP: a fresh McpServer and
 *                   transport per request (no session store), and
 *                   `enableJsonResponse: true` so every response is a
 *                   single JSON body rather than an SSE stream — the
 *                   shape a buffered Lambda-proxy response can carry.
 *                   The tools read and write orchestration/state.json
 *                   of the resolved project's repository through the
 *                   GitHub App (src/stateTools.ts).
 *   GET  /view/sign-in, POST /view/sign-in, GET /view, GET /view/node/*,
 *   GET  /view/task/*
 *                 — the web view: server-rendered pages of the state
 *                   file at one commit, behind the view cookie, never
 *                   the MCP bearer token. See src/view/routes.ts.
 *   GET  /view/app.js, GET /view/version
 *                 — the view's one first-party script, and the route
 *                   it polls for a newer commit (src/view/appScript.ts).
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
import { findProject, loadProjectList } from "./projects.js";
import type { Project } from "./projects.js";
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

  /** Resolves the project a `/mcp` call is for: by path params, or —
   * for the bare `/mcp` — the deployment's list's first project
   * (P2-N054, criterion 5). Returns the response to send instead when
   * the deployment's project list is misconfigured (RU-013) or the
   * named path is outside it; neither names a token or another
   * project (criterion 3). */
  function resolveProject(
    c: Context,
    params: { owner: string; repo: string } | undefined,
  ): Project | Response {
    const list = loadProjectList(process.env);
    if (!list.ok) {
      return c.json(
        {
          error: "server_misconfigured",
          reason: `the deployment's project list is misconfigured: ${list.missing.join("; ")}`,
        },
        500,
      );
    }
    if (!params) {
      return list.projects[0]!;
    }
    const project = findProject(list.projects, params.owner, params.repo);
    if (!project) {
      return c.json(
        {
          error: "not_found",
          reason: `${params.owner}/${params.repo} is not a project this deployment serves`,
        },
        404,
      );
    }
    return project;
  }

  async function handleMcp(
    c: Context,
    params: { owner: string; repo: string } | undefined,
  ): Promise<Response> {
    const resolved = resolveProject(c, params);
    if (resolved instanceof Response) return resolved;

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: no session store
      enableJsonResponse: true, // single JSON response, not SSE
    });
    const server = createMcpServer({
      state: options.state,
      lambdaQualifier: invokedQualifier(c),
      project: resolved,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await transport.close();
      await server.close();
    }
  }

  const authenticated = requireBearerToken(() => process.env.MCP_AUTH_TOKEN);

  app.all("/mcp/:owner/:repo", authenticated, (c) =>
    handleMcp(c, { owner: c.req.param("owner"), repo: c.req.param("repo") }),
  );

  app.all("/mcp", authenticated, (c) => handleMcp(c, undefined));

  registerViewRoutes(app, options.view);

  return app;
}
