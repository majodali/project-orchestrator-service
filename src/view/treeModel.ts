/**
 * What the tree page adds to each node (node P2-N023, iteration 2, by
 * the owner's rules of 2026-11-03): an aggregate status over the node's
 * subtree, and the Project model's resources placed in the tree.
 *
 * Aggregate status. Over the node and every node beneath it, the first
 * rule that holds:
 *
 *   1. every node is `done`: done;
 *   2. a node not `done` carries a `gated` hold: waiting on the owner;
 *   3. a node is `broken-down`, `executing` or `verifying`, or some
 *      nodes are `done` and some are not: in progress;
 *   4. a node carries a `blocked` hold, or the list of what is next
 *      classes a node `waiting on` (a recorded dependency on a node not
 *      `done`): pending dependencies;
 *   5. otherwise: ready.
 *
 * Resource placement. Each Project model entry is placed under the
 * highest node, the one nearest the root, among: the nodes on its
 * `created-by` line, the nodes on its `modified-by` line, and the
 * parent of each node on its `used-by` line (the node itself where it
 * is a root). Only nodes the register lists count; gate items, `none`,
 * `not yet derived` and parties outside the plan place nothing. Ties go
 * to the node earlier in register order. An entry no rule places is
 * listed apart, with the reason.
 *
 * Like the renderings it draws on, this carries no progress authority:
 * every page's limit line names the Backlog as the referent.
 */

import type { RegisterParseResult } from "../planRegister/types.js";
import type {
  ModelEntry,
  ModelItem,
} from "../planRegister/vendored/project-model.js";
import type { MapRow } from "./modelRenderings.js";
import { listOfWhatIsNext, mapRow } from "./modelRenderings.js";
import type { ModelAtPage } from "./projectModel.js";
import { itemsOf } from "./projectModel.js";

export type TreeStatus = "done" | "owner" | "progress" | "pending" | "ready";

export const STATUS_LABELS: Readonly<Record<TreeStatus, string>> = {
  done: "All done",
  owner: "Waiting on the owner",
  progress: "In progress",
  pending: "Pending dependencies",
  ready: "Not started, ready",
};

const ACTIVE = new Set(["broken-down", "executing", "verifying"]);

function subtree(register: RegisterParseResult, id: string): string[] {
  const out = [id];
  for (const child of register.nodes.get(id)!.childIds) {
    out.push(...subtree(register, child));
  }
  return out;
}

/** The aggregate status of every node in the register. */
export function treeStatuses(
  register: RegisterParseResult,
  model: ModelAtPage,
): Map<string, TreeStatus> {
  const waiting = new Set<string>();
  const next = listOfWhatIsNext(model, register);
  if (next.kind === "items") {
    for (const item of next.items) {
      if (item.classification === "waiting on") waiting.add(item.node.id);
    }
  }
  const statuses = new Map<string, TreeStatus>();
  for (const id of register.order) {
    const nodes = subtree(register, id).map((n) => register.nodes.get(n)!);
    const open = nodes.filter((n) => n.stage !== "done");
    let status: TreeStatus;
    if (open.length === 0) status = "done";
    else if (open.some((n) => n.hold?.kind === "gated")) status = "owner";
    else if (
      open.some((n) => ACTIVE.has(n.stage)) ||
      open.length < nodes.length
    ) {
      status = "progress";
    } else if (
      open.some((n) => n.hold?.kind === "blocked" || waiting.has(n.id))
    ) {
      status = "pending";
    } else status = "ready";
    statuses.set(id, status);
  }
  return statuses;
}

/** A resource placed in the tree, or listed apart with the reason. */
export interface PlacedResource {
  row: MapRow;
  /** The node it sits under, or null when no rule places it. */
  nodeId: string | null;
  /** Why no rule places it; null when placed. */
  reason: string | null;
}

function depthOf(register: RegisterParseResult, id: string): number {
  let depth = 0;
  let parent = register.nodes.get(id)!.parentId;
  while (parent !== null) {
    depth += 1;
    parent = register.nodes.get(parent)!.parentId;
  }
  return depth;
}

function itemWords(register: RegisterParseResult, item: ModelItem): string {
  const form = item.form;
  switch (form.kind) {
    case "node":
      return register.nodes.has(form.node)
        ? form.node
        : `${form.node} (not in the register)`;
    case "gate":
      return `${form.node} gate`;
    case "none":
      return "none";
    case "not-yet-derived":
      return "not yet derived";
    case "outside":
      return `${form.party} (outside the plan)`;
    default:
      return "an item that does not parse";
  }
}

function lineWords(
  register: RegisterParseResult,
  entry: ModelEntry,
  label: "created-by" | "modified-by" | "used-by",
): string {
  const items = itemsOf(entry, label);
  const words =
    items.length === 0
      ? "no line"
      : items.map((item) => itemWords(register, item)).join(", ");
  return `${label}: ${words}`;
}

/** Places every entry of the instance; empty when it is absent. */
export function placeResources(
  register: RegisterParseResult,
  model: ModelAtPage,
): PlacedResource[] {
  if (model.kind === "absent") return [];
  const rank = new Map(register.order.map((id, i) => [id, i]));
  return model.parsed.entries.map((entry) => {
    const row = mapRow(entry, model.parsed, register);
    const candidates: string[] = [];
    for (const label of ["created-by", "modified-by"] as const) {
      for (const item of itemsOf(entry, label)) {
        if (item.form.kind === "node" && register.nodes.has(item.form.node)) {
          candidates.push(item.form.node);
        }
      }
    }
    for (const item of itemsOf(entry, "used-by")) {
      if (item.form.kind !== "node") continue;
      const user = register.nodes.get(item.form.node);
      if (user === undefined) continue;
      candidates.push(user.parentId ?? user.id);
    }
    if (candidates.length === 0) {
      const reason = `No node in the register creates, modifies or uses it (${[
        lineWords(register, entry, "created-by"),
        lineWords(register, entry, "modified-by"),
        lineWords(register, entry, "used-by"),
      ].join("; ")}).`;
      return { row, nodeId: null, reason };
    }
    candidates.sort(
      (a, b) =>
        depthOf(register, a) - depthOf(register, b) ||
        rank.get(a)! - rank.get(b)!,
    );
    return { row, nodeId: candidates[0]!, reason: null };
  });
}
