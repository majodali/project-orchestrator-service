/**
 * What every web-view page carries: the header naming the ref, the
 * full SHA and the fetch time; the source line naming the state file
 * the page renders; document links pinned to the SHA; and no script.
 * Since the rebuild's milestone 2 the pages target a desktop browser
 * and read `orchestration/state.json`. Every value read from a file
 * passes `escapeHtml` before it reaches the page.
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
  /** The commit's check status: a summary, or null when it could not
   * be read; absent on a page that did not ask. */
  checks?: { state: string; failing: string[] } | null;
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
  "body{margin:0;padding:16px 24px 40px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:var(--fg);background:var(--bg);overflow-wrap:anywhere}",
  "header,main,.source{max-width:1100px;margin-left:auto;margin-right:auto}",
  "a{color:var(--link);text-decoration:none}",
  "a:hover{text-decoration:underline}",
  "header{font-size:13px;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:2px 24px}",
  "header p{margin:0}",
  ".source{font-size:13px;color:var(--muted);margin-bottom:14px;padding:6px 12px;border-left:3px solid var(--line)}",
  "code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}",
  "h1{font-size:24px;line-height:1.3;margin:8px 0 10px}",
  "h1 .id{font-size:14px;font-weight:400;margin-left:8px}",
  "h2{font-size:14px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}",
  "section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:0 0 12px}",
  ".columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px;margin:0 0 12px}",
  ".columns>section{margin:0}",
  ".note{font-size:14px;color:var(--muted)}",
  "p.note{margin:4px 0}",
  "p.outcome{margin:4px 0 8px}",
  ".error{color:var(--err)}",
  ".crumbs{font-size:13px;color:var(--muted);margin:0 0 4px}",
  "dl{display:grid;grid-template-columns:minmax(0,max-content) minmax(0,1fr);margin:0 0 8px;border:1px solid var(--line);border-radius:6px;overflow:hidden;font-size:14px}",
  "dt,dd{margin:0;padding:5px 10px;border-top:1px solid var(--line)}",
  "dt:first-of-type,dt:first-of-type+dd{border-top:0}",
  "dt{color:var(--muted);background:var(--soft);font-weight:500;max-width:180px}",
  "section ul{padding-left:20px;margin:4px 0}",
  "ul.plain{list-style:none;padding:0}",
  "ul.plain>li{padding:6px 0;border-top:1px solid var(--line)}",
  "ul.plain>li:first-child{border-top:0;padding-top:0}",
  ".id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--muted)}",
  ".stage{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}",
  ".badge{display:inline-block;font-size:12px;line-height:1.4;padding:0 8px;border-radius:10px;border:1px solid currentColor;white-space:nowrap;vertical-align:middle}",
  ".c-done{color:var(--done)}.c-gated{color:var(--owner)}.c-blocked{color:var(--err)}.c-in-flight,.c-in-progress{color:var(--progress)}.c-waiting{color:var(--pending)}.c-actionable{color:var(--ready)}.c-parked,.c-paused{color:var(--muted)}",
  ".legend{list-style:none;display:flex;flex-wrap:wrap;gap:4px 14px;padding:0;margin:0 0 10px;font-size:13px;color:var(--muted)}",
  "ul.tree{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}",
  "ul.tree ul{list-style:none;margin:0 0 0 10px;padding:0 0 0 10px;border-left:1px solid var(--line)}",
  "ul.tree li{margin:0}",
  "ul.tree>li+li{border-top:1px solid var(--line)}",
  "summary,.leaf{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;padding:6px 10px;cursor:pointer;list-style:none}",
  ".leaf{cursor:auto;padding-left:36px}",
  "summary::-webkit-details-marker{display:none}",
  "summary::before{content:'\\25B8';flex:none;width:18px;font-size:18px;line-height:22px;color:var(--muted);transition:transform .1s}",
  "details[open]>summary::before{transform:rotate(90deg)}",
  "summary:hover,.leaf:hover{background:var(--soft)}",
  ".row-title{font-weight:600}",
  ".row-outcome{flex-basis:100%;padding-left:26px;font-size:14px;color:var(--muted)}",
  ".leaf .row-outcome{padding-left:0}",
  ".hold{flex-basis:100%;padding-left:26px;font-size:13px;color:var(--owner)}",
  ".leaf .hold{padding-left:0}",
  ".counts{margin:0;font-size:14px}",
  ".flag{display:inline-block;font-size:12px;padding:0 7px;border-radius:10px;color:#fff}",
  ".f-owner{background:var(--owner)}.f-flight{background:var(--progress)}",
  "summary.attention,.leaf.attention{background:color-mix(in srgb,var(--owner) 9%,var(--card));box-shadow:inset 3px 0 0 var(--owner)}",
  "ul.decisions{flex-basis:100%;list-style:none;margin:2px 0 4px;padding:0 0 0 26px;font-size:14px}",
  ".leaf ul.decisions{padding-left:0}",
  "ul.decisions li{padding:2px 0}",
  "section.problems{border-color:var(--err)}",
  "section.problems h2{color:var(--err)}",
  ".pre{white-space:pre-wrap}",
  ".table-wrap{max-width:100%;overflow-x:auto}",
  "table{border-collapse:collapse;width:100%;font-size:13px}",
  "th,td{border:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}",
  "th{background:var(--soft);color:var(--muted);font-weight:600}",
  "table.tasks th,table.tasks td{white-space:nowrap;overflow-wrap:normal}",
  "table.tasks td:nth-child(6),table.tasks td:nth-child(7),table.tasks th:nth-child(7){white-space:normal;overflow-wrap:anywhere}",
  "form p{margin:0 0 10px}",
  "form.decide{margin:8px 0 2px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--soft);font-size:14px}",
  "form.decide p{margin:6px 0 0}",
  ".choices{display:flex;flex-direction:column;gap:4px}",
  ".choice{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
  ".choice input[type=radio],.choice input[type=checkbox]{margin:0;padding:0}",
  "form.decide input[type=text],form.act input[type=text]{font-size:14px;padding:5px 8px}",
  "form.decide button,form.act button{font-size:14px;padding:5px 12px}",
  "form.act{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 8px}",
  ".checks-failing{color:var(--err);font-weight:600}.checks-passing{color:var(--done)}",
  ".kind{display:inline-block;font-size:11px;line-height:1.4;padding:0 6px;border-radius:4px;background:var(--soft);color:var(--muted);text-transform:uppercase;letter-spacing:.04em;vertical-align:middle}",
  ".committed{margin:0 0 10px;padding:6px 12px;border-left:3px solid var(--done);background:var(--card);font-size:14px}",
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

/** The file every page renders. */
export const STATE_PATH = "orchestration/state.json";

/**
 * The source line: the state file the page renders, linked at the
 * page's SHA, and its authority. During the rebuild the state file is
 * the progress truth, under the deviation from K-003 (the Backlog is
 * the single source of progress truth) recorded in the coordinating
 * repository's Classification. A page with no resolved SHA names the
 * file without a link.
 */
export function sourceLine(
  repo: RepoCoordinates | undefined,
  sha: string | undefined,
): string {
  const authority =
    "the progress truth during the rebuild, under the deviation from K-003 recorded in docs/classification.md";
  if (repo && sha) {
    return `<p class="source" data-source>Rendered from <a href="${escapeHtml(blobUrl(repo, sha, STATE_PATH))}"><code>${escapeHtml(STATE_PATH)}</code> at ${escapeHtml(sha.slice(0, 7))}</a>, ${authority}.</p>`;
  }
  return `<p class="source" data-source>Renders <code>${escapeHtml(STATE_PATH)}</code>, ${authority}. No commit resolved for this page.</p>`;
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
  const checks = "checks" in commit ? commit.checks : undefined;
  const checksLine =
    checks === undefined
      ? ""
      : checks === null
        ? `<p>Checks: <span data-checks="unavailable">unavailable</span></p>`
        : `<p>Checks: <span class="checks-${escapeHtml(checks.state)}" data-checks="${escapeHtml(checks.state)}">${escapeHtml(checks.state === "none" ? "none ran" : checks.state)}${checks.failing.length > 0 ? `: ${escapeHtml(checks.failing.join(", "))}` : ""}</span></p>`;
  return [
    "<header>",
    `<p>Repository: <code>${escapeHtml(commit.owner)}/${escapeHtml(commit.repo)}</code></p>`,
    refLine(commit.requestedRef, commit.resolvedRef),
    shaLine,
    checksLine,
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
