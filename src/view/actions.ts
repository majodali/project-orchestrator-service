/**
 * The view's forms (the rebuild plan, milestone 4): the signed-in
 * owner closes an open decision where it is shown and acts on a
 * node's lifecycle with one click. Each form posts to a `/view` route
 * that commits through the store (src/view/routes.ts); no script runs
 * on the page, so every form is plain HTML. The page a form submits
 * from carries a `ref` only for reading: a write always lands on the
 * default branch's head.
 */

import {
  NODE_ACTION_LABELS,
  nodeActions,
  type NodeAction,
} from "../model/mutations.js";
import type { Decision, Node } from "../model/schema.js";
import { commitUrl, escapeHtml, type RepoCoordinates } from "./html.js";

/** The value of the `chosen` radio that takes the answer from the
 * `other` text field. */
export const OTHER_ANSWER = "__other__";

export function decisionClosePath(id: string): string {
  return `/view/decision/${encodeURIComponent(id)}/close`;
}

export function nodeActionPath(id: string): string {
  return `/view/node/${encodeURIComponent(id)}/action`;
}

function radio(
  name: string,
  value: string,
  label: string,
  checked: boolean,
): string {
  return `<label class="choice"><input type="radio" name="${name}" value="${escapeHtml(value)}"${checked ? " checked" : ""}> ${label}</label>`;
}

/**
 * The form that closes an open decision: one radio per option, the
 * default marked and preselected, another answer as free text, a
 * one-line note, and the standing flag.
 */
export function decisionForm(d: Decision): string {
  if (d.chosen !== null) return "";
  const choices: string[] = [];
  const options = [...d.options];
  if (d.default !== null && !options.includes(d.default))
    options.unshift(d.default);
  let preselected = false;
  for (const option of options) {
    const isDefault = option === d.default;
    choices.push(
      radio(
        "chosen",
        option,
        `${escapeHtml(option)}${isDefault ? ' <span class="note">(the default)</span>' : ""}`,
        isDefault,
      ),
    );
    if (isDefault) preselected = true;
  }
  choices.push(
    radio(
      "chosen",
      OTHER_ANSWER,
      `another answer: <input type="text" name="other" size="40" maxlength="500" aria-label="Another answer">`,
      !preselected,
    ),
  );
  return [
    `<form class="decide" method="post" action="${decisionClosePath(d.id)}" data-decision-form="${escapeHtml(d.id)}">`,
    `<div class="choices">${choices.join("")}</div>`,
    `<p><input type="text" name="note" size="60" maxlength="500" placeholder="A one-line note, optional" aria-label="Note"></p>`,
    `<p><label class="choice"><input type="checkbox" name="standing" value="yes"> Standing: decides the same question again without asking</label></p>`,
    `<p><button type="submit">Close ${escapeHtml(d.id)}</button></p>`,
    "</form>",
  ].join("\n");
}

/** The one-click lifecycle actions open on a node, each with an
 * optional one-line note; nothing when none is. */
export function nodeActionsSection(node: Node): string {
  const actions = nodeActions(node);
  if (actions.length === 0) return "";
  const forms = actions.map((action: NodeAction) =>
    [
      `<form class="act" method="post" action="${nodeActionPath(node.id)}" data-node-action="${action}">`,
      `<input type="hidden" name="action" value="${action}">`,
      `<input type="text" name="note" size="40" maxlength="500" placeholder="A one-line note, optional" aria-label="Note">`,
      `<button type="submit">${escapeHtml(NODE_ACTION_LABELS[action])}</button>`,
      "</form>",
    ].join(""),
  );
  return [
    "<section data-actions>",
    "<h2>Actions</h2>",
    '<p class="note">Each commits one change to the state file on the default branch, as the service.</p>',
    ...forms,
    "</section>",
  ].join("\n");
}

/** The line a page shows after a write it was redirected from: the
 * commit, and whether this page already reads it. */
export function committedLine(
  repo: RepoCoordinates,
  committed: string | undefined,
  pageSha: string,
): string {
  if (committed === undefined) return "";
  const shown =
    committed === pageSha
      ? "This page reads it."
      : `This page reads ${escapeHtml(pageSha.slice(0, 7))}; reload until it shows the new commit.`;
  return `<p class="committed" data-committed="${escapeHtml(committed)}">Committed as <a href="${escapeHtml(commitUrl(repo, committed))}"><code>${escapeHtml(committed.slice(0, 7))}</code></a>. ${shown}</p>`;
}
