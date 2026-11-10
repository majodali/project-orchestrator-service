/**
 * The node page, `GET /view/node/<node ID>` (the rebuild plan,
 * milestone 2): one node of the state file at one commit. Its place in
 * the tree, its class and stage, its outcome, what it waits on and
 * what waits on it, its documents at the page's SHA, its decisions and
 * its tasks. No criteria labels and no rulings.
 */

import {
  NODE_CLASS_LABELS,
  attentionReason,
  childrenOf,
  classifyAll,
  nodesById,
  type NodeClass,
} from "../model/check.js";
import type { Decision, Node, State, Task } from "../model/schema.js";
import type { PageCommit } from "./html.js";
import {
  blobUrl,
  escapeHtml,
  pageHeader,
  pageShell,
  sourceLine,
  viewLink,
} from "./html.js";
import {
  classBadge,
  nodeHref,
  nodePagePath,
  pullRequestUrl,
  taskPagePath,
} from "./parts.js";

function field(name: string, heading: string, body: string): string {
  return `<dt>${escapeHtml(heading)}</dt><dd data-field="${name}">${body}</dd>`;
}

function nodeRef(
  n: Node,
  classes: Map<string, NodeClass>,
  commit: PageCommit,
): string {
  return `${classBadge(classes.get(n.id)!)} <a href="${escapeHtml(nodeHref(n.id, commit.requestedRef))}">${escapeHtml(n.title)}</a> <span class="id">${escapeHtml(n.id)}</span>`;
}

function nodeRefs(
  nodes: Node[],
  classes: Map<string, NodeClass>,
  commit: PageCommit,
  empty: string,
): string {
  if (nodes.length === 0)
    return `<span class="note">${escapeHtml(empty)}</span>`;
  return `<ul class="plain">${nodes.map((n) => `<li>${nodeRef(n, classes, commit)}</li>`).join("")}</ul>`;
}

function crumbs(
  node: Node,
  byId: Map<string, Node>,
  commit: PageCommit,
): string {
  const chain: Node[] = [];
  let p = node.parent === null ? undefined : byId.get(node.parent);
  while (p) {
    chain.unshift(p);
    p = p.parent === null ? undefined : byId.get(p.parent);
  }
  const parts = [
    `<a href="${escapeHtml(viewLink("/view", commit.requestedRef))}">Plan</a>`,
  ];
  for (const c of chain) {
    parts.push(
      `<a href="${escapeHtml(nodeHref(c.id, commit.requestedRef))}">${escapeHtml(c.title)}</a>`,
    );
  }
  return `<p class="crumbs" data-crumbs>${parts.join(" › ")}</p>`;
}

function documentsField(node: Node, commit: PageCommit): string {
  const links: string[] = [];
  for (const [label, p] of [
    ["plan", node.docs.plan],
    ["spec", node.docs.spec],
  ] as const) {
    if (p) {
      links.push(
        `<a data-document="${label}" href="${escapeHtml(blobUrl(commit, commit.sha, p))}">${escapeHtml(label)}: ${escapeHtml(p)}</a>`,
      );
    }
  }
  return links.length > 0
    ? links.join("<br>")
    : '<span class="note">none</span>';
}

function decisionRow(d: Decision): string {
  const status =
    d.chosen === null
      ? `<span class="badge c-gated">open</span> ${d.default ? `default: ${escapeHtml(d.default)}` : ""}`
      : `<span class="badge c-done">${d.standing ? "standing" : "closed"}</span> ${escapeHtml(d.chosen)}${d.decided ? ` <span class="note">(${escapeHtml(d.decided)})</span>` : ""}`;
  const source = d.source
    ? `<br><span class="note">${escapeHtml(d.source)}</span>`
    : "";
  return `<li data-decision="${escapeHtml(d.id)}"><span class="id">${escapeHtml(d.id)}</span> ${escapeHtml(d.question)}<br>${status}${d.rationale ? `<br><span class="note">${escapeHtml(d.rationale)}</span>` : ""}${source}</li>`;
}

function decisionsSection(node: Node, state: State): string {
  const own = state.decisions.filter((d) => d.node === node.id);
  if (own.length === 0) return "";
  const open = own.filter((d) => d.chosen === null);
  const closed = own.filter((d) => d.chosen !== null);
  return [
    "<section data-decisions>",
    "<h2>Decisions</h2>",
    '<ul class="plain">',
    ...open.map(decisionRow),
    ...closed.map(decisionRow),
    "</ul>",
    "</section>",
  ].join("\n");
}

function taskRow(t: Task, commit: PageCommit): string {
  const pr = t.pr ? pullRequestUrl(t.pr) : null;
  const prCell = t.pr
    ? pr
      ? `<a href="${escapeHtml(pr)}">${escapeHtml(t.pr)}</a>`
      : escapeHtml(t.pr)
    : "";
  return [
    `<tr data-task="${escapeHtml(t.id)}">`,
    `<td><a href="${escapeHtml(viewLink(taskPagePath(t.id), commit.requestedRef))}">${escapeHtml(t.id)}</a></td>`,
    `<td>${escapeHtml(t.step)}</td>`,
    `<td>${escapeHtml(t.status)}</td>`,
    `<td>${escapeHtml(t.opened?.slice(0, 10) ?? "")}</td>`,
    `<td>${escapeHtml(t.closed?.slice(0, 10) ?? "")}</td>`,
    `<td>${prCell}</td>`,
    `<td>${escapeHtml(t.summary ?? "")}</td>`,
    "</tr>",
  ].join("");
}

function tasksSection(node: Node, state: State, commit: PageCommit): string {
  const own = state.tasks
    .filter((t) => t.node === node.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const body =
    own.length === 0
      ? '<p class="note" data-empty>No task has run on this node.</p>'
      : [
          '<div class="table-wrap"><table class="tasks">',
          "<thead><tr><th>Task</th><th>Step</th><th>Status</th><th>Opened</th><th>Closed</th><th>Pull request</th><th>Summary</th></tr></thead>",
          "<tbody>",
          ...own.map((t) => taskRow(t, commit)),
          "</tbody></table></div>",
        ].join("\n");
  return ["<section data-tasks>", "<h2>Tasks</h2>", body, "</section>"].join(
    "\n",
  );
}

export function renderNodePage(
  state: State,
  node: Node,
  commit: PageCommit,
): string {
  const byId = nodesById(state);
  const classes = classifyAll(state);
  const children = childrenOf(state);
  const cls = classes.get(node.id)!;
  const waitsOn = node.after
    .map((d) => byId.get(d))
    .filter((n): n is Node => n !== undefined);
  const neededBy = state.nodes.filter((n) => n.after.includes(node.id));
  const parent = node.parent === null ? undefined : byId.get(node.parent);
  const stage =
    node.stage === "done" && node.done ? `done ${node.done}` : node.stage;
  const hold = node.hold
    ? `<p class="hold" data-hold>${escapeHtml(node.hold.kind)}: ${escapeHtml(node.hold.reason)}</p>`
    : cls === "gated"
      ? `<p class="hold" data-hold>${escapeHtml(attentionReason(node))}</p>`
      : "";
  const body = [
    pageHeader(commit, nodePagePath(node.id)),
    sourceLine(commit, commit.sha),
    "<main>",
    crumbs(node, byId, commit),
    `<h1 data-title>${escapeHtml(node.title)}<span class="id" data-node-id>${escapeHtml(node.id)}</span></h1>`,
    `<p>${classBadge(cls)} <span class="stage" data-stage>${escapeHtml(stage)}</span>${cls === "done" || cls === "parked" ? "" : ` <span class="note">${escapeHtml(NODE_CLASS_LABELS[cls])}</span>`}</p>`,
    hold,
    node.outcome
      ? `<p class="outcome" data-outcome>${escapeHtml(node.outcome)}</p>`
      : '<p class="note" data-outcome>No outcome sentence recorded yet.</p>',
    node.note ? `<p class="note" data-note>${escapeHtml(node.note)}</p>` : "",
    '<div class="columns">',
    "<section>",
    "<h2>Position</h2>",
    "<dl>",
    field(
      "parent",
      "Parent",
      parent
        ? nodeRef(parent, classes, commit)
        : '<span class="note">a top-level line of work</span>',
    ),
    field(
      "children",
      "Children",
      nodeRefs(children.get(node.id) ?? [], classes, commit, "none"),
    ),
    field("documents", "Documents", documentsField(node, commit)),
    field(
      "start",
      "Start",
      node.start === "auto"
        ? "automatic, when its dependencies are done"
        : "needs the owner's approval when ready",
    ),
    "</dl>",
    "</section>",
    "<section>",
    "<h2>Dependencies</h2>",
    "<dl>",
    field(
      "waits-on",
      "Waits on",
      nodeRefs(waitsOn, classes, commit, "nothing recorded"),
    ),
    field(
      "needed-by",
      "Needed by",
      nodeRefs(neededBy, classes, commit, "nothing recorded"),
    ),
    "</dl>",
    "</section>",
    "</div>",
    decisionsSection(node, state),
    tasksSection(node, state, commit),
    "</main>",
  ].join("\n");
  return pageShell(`${node.title} (${node.id})`, body);
}
