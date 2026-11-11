/**
 * The task loop (the rebuild plan, "The loop and the close-out"):
 * which step a node offers next, which node `task_next` answers, what
 * the claim records, and what a close moves. The close-out actions
 * are the service's own behaviour, never nodes of the plan (decision
 * 13); verification runs as a hidden check node. Every function here
 * edits the state it is given in place; the store commits the result
 * (src/model/store.ts). The MCP tools (src/stateTools.ts) are a thin
 * layer over this module.
 */

import { childrenOf, nodesById, openTaskByNode } from "./check.js";
import { NotFoundError, type WriteEvent } from "./store.js";
import type {
  Decision,
  Node,
  State,
  Step,
  Task,
  TaskStatus,
} from "./schema.js";

/** A task open longer than this is closed as stale by `task_next`. */
export const TASK_TIME_LIMIT_HOURS = 24;

/** The role a step belongs to. */
export const STEP_ROLES: Readonly<Record<Step, string>> = {
  plan: "planner",
  specify: "planner",
  "break down": "planner",
  execute: "implementer",
  verify: "reviewer",
};

/** Why a node offers no step. */
export type Unavailable =
  | { reason: "done" | "parked" | "in-progress" }
  | { reason: "hold"; hold: NonNullable<Node["hold"]> }
  | { reason: "approval" }
  | { reason: "open-task"; task: string }
  | { reason: "open-decision"; decisions: string[] }
  | { reason: "dependency"; pending: string[] };

export type Offer =
  | { offered: true; steps: Step[]; role: string }
  | { offered: false; why: Unavailable };

/** The ancestors of a node, nearest first. */
export function ancestorsOf(node: Node, byId: Map<string, Node>): Node[] {
  const out: Node[] = [];
  let p = node.parent === null ? undefined : byId.get(node.parent);
  while (p) {
    out.push(p);
    p = p.parent === null ? undefined : byId.get(p.parent);
  }
  return out;
}

/** The check nodes of a node that are not done. */
export function openCheckNodes(
  node: Node,
  children: Map<string, Node[]>,
): Node[] {
  return (children.get(node.id) ?? []).filter(
    (c) => c.kind === "check" && c.stage !== "done",
  );
}

/** The steps a node's stage admits, the first being the one the loop
 * takes; none for a stage whose work lies elsewhere. */
export function stepsForStage(
  node: Node,
  children: Map<string, Node[]>,
): Step[] {
  if (node.kind === "check") {
    return node.stage === "specified" && node.hold === null ? ["verify"] : [];
  }
  switch (node.stage) {
    case "identified":
      return ["plan"];
    case "planned":
      return ["specify"];
    case "specified":
      return ["execute", "break down"];
    case "executing":
      return ["execute"];
    case "verifying":
      // Rework, when the check node failed.
      return openCheckNodes(node, children).some((c) => c.hold !== null)
        ? ["execute"]
        : [];
    default:
      return [];
  }
}

/** What the loop offers on a node as the state stands. */
export function offerOn(
  node: Node,
  state: State,
  byId = nodesById(state),
  children = childrenOf(state),
  openTasks = openTaskByNode(state),
): Offer {
  if (node.stage === "done" || node.stage === "parked")
    return { offered: false, why: { reason: node.stage } };
  if (node.hold !== null)
    return { offered: false, why: { reason: "hold", hold: node.hold } };
  const task = (openTasks.get(node.id) ?? [])[0];
  if (task !== undefined)
    return { offered: false, why: { reason: "open-task", task } };
  const decisions = state.decisions
    .filter((d) => d.node === node.id && d.chosen === null)
    .map((d) => d.id);
  if (decisions.length > 0)
    return { offered: false, why: { reason: "open-decision", decisions } };
  const pending: string[] = [];
  for (const n of [node, ...ancestorsOf(node, byId)]) {
    for (const d of n.after) {
      if (byId.get(d)?.stage !== "done" && !pending.includes(d))
        pending.push(d);
    }
  }
  if (pending.length > 0)
    return { offered: false, why: { reason: "dependency", pending } };
  if (node.start === "approve")
    return { offered: false, why: { reason: "approval" } };
  const steps = stepsForStage(node, children);
  if (steps.length === 0)
    return { offered: false, why: { reason: "in-progress" } };
  return { offered: true, steps, role: STEP_ROLES[steps[0]!] };
}

/** Nodes in tree order: each root, then its subtree, in file order. */
export function treeOrdered(state: State): Node[] {
  const children = childrenOf(state);
  const out: Node[] = [];
  const visit = (n: Node): void => {
    out.push(n);
    for (const c of children.get(n.id) ?? []) visit(c);
  };
  for (const n of state.nodes) if (n.parent === null) visit(n);
  return out;
}

export interface Candidate {
  node: Node;
  step: Step;
  steps: Step[];
  role: string;
}

/** The nodes that offer a step, in tree order, for a role when given. */
export function candidates(state: State, role?: string): Candidate[] {
  const byId = nodesById(state);
  const children = childrenOf(state);
  const openTasks = openTaskByNode(state);
  const out: Candidate[] = [];
  for (const node of treeOrdered(state)) {
    const offer = offerOn(node, state, byId, children, openTasks);
    if (!offer.offered) continue;
    // The first step is the one the loop takes; the others are open
    // to a claim that names them (break down instead of execute).
    const first = offer.steps[0]!;
    if (role !== undefined && STEP_ROLES[first] !== role) continue;
    out.push({
      node,
      step: first,
      steps: offer.steps,
      role: STEP_ROLES[first],
    });
  }
  return out;
}

/** The open tasks past the time limit at `now`. */
export function staleTasks(state: State, now: Date): Task[] {
  const limit = now.getTime() - TASK_TIME_LIMIT_HOURS * 3600 * 1000;
  return state.tasks.filter(
    (t) =>
      t.status === "open" &&
      t.opened !== null &&
      new Date(t.opened).getTime() < limit,
  );
}

/** Closes the stale tasks at `now`; returns their identifiers. */
export function closeStale(
  state: State,
  now: Date,
  timestamp: string,
): string[] {
  const ids: string[] = [];
  for (const t of staleTasks(state, now)) {
    t.status = "stale";
    t.closed = timestamp;
    t.summary = `Closed as stale by task_next: open since ${t.opened}, past the ${TASK_TIME_LIMIT_HOURS}-hour limit.`;
    ids.push(t.id);
  }
  return ids;
}

/** The next identifier in a plan line: `P4-N009` after `P4-N008`. */
export function nextNodeId(state: State, line: string): string {
  let max = 0;
  const re = new RegExp(`^${line}-N(\\d+)$`);
  for (const n of state.nodes) {
    const m = re.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${line}-N${String(max + 1).padStart(3, "0")}`;
}

/** The plan line of a node: `P4` of `P4-N006`. */
export function lineOf(id: string): string {
  return id.slice(0, id.indexOf("-"));
}

/** Adds the check node that carries a node's verification; the node
 * enters `verifying`. */
export function enterVerifying(state: State, node: Node): Node {
  node.stage = "verifying";
  node.done = null;
  const check: Node = {
    id: nextNodeId(state, lineOf(node.id)),
    kind: "check",
    title: `Verification of ${node.title}`,
    outcome: `${node.id} is verified against its outcome.`,
    stage: "specified",
    parent: node.id,
    after: [],
    hold: null,
    start: "auto",
    docs: { ...node.docs },
    done: null,
    note: null,
  };
  state.nodes.push(check);
  return check;
}

/** Marks a node done with the date, its open check nodes with it, and
 * climbs: a broken-down parent whose work children are all done
 * enters verifying. Returns the nodes moved, in order. */
export function completeNode(
  state: State,
  node: Node,
  today: string,
): string[] {
  const moved: string[] = [];
  const byId = nodesById(state);
  const children = childrenOf(state);
  for (const c of openCheckNodes(node, children)) {
    c.stage = "done";
    c.done = today;
    c.hold = null;
    moved.push(`${c.id} done`);
  }
  node.stage = "done";
  node.done = today;
  moved.push(`${node.id} done ${today}`);
  const parent = node.parent === null ? undefined : byId.get(node.parent);
  if (parent && parent.stage === "broken-down") {
    const work = (children.get(parent.id) ?? []).filter(
      (c) => c.kind === "work",
    );
    if (
      work.every(
        (c) => c.id === node.id || c.stage === "done" || c.stage === "parked",
      )
    ) {
      const check = enterVerifying(state, parent);
      moved.push(`${parent.id} verifying, check node ${check.id}`);
    }
  }
  return moved;
}

/** The fields of a node a task's scope is: a change to any of them
 * during the task is a stop condition. */
export function scopeOf(node: Node): string {
  return JSON.stringify({
    title: node.title,
    outcome: node.outcome,
    parent: node.parent,
    after: node.after,
    docs: node.docs,
  });
}

export interface OpenInput {
  nodeId: string;
  step: Step;
  role?: string;
  model?: string;
  summary?: string;
  session?: string;
}

export interface OpenResult {
  task: Task;
  event: WriteEvent;
  moved: string[];
}

/** The claim: refuses a node that does not offer the step, opens the
 * task with the base commit, and moves an executed node to
 * `executing`. */
export function openTask(
  state: State,
  input: OpenInput,
  nextTaskId: string,
  timestamp: string,
  baseSha: string,
): OpenResult {
  const node = state.nodes.find((n) => n.id === input.nodeId);
  if (!node) throw new NotFoundError(`no node ${input.nodeId}`);
  const offer = offerOn(node, state);
  if (!offer.offered) {
    throw new NotFoundError(
      `${node.id} offers no step: ${describeUnavailable(offer.why)}`,
    );
  }
  if (!offer.steps.includes(input.step)) {
    throw new NotFoundError(
      `${node.id} is ${node.stage} and offers ${offer.steps.join(" or ")}, not ${input.step}`,
    );
  }
  const task: Task = {
    id: nextTaskId,
    node: node.id,
    step: input.step,
    status: "open",
    role: input.role ?? STEP_ROLES[input.step],
    model: input.model ?? null,
    tokens: { in: null, out: null },
    opened: timestamp,
    closed: null,
    base: baseSha,
    ref: null,
    pr: null,
    summary: input.summary ?? null,
    notes: null,
  };
  state.tasks.push(task);
  const moved: string[] = [];
  if (input.step === "execute" && node.stage === "specified") {
    node.stage = "executing";
    moved.push(`${node.id} executing`);
  }
  return {
    task,
    moved,
    event: {
      task: task.id,
      node: node.id,
      session: input.session ?? null,
      note: `task_open ${task.id} on ${node.id}, ${input.step}${moved.length > 0 ? ` (${moved.join("; ")})` : ""}${input.summary ? `: ${input.summary}` : ""}`,
    },
  };
}

export function describeUnavailable(why: Unavailable): string {
  switch (why.reason) {
    case "done":
    case "parked":
      return `it is ${why.reason}`;
    case "in-progress":
      return "its children, or its check node, carry the work";
    case "hold":
      return `it is held ${why.hold.kind}: ${why.hold.reason}`;
    case "approval":
      return "its start waits for the owner's approval";
    case "open-task":
      return `task ${why.task} is open on it`;
    case "open-decision":
      return `decision ${why.decisions.join(", ")} is open on it; the owner answers it in the view`;
    case "dependency":
      return `it waits for ${why.pending.join(", ")}`;
  }
}

export interface Ask {
  question: string;
  options?: string[];
  default: string;
}

export interface CloseInput {
  taskId: string;
  status: Exclude<TaskStatus, "open">;
  summary: string;
  pr?: string;
  ref?: string;
  tokensIn?: number;
  tokensOut?: number;
  asks?: Ask[];
  /** What a planning step delivers, applied at close: a plan step
   * sets the outcome and the plan document, a specify step the
   * specification; applied with status `closed` only. */
  title?: string;
  outcome?: string;
  docs?: { plan?: string | null; spec?: string | null };
  session?: string;
}

export interface CloseResult {
  task: Task;
  node: Node;
  event: WriteEvent;
  /** What moved, in order. */
  moved: string[];
  /** The decisions opened from the asks. */
  decisions: string[];
  /** Set when the close returns the session to the owner, and why. */
  stop: string | null;
}

/**
 * Records a task's result and runs the close-out. `scopeAtBase` is
 * the node's scope at the task's base commit, when the caller could
 * read it; a scope that changed since closes the task as
 * `needs-judgment` whatever status was given.
 */
export function closeTask(
  state: State,
  input: CloseInput,
  scopeAtBase: string | null,
  today: string,
  timestamp: string,
  nextDecisionId: (state: State) => string,
): CloseResult {
  const task = state.tasks.find((t) => t.id === input.taskId);
  if (!task) throw new NotFoundError(`no task ${input.taskId}`);
  if (task.status !== "open")
    throw new NotFoundError(`task ${input.taskId} is ${task.status}, not open`);
  const node = state.nodes.find((n) => n.id === task.node);
  if (!node)
    throw new NotFoundError(`no node ${task.node} for task ${task.id}`);

  let status = input.status;
  let summary = input.summary;
  let stop: string | null = null;
  const moved: string[] = [];
  const scopeChanged = scopeAtBase !== null && scopeAtBase !== scopeOf(node);
  if (scopeChanged) {
    status = "needs-judgment";
    summary = `Scope changed during ${task.id}: the node's title, outcome, parent, dependencies or documents differ from its base commit. Given status ${input.status}: ${input.summary}`;
    stop = `scope changed during ${task.id}; the owner confirms the result and lifts the hold`;
  }

  task.status = status;
  task.closed = timestamp;
  task.summary = summary;
  if (input.pr !== undefined) task.pr = input.pr;
  if (input.ref !== undefined) task.ref = input.ref;
  if (input.tokensIn !== undefined) task.tokens.in = input.tokensIn;
  if (input.tokensOut !== undefined) task.tokens.out = input.tokensOut;

  const decisions: string[] = [];
  if (status === "closed") {
    if (input.title !== undefined) node.title = input.title;
    if (input.outcome !== undefined) node.outcome = input.outcome;
    if (input.docs?.plan !== undefined) node.docs.plan = input.docs.plan;
    if (input.docs?.spec !== undefined) node.docs.spec = input.docs.spec;
    moved.push(...closeOut(state, node, task, today));
    for (const ask of input.asks ?? []) {
      const id = nextDecisionId(state);
      const decision: Decision = {
        id,
        node: node.id,
        question: ask.question,
        options: ask.options ?? [],
        default: ask.default,
        chosen: null,
        decided: null,
        rationale: `Asked by ${task.id} at close.`,
        standing: false,
        source: null,
      };
      state.decisions.push(decision);
      decisions.push(id);
    }
    if (decisions.length > 0) {
      stop = `${decisions.join(", ")} opened on ${node.id}; the owner answers in the view before the next step`;
    }
  } else if (status === "blocked") {
    node.hold = { kind: "blocked", reason: `${task.id}: ${summary}` };
    moved.push(`${node.id} held blocked`);
    stop = `${node.id} is blocked; the owner lifts the hold in the view`;
  } else if (status === "needs-judgment") {
    node.hold = { kind: "gated", reason: `${task.id}: ${summary}` };
    moved.push(`${node.id} held gated`);
    stop ??= `${node.id} needs the owner's judgment; the owner lifts the hold in the view`;
  }

  return {
    task,
    node,
    moved,
    decisions,
    stop,
    event: {
      task: task.id,
      node: node.id,
      session: input.session ?? null,
      note: `task_close ${task.id} ${status}${moved.length > 0 ? ` (${moved.join("; ")})` : ""}: ${summary}`,
    },
  };
}

/** The move a closed step makes (the table in the plan). */
function closeOut(
  state: State,
  node: Node,
  task: Task,
  today: string,
): string[] {
  const children = childrenOf(state);
  switch (task.step) {
    case "plan":
      if (node.stage === "identified") {
        node.stage = "planned";
        return [`${node.id} planned`];
      }
      return [];
    case "specify":
      if (node.stage === "planned") {
        node.stage = "specified";
        return [`${node.id} specified`];
      }
      return [];
    case "break down":
      if (node.stage === "specified" || node.stage === "executing") {
        node.stage = "broken-down";
        return [`${node.id} broken-down`];
      }
      return [];
    case "execute": {
      if (node.stage === "verifying") {
        // The rework: the failed check node gets a new round.
        const out: string[] = [];
        for (const c of openCheckNodes(node, children)) {
          c.hold = null;
          c.stage = "specified";
          out.push(`${c.id} specified again`);
        }
        return out;
      }
      if (node.stage === "specified" || node.stage === "executing") {
        const check = enterVerifying(state, node);
        return [`${node.id} verifying, check node ${check.id}`];
      }
      return [];
    }
    case "verify": {
      if (node.kind !== "check") return [];
      const byId = nodesById(state);
      const parent = node.parent === null ? undefined : byId.get(node.parent);
      if (!parent) return [];
      return completeNode(state, parent, today);
    }
  }
}

export interface AddInput {
  parentId: string | null;
  /** The plan line of a root node, `P5`; a child takes its parent's. */
  line?: string;
  title: string;
  outcome: string | null;
  after?: string[];
  docs?: { plan: string | null; spec: string | null };
  stage?: "identified" | "planned" | "specified";
  start?: Node["start"];
  note?: string;
  session?: string;
}

/** Adds a node with the next identifier in its line. */
export function addNode(
  state: State,
  input: AddInput,
): { node: Node; event: WriteEvent } {
  let line: string;
  let parentMoved = "";
  if (input.parentId !== null) {
    const parent = state.nodes.find((n) => n.id === input.parentId);
    if (!parent) throw new NotFoundError(`no node ${input.parentId}`);
    line = lineOf(parent.id);
    // A node with children is broken down (invariant 3).
    if (
      parent.stage === "identified" ||
      parent.stage === "planned" ||
      parent.stage === "specified" ||
      parent.stage === "executing"
    ) {
      parent.stage = "broken-down";
      parentMoved = `; ${parent.id} broken-down`;
    }
  } else {
    if (!input.line || !/^P\d+$/.test(input.line))
      throw new NotFoundError("a root node needs its plan line, such as P5");
    line = input.line;
  }
  const node: Node = {
    id: nextNodeId(state, line),
    kind: "work",
    title: input.title,
    outcome: input.outcome,
    stage: input.stage ?? "identified",
    parent: input.parentId,
    after: input.after ?? [],
    hold: null,
    start: input.start ?? "auto",
    docs: input.docs ?? { plan: null, spec: null },
    done: null,
    note: input.note ?? null,
  };
  state.nodes.push(node);
  return {
    node,
    event: {
      task: null,
      node: node.id,
      session: input.session ?? null,
      note: `node_add ${node.id} under ${input.parentId ?? "no parent"}: ${node.title}${parentMoved}`,
    },
  };
}
