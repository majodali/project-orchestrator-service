/**
 * A register line's note and links, rendered for a page (node P2-N021,
 * the web view's first version; the specification of P2-N003, "What
 * every page carries"). The tree page shows each note verbatim with
 * its document targets linked (task E1). The node page shows the same
 * note with every node ID in it linked as well (task E2, field 3).
 * Every document link is pinned to the page's SHA (decision 6, V10),
 * and every link between pages carries the received `ref` (V10).
 */

import type { PlanNode, RegisterLink } from "../planRegister/types.js";
import type { RepoCoordinates } from "./html.js";
import { blobUrl, escapeHtml, viewLink } from "./html.js";

/** Register links such as `plans/x.md` resolve against `docs/`. */
export const REGISTER_LINK_BASE = "docs/";
const LINK_SEPARATOR = " · ";
/** A relative path to a Markdown document inside the repository. */
const DOCUMENT_TARGET =
  /^(?!\/)(?!.*\.\.)[A-Za-z0-9._\-/]+\.md(?:#[A-Za-z0-9_-]+)?$/;
const NODE_ID = /P\d+-N\d+/g;

/** The repository path a register link target names, without its
 * anchor, or undefined when the target is not a relative Markdown
 * document. */
export function documentPath(target: string): string | undefined {
  if (!DOCUMENT_TARGET.test(target)) return undefined;
  const [path] = target.split("#") as [string];
  return `${REGISTER_LINK_BASE}${path}`;
}

/** A register link target as a link to GitHub's file view at `sha`,
 * or undefined when the target is not a relative Markdown document. */
export function documentHref(
  repo: RepoCoordinates,
  sha: string,
  target: string,
): string | undefined {
  const path = documentPath(target);
  if (path === undefined) return undefined;
  const anchor = target.includes("#")
    ? `#${target.slice(target.indexOf("#") + 1)}`
    : "";
  return blobUrl(repo, sha, path) + anchor;
}

/** Links a node's page, carrying the received `ref`. */
export function nodePageHref(
  id: string,
  requestedRef: string | undefined,
): string {
  return viewLink(`/view/node/${encodeURIComponent(id)}`, requestedRef);
}

/** How the node page links node IDs in a note: the IDs the register
 * holds, and the `ref` the page received. */
export interface NodeIdLinks {
  known: ReadonlySet<string>;
  requestedRef: string | undefined;
}

/** Escapes `text`, linking each node ID in it that the register holds,
 * when `nodeLinks` is given. */
function renderText(text: string, nodeLinks: NodeIdLinks | undefined): string {
  if (!nodeLinks) return escapeHtml(text);
  let out = "";
  let last = 0;
  for (const m of text.matchAll(NODE_ID)) {
    const id = m[0];
    if (!nodeLinks.known.has(id)) continue;
    out += escapeHtml(text.slice(last, m.index));
    out += `<a data-node-ref href="${escapeHtml(nodePageHref(id, nodeLinks.requestedRef))}">${escapeHtml(id)}</a>`;
    last = m.index + id.length;
  }
  return out + escapeHtml(text.slice(last));
}

/**
 * The note as written, with each document target the register's
 * `label: target` links name turned into a link at the page's SHA, and,
 * with `nodeLinks`, each node ID turned into a link to its node page.
 * The text a reader sees is the note verbatim (V7).
 */
export function renderNote(
  node: PlanNode,
  repo: RepoCoordinates,
  sha: string,
  nodeLinks?: NodeIdLinks,
): string {
  const annotation = node.annotation ?? "";
  const targets = new Set(node.links.map((link) => link.target));
  return annotation
    .split(LINK_SEPARATOR)
    .map((segment) => {
      const trimmed = segment.trimEnd();
      for (const target of targets) {
        const href = documentHref(repo, sha, target);
        if (href !== undefined && trimmed.endsWith(target)) {
          const head = segment.slice(0, trimmed.length - target.length);
          const tail = segment.slice(trimmed.length);
          return `${renderText(head, nodeLinks)}<a href="${escapeHtml(href)}">${escapeHtml(target)}</a>${renderText(tail, nodeLinks)}`;
        }
      }
      return renderText(segment, nodeLinks);
    })
    .join(escapeHtml(LINK_SEPARATOR));
}

/** One register link, as a list item: the label, then the target,
 * linked at the page's SHA when it is a repository document. */
export function renderRegisterLink(
  link: RegisterLink,
  repo: RepoCoordinates,
  sha: string,
): string {
  const href = documentHref(repo, sha, link.target);
  const target =
    href === undefined
      ? `<code>${escapeHtml(link.target)}</code>`
      : `<a href="${escapeHtml(href)}">${escapeHtml(link.target)}</a>`;
  return `<li data-document>${escapeHtml(link.label)}: ${target}</li>`;
}
