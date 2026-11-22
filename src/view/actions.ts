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
import {
  describeUnavailable,
  offerOn,
  pullRequestsOf,
  type Offer,
} from "../model/loop.js";
import type { Decision, Node, State } from "../model/schema.js";
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

/** A node as `lift-hold` or `approve-start` would leave it: the hold
 * lifted, or the start approved, with everything else as it stands.
 * What the action actually changes next is read off the result with
 * `offerOn`, the same function the loop itself takes its offer from
 * (section 2: "which node moves, to which stage"). */
function offerAfter(node: Node, state: State, patch: Partial<Node>): Offer {
  const patched: Node = { ...node, ...patch };
  const nodes = state.nodes.map((n) => (n.id === node.id ? patched : n));
  return offerOn(patched, { ...state, nodes });
}

function offerSentence(offer: Offer): string {
  return offer.offered
    ? `offers ${offer.steps.join(" or ")} to the ${offer.role} next, starting without you`
    : describeUnavailable(offer.why);
}

/** The sentence beside an action button, naming what the click changes
 * (section 2, every action button says what it does). */
export function nodeActionSentence(
  action: NodeAction,
  node: Node,
  state: State,
): string {
  switch (action) {
    case "approve-start":
      return `${node.id} then ${offerSentence(offerAfter(node, state, { start: "auto" }))}.`;
    case "lift-hold":
      return `${node.id} then ${offerSentence(offerAfter(node, state, { hold: null }))}.`;
    case "accept-review": {
      const prs = pullRequestsOf(state, node.id);
      const merged =
        prs.length === 0
          ? "it carries no pull request to merge"
          : prs.length === 1
            ? `pull request ${prs[0]} is merged`
            : `its ${prs.length} pull requests are merged`;
      return `${node.id} becomes done, and ${merged}.`;
    }
  }
}

/** The one-click lifecycle actions open on a node, each with an
 * optional one-line note and the sentence that says what it changes;
 * the empty string when none is open. Shared by the node page and the
 * "Needs you" rows of `/view` (./landing.ts), so the sentence shows on
 * every page that offers the action. */
export function nodeActionForms(node: Node, state: State): string {
  const actions = nodeActions(node);
  if (actions.length === 0) return "";
  return actions
    .map((action: NodeAction) =>
      [
        `<form class="act" method="post" action="${nodeActionPath(node.id)}" data-node-action="${action}">`,
        `<input type="hidden" name="action" value="${action}">`,
        `<input type="text" name="note" size="40" maxlength="500" placeholder="A one-line note, optional" aria-label="Note">`,
        `<button type="submit">${escapeHtml(NODE_ACTION_LABELS[action])}</button>`,
        `<span class="note" data-action-sentence="${action}">${escapeHtml(nodeActionSentence(action, node, state))}</span>`,
        "</form>",
      ].join(""),
    )
    .join("");
}

/** The node page's "Actions" section: the forms, under their heading. */
export function nodeActionsSection(node: Node, state: State): string {
  const forms = nodeActionForms(node, state);
  if (forms === "") return "";
  return [
    "<section data-actions>",
    "<h2>Actions</h2>",
    '<p class="note">Each commits one change to the state file on the default branch, as the service.</p>',
    forms,
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
