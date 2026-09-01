/**
 * The node-lifecycle transition table (chunk 1 child D, node P2-N010).
 *
 * Cited to `docs/process/plan-model.md` in the coordinating repository
 * (majodali/project-orchestrator), "The node lifecycle" table — this
 * module implements that table, it does not restate or extend it
 * (I2: "legality is not a second truth" — a transition the process
 * spec permits and this module refuses, or the reverse, is a service
 * bug with a Backlog entry, never a new lifecycle rule).
 *
 * The lifecycle table, as published:
 *
 *   identified  --(planning dispatched)-->        planned
 *   planned     --(specification dispatched)-->   specified
 *   specified   --(breakdown dispatched)-->        broken-down   (interior)
 *   specified   --(execution dispatched)-->        executing     (leaf)
 *   broken-down --(all children done)-->           verifying
 *   executing   --(work committed, W-003)-->        verifying
 *   verifying   --(criteria met, review passed)-->  done
 *
 * Plus: "Backward transitions (any stage -> an earlier stage) are
 * permitted and MUST record their reason." `RANK` below encodes
 * "earlier": `broken-down` and `executing` share one rank because
 * they are parallel branches at the same point in the table (a node
 * is either interior or leaf, decided when it leaves `specified`),
 * not one before the other — so a lateral hop between them is neither
 * the documented forward exit nor a move to an earlier stage, and
 * this module refuses it. That reading is this module's own judgment
 * call, not something the cited table states in so many words; if a
 * later gate finds the table means otherwise, that is exactly the I2
 * kind of disagreement — a service bug to fix against the table, not
 * a rule to argue for here.
 *
 * A second, register-*structure* invariant travels alongside the
 * stage table: an interior node's stage must be one that structurally
 * permits children (`broken-down` and `done`, or terminally
 * `verifying`... — the coordinating repository's form checker calls
 * this set `INTERIOR_OK = {broken-down, verifying, done}`), and a
 * `broken-down` node must actually have children. `checkStructural`
 * below applies the identical rule (same set, same two arms) so this
 * module cannot legalize a transition that would immediately fail the
 * coordinating repository's own `register-structure` check on the
 * next line of the same file.
 */

import { STAGES } from "./vendored/plan-register.js";
import type { PlanNode, Stage } from "./vendored/plan-register.js";

// Rank order matches the lifecycle table above. `broken-down` and
// `executing` share rank 3 — parallel branches, not a sequence.
const RANK: Record<Stage, number> = {
  identified: 0,
  planned: 1,
  specified: 2,
  "broken-down": 3,
  executing: 3,
  verifying: 4,
  done: 5,
};

// The documented forward exit(s) for each stage, verbatim from the
// table's "Exit condition" column.
const FORWARD_EDGES: Record<Stage, readonly Stage[]> = {
  identified: ["planned"],
  planned: ["specified"],
  specified: ["broken-down", "executing"],
  "broken-down": ["verifying"],
  executing: ["verifying"],
  verifying: ["done"],
  done: [],
};

// Mirrors form_check's INTERIOR_OK: the only stages a node with
// children may legally carry (plugin/scripts/lib/form-check-core.ts
// in the coordinating repository, register-structure rule).
const INTERIOR_OK: ReadonlySet<Stage> = new Set([
  "broken-down",
  "verifying",
  "done",
]);

export function isKnownStage(stage: string): stage is Stage {
  return (STAGES as readonly string[]).includes(stage);
}

export type TransitionCheck =
  | { legal: true; direction: "forward" | "backward" }
  | { legal: false; reason: string };

/**
 * Checks `from -> to` against the lifecycle table alone (no register
 * structure yet — see `checkStructural` for the second invariant).
 */
export function checkTransition(from: string, to: string): TransitionCheck {
  if (!isKnownStage(from)) {
    return {
      legal: false,
      reason:
        `the register's current stage [${from}] is not in the node lifecycle ` +
        'vocabulary (docs/process/plan-model.md, "The node lifecycle"); ' +
        "this register line needs a human to fix before it can be moved through the service",
    };
  }
  if (!isKnownStage(to)) {
    return {
      legal: false,
      reason:
        `requested stage [${to}] is not in the node lifecycle vocabulary ` +
        '(docs/process/plan-model.md, "The node lifecycle")',
    };
  }
  if (from === to) {
    return {
      legal: false,
      reason: `[${from}] -> [${to}] is not a transition (the node is already there)`,
    };
  }
  if (FORWARD_EDGES[from].includes(to)) {
    return { legal: true, direction: "forward" };
  }
  if (RANK[to] < RANK[from]) {
    return { legal: true, direction: "backward" };
  }
  return {
    legal: false,
    reason:
      `[${from}] -> [${to}] is not a legal transition: it is neither the documented ` +
      "forward exit for [" +
      from +
      '] (docs/process/plan-model.md, "The node lifecycle") nor a move to an earlier stage',
  };
}

export type StructuralCheck = { ok: true } | { ok: false; reason: string };

/**
 * The register-structure invariant: a node with children may only
 * carry a stage in `INTERIOR_OK`, and `broken-down` requires at least
 * one child. Applied against `to` (the requested stage) and the
 * node's children as parsed from the register the edit is computed
 * against — the same content `checkTransition` above is checked
 * against, so both invariants see one consistent snapshot.
 */
export function checkStructural(node: PlanNode, to: Stage): StructuralCheck {
  const hasChildren = node.childIds.length > 0;
  if (hasChildren && !INTERIOR_OK.has(to)) {
    return {
      ok: false,
      reason:
        `${node.id} has ${node.childIds.length} child(ren); moving it to [${to}] would fail ` +
        "the register-structure invariant (interior nodes are broken-down/verifying/done)",
    };
  }
  if (!hasChildren && to === "broken-down") {
    return {
      ok: false,
      reason: `${node.id} has no children; [broken-down] requires at least one`,
    };
  }
  return { ok: true };
}
