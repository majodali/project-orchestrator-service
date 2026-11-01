/**
 * The web view's routes on the existing Hono app (node P2-N021, task
 * E1; the specification of P2-N003, "Routes on the existing function",
 * decision 3):
 *
 *   GET  /view/sign-in  the sign-in form
 *   POST /view/sign-in  the exchange of the view token for the view cookie
 *   GET  /view          the tree page
 *
 * Every other `/view` route requires a valid view cookie and refuses a
 * request without one by a `303` to the sign-in page. No `/view` route
 * but `POST /view/sign-in` accepts a method other than `GET` (V17).
 * Every `/view` response carries the security headers of
 * `VIEW_SECURITY_HEADERS` (V11).
 *
 * The view reads the repository through `CommitReader` and nothing
 * else: it imports no lease backend and no AWS SDK client (V6).
 */

import type { Context, Hono, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import { GithubAppAuthError } from "../planRegister/githubAppAuth.js";
import {
  GithubAppNotConfiguredError,
  getDefaultCommitReader,
} from "../planRegister/defaultFetcher.js";
import type { CommitReader } from "../planRegister/registerFetcher.js";
import { GithubFetchError } from "../planRegister/registerFetcher.js";
import { PageReadError, ShaPathCache, readPageFiles } from "./commitRead.js";
import type { ErrorPageCommit } from "./html.js";
import {
  VIEW_SECURITY_HEADERS,
  escapeHtml,
  limitLine,
  pageHeader,
  pageShell,
} from "./html.js";
import { REGISTER_PATH, renderTreePage } from "./treePage.js";
import {
  VIEW_COOKIE_NAME,
  loadViewTokenConfig,
  verifyViewCookie,
  viewCookieHeader,
  viewTokenMatches,
} from "./viewAuth.js";

export interface ViewOptions {
  /** Test-only: the repository reader. Production uses the GitHub App. */
  reader?: CommitReader;
  /** Test-only: the clock. */
  now?: () => Date;
}

const SIGN_IN_PATH = "/view/sign-in";

export function isViewPath(path: string): boolean {
  return path === "/view" || path.startsWith("/view/");
}

function nowSeconds(now: () => Date): number {
  return Math.floor(now().getTime() / 1000);
}

function htmlResponse(
  c: Context,
  html: string,
  status: 200 | 401 | 404 | 405 | 500 | 502,
): Response {
  return c.html(html, status);
}

function simplePage(
  c: Context,
  title: string,
  message: string,
  status: 401 | 404 | 405 | 500,
): Response {
  const body = [
    limitLine(undefined, undefined),
    "<main>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<p class="error">${escapeHtml(message)}</p>`,
    "</main>",
  ].join("\n");
  return htmlResponse(c, pageShell(title, body), status);
}

function signInPage(message: string | undefined): string {
  const body = [
    limitLine(undefined, undefined),
    "<main>",
    "<h1>Sign in to the plan view</h1>",
    message ? `<p class="error">${escapeHtml(message)}</p>` : "",
    `<form method="post" action="${SIGN_IN_PATH}">`,
    '<p><label for="token">View token</label></p>',
    '<p><input id="token" name="token" type="password" autocomplete="current-password" required></p>',
    '<p><button type="submit">Sign in</button></p>',
    "</form>",
    "</main>",
  ].join("\n");
  return pageShell("Sign in", body);
}

/** GitHub's status for a failed read, where the error carries one. */
function githubStatus(err: unknown): number | undefined {
  if (err instanceof GithubFetchError || err instanceof GithubAppAuthError) {
    return err.status;
  }
  return undefined;
}

/**
 * The error page (V3): it names the ref, the failing file and GitHub's
 * status, carries the header (V2) and the limit line (V13), and shows
 * no plan content.
 */
function errorPage(
  c: Context,
  err: unknown,
  requestedRef: string | undefined,
  repo: { owner: string; repo: string },
  now: () => Date,
): Response {
  const failure = err instanceof PageReadError ? err : undefined;
  const underlying = failure ? failure.underlying : err;
  const status = githubStatus(underlying);
  const commit: ErrorPageCommit = {
    owner: repo.owner,
    repo: repo.repo,
    requestedRef,
    resolvedRef: failure?.resolvedRef,
    sha: failure?.sha,
    fetchedAt: now().toISOString(),
  };
  const what =
    failure?.path === undefined
      ? `The ref ${requestedRef === undefined ? "(none requested: the default branch)" : JSON.stringify(requestedRef)} did not resolve to a commit.`
      : `The file ${failure.path} could not be read at ${failure.sha}.`;
  const statusLine =
    status === undefined
      ? `<p>GitHub status: <span data-github-status>none</span> (${escapeHtml(underlying instanceof Error ? underlying.message : String(underlying))})</p>`
      : `<p>GitHub status: <span data-github-status>${status}</span></p>`;
  const body = [
    pageHeader(commit, "/view"),
    limitLine(commit, commit.sha),
    "<main>",
    "<h1>The page could not be read</h1>",
    `<p class="error">${escapeHtml(what)}</p>`,
    failure?.path === undefined
      ? ""
      : `<p>Failing file: <code data-failing-file>${escapeHtml(failure.path)}</code></p>`,
    statusLine,
    "</main>",
  ].join("\n");
  const pageStatus =
    underlying instanceof GithubAppNotConfiguredError
      ? 500
      : status === 404 || status === 422
        ? 404
        : 502;
  return htmlResponse(c, pageShell("Read failed", body), pageStatus);
}

export function registerViewRoutes(app: Hono, options: ViewOptions = {}): void {
  const now = options.now ?? (() => new Date());
  const cache = new ShaPathCache();
  const reader = (): CommitReader => options.reader ?? getDefaultCommitReader();

  // Headers first, so every `/view` response carries them, refusals
  // and errors included (V11).
  const securityHeaders: MiddlewareHandler = async (c, next) => {
    if (!isViewPath(c.req.path)) return next();
    await next();
    for (const [name, value] of Object.entries(VIEW_SECURITY_HEADERS)) {
      c.res.headers.set(name, value);
    }
  };

  // Only GET, and POST on the sign-in path (V17).
  const methodGuard: MiddlewareHandler = async (c, next) => {
    if (!isViewPath(c.req.path)) return next();
    const allowed = c.req.path === SIGN_IN_PATH ? ["GET", "POST"] : ["GET"];
    if (!allowed.includes(c.req.method)) {
      c.header("Allow", allowed.join(", "));
      return simplePage(
        c,
        "Method not allowed",
        `${c.req.method} is not accepted here. The view changes nothing.`,
        405,
      );
    }
    return next();
  };

  // An unset view token, or one equal to the MCP bearer token, stops
  // every `/view` route with a 500 naming the misconfiguration (V16).
  const configGuard: MiddlewareHandler = async (c, next) => {
    if (!isViewPath(c.req.path)) return next();
    const config = loadViewTokenConfig();
    if (!config.ok) {
      return simplePage(
        c,
        "The view is not configured",
        `Server misconfigured: ${config.reason}.`,
        500,
      );
    }
    return next();
  };

  // Every route but sign-in requires a valid view cookie (V15).
  const cookieGuard: MiddlewareHandler = async (c, next) => {
    if (!isViewPath(c.req.path) || c.req.path === SIGN_IN_PATH) {
      return next();
    }
    const config = loadViewTokenConfig();
    const viewToken = config.ok ? config.viewToken : "";
    const value = getCookie(c, VIEW_COOKIE_NAME);
    if (!config.ok || !verifyViewCookie(viewToken, value, nowSeconds(now))) {
      return c.redirect(SIGN_IN_PATH, 303);
    }
    return next();
  };

  app.use("*", securityHeaders);
  app.use("*", methodGuard);
  app.use("*", configGuard);
  app.use("*", cookieGuard);

  app.get(SIGN_IN_PATH, (c) => htmlResponse(c, signInPage(undefined), 200));

  app.post(SIGN_IN_PATH, async (c) => {
    const config = loadViewTokenConfig();
    if (!config.ok) {
      return simplePage(c, "The view is not configured", config.reason, 500);
    }
    let submitted: string;
    try {
      const form = await c.req.parseBody();
      const token = form.token;
      submitted = typeof token === "string" ? token : "";
    } catch {
      // A body that does not parse carries no token.
      submitted = "";
    }
    if (!submitted || !viewTokenMatches(config.viewToken, submitted)) {
      return htmlResponse(
        c,
        signInPage("That token did not match. No cookie was set."),
        401,
      );
    }
    c.header("Set-Cookie", viewCookieHeader(config.viewToken, nowSeconds(now)));
    return c.redirect("/view", 303);
  });

  app.get("/view", async (c) => {
    // An empty `ref` names no ref, the same as an absent one.
    const requestedRef = c.req.query("ref") || undefined;
    let source: CommitReader;
    try {
      source = reader();
    } catch (err) {
      return errorPage(
        c,
        err,
        requestedRef,
        { owner: "(not configured)", repo: "(not configured)" },
        now,
      );
    }
    try {
      const page = await readPageFiles(
        source,
        cache,
        requestedRef,
        [REGISTER_PATH],
        now,
      );
      const html = renderTreePage(page.files.get(REGISTER_PATH)!, {
        owner: source.owner,
        repo: source.repo,
        requestedRef,
        resolvedRef: page.resolvedRef,
        sha: page.sha,
        fetchedAt: page.fetchedAt,
      });
      return htmlResponse(c, html, 200);
    } catch (err) {
      return errorPage(c, err, requestedRef, source, now);
    }
  });

  // The node and task pages arrive with task E2. Until then a signed-in
  // request for any other `/view` path answers this page.
  app.get("/view/*", (c) =>
    simplePage(
      c,
      "No page here yet",
      "This view page does not exist in this version of the service.",
      404,
    ),
  );
}
