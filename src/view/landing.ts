/**
 * The first screen of `/view`, ahead of the tree (the specification of
 * P2-N028, section 1, criteria 7 to 11): four sections, in order --
 * "Needs you", "Ready", "Running" and "Just finished" -- each with its
 * own empty line when it has no row. "Needs you" holds exactly what
 * the orchestrator's own `stateReports` would report (majodali/
 * project-orchestrator, plugin/scripts/lib/orchestrate.ts): an open
 * decision, a node held (a check node held `blocked` excepted, since
 * that hold only offers the rework and is not the owner's to lift),
 * and a node whose start waits for approval, in that order; a node
 * below a held or parked node has no row.
 *
 * A held node's row links its pull request and the state of its
 * checks when the task that set the hold carries one (a "review"
 * row); that information is fetched over the network, so it is read
 * once by the route (./routes.ts) and handed in as `reviews`, keeping
 * this module a pure renderer.
 */

import {
  childrenOf,
  classifyAll,
  isHiddenCheck,
  nodesById,
  openTaskByNode,
  pausedBy,
  type NodeClass,
} from "../model/check.js";
import {
  candidates,
  failedCheckNode,
  offerOn,
  type Candidate,
} from "../model/loop.js";
import type { Decision, Node, State, Task } from "../model/schema.js";
import { decisionForm, nodeActionForms } from "./actions.js";
import { escapeHtml, richText, viewLink, type PageCommit } from "./html.js";
import { classBadge, nodeHref, pullRequestUrl, taskPagePath } from "./parts.js";

export interface NeedsYouRow {
  kind: "decision" | "hold" | "approval";
  node: Node;
  decision?: Decision;
}

/** The state of a held node's pull request, read once by the route
 * over the network; `null` when it could not be read. */
export interface ReviewInfo {
  pr: string;
  url: string | null;
  checks: { state: string; failing: string[] } | null;
}

/** The task whose close most recently touched a node: for a held node
 * this is the task that set the hold, open or not (loop.ts sets a
 * hold only at a task's close, and a held node carries no open task
 * of its own). Tasks are appended in the order they were opened, so
 * the last one on the node is the most recent. */
export function latestTaskOf(state: State, nodeId: string): Task | undefined {
  const own = state.tasks.filter((t) => t.node === nodeId);
  return own.length > 0 ? own[own.length - 1] : undefined;
}

/** The pull request to show on a held node's row, when its holding
 * task carries one. */
export function reviewRefOf(state: State, nodeId: string): string | null {
  return latestTaskOf(state, nodeId)?.pr ?? null;
}

/** "Needs you", exactly as the orchestrator's `stateReports` would
 * report it, in the order of section 1: every open decision, then
 * every held node (a failed check node excepted), then every node
 * whose start waits for approval. */
export function needsYouRows(state: State): NeedsYouRow[] {
  const byId = nodesById(state);
  const openTasks = openTaskByNode(state);
  const decisions: NeedsYouRow[] = [];
  const holds: NeedsYouRow[] = [];
  const approvals: NeedsYouRow[] = [];
  for (const node of state.nodes) {
    if (pausedBy(node, byId) !== undefined) continue;
    // A hidden check node has no row of its own: an open decision on
    // it is keyed to the node it verifies, whose row is shown (the
    // same rule the tree page applies, treePage.ts).
    const hidden = isHiddenCheck(node, openTasks);
    const displayNode = hidden ? (byId.get(node.parent ?? "") ?? node) : node;
    for (const d of state.decisions) {
      if (d.node === node.id && d.chosen === null) {
        decisions.push({ kind: "decision", node: displayNode, decision: d });
      }
    }
    if (hidden) continue;
    const live = node.stage !== "done" && node.stage !== "parked";
    if (live && node.hold !== null) {
      const failedCheck = node.kind === "check" && node.hold.kind === "blocked";
      if (!failedCheck) holds.push({ kind: "hold", node });
    } else if (live) {
      const offer = offerOn(node, state, byId);
      if (!offer.offered && offer.why.reason === "approval") {
        approvals.push({ kind: "approval", node });
      }
    }
  }
  return [...decisions, ...holds, ...approvals];
}

function titleLink(n: Node, commit: PageCommit): string {
  return `<a href="${escapeHtml(nodeHref(n.id, commit.requestedRef))}">${escapeHtml(n.title)}</a> <span class="id">${escapeHtml(n.id)}</span>`;
}

/** An author's free text, with its line breaks and blank lines shown
 * as written and a backtick run in the page's code style (P2-N077). */
function richSpan(value: string, extraClass = ""): string {
  return `<span class="pre${extraClass ? ` ${extraClass}` : ""}">${richText(value)}</span>`;
}

function reviewLine(info: ReviewInfo | undefined): string {
  if (info === undefined) return "";
  const prLink = info.url
    ? `<a href="${escapeHtml(info.url)}">${escapeHtml(info.pr)}</a>`
    : escapeHtml(info.pr);
  const checksText =
    info.checks === null
      ? `<span data-review-checks="unavailable">unavailable</span>`
      : `<span class="checks-${escapeHtml(info.checks.state)}" data-review-checks="${escapeHtml(info.checks.state)}">${escapeHtml(info.checks.state === "none" ? "none ran" : info.checks.state)}${info.checks.failing.length > 0 ? `: ${escapeHtml(info.checks.failing.join(", "))}` : ""}</span>`;
  return `<p class="note" data-review="${escapeHtml(info.pr)}">Pull request: ${prLink}. Checks: ${checksText}.</p>`;
}

function needsYouRow(
  row: NeedsYouRow,
  state: State,
  commit: PageCommit,
  reviews: ReadonlyMap<string, ReviewInfo>,
  classes: Map<string, NodeClass>,
): string {
  const { node } = row;
  if (row.kind === "decision") {
    const d = row.decision!;
    const dflt = d.default
      ? ` <span class="note">Default: ${richSpan(d.default)}</span>`
      : "";
    return [
      `<li data-needs-you-row="decision" data-node="${escapeHtml(node.id)}" data-open-decision="${escapeHtml(d.id)}">`,
      `${titleLink(node, commit)}: <span class="id">${escapeHtml(d.id)}</span> ${richSpan(d.question)}${dflt}`,
      decisionForm(d),
      "</li>",
    ].join("");
  }
  if (row.kind === "hold") {
    return [
      `<li data-needs-you-row="hold" data-node="${escapeHtml(node.id)}">`,
      `${classBadge(classes.get(node.id)!)} ${titleLink(node, commit)}`,
      `<p class="hold pre" data-hold>${escapeHtml(node.hold!.kind)}: ${richText(node.hold!.reason)}</p>`,
      reviewLine(reviews.get(node.id)),
      nodeActionForms(node, state),
      "</li>",
    ].join("");
  }
  return [
    `<li data-needs-you-row="approval" data-node="${escapeHtml(node.id)}">`,
    `${classBadge(classes.get(node.id)!)} ${titleLink(node, commit)}`,
    `<p class="hold" data-hold>start needs the owner's approval</p>`,
    nodeActionForms(node, state),
    "</li>",
  ].join("");
}

function emptySection(name: string, text: string): string {
  return `<p class="note" data-empty="${escapeHtml(name)}">${escapeHtml(text)}</p>`;
}

function needsYouSection(
  state: State,
  commit: PageCommit,
  reviews: ReadonlyMap<string, ReviewInfo>,
): string {
  const rows = needsYouRows(state);
  const classes = classifyAll(state);
  const body =
    rows.length === 0
      ? emptySection("needs-you", "Nothing needs you.")
      : `<ul class="plain" data-rows>${rows.map((r) => needsYouRow(r, state, commit, reviews, classes)).join("")}</ul>`;
  return [
    "<section data-needs-you>",
    "<h2>Needs you</h2>",
    body,
    "</section>",
  ].join("\n");
}

function readyRow(c: Candidate, commit: PageCommit): string {
  return `<li data-node="${escapeHtml(c.node.id)}">${titleLink(c.node, commit)}: offers <span data-step>${escapeHtml(c.step)}</span> to the ${escapeHtml(c.role)}</li>`;
}

function readySection(state: State, commit: PageCommit): string {
  const rows = candidates(state);
  const body =
    rows.length === 0
      ? emptySection("ready", "Nothing is ready to start without you.")
      : `<ul class="plain" data-rows>${rows.map((c) => readyRow(c, commit)).join("")}</ul>`;
  return ["<section data-ready>", "<h2>Ready</h2>", body, "</section>"].join(
    "\n",
  );
}

function runningRow(
  t: Task,
  state: State,
  children: Map<string, Node[]>,
  byId: Map<string, Node>,
  commit: PageCommit,
): string {
  const node = byId.get(t.node);
  const rework =
    node !== undefined && failedCheckNode(node, children) !== undefined;
  const prLink = t.pr
    ? pullRequestUrl(t.pr)
      ? `<a href="${escapeHtml(pullRequestUrl(t.pr)!)}">${escapeHtml(t.pr)}</a>`
      : escapeHtml(t.pr)
    : "";
  return [
    `<li data-task="${escapeHtml(t.id)}" data-node="${escapeHtml(t.node)}"${rework ? " data-rework" : ""}>`,
    `<a href="${escapeHtml(viewLink(taskPagePath(t.id), commit.requestedRef))}">${escapeHtml(t.id)}</a> `,
    node ? titleLink(node, commit) : escapeHtml(t.node),
    `: <span data-step>${escapeHtml(t.step)}</span>, ${escapeHtml(t.role ?? "no role recorded")}`,
    rework ? `, <span class="note">rework; starts without you</span>` : "",
    t.opened ? `, open since <time>${escapeHtml(t.opened)}</time>` : "",
    prLink ? ` (${prLink})` : "",
    "</li>",
  ].join("");
}

function runningSection(state: State, commit: PageCommit): string {
  const open = state.tasks.filter((t) => t.status === "open");
  const children = childrenOf(state);
  const byId = nodesById(state);
  const body =
    open.length === 0
      ? emptySection("running", "Nothing is running.")
      : `<ul class="plain" data-rows>${open.map((t) => runningRow(t, state, children, byId, commit)).join("")}</ul>`;
  return [
    "<section data-running>",
    "<h2>Running</h2>",
    body,
    "</section>",
  ].join("\n");
}

const JUST_FINISHED_HOURS = 24;
const JUST_FINISHED_MAX = 10;

function justFinishedRow(
  t: Task,
  byId: Map<string, Node>,
  commit: PageCommit,
): string {
  const node = byId.get(t.node);
  return [
    `<li data-task="${escapeHtml(t.id)}" data-node="${escapeHtml(t.node)}">`,
    `<a href="${escapeHtml(viewLink(taskPagePath(t.id), commit.requestedRef))}">${escapeHtml(t.id)}</a> `,
    node ? titleLink(node, commit) : escapeHtml(t.node),
    `: <span data-step>${escapeHtml(t.step)}</span>, <span data-status>${escapeHtml(t.status)}</span>`,
    t.closed ? `, closed <time>${escapeHtml(t.closed)}</time>` : "",
    t.summary ? `: ${richSpan(t.summary)}` : "",
    "</li>",
  ].join("");
}

function justFinishedSection(state: State, commit: PageCommit): string {
  const nowMs = Date.parse(commit.fetchedAt);
  const limit = JUST_FINISHED_HOURS * 3600 * 1000;
  const rows = state.tasks
    .filter(
      (t) =>
        t.status !== "open" &&
        t.closed !== null &&
        Number.isFinite(nowMs) &&
        nowMs - Date.parse(t.closed) <= limit,
    )
    .sort((a, b) =>
      b.closed! < a.closed! ? -1 : b.closed! > a.closed! ? 1 : 0,
    )
    .slice(0, JUST_FINISHED_MAX);
  const byId = nodesById(state);
  const body =
    rows.length === 0
      ? emptySection("just-finished", "Nothing finished in the last 24 hours.")
      : `<ul class="plain" data-rows>${rows.map((t) => justFinishedRow(t, byId, commit)).join("")}</ul>`;
  return [
    "<section data-just-finished>",
    "<h2>Just finished</h2>",
    body,
    "</section>",
  ].join("\n");
}

/** The four sections, in order, ahead of the tree (criterion 7). */
export function renderLandingSections(
  state: State,
  commit: PageCommit,
  reviews: ReadonlyMap<string, ReviewInfo> = new Map(),
): string {
  return [
    '<div class="columns" data-landing>',
    needsYouSection(state, commit, reviews),
    readySection(state, commit),
    runningSection(state, commit),
    justFinishedSection(state, commit),
    "</div>",
  ].join("\n");
}
