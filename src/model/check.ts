/**
 * The invariants over a state file (the rebuild plan, "The
 * invariants"). Pure: state in, findings out. `cli.ts` adds the
 * repository checks that need the file system (invariants 8 and 9)
 * through `checkRepository`.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import type { ZodError } from "zod";

import { isOrdered, orderSiblingsByDependency } from "./order.js";
import { renderPlan, renderRegister } from "./render.js";
import {
  INTERIOR_STAGES,
  OUTCOME_MAX_WORDS,
  SUMMARY_MAX_WORDS,
  TERMINAL_STAGES,
  TITLE_MIN_WORDS,
  stateSchema,
  wordCount,
  type Node,
  type State,
} from "./schema.js";

export type Severity = "violation" | "warning";

export interface Finding {
  severity: Severity;
  /** The invariant's number, 1 to 10, as the plan lists them. */
  invariant: number;
  /** The node, task or decision identifier, when one applies. */
  subject: string | null;
  message: string;
}

/** What a node not `done` and not `parked` is, exactly one of
 * (invariant 5). The order below is the precedence. */
export type NodeClass =
  | "gated"
  | "blocked"
  | "in-flight"
  | "in-progress"
  | "waiting"
  | "actionable"
  | "done"
  | "parked";

export const NODE_CLASS_LABELS: Readonly<Record<NodeClass, string>> = {
  gated: "waiting on the owner",
  blocked: "blocked",
  "in-flight": "in flight",
  "in-progress": "in progress, its children carry the work",
  waiting: "waiting on a dependency",
  actionable: "ready, starts automatically",
  done: "done",
  parked: "parked",
};

export function nodesById(state: State): Map<string, Node> {
  return new Map(state.nodes.map((n) => [n.id, n]));
}

export function childrenOf(state: State): Map<string, Node[]> {
  const out = new Map<string, Node[]>();
  for (const n of state.nodes) out.set(n.id, []);
  for (const n of state.nodes) {
    if (n.parent !== null && out.has(n.parent)) out.get(n.parent)!.push(n);
  }
  return out;
}

export function openTaskByNode(state: State): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of state.tasks) {
    if (t.status !== "open") continue;
    if (!out.has(t.node)) out.set(t.node, []);
    out.get(t.node)!.push(t.id);
  }
  return out;
}

export function classifyNode(
  node: Node,
  byId: Map<string, Node>,
  openTasks: Map<string, string[]>,
): NodeClass {
  if (node.stage === "done") return "done";
  if (node.stage === "parked") return "parked";
  if (node.hold?.kind === "gated") return "gated";
  if (node.hold?.kind === "blocked") return "blocked";
  if ((openTasks.get(node.id) ?? []).length > 0) return "in-flight";
  if (node.stage === "broken-down") return "in-progress";
  if (node.after.some((d) => byId.get(d)?.stage !== "done")) return "waiting";
  if (node.start === "approve") return "gated";
  return "actionable";
}

/** Why a node waits on the owner: its hold's reason, or, for a ready
 * node that needs a go-ahead, that its start needs approval. */
export function attentionReason(node: Node): string {
  if (node.hold) return node.hold.reason;
  return "start needs the owner's approval";
}

export function classifyAll(state: State): Map<string, NodeClass> {
  const byId = nodesById(state);
  const open = openTaskByNode(state);
  return new Map(state.nodes.map((n) => [n.id, classifyNode(n, byId, open)]));
}

function zodFindings(error: ZodError): Finding[] {
  return error.issues.map((issue) => ({
    severity: "violation" as const,
    invariant: 1,
    subject: null,
    message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
  }));
}

/** Invariants 1 to 7: everything decidable from the file alone. Takes
 * the parsed JSON value so that a file that fails the schema still
 * reports what failed. */
export function checkState(value: unknown): {
  state: State | null;
  findings: Finding[];
} {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) {
    return { state: null, findings: zodFindings(parsed.error) };
  }
  const state = parsed.data;
  const findings: Finding[] = [];
  const find = (
    severity: Severity,
    invariant: number,
    subject: string | null,
    message: string,
  ): void => {
    findings.push({ severity, invariant, subject, message });
  };

  // 1. Unique identifiers.
  for (const [kind, ids] of [
    ["node", state.nodes.map((n) => n.id)],
    ["task", state.tasks.map((t) => t.id)],
    ["decision", state.decisions.map((d) => d.id)],
  ] as const) {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id))
        find("violation", 1, id, `duplicate ${kind} identifier ${id}`);
      seen.add(id);
    }
  }

  const byId = nodesById(state);
  const children = childrenOf(state);

  // 2. Parents and dependencies exist; no cycles.
  for (const n of state.nodes) {
    if (n.parent !== null && !byId.has(n.parent)) {
      find("violation", 2, n.id, `parent ${n.parent} is not a node`);
    }
    if (n.parent === n.id)
      find("violation", 2, n.id, "a node is its own parent");
    for (const d of n.after) {
      if (!byId.has(d)) find("violation", 2, n.id, `after ${d}: not a node`);
      if (d === n.id) find("violation", 2, n.id, "a node waits for itself");
    }
  }
  for (const cycle of findCycles(state.nodes, (n) => n.after, byId)) {
    find(
      "violation",
      2,
      cycle[0] ?? null,
      `dependency cycle: ${cycle.join(" -> ")}`,
    );
  }
  for (const cycle of findCycles(
    state.nodes,
    (n) => (n.parent === null ? [] : [n.parent]),
    byId,
  )) {
    find(
      "violation",
      2,
      cycle[0] ?? null,
      `parent cycle: ${cycle.join(" -> ")}`,
    );
  }

  // 3. A node with children holds an interior stage; a child never runs
  // ahead of a parent that is not yet specified.
  for (const n of state.nodes) {
    const kids = children.get(n.id) ?? [];
    if (kids.length > 0 && !INTERIOR_STAGES.has(n.stage)) {
      find(
        "violation",
        3,
        n.id,
        `has ${kids.length} child node(s) but stage is ${n.stage}; a node with children is broken-down, verifying, done or parked`,
      );
    }
    if (n.parent !== null) {
      const parent = byId.get(n.parent);
      if (
        parent &&
        n.stage !== "identified" &&
        !INTERIOR_STAGES.has(parent.stage)
      ) {
        find(
          "violation",
          3,
          n.id,
          `is ${n.stage} under parent ${parent.id}, which is ${parent.stage}`,
        );
      }
    }
  }

  // 4. Titles and outcomes.
  for (const n of state.nodes) {
    const titleWords = wordCount(n.title);
    if (titleWords < TITLE_MIN_WORDS) {
      find(
        "violation",
        4,
        n.id,
        `title has ${titleWords} word(s); at least ${TITLE_MIN_WORDS}`,
      );
    }
    if (/^(?:P\d+-N\d+|child [a-z0-9]+|chunk \d+)$/i.test(n.title.trim())) {
      find(
        "violation",
        4,
        n.id,
        `title "${n.title}" is an identifier, a child letter or a chunk number`,
      );
    }
    // The "<noun phrase>, <past participle>" idiom ("The facts,
    // verified") says what was done to a thing instead of naming the
    // thing; a title is read in its tree, so it names the thing
    // (owner, 2026-11-10).
    if (
      n.title.includes(",") &&
      /\b[a-z]+(?:ed|en|own|ilt|ade|ught)(?:,|\s*$)/i.test(n.title)
    ) {
      find(
        "warning",
        4,
        n.id,
        `title "${n.title}" reads as "<noun phrase>, <verb>"; name the thing instead`,
      );
    }
    if (n.stage !== "identified" && n.stage !== "parked") {
      if (n.outcome === null) {
        find("violation", 4, n.id, `is ${n.stage} and has no outcome sentence`);
      } else if (wordCount(n.outcome) > OUTCOME_MAX_WORDS) {
        find(
          "violation",
          4,
          n.id,
          `outcome has ${wordCount(n.outcome)} words; at most ${OUTCOME_MAX_WORDS}`,
        );
      }
    }
  }

  // 5. Every open node has one class; combinations that hide one
  // another are warnings.
  const open = openTaskByNode(state);
  for (const n of state.nodes) {
    if (TERMINAL_STAGES.has(n.stage)) continue;
    const tasks = open.get(n.id) ?? [];
    if (n.hold && tasks.length > 0) {
      find(
        "warning",
        5,
        n.id,
        `is ${n.hold.kind} and has an open task (${tasks.join(", ")}); the hold decides its class`,
      );
    }
    if (n.stage === "done") continue;
    if (
      n.hold?.kind === "gated" &&
      n.after.some((d) => byId.get(d)?.stage !== "done")
    ) {
      find(
        "warning",
        5,
        n.id,
        "is gated and also waits on a dependency not done",
      );
    }
  }
  for (const n of state.nodes) {
    if (TERMINAL_STAGES.has(n.stage) && n.hold !== null) {
      find(
        "warning",
        5,
        n.id,
        `is ${n.stage} and still carries a ${n.hold.kind} hold`,
      );
    }
  }

  // 6. Tasks.
  for (const t of state.tasks) {
    if (!byId.has(t.node))
      find("violation", 6, t.id, `node ${t.node} is not a node`);
    if (t.status !== "open" && t.closed === null) {
      find("violation", 6, t.id, `is ${t.status} and has no closing time`);
    }
    if (t.status === "open" && t.closed !== null) {
      find("violation", 6, t.id, "is open and has a closing time");
    }
    if (t.opened !== null && t.closed !== null && t.closed < t.opened) {
      find(
        "violation",
        6,
        t.id,
        `closed (${t.closed}) before opened (${t.opened})`,
      );
    }
    if (t.status === "closed" && t.pr === null && t.summary === null) {
      find(
        "warning",
        6,
        t.id,
        "is closed with no pull request and no summary saying why",
      );
    }
    if (t.summary !== null && wordCount(t.summary) > SUMMARY_MAX_WORDS) {
      find(
        "violation",
        6,
        t.id,
        `summary has ${wordCount(t.summary)} words; at most ${SUMMARY_MAX_WORDS}`,
      );
    }
  }
  for (const [node, tasks] of open) {
    if (tasks.length > 1) {
      find(
        "violation",
        6,
        node,
        `has ${tasks.length} open tasks (${tasks.join(", ")}); at most one`,
      );
    }
  }

  // 7. Decisions.
  for (const d of state.decisions) {
    if (d.node !== null && !byId.has(d.node)) {
      find("violation", 7, d.id, `node ${d.node} is not a node`);
    }
    if (d.chosen === null) {
      if (d.default === null)
        find("violation", 7, d.id, "is open and has no default");
      if (d.decided !== null)
        find("violation", 7, d.id, "is open and carries a decision date");
    } else if (d.decided === null) {
      find("violation", 7, d.id, "is closed and has no decision date");
    }
  }

  // 10. Siblings follow the siblings they depend on.
  if (!isOrdered(state)) {
    const ordered = orderSiblingsByDependency(state);
    const first = ordered.find((n, i) => state.nodes[i] !== n);
    find(
      "violation",
      10,
      first?.id ?? null,
      "nodes are not in canonical order (siblings after the siblings they depend on); run plan-state render --write",
    );
  }

  return { state, findings };
}

function findCycles(
  nodes: Node[],
  edges: (n: Node) => string[],
  byId: Map<string, Node>,
): string[][] {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  const cycles: string[][] = [];
  const stack: string[] = [];
  const visit = (id: string): void => {
    colour.set(id, GREY);
    stack.push(id);
    const node = byId.get(id);
    for (const next of node ? edges(node) : []) {
      if (!byId.has(next)) continue;
      const c = colour.get(next) ?? WHITE;
      if (c === GREY) {
        const start = stack.indexOf(next);
        cycles.push([...stack.slice(start), next]);
      } else if (c === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    colour.set(id, BLACK);
  };
  for (const n of nodes) {
    if ((colour.get(n.id) ?? WHITE) === WHITE) visit(n.id);
  }
  return cycles;
}

/** The paths a state file names under the repository. */
export const STATE_PATH = "orchestration/state.json";
export const REGISTER_PATH = "docs/plan-register.md";
export const PLAN_PATH = "docs/plan.md";

/** Invariants 8 and 9: documents exist, renderings are current. */
export function checkRepository(
  state: State,
  repoRoot: string,
  read: (relativePath: string) => string | null,
): Finding[] {
  const findings: Finding[] = [];
  for (const n of state.nodes) {
    for (const [label, p] of [
      ["plan", n.docs.plan],
      ["spec", n.docs.spec],
    ] as const) {
      if (p !== null && !existsSync(path.join(repoRoot, p))) {
        findings.push({
          severity: "violation",
          invariant: 8,
          subject: n.id,
          message: `${label} document ${p} does not exist in the repository`,
        });
      }
    }
  }
  for (const [p, render] of [
    [REGISTER_PATH, renderRegister],
    [PLAN_PATH, renderPlan],
  ] as const) {
    const current = read(p);
    const expected = render(state);
    if (current === null) {
      findings.push({
        severity: "violation",
        invariant: 9,
        subject: null,
        message: `${p} is missing; run plan-state render --write`,
      });
    } else if (current !== expected) {
      findings.push({
        severity: "violation",
        invariant: 9,
        subject: null,
        message: `${p} differs from the rendering of ${STATE_PATH}; run plan-state render --write`,
      });
    }
  }
  return findings;
}

export function formatFinding(f: Finding): string {
  const subject = f.subject ? ` ${f.subject}:` : "";
  return `${f.severity.toUpperCase().padEnd(9)} invariant ${f.invariant}${subject} ${f.message}`;
}
