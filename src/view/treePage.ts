/**
 * The tree page, `GET /view` (the rebuild plan, milestone 2). It
 * renders `orchestration/state.json` at one commit for a desktop
 * browser: first what waits on the owner, then what is ready to start
 * and what is in flight, then every node in its tree with its title,
 * its class, its identifier and its one-sentence outcome, and last the
 * problems `check` would report. The page runs no script: the folding
 * is HTML's own `details` element. Titles read in the context of their
 * parent and siblings, so a node is always shown in its tree.
 */

import {
  childrenOf,
  classifyAll,
  nodesById,
  type Finding,
  type NodeClass,
} from "../model/check.js";
import type { Decision, Node, State } from "../model/schema.js";
import type { PageCommit } from "./html.js";
import { escapeHtml, pageHeader, pageShell, sourceLine } from "./html.js";
import { classBadge, nodeHref } from "./parts.js";
import type { StateAtPage } from "./stateRead.js";
import { STATE_PATH } from "./stateRead.js";

function titleLink(n: Node, commit: PageCommit): string {
  return `<a class="row-title" data-node-link href="${escapeHtml(nodeHref(n.id, commit.requestedRef))}">${escapeHtml(n.title)}</a> <span class="id" data-node-id>${escapeHtml(n.id)}</span>`;
}

/** The "Problems found" section, or nothing when there are none. */
export function problemsSection(findings: Finding[]): string {
  if (findings.length === 0) return "";
  const items = findings.map(
    (f) =>
      `<li data-problem data-severity="${f.severity}">${escapeHtml(f.severity)}, invariant ${f.invariant}${f.subject ? `, ${escapeHtml(f.subject)}` : ""}: ${escapeHtml(f.message)}</li>`,
  );
  return [
    '<section class="problems" data-problems>',
    "<h2>Problems found</h2>",
    `<p class="note">What <code>plan-state check</code> reports for <code>${escapeHtml(STATE_PATH)}</code> at this commit.</p>`,
    "<ul>",
    ...items,
    "</ul>",
    "</section>",
  ].join("\n");
}

function decisionItem(
  d: Decision,
  byId: Map<string, Node>,
  commit: PageCommit,
): string {
  const node = d.node ? byId.get(d.node) : undefined;
  const where = node
    ? ` on <a href="${escapeHtml(nodeHref(node.id, commit.requestedRef))}">${escapeHtml(node.title)}</a> <span class="id">${escapeHtml(node.id)}</span>`
    : d.node
      ? ` on <span class="id">${escapeHtml(d.node)}</span>`
      : "";
  const dflt = d.default
    ? ` <span class="note">Default: ${escapeHtml(d.default)}</span>`
    : "";
  return `<li data-open-decision="${escapeHtml(d.id)}"><span class="id">${escapeHtml(d.id)}</span>${where}: ${escapeHtml(d.question)}${dflt}</li>`;
}

function waitingSection(
  state: State,
  classes: Map<string, NodeClass>,
  commit: PageCommit,
): string {
  const byId = nodesById(state);
  const open = state.decisions.filter((d) => d.chosen === null);
  const gated = state.nodes.filter((n) => classes.get(n.id) === "gated");
  const lines = ["<section data-waiting>", "<h2>Waiting on you</h2>"];
  if (open.length === 0 && gated.length === 0) {
    lines.push('<p class="note" data-empty>Nothing.</p>');
  }
  if (open.length > 0) {
    lines.push(
      `<p class="note">${open.length} open decision${open.length === 1 ? "" : "s"}:</p>`,
      '<ul class="plain">',
    );
    for (const d of open) lines.push(decisionItem(d, byId, commit));
    lines.push("</ul>");
  }
  if (gated.length > 0) {
    lines.push(
      `<p class="note">${gated.length} gated node${gated.length === 1 ? "" : "s"}:</p>`,
      '<ul class="plain">',
    );
    for (const n of gated) {
      lines.push(
        `<li data-gated="${escapeHtml(n.id)}">${titleLink(n, commit)}<br><span class="hold">${escapeHtml(n.hold!.reason)}</span></li>`,
      );
    }
    lines.push("</ul>");
  }
  lines.push("</section>");
  return lines.join("\n");
}

function nodeList(
  heading: string,
  attribute: string,
  nodes: Node[],
  state: State,
  commit: PageCommit,
  detail: (n: Node) => string,
): string {
  const lines = [`<section ${attribute}>`, `<h2>${escapeHtml(heading)}</h2>`];
  if (nodes.length === 0) {
    lines.push('<p class="note" data-empty>None.</p>');
  } else {
    lines.push('<ul class="plain">');
    for (const n of nodes) {
      const extra = detail(n);
      lines.push(
        `<li>${titleLink(n, commit)} <span class="stage">[${escapeHtml(n.stage)}]</span>${extra ? ` <span class="note">${extra}</span>` : ""}${n.outcome ? `<br><span class="note">${escapeHtml(n.outcome)}</span>` : ""}</li>`,
      );
    }
    lines.push("</ul>");
  }
  lines.push("</section>");
  return lines.join("\n");
}

function legend(): string {
  const order: NodeClass[] = [
    "gated",
    "blocked",
    "in-flight",
    "in-progress",
    "waiting",
    "actionable",
    "done",
    "parked",
  ];
  return `<ul class="legend">${order.map((c) => `<li>${classBadge(c)}</li>`).join("")}</ul>`;
}

function treeRow(n: Node, cls: NodeClass, commit: PageCommit): string {
  const hold = n.hold
    ? `<span class="hold" data-hold>${escapeHtml(n.hold.kind)}: ${escapeHtml(n.hold.reason)}</span>`
    : "";
  const done =
    n.stage === "done" && n.done
      ? ` <span class="stage">done ${escapeHtml(n.done)}</span>`
      : ` <span class="stage">[${escapeHtml(n.stage)}]</span>`;
  const outcome = n.outcome
    ? `<span class="row-outcome" data-outcome>${escapeHtml(n.outcome)}</span>`
    : "";
  return `${classBadge(cls)} ${titleLink(n, commit)}${done}${outcome}${hold}`;
}

function renderTree(
  state: State,
  classes: Map<string, NodeClass>,
  commit: PageCommit,
): string {
  const children = childrenOf(state);
  const visit = (n: Node, depth: number): string => {
    const kids = children.get(n.id) ?? [];
    const cls = classes.get(n.id)!;
    const row = treeRow(n, cls, commit);
    if (kids.length === 0) {
      return `<li data-node="${escapeHtml(n.id)}"><div class="leaf">${row}</div></li>`;
    }
    const open = depth === 0 ? " open" : "";
    return [
      `<li data-node="${escapeHtml(n.id)}"><details${open}><summary>${row}</summary>`,
      "<ul>",
      ...kids.map((k) => visit(k, depth + 1)),
      "</ul>",
      "</details></li>",
    ].join("\n");
  };
  return [
    '<ul class="tree" data-tree>',
    ...state.nodes.filter((n) => n.parent === null).map((n) => visit(n, 0)),
    "</ul>",
  ].join("\n");
}

export function renderTreePage(read: StateAtPage, commit: PageCommit): string {
  const title = read.state ? `Plan: ${read.state.project}` : "Plan";
  const body: string[] = [
    pageHeader(commit, "/view"),
    sourceLine(commit, commit.sha),
    "<main>",
  ];
  if (read.state === null) {
    body.push(
      `<h1>${escapeHtml(title)}</h1>`,
      problemsSection(read.findings),
      "</main>",
    );
    return pageShell(title, body.join("\n"));
  }
  const state = read.state;
  const classes = classifyAll(state);
  const byId = nodesById(state);
  const openTasks = state.tasks.filter((t) => t.status === "open");
  body.push(
    `<h1>${escapeHtml(title)}</h1>`,
    '<div class="columns">',
    waitingSection(state, classes, commit),
    nodeList(
      "Ready to start",
      "data-ready",
      state.nodes.filter((n) => classes.get(n.id) === "actionable"),
      state,
      commit,
      () => "",
    ),
    nodeList(
      "In flight",
      "data-in-flight",
      state.nodes.filter((n) => classes.get(n.id) === "in-flight"),
      state,
      commit,
      (n) =>
        openTasks
          .filter((t) => t.node === n.id)
          .map((t) => t.id)
          .join(", "),
    ),
    nodeList(
      "Waiting on a dependency",
      "data-waiting-on",
      state.nodes.filter((n) => classes.get(n.id) === "waiting"),
      state,
      commit,
      (n) =>
        "after " +
        n.after
          .filter((d) => byId.get(d)?.stage !== "done")
          .map((d) => escapeHtml(byId.get(d)?.title ?? d))
          .join(", "),
    ),
    "</div>",
    "<section data-plan>",
    "<h2>The plan</h2>",
    legend(),
    renderTree(state, classes, commit),
    "</section>",
    problemsSection(read.findings),
    "</main>",
  );
  return pageShell(title, body.join("\n"));
}
