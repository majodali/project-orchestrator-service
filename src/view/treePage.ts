/**
 * The tree page, `GET /view` (the rebuild plan, milestone 2, as the
 * owner directed on 2026-11-10). The plan hierarchy is the primary
 * view: every node in its tree, read in the context of its parent and
 * siblings. What needs attention shows in that context, not in lists:
 *
 * - a node waiting on the owner (a hold, or a ready node whose start
 *   needs approval) is marked, and every ancestor carries a flag with
 *   the count of such nodes below it;
 * - the paths to those nodes are unfolded on load, and everything
 *   else is folded, roots included, so a large plan opens small;
 * - open decisions sit under the node they belong to;
 * - `?open=` picks what is unfolded: `owner` (the default), `active`
 *   (also in flight), `all`, or `roots`. The page runs no script, so
 *   the unfold is the server's.
 *
 * "Ready" is not a category of its own: a ready node starts
 * automatically unless its `start` is `approve`, and then it waits on
 * the owner.
 */

import {
  attentionReason,
  childrenOf,
  classifyAll,
  nodesById,
  shownNodes,
  type Finding,
  type NodeClass,
} from "../model/check.js";
import type { Decision, Node, State } from "../model/schema.js";
import { committedLine, decisionForm } from "./actions.js";
import type { PageCommit } from "./html.js";
import { escapeHtml, pageHeader, pageShell, sourceLine } from "./html.js";
import { classBadge, nodeHref } from "./parts.js";
import type { StateAtPage } from "./stateRead.js";
import { STATE_PATH } from "./stateRead.js";

export const OPEN_MODES = ["owner", "active", "all", "roots"] as const;
export type OpenMode = (typeof OPEN_MODES)[number];

export function openMode(value: string | undefined): OpenMode {
  return (OPEN_MODES as readonly string[]).includes(value ?? "")
    ? (value as OpenMode)
    : "owner";
}

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

/** An open decision under its node: the question, the default, and a
 * link to the node page, where the form that closes it is. */
function decisionLine(d: Decision, commit: PageCommit): string {
  const dflt = d.default
    ? ` <span class="note">Default: ${escapeHtml(d.default)}</span>`
    : "";
  const answer =
    d.node === null
      ? ""
      : ` <a href="${escapeHtml(nodeHref(d.node, commit.requestedRef))}#${escapeHtml(d.id)}">answer</a>`;
  return `<li data-open-decision="${escapeHtml(d.id)}"><span class="id">${escapeHtml(d.id)}</span> ${escapeHtml(d.question)}${dflt}${answer}</li>`;
}

/** A project decision, on no node, with the form that closes it. */
function projectDecision(d: Decision): string {
  const dflt = d.default
    ? ` <span class="note">Default: ${escapeHtml(d.default)}</span>`
    : "";
  return `<li id="${escapeHtml(d.id)}" data-open-decision="${escapeHtml(d.id)}"><span class="id">${escapeHtml(d.id)}</span> ${escapeHtml(d.question)}${dflt}${decisionForm(d)}</li>`;
}

/** Counts over a node's subtree, the node itself included. */
interface Below {
  owner: number;
  inFlight: number;
  decisions: number;
}

function countBelow(
  state: State,
  classes: Map<string, NodeClass>,
  openDecisions: Map<string, Decision[]>,
): Map<string, Below> {
  const children = childrenOf(state);
  const out = new Map<string, Below>();
  const visit = (n: Node): Below => {
    const own: Below = {
      owner: classes.get(n.id) === "gated" ? 1 : 0,
      inFlight: classes.get(n.id) === "in-flight" ? 1 : 0,
      decisions: openDecisions.get(n.id)?.length ?? 0,
    };
    for (const c of children.get(n.id) ?? []) {
      const b = visit(c);
      own.owner += b.owner;
      own.inFlight += b.inFlight;
      own.decisions += b.decisions;
    }
    out.set(n.id, own);
    return own;
  };
  for (const n of state.nodes) if (n.parent === null) visit(n);
  return out;
}

function needsAttention(b: Below): boolean {
  return b.owner > 0 || b.decisions > 0;
}

function flags(b: Below, own: Below): string {
  const parts: string[] = [];
  const belowOwner = b.owner - own.owner + (b.decisions - own.decisions);
  if (belowOwner > 0) {
    parts.push(
      `<span class="flag f-owner" data-below-owner="${belowOwner}">${belowOwner} waiting on you below</span>`,
    );
  }
  const belowFlight = b.inFlight - own.inFlight;
  if (belowFlight > 0) {
    parts.push(
      `<span class="flag f-flight" data-below-flight="${belowFlight}">${belowFlight} in flight below</span>`,
    );
  }
  return parts.join(" ");
}

function treeRow(
  n: Node,
  cls: NodeClass,
  below: Below,
  own: Below,
  decisions: Decision[],
  commit: PageCommit,
): string {
  const attention =
    cls === "gated"
      ? `<span class="hold" data-hold>${escapeHtml(attentionReason(n))}</span>`
      : cls === "blocked"
        ? `<span class="hold" data-hold>blocked: ${escapeHtml(n.hold!.reason)}</span>`
        : "";
  const stage =
    n.stage === "done" && n.done
      ? ` <span class="stage">done ${escapeHtml(n.done)}</span>`
      : ` <span class="stage">[${escapeHtml(n.stage)}]</span>`;
  const outcome = n.outcome
    ? `<span class="row-outcome" data-outcome>${escapeHtml(n.outcome)}</span>`
    : "";
  const list =
    decisions.length > 0
      ? `<ul class="decisions" data-decisions-of="${escapeHtml(n.id)}">${decisions.map((d) => decisionLine(d, commit)).join("")}</ul>`
      : "";
  const kind =
    n.kind === "check"
      ? '<span class="kind" data-kind="check">check</span> '
      : "";
  return `${classBadge(cls)} ${kind}${titleLink(n, commit)}${stage} ${flags(below, own)}${outcome}${attention}${list}`;
}

function renderTree(
  state: State,
  classes: Map<string, NodeClass>,
  openDecisions: Map<string, Decision[]>,
  mode: OpenMode,
  commit: PageCommit,
): string {
  const children = childrenOf(state);
  const below = countBelow(state, classes, openDecisions);
  const isOpen = (n: Node, depth: number): boolean => {
    if (mode === "all") return true;
    if (mode === "roots") return depth === 0;
    const b = below.get(n.id)!;
    if (needsAttention(b)) return true;
    return mode === "active" && b.inFlight > 0;
  };
  const visit = (n: Node, depth: number): string => {
    const kids = children.get(n.id) ?? [];
    const cls = classes.get(n.id)!;
    const b = below.get(n.id)!;
    const own: Below = {
      owner: cls === "gated" ? 1 : 0,
      inFlight: cls === "in-flight" ? 1 : 0,
      decisions: openDecisions.get(n.id)?.length ?? 0,
    };
    const attention = needsAttention(own) ? " attention" : "";
    const row = treeRow(n, cls, b, own, openDecisions.get(n.id) ?? [], commit);
    if (kids.length === 0) {
      return `<li data-node="${escapeHtml(n.id)}"><div class="leaf${attention}">${row}</div></li>`;
    }
    const open = isOpen(n, depth) ? " open" : "";
    return [
      `<li data-node="${escapeHtml(n.id)}"><details${open}><summary class="${attention.trim()}">${row}</summary>`,
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

function modeLinks(mode: OpenMode, commit: PageCommit): string {
  const labels: Record<OpenMode, string> = {
    owner: "waiting on you",
    active: "waiting on you and in flight",
    all: "everything",
    roots: "roots only",
  };
  const parts = OPEN_MODES.map((m) => {
    const params = new URLSearchParams();
    if (commit.requestedRef !== undefined)
      params.set("ref", commit.requestedRef);
    if (m !== "owner") params.set("open", m);
    const query = params.toString();
    const href = query ? `/view?${query}` : "/view";
    return m === mode
      ? `<strong data-open-mode="${m}">${labels[m]}</strong>`
      : `<a data-open-mode="${m}" href="${escapeHtml(href)}">${labels[m]}</a>`;
  });
  return `<p class="note" data-unfold>Unfolded: ${parts.join(" · ")}</p>`;
}

function summary(
  state: State,
  classes: Map<string, NodeClass>,
  openDecisions: Map<string, Decision[]>,
): string {
  // Counts are over the work nodes: check nodes count in no total.
  const count = (c: NodeClass): number =>
    state.nodes.filter((n) => n.kind !== "check" && classes.get(n.id) === c)
      .length;
  const total = state.nodes.filter((n) => n.kind !== "check").length;
  const decisions = state.decisions.filter((d) => d.chosen === null).length;
  const owner = count("gated");
  const parts = [
    `<span data-count-owner="${owner}">${owner} node${owner === 1 ? "" : "s"} waiting on you</span>`,
    `<span data-count-decisions="${decisions}">${decisions} open decision${decisions === 1 ? "" : "s"}</span>`,
    `<span data-count-flight="${count("in-flight")}">${count("in-flight")} in flight</span>`,
    `<span data-count-waiting="${count("waiting")}">${count("waiting")} waiting on a dependency</span>`,
    `<span data-count-blocked="${count("blocked")}">${count("blocked")} blocked</span>`,
    `<span data-count-done="${count("done")}">${count("done")} of ${total} done</span>`,
  ];
  const project = openDecisions.get("") ?? [];
  const projectList =
    project.length > 0
      ? `<p class="note">Project decisions, on no node:</p><ul class="decisions project" data-decisions-of="">${project.map(projectDecision).join("")}</ul>`
      : "";
  return `<section data-summary><p class="counts">${parts.join(" · ")}</p>${projectList}</section>`;
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

export function renderTreePage(
  read: StateAtPage,
  commit: PageCommit,
  mode: OpenMode = "owner",
  committed?: string,
): string {
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
  // Hidden check nodes stay out of the tree; shown ones (failed or in
  // flight) sit under the node they verify.
  const state: State = { ...read.state, nodes: shownNodes(read.state) };
  const classes = classifyAll(state);
  nodesById(state); // the ids are valid: checkState passed the schema
  const openDecisions = new Map<string, Decision[]>();
  for (const d of state.decisions) {
    if (d.chosen !== null) continue;
    const key = d.node ?? "";
    if (!openDecisions.has(key)) openDecisions.set(key, []);
    openDecisions.get(key)!.push(d);
  }
  body.push(
    `<h1>${escapeHtml(title)}</h1>`,
    committedLine(commit, committed, commit.sha),
    summary(state, classes, openDecisions),
    "<section data-plan>",
    modeLinks(mode, commit),
    legend(),
    renderTree(state, classes, openDecisions, mode, commit),
    "</section>",
    problemsSection(read.findings),
    "</main>",
  );
  return pageShell(title, body.join("\n"));
}
