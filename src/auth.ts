/**
 * Bearer-token auth for the MCP transport (chunk 1 child B).
 *
 * Decision 5 of the p2-n002 plan: a bearer token supplied by
 * environment-variable expansion in the client's `.mcp.json`, minted
 * and held by the owner. Server side, the same token is compared
 * against the `MCP_AUTH_TOKEN` environment variable — never a literal
 * in code or in the infrastructure template (see template.yaml, which
 * resolves it from Secrets Manager at deploy time).
 */

import { timingSafeEqual } from "node:crypto";

import type { Context, MiddlewareHandler } from "hono";

export const BEARER_PREFIX = "Bearer ";

/** Constant-time string comparison, so a wrong token cannot be distinguished
 * from a right one by response timing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // timingSafeEqual requires equal-length buffers; unequal lengths
    // are already distinguishable by the attacker (nothing is leaked
    // by short-circuiting here), so this is not a timing regression.
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function unauthorized(c: Context, reason: string) {
  c.header("WWW-Authenticate", 'Bearer realm="project-orchestrator-service"');
  return c.json({ error: "unauthorized", reason }, 401);
}

/**
 * Requires `Authorization: Bearer <token>` matching the
 * `MCP_AUTH_TOKEN` environment variable. A server misconfigured with
 * no token set refuses every call (500, "server not configured")
 * rather than silently accepting all callers.
 */
export function requireBearerToken(
  getExpectedToken: () => string | undefined,
): MiddlewareHandler {
  return async (c, next) => {
    const expected = getExpectedToken();
    if (!expected) {
      return c.json(
        { error: "server_misconfigured", reason: "MCP_AUTH_TOKEN is not set" },
        500,
      );
    }

    const header = c.req.header("Authorization");
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      return unauthorized(c, "missing Authorization: Bearer header");
    }

    const presented = header.slice(BEARER_PREFIX.length);
    if (!safeEqual(presented, expected)) {
      return unauthorized(c, "token did not match");
    }

    await next();
  };
}
