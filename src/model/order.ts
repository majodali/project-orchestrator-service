/**
 * Sibling order follows dependency (owner, 2026-11-10): among the
 * children of one parent, a node comes after every sibling it waits
 * for, directly or through other siblings, and otherwise keeps its
 * place. `plan-state render --write` writes the state file in this
 * order; `check` reports a file that is not (invariant 10). The order
 * carries no meaning beyond reading: dependencies are the `after`
 * field, never the position.
 */

import type { Node, State } from "./schema.js";

/** The nodes in canonical order: parents before children in the
 * existing tree order, siblings sorted so that a node follows the
 * siblings it depends on, stable otherwise. A dependency counts at the
 * sibling level when any node in one sibling's subtree waits for any
 * node in another's, so that a parent whose child waits on an uncle
 * comes after that uncle (owner, 2026-11-10: P2-N022 waits on
 * P2-N005). */
export function orderSiblingsByDependency(state: State): Node[] {
  const byParent = new Map<string | null, Node[]>();
  for (const n of state.nodes) {
    if (!byParent.has(n.parent)) byParent.set(n.parent, []);
    byParent.get(n.parent)!.push(n);
  }
  const ids = new Set(state.nodes.map((n) => n.id));
  const subtree = new Map<string, Set<string>>();
  const collect = (id: string): Set<string> => {
    if (subtree.has(id)) return subtree.get(id)!;
    const set = new Set<string>([id]);
    for (const c of byParent.get(id) ?? [])
      for (const x of collect(c.id)) set.add(x);
    subtree.set(id, set);
    return set;
  };
  for (const id of ids) collect(id);
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const out: Node[] = [];
  const visit = (parent: string | null): void => {
    const siblings = byParent.get(parent) ?? [];
    for (const n of sortSiblings(siblings, subtree, byId)) {
      out.push(n);
      if (ids.has(n.id)) visit(n.id);
    }
  };
  visit(null);
  // Nodes whose parent is not in the file keep their place at the end,
  // so that a broken file still round-trips; invariant 2 reports them.
  for (const n of state.nodes) if (!out.includes(n)) out.push(n);
  return out;
}

/** The siblings a sibling waits for, through any node of its subtree. */
function liftedDependencies(
  n: Node,
  siblings: Node[],
  subtree: Map<string, Set<string>>,
  byId: Map<string, Node>,
): Set<string> {
  const out = new Set<string>();
  for (const id of subtree.get(n.id) ?? [n.id]) {
    for (const d of byId.get(id)?.after ?? []) {
      const owner = siblings.find(
        (s) => s.id !== n.id && (subtree.get(s.id)?.has(d) ?? false),
      );
      if (owner) out.add(owner.id);
    }
  }
  return out;
}

/** A stable topological sort of one sibling group over the lifted
 * dependencies. A cycle inside the group leaves the cyclic nodes in
 * their original order; invariant 2 reports a direct one. */
function sortSiblings(
  siblings: Node[],
  subtree: Map<string, Set<string>>,
  byId: Map<string, Node>,
): Node[] {
  const deps = new Map(
    siblings.map((n) => [n.id, liftedDependencies(n, siblings, subtree, byId)]),
  );
  const position = new Map(siblings.map((n, i) => [n.id, i]));
  const placed = new Set<string>();
  const out: Node[] = [];
  let remaining = [...siblings];
  while (remaining.length > 0) {
    const ready = remaining.filter((n) =>
      [...deps.get(n.id)!].every((d) => placed.has(d)),
    );
    if (ready.length === 0) {
      out.push(...remaining);
      break;
    }
    const next = ready.reduce((a, b) =>
      position.get(a.id)! <= position.get(b.id)! ? a : b,
    );
    out.push(next);
    placed.add(next.id);
    remaining = remaining.filter((n) => n !== next);
  }
  return out;
}

/** True when the state's nodes already stand in canonical order. */
export function isOrdered(state: State): boolean {
  const ordered = orderSiblingsByDependency(state);
  return ordered.every((n, i) => state.nodes[i] === n);
}
