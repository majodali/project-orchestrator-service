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
import type { Context } from "hono";
import { cors } from "hono/cors";
import type { LambdaContext } from "hono/aws-lambda";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { requireBearerToken } from "./auth.js";
import { createMcpServer } from "./mcpServer.js";
import type { CreateMcpServerOptions } from "./mcpServer.js";
import { getServiceIdentity } from "./serviceInfo.js";
import {
  parseInvokedQualifier,
  resolveAliasLeaseTable,
} from "./planRegister/aliasLeaseTable.js";
import { LazyAliasLeaseBackend } from "./planRegister/defaultLeaseBackend.js";
import type { LeaseBackend } from "./planRegister/leaseBackend.js";

export interface CreateAppOptions {
  /** Forwarded to createMcpServer — test-only, see src/mcpServer.ts. */
  planRegisterFetcher?: CreateMcpServerOptions["planRegisterFetcher"];
  /**
   * Forwarded to createMcpServer — test-only (used when this request
   * carries no Lambda context; see resolveLambdaAliasContext below,
   * which takes over entirely under real Lambda invocation, node
   * P2-N015, I7).
   */
  planLeaseBackend?: CreateMcpServerOptions["planLeaseBackend"];
}

/** The shape `hono/aws-lambda`'s `handle()` puts on `c.env` — see
 * node_modules/hono/dist/adapter/aws-lambda/handler.js and child A's
 * finding (docs/findings/alias-assumptions.md, assumption 2). Neither
 * the local dev server (src/localServer.ts) nor `app.request()` calls
 * with no third `env` argument (every test in this repository) ever
 * populate this — `c.env` is `{}` for both. */
interface LambdaEnvBindings {
  lambdaContext?: LambdaContext;
}

interface LambdaAliasContext {
  qualifier: string;
  /** `null` when the qualifier was refused (fail-closed). */
  leaseTable: string | null;
  leaseBackend: LeaseBackend;
}

/**
 * Reads the invoked Lambda qualifier from `c.env.lambdaContext.invokedFunctionArn`
 * (present only under a real `hono/aws-lambda` invocation — src/lambda.ts)
 * and resolves it to a lease table, failing closed. Returns `undefined`
 * — not a default — when there is no Lambda context at all, which is
 * exactly what scopes the fail-closed rule to Lambda (I7): the local
 * dev server and every test in this repository call `createApp()`
 * directly or use `app.request()` with no `env` argument, so this
 * always returns `undefined` for them and `options.planLeaseBackend` /
 * `LEASE_TABLE_NAME` keep resolving the table exactly as before.
 */
function resolveLambdaAliasContext(c: Context): LambdaAliasContext | undefined {
  const invokedFunctionArn = (c.env as LambdaEnvBindings | undefined)
    ?.lambdaContext?.invokedFunctionArn;
  if (!invokedFunctionArn) {
    return undefined;
  }
  // One lazy backend regardless of outcome (success or refusal) — it
  // re-resolves on first actual use and throws the same fail-closed
  // error every write tool would hit, so there is exactly one place
  // the qualifier-to-table decision is made (aliasLeaseTable.ts), not
  // two copies that could disagree.
  const leaseBackend = new LazyAliasLeaseBackend(invokedFunctionArn);
  try {
    const resolved = resolveAliasLeaseTable(invokedFunctionArn);
    return {
      qualifier: resolved.qualifier,
      leaseTable: resolved.tableName,
      leaseBackend,
    };
  } catch {
    const qualifier = parseInvokedQualifier(invokedFunctionArn) ?? "$LATEST";
    return { qualifier, leaseTable: null, leaseBackend };
  }
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
      const aliasContext = resolveLambdaAliasContext(c);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: no session store
        enableJsonResponse: true, // single JSON response, not SSE
      });
      const server = createMcpServer({
        planRegisterFetcher: options.planRegisterFetcher,
        // Under real Lambda invocation, the alias-aware backend always
        // wins — never falls back to options.planLeaseBackend, so a
        // fail-closed refusal can never be masked by a test/dev
        // override that happens to also be set (I3).
        planLeaseBackend:
          aliasContext?.leaseBackend ?? options.planLeaseBackend,
        lambdaAliasInfo: aliasContext
          ? {
              qualifier: aliasContext.qualifier,
              leaseTable: aliasContext.leaseTable,
            }
          : undefined,
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
