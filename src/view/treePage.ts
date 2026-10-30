/**
 * The tree page, `GET /view` (node P2-N021, task E1; the specification
 * of P2-N003, "The tree page"). Every node of the Plan register, once,
 * nested as the register nests it. Per node: its ID, linked to its node
 * page; its stage; its hold marker, if any; its title; and its register
 * note, verbatim. The register is parsed by the vendored grammar
 * (RU-012, how two repositories share one unit of code), which this
 * page uses and does not change.
 */

import { parseRegister } from "../planRegister/parser.js";
import type { RegisterParseResult } from "../planRegister/types.js";
import type { PageCommit } from "./html.js";
import {
  blobUrl,
  escapeHtml,
  limitLine,
  pageHeader,
  pageShell,
} from "./html.js";
import { nodePageHref, renderNote } from "./registerNote.js";

export const REGISTER_PATH = "docs/plan-register.md";

function renderNode(
  parsed: RegisterParseResult,
  id: string,
  commit: PageCommit,
  depth: number,
): string {
  const node = parsed.nodes.get(id)!;
  const parts = [
    `<li data-node="${escapeHtml(node.id)}" data-depth="${depth}">`,
    "<div>",
    `<a data-node-link href="${escapeHtml(nodePageHref(node.id, commit.requestedRef))}">${escapeHtml(node.id)}</a>`,
    ` <span class="stage" data-stage>[${escapeHtml(node.stage)}]</span>`,
    node.hold
      ? ` <span class="hold" data-hold>[${escapeHtml(node.hold.kind)}: ${escapeHtml(node.hold.reason)}]</span>`
      : "",
    ` <span data-title>${escapeHtml(node.title)}</span>`,
    "</div>",
    node.annotation === null
      ? ""
      : `<div class="note" data-note>${renderNote(node, commit, commit.sha)}</div>`,
  ];
  if (node.childIds.length > 0) {
    parts.push("<ul>");
    for (const childId of node.childIds) {
      parts.push(renderNode(parsed, childId, commit, depth + 1));
    }
    parts.push("</ul>");
  }
  parts.push("</li>");
  return parts.join("");
}

function renderParseErrors(parsed: RegisterParseResult): string {
  if (parsed.errors.length === 0) return "";
  const items = parsed.errors
    .map(
      (error) =>
        `<li>line ${error.line}: ${escapeHtml(error.reason)}: <code>${escapeHtml(error.raw)}</code></li>`,
    )
    .join("\n");
  return `<h2>Register lines that did not parse</h2>\n<ul class="error">\n${items}\n</ul>`;
}

/** Renders the tree page from the register's text at `commit.sha`. */
export function renderTreePage(
  registerText: string,
  commit: PageCommit,
): string {
  const parsed = parseRegister(registerText);
  const tree = parsed.rootIds
    .map((id) => renderNode(parsed, id, commit, 0))
    .join("\n");
  const body = [
    pageHeader(commit, "/view"),
    limitLine(commit, commit.sha),
    "<main>",
    "<h1>Plan tree</h1>",
    `<p class="note">From <a href="${escapeHtml(blobUrl(commit, commit.sha, REGISTER_PATH))}">${escapeHtml(REGISTER_PATH)}</a> at this commit.</p>`,
    `<ul class="tree">\n${tree}\n</ul>`,
    renderParseErrors(parsed),
    "</main>",
  ].join("\n");
  return pageShell("Plan tree", body);
}
