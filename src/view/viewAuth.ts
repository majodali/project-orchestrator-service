/**
 * Sign-in for the web view (node P2-N021; the specification of P2-N003,
 * "Sign-in: the view token and the view cookie", decisions 4 and 13).
 *
 * The view token is a read-only credential held in Secrets Manager
 * apart from the MCP bearer token, and resolved into the `VIEW_TOKEN`
 * environment variable at deploy time. Sign-in exchanges it for the
 * view cookie. The cookie's value carries an expiry and an
 * HMAC-SHA256 signature, checked without a session store. The
 * signature key is derived from the view token by HMAC-SHA256 over a
 * fixed label, so rotating the token signs every device out (decision
 * 13). The cookie lives 30 days.
 */

import { createHmac } from "node:crypto";

import { safeEqual } from "../auth.js";

export const VIEW_COOKIE_NAME = "po_view";
export const VIEW_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
/** The fixed label the cookie key is derived over (decision 13). */
export const VIEW_COOKIE_KEY_LABEL =
  "project-orchestrator-service view cookie key v1";
const COOKIE_VERSION = "v1";

export type ViewTokenConfig =
  { ok: true; viewToken: string } | { ok: false; reason: string };

/**
 * The view refuses to run when its token is unset, or equal to the MCP
 * bearer token: the two credentials must stay separate (V16). The MCP
 * endpoint does not read this, so it keeps answering.
 */
export function loadViewTokenConfig(
  env: NodeJS.ProcessEnv = process.env,
): ViewTokenConfig {
  const viewToken = env.VIEW_TOKEN;
  if (!viewToken) {
    return { ok: false, reason: "VIEW_TOKEN is not set" };
  }
  const mcpToken = env.MCP_AUTH_TOKEN;
  if (mcpToken && safeEqual(viewToken, mcpToken)) {
    return {
      ok: false,
      reason:
        "VIEW_TOKEN equals MCP_AUTH_TOKEN; the view token and the MCP bearer token must differ",
    };
  }
  return { ok: true, viewToken };
}

function cookieKey(viewToken: string): Buffer {
  return createHmac("sha256", viewToken).update(VIEW_COOKIE_KEY_LABEL).digest();
}

function signature(viewToken: string, expiresAt: number): string {
  return createHmac("sha256", cookieKey(viewToken))
    .update(`${COOKIE_VERSION}.${expiresAt}`)
    .digest("base64url");
}

/** The cookie value: version, expiry in Unix seconds, and signature. */
export function signViewCookie(viewToken: string, expiresAt: number): string {
  return `${COOKIE_VERSION}.${expiresAt}.${signature(viewToken, expiresAt)}`;
}

/**
 * True only for a value signed under the current view token whose
 * expiry has not passed and lies no further ahead than one cookie
 * lifetime.
 */
export function verifyViewCookie(
  viewToken: string,
  value: string | undefined,
  nowSeconds: number,
): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [version, expiresText, presented] = parts as [string, string, string];
  if (version !== COOKIE_VERSION || !/^[0-9]{1,12}$/.test(expiresText)) {
    return false;
  }
  const expiresAt = Number.parseInt(expiresText, 10);
  if (expiresAt <= nowSeconds) return false;
  if (expiresAt > nowSeconds + VIEW_COOKIE_MAX_AGE_SECONDS) return false;
  return safeEqual(presented, signature(viewToken, expiresAt));
}

/** The `Set-Cookie` value sign-in sends, with every attribute the
 * specification lists. */
export function viewCookieHeader(
  viewToken: string,
  nowSeconds: number,
): string {
  const expiresAt = nowSeconds + VIEW_COOKIE_MAX_AGE_SECONDS;
  return [
    `${VIEW_COOKIE_NAME}=${signViewCookie(viewToken, expiresAt)}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/view",
    `Max-Age=${VIEW_COOKIE_MAX_AGE_SECONDS}`,
  ].join("; ");
}

/** Constant-time check of a submitted token against the view token. */
export function viewTokenMatches(
  viewToken: string,
  submitted: string,
): boolean {
  return safeEqual(submitted, viewToken);
}
