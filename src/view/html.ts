/**
 * What every web-view page carries (node P2-N021, the web view's first
 * version; the specification of P2-N003 in the coordinating
 * repository, "What every page carries"): the header naming the ref,
 * the full SHA and the fetch time; the line saying the page carries no
 * progress authority; document links pinned to the SHA; phone width;
 * and no script. Every value read from a file passes `escapeHtml`
 * before it reaches the page.
 */

import { createHash } from "node:crypto";

/** The repository a page reads, for links to GitHub. */
export interface RepoCoordinates {
  owner: string;
  repo: string;
}

/** The commit a page was read at (decision 5). */
export interface PageCommit extends RepoCoordinates {
  /** The `ref` query parameter as received, or undefined when none was. */
  requestedRef: string | undefined;
  /** The ref resolved: the requested ref, or the default branch's name. */
  resolvedRef: string;
  sha: string;
  /** ISO-8601 time the page's reads completed. */
  fetchedAt: string;
}

/** What the header of an error page knows: the SHA is absent when the
 * ref itself did not resolve. */
export interface ErrorPageCommit extends RepoCoordinates {
  requestedRef: string | undefined;
  resolvedRef: string | undefined;
  sha: string | undefined;
  fetchedAt: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The one style sheet. No declaration sets a width in CSS pixels, so
 * nothing forces a page wider than a 360-pixel phone screen (V12).
 * Long SHAs, refs and notes wrap instead of scrolling.
 */
export const PAGE_CSS = [
  "body{margin:0;padding:12px;font-family:system-ui,sans-serif;font-size:16px;line-height:1.45;color:#1b1b1b;background:#fff;overflow-wrap:anywhere}",
  "header,.limit{font-size:14px;color:#444}",
  "header p,.limit{margin:0 0 4px}",
  ".limit{padding:6px 0;border-bottom:1px solid #ccc;margin-bottom:12px}",
  "code{font-size:13px}",
  "h1{font-size:20px;margin:8px 0}",
  "ul.tree,ul.tree ul{list-style:none;margin:0;padding-left:12px}",
  "ul.tree{padding-left:0}",
  "ul.tree li{margin:6px 0}",
  ".stage{font-family:ui-monospace,monospace;font-size:13px}",
  ".hold{font-family:ui-monospace,monospace;font-size:13px;color:#8a3b00}",
  ".note{font-size:14px;color:#444}",
  ".error{color:#8a0000}",
  "input,button{font-size:16px;max-width:100%}",
  "@media (prefers-color-scheme:dark){body{color:#e8e8e8;background:#121212}header,.limit,.note{color:#bbb}.hold{color:#f0a060}.error{color:#ff8080}a{color:#8ab4f8}}",
].join("\n");

const CSS_HASH = createHash("sha256").update(PAGE_CSS).digest("base64");

/**
 * Every `/view` response carries these (V11). The policy allows no
 * script and no framing, and lets the one style element run by its
 * hash, not by `unsafe-inline`.
 */
export const VIEW_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": [
    "default-src 'none'",
    "script-src 'none'",
    `style-src 'sha256-${CSS_HASH}'`,
    "img-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; "),
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/** A link to a file in GitHub's file view, at a full SHA (decision 6). */
export function blobUrl(
  repo: RepoCoordinates,
  sha: string,
  path: string,
): string {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/blob/${sha}/${encodedPath}`;
}

export function commitUrl(repo: RepoCoordinates, sha: string): string {
  return `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commit/${sha}`;
}

/** A link between pages, carrying the received `ref` unchanged, or no
 * `ref` when the page received none (decision 5). */
export function viewLink(
  path: string,
  requestedRef: string | undefined,
): string {
  return requestedRef === undefined
    ? path
    : `${path}?ref=${encodeURIComponent(requestedRef)}`;
}

/** The repository's Backlog, the referent of progress truth under
 * K-003 (the Backlog is the single source of progress truth) as
 * released at methodology 1.6.0. */
export const BACKLOG_PATH = "docs/backlog.md";

const LIMIT_TEXT =
  "This page carries no progress authority. Under K-003 (the Backlog is the single source of progress truth), the Backlog is the referent";

/**
 * The limit line (V13). With a SHA, it links the Backlog at that SHA.
 * A page with no resolved SHA (the sign-in page, or a ref that did not
 * resolve) names the Backlog without a link, since the only other link
 * would name a branch (V10).
 */
export function limitLine(
  repo: RepoCoordinates | undefined,
  sha: string | undefined,
): string {
  if (repo && sha) {
    return `<p class="limit" data-limit>${escapeHtml(LIMIT_TEXT)}: <a href="${escapeHtml(blobUrl(repo, sha, BACKLOG_PATH))}">${escapeHtml(BACKLOG_PATH)} at ${escapeHtml(sha.slice(0, 7))}</a>.</p>`;
  }
  return `<p class="limit" data-limit>${escapeHtml(LIMIT_TEXT)}: ${escapeHtml(BACKLOG_PATH)}, not linked because this page resolved no commit.</p>`;
}

function refLine(
  requestedRef: string | undefined,
  resolvedRef: string | undefined,
): string {
  if (requestedRef !== undefined) {
    return `<p>Ref requested: <code data-ref>${escapeHtml(requestedRef)}</code></p>`;
  }
  const branch =
    resolvedRef === undefined
      ? "the default branch"
      : `the default branch, <code>${escapeHtml(resolvedRef)}</code>`;
  return `<p>Ref requested: none, so <span data-ref>${branch}</span></p>`;
}

/**
 * The header (V2): the ref as requested, the full SHA linked to
 * GitHub's commit view, the fetch time, and a link to the same page at
 * the requested ref, which a reload follows to a new SHA.
 */
export function pageHeader(
  commit: PageCommit | ErrorPageCommit,
  selfPath: string,
): string {
  const shaLine =
    commit.sha === undefined
      ? `<p>Commit: <span data-sha>none, the ref did not resolve</span></p>`
      : `<p>Commit: <a href="${escapeHtml(commitUrl(commit, commit.sha))}"><code data-sha>${escapeHtml(commit.sha)}</code></a></p>`;
  const reload = viewLink(selfPath, commit.requestedRef);
  return [
    "<header>",
    `<p>Repository: <code>${escapeHtml(commit.owner)}/${escapeHtml(commit.repo)}</code></p>`,
    refLine(commit.requestedRef, commit.resolvedRef),
    shaLine,
    `<p>Fetched: <time data-fetched>${escapeHtml(commit.fetchedAt)}</time></p>`,
    `<p><a href="${escapeHtml(reload)}">Reload at the requested ref</a></p>`,
    "</header>",
  ].join("\n");
}

/** The page shell: a viewport meta tag (V12), the one style element,
 * and no script element of any kind. */
export function pageShell(title: string, body: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${PAGE_CSS}</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}
