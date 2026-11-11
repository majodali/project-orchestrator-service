/**
 * The task page, `GET /view/task/<task ID>` (the rebuild plan,
 * milestone 2): one task of the state file at one commit, with its
 * node, its fields and its notes.
 */

import { nodesById } from "../model/check.js";
import type { State, Task } from "../model/schema.js";
import type { PageCommit } from "./html.js";
import {
  commitUrl,
  escapeHtml,
  pageHeader,
  pageShell,
  sourceLine,
  viewLink,
} from "./html.js";
import { nodePagePath, pullRequestUrl, taskPagePath } from "./parts.js";

function field(name: string, heading: string, body: string): string {
  return `<dt>${escapeHtml(heading)}</dt><dd data-field="${name}">${body}</dd>`;
}

function text(value: string | number | null): string {
  return value === null
    ? '<span class="note">none</span>'
    : escapeHtml(String(value));
}

export function renderTaskPage(
  state: State,
  task: Task,
  commit: PageCommit,
): string {
  const node = nodesById(state).get(task.node);
  const nodeLink = node
    ? `<a href="${escapeHtml(viewLink(nodePagePath(node.id), commit.requestedRef))}">${escapeHtml(node.title)}</a> <span class="id">${escapeHtml(node.id)}</span>`
    : `<span class="id">${escapeHtml(task.node)}</span> <span class="note">(not in the state file)</span>`;
  const pr = task.pr ? pullRequestUrl(task.pr) : null;
  const ref = task.ref
    ? /^[0-9a-f]{7,40}$/.test(task.ref)
      ? `<a href="${escapeHtml(commitUrl(commit, task.ref))}"><code>${escapeHtml(task.ref)}</code></a>`
      : `<code>${escapeHtml(task.ref)}</code>`
    : '<span class="note">none</span>';
  const tokens =
    task.tokens.in === null && task.tokens.out === null
      ? '<span class="note">not recorded</span>'
      : `${text(task.tokens.in)} in, ${text(task.tokens.out)} out${task.tokens.cacheRead === undefined ? "" : `, ${task.tokens.cacheRead} cache read`}${task.tokens.cacheWrite === undefined ? "" : `, ${task.tokens.cacheWrite} cache write`}${task.costSource ? ` (${task.costSource})` : ""}`;
  const body = [
    pageHeader(commit, taskPagePath(task.id)),
    sourceLine(commit, commit.sha),
    "<main>",
    `<p class="crumbs"><a href="${escapeHtml(viewLink("/view", commit.requestedRef))}">Plan</a> › ${nodeLink}</p>`,
    `<h1 data-title>Task <span data-task-id>${escapeHtml(task.id)}</span></h1>`,
    task.summary
      ? `<p class="outcome" data-summary>${escapeHtml(task.summary)}</p>`
      : "",
    "<section>",
    "<dl>",
    field("node", "Node", nodeLink),
    field("step", "Step", escapeHtml(task.step)),
    field("status", "Status", escapeHtml(task.status)),
    field("role", "Role", text(task.role)),
    field("model", "Model", text(task.model)),
    field("tokens", "Tokens", tokens),
    field("opened", "Opened", text(task.opened)),
    field("closed", "Closed", text(task.closed)),
    field("ref", "Commit", ref),
    field(
      "pr",
      "Pull request",
      task.pr
        ? pr
          ? `<a href="${escapeHtml(pr)}">${escapeHtml(task.pr)}</a>`
          : escapeHtml(task.pr)
        : '<span class="note">none</span>',
    ),
    "</dl>",
    "</section>",
    task.notes
      ? `<section data-notes><h2>Notes</h2><p class="pre">${escapeHtml(task.notes)}</p></section>`
      : "",
    "</main>",
  ].join("\n");
  return pageShell(`Task ${task.id}`, body);
}
