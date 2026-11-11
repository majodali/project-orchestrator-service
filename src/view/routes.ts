/**
 * The web view's routes on the existing Hono app (node P2-N021, task
 * E1; the specification of P2-N003, "Routes on the existing function",
 * decision 3):
 *
 *   GET  /view/sign-in  the sign-in form
 *   POST /view/sign-in  the exchange of the view token for the view cookie
 *   GET  /view          the tree page over the state file
 *   GET  /view/node/<node ID>  a node page
 *   GET  /view/task/<task ID>  a task page
 *   POST /view/decision/<decision ID>/close  the owner's answer to an
 *        open decision, committed through the store (milestone 4)
 *   POST /view/node/<node ID>/action  one lifecycle action on a node
 *        (approve its start, lift its hold, accept its review),
 *        committed through the store (milestone 4)
 *
 * Since the rebuild's milestone 2 every page reads one file,
 * `orchestration/state.json`, at the page's commit (./stateRead.ts).
 * A write goes through the same store as the MCP tools
 * (src/model/store.ts): checked, rendered, one commit on the default
 * branch, one journal event; nothing is held outside git. After a
 * write the browser is sent back to the page, which names the commit.
 *
 * Every other `/view` route requires a valid view cookie and refuses a
 * request without one by a `303` to the sign-in page. Only the sign-in
 * and the two write routes accept `POST`; nothing accepts any other
 * method (V17). A `POST` the browser marks as cross-site
 * (`Sec-Fetch-Site`), or whose `Origin` names another host, is refused
 * (403); the pages' `Referrer-Policy: no-referrer` makes browsers send
 * `Origin: null` on their own form posts, so a null origin decides
 * nothing. The cookie's `SameSite=Strict` is the defence beneath both:
 * a cross-site request carries no cookie and is sent to sign in. Every
 * `/view` response carries the security headers of
 * `VIEW_SECURITY_HEADERS` (V11).
 *
 * The view reads the repository through `CommitReader` and writes
 * through `GitWriter`, and nothing else (V6).
 */

import type { Context, Hono, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import {
  NODE_ACTIONS,
  closeDecision,
  nodeActionInput,
  updateNode,
  type NodeAction,
} from "../model/mutations.js";
import {
  NotFoundError,
  StateStore,
  StateUnreadableError,
  WriteRefusedError,
} from "../model/store.js";
import { GithubAppAuthError } from "../planRegister/githubAppAuth.js";
import {
  GithubAppNotConfiguredError,
  getDefaultCommitChecks,
  getDefaultCommitReader,
  getDefaultGitWriter,
  getDefaultPullRequests,
} from "../planRegister/defaultFetcher.js";
import { GitConflictError, GitWriteError } from "../planRegister/gitWriter.js";
import type { CommitReader } from "../planRegister/registerFetcher.js";
import {
  FileTooLargeError,
  GithubFetchError,
} from "../planRegister/registerFetcher.js";
import type { CommitChecks } from "../planRegister/commitChecks.js";
import {
  NotMergeableError,
  PullRequestError,
  ensureMerged,
  type PullRequests,
} from "../planRegister/pullRequests.js";
import { pullRequestsOf } from "../model/loop.js";
import { OTHER_ANSWER } from "./actions.js";
import { PageReadError, ShaPathCache, readPageFiles } from "./commitRead.js";
import type { PageFiles } from "./commitRead.js";
import type { ErrorPageCommit, PageCommit } from "./html.js";
import {
  VIEW_SECURITY_HEADERS,
  escapeHtml,
  pageHeader,
  pageShell,
  sourceLine,
  viewLink,
} from "./html.js";
import { renderNodePage } from "./nodePage.js";
import { nodePagePath, taskPagePath } from "./parts.js";
import { STATE_PATH, stateAtPage } from "./stateRead.js";
import { renderTaskPage } from "./taskPage.js";
import { openMode, renderTreePage } from "./treePage.js";
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
  /** Test-only: the store the forms write through. Production builds
   * one over the GitHub App. */
  store?: StateStore;
  /** Test-only: the pull request client. Production uses the App. */
  pullRequests?: PullRequests;
  /** Test-only: the commit check reader. Production uses the App. */
  checks?: CommitChecks;
  /** Test-only: the clock. */
  now?: () => Date;
}

const SIGN_IN_PATH = "/view/sign-in";
/** The journal's `session` for a write made in the view. */
const VIEW_SESSION = "the owner, in the view";
const DECISION_CLOSE = /^\/view\/decision\/[^/]+\/close$/;
const NODE_ACTION = /^\/view\/node\/[^/]+\/action$/;
const SHA = /^[0-9a-f]{40}$/;

/** The paths that accept `POST`. */
function acceptsPost(path: string): boolean {
  return (
    path === SIGN_IN_PATH || DECISION_CLOSE.test(path) || NODE_ACTION.test(path)
  );
}

export function isViewPath(path: string): boolean {
  return path === "/view" || path.startsWith("/view/");
}

function nowSeconds(now: () => Date): number {
  return Math.floor(now().getTime() / 1000);
}

function htmlResponse(
  c: Context,
  html: string,
  status: 200 | 400 | 401 | 403 | 404 | 405 | 409 | 422 | 500 | 502,
): Response {
  return c.html(html, status);
}

function simplePage(
  c: Context,
  title: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 405 | 409 | 422 | 500 | 502,
  back?: string,
): Response {
  const body = [
    sourceLine(undefined, undefined),
    "<main>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<p class="error pre" data-error>${escapeHtml(message)}</p>`,
    back ? `<p><a href="${escapeHtml(back)}">Back</a></p>` : "",
    "</main>",
  ].join("\n");
  return htmlResponse(c, pageShell(title, body), status);
}

function signInPage(message: string | undefined): string {
  const body = [
    sourceLine(undefined, undefined),
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
  selfPath = "/view",
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
  const tooLarge =
    underlying instanceof FileTooLargeError ? underlying : undefined;
  const what =
    failure?.path === undefined
      ? `The ref ${requestedRef === undefined ? "(none requested: the default branch)" : JSON.stringify(requestedRef)} did not resolve to a commit.`
      : tooLarge !== undefined
        ? `The file ${failure.path} is ${tooLarge.size} bytes at ${failure.sha}, and this page refuses it: ${tooLarge.reason}.`
        : `The file ${failure.path} could not be read at ${failure.sha}.`;
  const statusLine =
    status === undefined
      ? `<p>GitHub status: <span data-github-status>none</span> (${escapeHtml(underlying instanceof Error ? underlying.message : String(underlying))})</p>`
      : `<p>GitHub status: <span data-github-status>${status}</span></p>`;
  const body = [
    pageHeader(commit, selfPath),
    sourceLine(commit, commit.sha),
    "<main>",
    "<h1>The page could not be read</h1>",
    `<p class="error">${escapeHtml(what)}</p>`,
    failure?.path === undefined
      ? ""
      : `<p>Failing file: <code data-failing-file>${escapeHtml(failure.path)}</code></p>`,
    tooLarge === undefined
      ? ""
      : `<p>File size: <span data-file-size>${tooLarge.size}</span> bytes</p>`,
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

/** The commit a page read, for its header. */
function pageCommit(
  source: CommitReader,
  requestedRef: string | undefined,
  page: PageFiles,
): PageCommit {
  return {
    owner: source.owner,
    repo: source.repo,
    requestedRef,
    resolvedRef: page.resolvedRef,
    sha: page.sha,
    fetchedAt: page.fetchedAt,
  };
}

/**
 * A `404` for an ID the files at the page's commit do not name (V9).
 * It carries the header (V2) and the limit line (V13), and names the
 * ID and the SHA.
 */
function notFoundPage(
  c: Context,
  commit: PageCommit,
  selfPath: string,
  what: string,
): Response {
  const body = [
    pageHeader(commit, selfPath),
    sourceLine(commit, commit.sha),
    "<main>",
    `<p><a href="${escapeHtml(viewLink("/view", commit.requestedRef))}">Plan tree</a></p>`,
    "<h1>Not found at this commit</h1>",
    `<p class="error" data-not-found>${escapeHtml(what)}</p>`,
    "</main>",
  ].join("\n");
  return htmlResponse(c, pageShell("Not found", body), 404);
}

export function registerViewRoutes(app: Hono, options: ViewOptions = {}): void {
  const now = options.now ?? (() => new Date());
  const cache = new ShaPathCache();
  const reader = (): CommitReader => options.reader ?? getDefaultCommitReader();
  const store = (): StateStore =>
    options.store ??
    new StateStore({
      reader: getDefaultCommitReader(),
      writer: getDefaultGitWriter(),
      now,
    });
  const pullRequests = (): PullRequests =>
    options.pullRequests ?? getDefaultPullRequests();

  /** The commit's check status, or null when it cannot be read: the
   * page is shown either way. A test that injects a reader and no
   * check reader gets none. */
  async function checksOf(
    source: CommitReader,
    sha: string,
  ): Promise<{ state: string; failing: string[] } | null | undefined> {
    if (options.checks === undefined && options.reader !== undefined) {
      return undefined;
    }
    try {
      const checks = options.checks ?? getDefaultCommitChecks();
      return await checks.summary(source.owner, source.repo, sha);
    } catch {
      return null;
    }
  }

  // Headers first, so every `/view` response carries them, refusals
  // and errors included (V11).
  const securityHeaders: MiddlewareHandler = async (c, next) => {
    if (!isViewPath(c.req.path)) return next();
    await next();
    for (const [name, value] of Object.entries(VIEW_SECURITY_HEADERS)) {
      c.res.headers.set(name, value);
    }
  };

  // Only GET, and POST on the sign-in and write paths (V17). A POST
  // from another site is refused.
  const methodGuard: MiddlewareHandler = async (c, next) => {
    if (!isViewPath(c.req.path)) return next();
    const allowed =
      c.req.path === SIGN_IN_PATH
        ? ["GET", "POST"]
        : acceptsPost(c.req.path)
          ? ["POST"]
          : ["GET"];
    if (!allowed.includes(c.req.method)) {
      c.header("Allow", allowed.join(", "));
      return simplePage(
        c,
        "Method not allowed",
        `${c.req.method} is not accepted here. Nothing changed.`,
        405,
      );
    }
    if (c.req.method === "POST") {
      const site = c.req.header("Sec-Fetch-Site");
      // The host the request was made to, as the adapter built the URL
      // (on Lambda, the API's domain name): a `Host` header does not
      // survive every conversion to a Request.
      const origin = c.req.header("Origin");
      const host = new URL(c.req.url).host;
      let originHost: string | undefined;
      if (origin !== undefined && origin !== "null") {
        try {
          originHost = new URL(origin).host;
        } catch {
          originHost = "";
        }
      }
      const crossSite =
        (site !== undefined && site !== "same-origin" && site !== "none") ||
        (originHost !== undefined && originHost !== host);
      if (crossSite) {
        return simplePage(
          c,
          "Refused",
          "This request came from another site. Nothing changed.",
          403,
        );
      }
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

  /** Reads the state file at the requested ref, or answers the error
   * page. */
  async function statePage(
    c: Context,
    requestedRef: string | undefined,
    selfPath: string,
  ): Promise<
    | { ok: true; source: CommitReader; page: PageFiles; commit: PageCommit }
    | { ok: false; response: Response }
  > {
    let source: CommitReader;
    try {
      source = reader();
    } catch (err) {
      return {
        ok: false,
        response: errorPage(
          c,
          err,
          requestedRef,
          { owner: "(not configured)", repo: "(not configured)" },
          now,
          selfPath,
        ),
      };
    }
    try {
      const page = await readPageFiles(
        source,
        cache,
        requestedRef,
        [STATE_PATH],
        now,
      );
      const commit = pageCommit(source, requestedRef, page);
      const checks = await checksOf(source, page.sha);
      if (checks !== undefined) commit.checks = checks;
      return { ok: true, source, page, commit };
    } catch (err) {
      return {
        ok: false,
        response: errorPage(c, err, requestedRef, source, now, selfPath),
      };
    }
  }

  /** The commit a page was redirected to after a write, when the
   * query names one. */
  function committedQuery(c: Context): string | undefined {
    const value = c.req.query("committed");
    return value !== undefined && SHA.test(value) ? value : undefined;
  }

  app.get("/view", async (c) => {
    // An empty `ref` names no ref, the same as an absent one.
    const requestedRef = c.req.query("ref") || undefined;
    const read = await statePage(c, requestedRef, "/view");
    if (!read.ok) return read.response;
    const state = stateAtPage(read.page.files.get(STATE_PATH)!);
    const mode = openMode(c.req.query("open") || undefined);
    return htmlResponse(
      c,
      renderTreePage(state, read.commit, mode, committedQuery(c)),
      200,
    );
  });

  app.get("/view/node/:id", async (c) => {
    const requestedRef = c.req.query("ref") || undefined;
    const id = c.req.param("id");
    const selfPath = nodePagePath(id);
    const read = await statePage(c, requestedRef, selfPath);
    if (!read.ok) return read.response;
    const { state } = stateAtPage(read.page.files.get(STATE_PATH)!);
    const node = state?.nodes.find((n) => n.id === id);
    if (state === null || node === undefined) {
      return notFoundPage(
        c,
        read.commit,
        selfPath,
        state === null
          ? `${STATE_PATH} at ${read.page.sha} does not validate; the plan tree lists the problems.`
          : `No node ${id} in ${STATE_PATH} at ${read.page.sha}.`,
      );
    }
    return htmlResponse(
      c,
      renderNodePage(state, node, read.commit, committedQuery(c)),
      200,
    );
  });

  /** One string field of a posted form, trimmed; empty when absent. */
  function formField(form: Record<string, unknown>, name: string): string {
    const value = form[name];
    return typeof value === "string" ? value.trim() : "";
  }

  async function postedForm(c: Context): Promise<Record<string, unknown>> {
    try {
      return await c.req.parseBody();
    } catch {
      return {};
    }
  }

  /** The page a write failed from: the error named, nothing committed. */
  function writeFailed(c: Context, err: unknown, back: string): Response {
    if (err instanceof WriteRefusedError) {
      return simplePage(
        c,
        "Refused: the change would violate the state's invariants",
        `Nothing was committed.\n${err.findings.map((f) => `violation ${f.invariant}${f.subject ? ` ${f.subject}` : ""}: ${f.message}`).join("\n")}`,
        422,
        back,
      );
    }
    if (err instanceof NotFoundError) {
      return simplePage(
        c,
        "Not found",
        `${err.message}. Nothing was committed.`,
        404,
        back,
      );
    }
    if (err instanceof NotMergeableError) {
      return simplePage(
        c,
        "A pull request cannot be merged",
        `${err.message}. A node is done only when its pull requests are merged. Nothing was committed.`,
        409,
        back,
      );
    }
    if (err instanceof GitConflictError) {
      return simplePage(
        c,
        "The branch moved",
        `${err.message}; the write was retried once and the branch moved again. Nothing was committed; go back and try again.`,
        409,
        back,
      );
    }
    if (err instanceof StateUnreadableError) {
      return simplePage(
        c,
        "The state file does not validate",
        `${err.message}; fix the file by hand before the view can write. Nothing was committed.`,
        409,
        back,
      );
    }
    if (err instanceof GithubAppNotConfiguredError) {
      return simplePage(
        c,
        "The service is not configured",
        err.message,
        500,
        back,
      );
    }
    if (
      err instanceof PullRequestError ||
      err instanceof GithubAppAuthError ||
      err instanceof GithubFetchError ||
      err instanceof GitWriteError
    ) {
      return simplePage(
        c,
        "GitHub refused the write",
        `${err.message} (HTTP ${err.status}): ${err.body}. Nothing was committed.`,
        502,
        back,
      );
    }
    return simplePage(
      c,
      "The write failed",
      `${err instanceof Error ? err.message : String(err)}. Nothing was committed.`,
      500,
      back,
    );
  }

  app.post("/view/decision/:id/close", async (c) => {
    const id = c.req.param("id");
    const form = await postedForm(c);
    const picked = formField(form, "chosen");
    const chosen = picked === OTHER_ANSWER ? formField(form, "other") : picked;
    const note = formField(form, "note");
    const standing = formField(form, "standing") === "yes";
    const back = "/view";
    if (chosen === "") {
      return simplePage(
        c,
        "No answer given",
        "Choose an option or write another answer. Nothing was committed.",
        400,
        back,
      );
    }
    let node: string | null = null;
    try {
      const result = await store().write(`${id}: ${chosen}`, (state) => {
        const applied = closeDecision(
          state,
          {
            decisionId: id,
            chosen,
            ...(note ? { rationale: note } : {}),
            standing,
            session: VIEW_SESSION,
          },
          now().toISOString().slice(0, 10),
        );
        node = applied.decision.node;
        return applied.event;
      });
      const target = node === null ? "/view" : nodePagePath(node);
      return c.redirect(`${target}?committed=${result.sha}`, 303);
    } catch (err) {
      return writeFailed(c, err, back);
    }
  });

  app.post("/view/node/:id/action", async (c) => {
    const id = c.req.param("id");
    const back = nodePagePath(id);
    const form = await postedForm(c);
    const action = formField(form, "action");
    if (!(NODE_ACTIONS as readonly string[]).includes(action)) {
      return simplePage(
        c,
        "No such action",
        `${JSON.stringify(action)} is not an action this view offers. Nothing was committed.`,
        400,
        back,
      );
    }
    const input = nodeActionInput(
      id,
      action as NodeAction,
      formField(form, "note"),
      VIEW_SESSION,
    );
    try {
      if (input.stage === "done") {
        // Done needs the node's pull requests merged: the service
        // merges them here, before the commit (owner, 2026-11-11).
        const head = await store().read();
        if (head.state !== null) {
          await ensureMerged(pullRequests, pullRequestsOf(head.state, id));
        }
      }
      const result = await store().write(
        `${id}: ${input.reason}`,
        (state) =>
          updateNode(state, input, now().toISOString().slice(0, 10)).event,
      );
      return c.redirect(`${back}?committed=${result.sha}`, 303);
    } catch (err) {
      return writeFailed(c, err, back);
    }
  });

  app.get("/view/task/:id", async (c) => {
    const requestedRef = c.req.query("ref") || undefined;
    const id = c.req.param("id");
    const selfPath = taskPagePath(id);
    const read = await statePage(c, requestedRef, selfPath);
    if (!read.ok) return read.response;
    const { state } = stateAtPage(read.page.files.get(STATE_PATH)!);
    const task = state?.tasks.find((t) => t.id === id);
    if (state === null || task === undefined) {
      return notFoundPage(
        c,
        read.commit,
        selfPath,
        state === null
          ? `${STATE_PATH} at ${read.page.sha} does not validate; the plan tree lists the problems.`
          : `No task ${id} in ${STATE_PATH} at ${read.page.sha}.`,
      );
    }
    return htmlResponse(c, renderTaskPage(state, task, read.commit), 200);
  });

  // A signed-in request for any other `/view` path answers this page.
  app.get("/view/*", (c) =>
    simplePage(
      c,
      "No page here yet",
      "This view page does not exist in this version of the service.",
      404,
    ),
  );
}
