/**
 * Computes the exact register edit `plan_update` returns, and checks
 * whether a confirmed commit actually carries it (`plan_confirm`) —
 * chunk 1 child D, node P2-N010.
 *
 * The service never applies either: `planTransitionEdit` returns
 * `{ file, line, oldLine, newLine }` for the calling session to apply
 * itself (the write model — see docs/plans/p2-n002-service-skeleton.md
 * in the coordinating repository, "The write model"). The edit is
 * deliberately the smallest possible text change — the stage bracket
 * on one line, nothing else — so it is byte-identical to what a
 * session editing the line by hand under the v1 process would produce
 * (I1: equivalence with the v1 process).
 */

import { parseRegister } from "./vendored/plan-register.js";
import type { PlanNode, Stage } from "./vendored/plan-register.js";
import {
  checkStructural,
  checkTransition,
  isKnownStage,
} from "./transitions.js";

export const PLAN_REGISTER_PATH = "docs/plan-register.md";

export interface RegisterEdit {
  file: string;
  /** 1-based line number in the register text this edit was computed against. */
  line: number;
  oldLine: string;
  newLine: string;
}

export type PlanUpdatePlan =
  | {
      ok: true;
      node: PlanNode;
      fromStage: Stage;
      toStage: Stage;
      edit: RegisterEdit;
    }
  | { ok: false; reason: string };

function splitLines(text: string): string[] {
  return text.split(/\r\n|\n/);
}

/**
 * Replaces exactly the stage bracket's contents on a node's line —
 * `"- P2-N010 [identified] Title"` becomes
 * `"- P2-N010 [planned] Title"` — without touching indentation, hold
 * markers, title, or links. Locates the bracket by the node ID marker
 * that precedes it (`"<id> ["`) rather than by searching for the
 * stage text itself, so a stage name that happens to also appear in
 * the title or an annotation is never mistaken for the bracket.
 */
export function computeEditLine(
  rawLine: string,
  nodeId: string,
  fromStage: string,
):
  | { ok: true; newLine: (toStage: string) => string }
  | { ok: false; reason: string } {
  const idMarker = `${nodeId} [`;
  const idx = rawLine.indexOf(idMarker);
  if (idx === -1) {
    return {
      ok: false,
      reason: `internal: could not locate "${idMarker}" on the node's own source line`,
    };
  }
  const stageStart = idx + idMarker.length;
  const closeIdx = rawLine.indexOf("]", stageStart);
  if (closeIdx === -1) {
    return {
      ok: false,
      reason: "internal: stage bracket on the node's source line never closes",
    };
  }
  const foundStage = rawLine.slice(stageStart, closeIdx);
  if (foundStage !== fromStage) {
    return {
      ok: false,
      reason:
        `internal: parsed stage [${fromStage}] does not match the stage bracket text ` +
        `[${foundStage}] found on the node's own source line`,
    };
  }
  return {
    ok: true,
    newLine: (toStage: string) =>
      rawLine.slice(0, stageStart) + toStage + rawLine.slice(closeIdx),
  };
}

/**
 * The full `plan_update` computation: parse, locate `nodeId`, check
 * `fromStage -> toStage` against the lifecycle table and the
 * register-structure invariant, and compute the edit. Pure — takes
 * register text in, decides nothing about git or the lease.
 */
export function planTransitionEdit(
  registerText: string,
  nodeId: string,
  toStage: string,
): PlanUpdatePlan {
  const parsed = parseRegister(registerText);
  const node = parsed.nodes.get(nodeId);
  if (!node) {
    return { ok: false, reason: `no node ${nodeId} in this register` };
  }

  const transition = checkTransition(node.stage, toStage);
  if (!transition.legal) {
    return { ok: false, reason: transition.reason };
  }
  // checkTransition already confirmed both stages are known, so these
  // casts are sound rather than a bypass.
  const fromStage = node.stage as Stage;
  const targetStage = toStage as Stage;

  const structural = checkStructural(node, targetStage);
  if (!structural.ok) {
    return { ok: false, reason: structural.reason };
  }

  const lines = splitLines(registerText);
  const oldLine = lines[node.line - 1];
  if (oldLine === undefined) {
    return {
      ok: false,
      reason: `internal: line ${node.line} not present in the fetched register text`,
    };
  }

  const computed = computeEditLine(oldLine, nodeId, fromStage);
  if (!computed.ok) {
    return { ok: false, reason: computed.reason };
  }

  return {
    ok: true,
    node,
    fromStage,
    toStage: targetStage,
    edit: {
      file: PLAN_REGISTER_PATH,
      line: node.line,
      oldLine,
      newLine: computed.newLine(targetStage),
    },
  };
}

export type ConfirmCheck =
  | { ok: true; line: number; actualLine: string }
  | { ok: false; reason: string; line?: number; actualLine?: string };

/**
 * `plan_confirm`'s divergence check (I3 / R10): does the register at
 * the confirmed commit actually show `nodeId` at `toStage`? Checked by
 * re-parsing the confirmed content and looking the node up by ID
 * (never by line number, which a race elsewhere in the register could
 * have shifted) — a mismatch, or the node's outright disappearance, is
 * reported naming the file and the line the node is (or was) found at.
 */
export function checkConfirmed(
  registerText: string,
  nodeId: string,
  toStage: string,
): ConfirmCheck {
  const parsed = parseRegister(registerText);
  const node = parsed.nodes.get(nodeId);
  if (!node) {
    return {
      ok: false,
      reason: `${PLAN_REGISTER_PATH} at the confirmed commit has no node ${nodeId} at all`,
    };
  }
  const lines = splitLines(registerText);
  const actualLine = lines[node.line - 1] ?? "";
  if (node.stage !== toStage) {
    return {
      ok: false,
      reason:
        `${PLAN_REGISTER_PATH} line ${node.line} shows ${nodeId} as [${node.stage}], ` +
        `not the expected [${toStage}] — divergence between the confirmed commit and the edit`,
      line: node.line,
      actualLine,
    };
  }
  return { ok: true, line: node.line, actualLine };
}

// Re-exported so callers that only need the stage guard do not have to
// reach into ./transitions.js separately.
export { isKnownStage };
