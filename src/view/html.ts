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
  ":root{--fg:#1f2328;--muted:#59636e;--bg:#f6f8fa;--card:#fff;--line:#d1d9e0;--soft:#eef1f4;--link:#0969da;--done:#1a7f37;--owner:#bc4c00;--progress:#0969da;--pending:#8250df;--ready:#59636e;--err:#b42318}",
  "*{box-sizing:border-box}",
  "body{margin:0;padding:12px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.5;color:var(--fg);background:var(--bg);overflow-wrap:anywhere}",
  "a{color:var(--link);text-decoration:none}",
  "a:hover{text-decoration:underline}",
  "header{font-size:13px;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:0 0 8px}",
  "header p{margin:0 0 2px}",
  "header p:last-child{margin:0}",
  ".limit{font-size:13px;color:var(--muted);margin:0 0 12px;padding:6px 12px;border-left:3px solid var(--line)}",
  "code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}",
  "h1{font-size:22px;line-height:1.3;margin:8px 0 6px}",
  "h2{font-size:15px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}",
  "section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:0 0 10px}",
  ".note{font-size:14px;color:var(--muted)}",
  "p.note{margin:4px 0}",
  ".error{color:var(--err)}",
  ".label{font-size:14px;color:var(--muted);margin:6px 0 2px}",
  "dl{display:grid;grid-template-columns:minmax(0,max-content) minmax(0,1fr);margin:0 0 8px;border:1px solid var(--line);border-radius:6px;overflow:hidden;font-size:14px}",
  "dt,dd{margin:0;padding:5px 8px;border-top:1px solid var(--line)}",
  "dt:first-of-type,dt:first-of-type+dd{border-top:0}",
  "dt{color:var(--muted);background:var(--soft);font-weight:500;max-width:150px}",
  "ol.events{list-style:none;padding:0;margin:0}",
  "ol.events li{margin:0 0 10px}",
  "section ul{padding-left:20px;margin:4px 0}",
  ".stage,.hold,.id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}",
  ".hold{color:var(--owner)}",
  ".legend{list-style:none;display:flex;flex-wrap:wrap;gap:4px 14px;padding:0;margin:6px 0 10px;font-size:13px;color:var(--muted)}",
  ".legend li{display:flex;align-items:center;gap:5px}",
  ".icon{flex:none;vertical-align:-3px}",
  ".s-done{color:var(--done)}.s-owner{color:var(--owner)}.s-progress{color:var(--progress)}.s-pending{color:var(--pending)}.s-ready{color:var(--ready)}",
  ".r-built{color:var(--done)}.r-open{color:var(--muted)}",
  "ul.tree{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}",
  "ul.tree ul{list-style:none;margin:0 0 0 4px;padding:0 0 0 6px;border-left:1px solid var(--line)}",
  "ul.tree li{margin:0}",
  "ul.tree>li+li{border-top:1px solid var(--line)}",
  "summary,.leaf{display:flex;align-items:baseline;padding:7px 8px;cursor:pointer;list-style:none}",
  ".leaf{cursor:auto;padding-left:24px}",
  "summary::-webkit-details-marker{display:none}",
  "summary::before{content:'\\25B8';flex:none;width:16px;color:var(--muted);transition:transform .1s}",
  "details[open]>summary::before{transform:rotate(90deg)}",
  "summary:hover,.leaf:hover{background:var(--soft)}",
  ".row .title{font-weight:600;color:var(--fg)}",
  ".row .meta{color:var(--muted);white-space:normal}",
  ".fold{padding:0 8px 6px 14px}",
  ".fold>.note{margin:0 0 6px}",
  "ul.resources{list-style:none;padding:0;margin:4px 0 8px}",
  "li.resource{border:1px solid var(--line);border-radius:6px;padding:5px 8px;margin:0 0 6px;background:var(--soft)}",
  "li.resource p{margin:2px 0 0}",
  ".resource-head{font-size:14px}",
  "section[data-unplaced]{padding:0;overflow:hidden}",
  "section[data-unplaced] h2{padding:10px 12px 0}",
  "section[data-unplaced] .error{padding:0 12px}",
  "form p{margin:0 0 10px}",
  "input,button{font:inherit;font-size:16px;max-width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}",
  "button{background:var(--link);border-color:var(--link);color:#fff;cursor:pointer}",
  "@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--muted:#9198a1;--bg:#0d1117;--card:#151b23;--line:#3d444d;--soft:#212830;--link:#4493f8;--done:#3fb950;--owner:#f0883e;--progress:#4493f8;--pending:#ab7df8;--ready:#9198a1;--err:#ff7b72}}",
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
