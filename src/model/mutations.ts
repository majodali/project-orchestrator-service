/**
 * The mutations of the state file that more than one surface applies
 * (the rebuild plan, milestone 4): the MCP tools (src/stateTools.ts)
 * and the web view's forms (src/view/actions.ts) change a node or
 * close a decision the same way, through the store. Each function
 * edits the state it is given in place and returns the journal
 * event's fields; a mutation that names nothing throws `NotFoundError`.
 */

import { NotFoundError, type WriteEvent } from "./store.js";
import type { Decision, Hold, Node, Stage, State } from "./schema.js";

export interface NodeUpdateInput {
  nodeId: string;
  /** Why, in one sentence; goes in the journal. */
  reason: string;
  stage?: Stage;
  /** A hold to set, or null to lift it. */
  hold?: Hold | null;
  start?: Node["start"];
  outcome?: string;
  title?: string;
  note?: string | null;
  /** The full list of nodes this one waits for. */
  after?: string[];
  session?: string;
}

export interface NodeUpdateResult {
  event: WriteEvent;
  /** One phrase per field changed, for the caller's result. */
  changes: string[];
}

/** Applies a `node_update`: the fields given that differ, and `done`
 * kept in step with the stage. */
export function updateNode(
  state: State,
  input: NodeUpdateInput,
  today: string,
): NodeUpdateResult {
  const n = state.nodes.find((x) => x.id === input.nodeId);
  if (!n) throw new NotFoundError(`no node ${input.nodeId}`);
  const changes: string[] = [];
  if (input.stage !== undefined && input.stage !== n.stage) {
    changes.push(`stage ${n.stage} -> ${input.stage}`);
    n.stage = input.stage;
    if (input.stage === "done" && n.done === null) n.done = today;
    if (input.stage !== "done") n.done = null;
    if (input.stage === "done") {
      // The owner's acceptance closes the verification with the node.
      for (const c of state.nodes) {
        if (c.parent === n.id && c.kind === "check" && c.stage !== "done") {
          c.stage = "done";
          c.done = today;
          c.hold = null;
          changes.push(`${c.id} done`);
        }
      }
    }
  }
  if (
    input.hold !== undefined &&
    JSON.stringify(input.hold) !== JSON.stringify(n.hold)
  ) {
    changes.push(
      input.hold
        ? `hold ${input.hold.kind}: ${input.hold.reason}`
        : "hold lifted",
    );
    n.hold = input.hold;
  }
  if (input.start !== undefined && input.start !== n.start) {
    changes.push(`start ${input.start}`);
    n.start = input.start;
  }
  if (input.outcome !== undefined) {
    changes.push("outcome");
    n.outcome = input.outcome;
  }
  if (input.title !== undefined) {
    changes.push(`title "${input.title}"`);
    n.title = input.title;
  }
  if (input.note !== undefined) {
    changes.push("note");
    n.note = input.note;
  }
  if (input.after !== undefined) {
    changes.push(`after ${input.after.join(", ") || "nothing"}`);
    n.after = input.after;
  }
  if (changes.length === 0)
    throw new NotFoundError("nothing to change: no field given differs");
  return {
    changes,
    event: {
      task: null,
      node: n.id,
      session: input.session ?? null,
      note: `node_update ${n.id}: ${changes.join("; ")}. ${input.reason}`,
    },
  };
}

export interface DecisionCloseInput {
  decisionId: string;
  chosen: string;
  rationale?: string;
  /** True when the answer is a precedent. */
  standing?: boolean;
  session?: string;
}

export interface DecisionCloseResult {
  event: WriteEvent;
  decision: Decision;
}

/** Applies a `decision_close`: the answer, today's date, and the
 * rationale and standing flag when given. */
export function closeDecision(
  state: State,
  input: DecisionCloseInput,
  today: string,
): DecisionCloseResult {
  const d = state.decisions.find((x) => x.id === input.decisionId);
  if (!d) throw new NotFoundError(`no decision ${input.decisionId}`);
  if (d.chosen !== null)
    throw new NotFoundError(`decision ${input.decisionId} is already closed`);
  d.chosen = input.chosen;
  d.decided = today;
  if (input.rationale !== undefined) d.rationale = input.rationale;
  if (input.standing !== undefined) d.standing = input.standing;
  return {
    decision: d,
    event: {
      task: null,
      node: d.node,
      session: input.session ?? null,
      note: `decision_close ${d.id}: ${input.chosen}`,
    },
  };
}

/**
 * The decisions a session opening a task on `nodeId` reads first (the
 * rebuild plan, milestone 4): the closed decisions on the node and on
 * each of its ancestors, nearest first, and the standing project
 * decisions, which decide the same question again without asking.
 */
export function decisionsForTask(state: State, nodeId: string): Decision[] {
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const chain: string[] = [];
  let current = byId.get(nodeId);
  while (current) {
    chain.push(current.id);
    current = current.parent === null ? undefined : byId.get(current.parent);
  }
  const out: Decision[] = [];
  for (const id of chain) {
    out.push(
      ...state.decisions.filter((d) => d.node === id && d.chosen !== null),
    );
  }
  out.push(
    ...state.decisions.filter(
      (d) => d.node === null && d.chosen !== null && d.standing,
    ),
  );
  return out;
}

/** The one-click lifecycle actions the view offers a node (the rebuild
 * plan, milestone 4), each a `node_update`. */
export const NODE_ACTIONS = [
  "approve-start",
  "lift-hold",
  "accept-review",
] as const;
export type NodeAction = (typeof NODE_ACTIONS)[number];

export const NODE_ACTION_LABELS: Readonly<Record<NodeAction, string>> = {
  "approve-start": "Approve the start",
  "lift-hold": "Lift the hold",
  "accept-review": "Accept the review: done",
};

/** The actions open on a node as it stands: approve a start that
 * waits on the owner, lift a hold, accept a node under review. */
export function nodeActions(node: Node): NodeAction[] {
  const out: NodeAction[] = [];
  if (node.stage === "done" || node.stage === "parked") return out;
  if (node.start === "approve") out.push("approve-start");
  if (node.hold !== null) out.push("lift-hold");
  if (node.stage === "verifying") out.push("accept-review");
  return out;
}

/** The `node_update` an action is. */
export function nodeActionInput(
  nodeId: string,
  action: NodeAction,
  note: string,
  session: string,
): NodeUpdateInput {
  const reason = note || NODE_ACTION_LABELS[action];
  switch (action) {
    case "approve-start":
      return { nodeId, reason, start: "auto", session };
    case "lift-hold":
      return { nodeId, reason, hold: null, session };
    case "accept-review":
      return { nodeId, reason, stage: "done", session };
  }
}
