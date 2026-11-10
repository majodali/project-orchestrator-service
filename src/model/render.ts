/**
 * Renderings of a state file: `docs/plan-register.md`, in the Plan
 * register grammar the plugin's form checker reads, and
 * `docs/plan.md`, the plan a person reads. Both carry a generated-file
 * header. `check` fails when a rendered file differs from this output.
 */

import {
  NODE_CLASS_LABELS,
  attentionReason,
  childrenOf,
  classifyAll,
  nodesById,
  type NodeClass,
} from "./check.js";
import type { Decision, Node, State } from "./schema.js";

const GENERATED_LINE =
  "Generated from `orchestration/state.json` by `plan-state render`. Do not edit by hand: edit the state file, or use the service's tools, and run `plan-state render --write`. `plan-state check` fails when this file differs from the rendering.";

/** Nodes in tree order: each root, then its subtree, in array order. */
export function treeOrder(state: State): Array<{ node: Node; depth: number }> {
  const children = childrenOf(state);
  const out: Array<{ node: Node; depth: number }> = [];
  const visit = (n: Node, depth: number): void => {
    out.push({ node: n, depth });
    for (const c of children.get(n.id) ?? []) visit(c, depth + 1);
  };
  for (const n of state.nodes) {
    if (n.parent === null) visit(n, 0);
  }
  return out;
}

function registerLinks(n: Node): string {
  const parts: string[] = [];
  if (n.docs.plan) parts.push(`plan: ${stripDocs(n.docs.plan)}`);
  if (n.docs.spec) parts.push(`spec: ${stripDocs(n.docs.spec)}`);
  return parts.length > 0 ? ` — ${parts.join(" · ")}` : "";
}

/** The register writes document paths relative to `docs/`. */
function stripDocs(p: string): string {
  return p.startsWith("docs/") ? p.slice("docs/".length) : p;
}

export function renderRegister(state: State): string {
  const lines: string[] = [
    "# Plan register",
    "",
    GENERATED_LINE,
    "",
    "Instance of the *Plan register* type, defined by citation in the",
    "[Classification](classification.md) ([type spec](process/plan-register.md)).",
    "One line per node: identifier, stage, hold, title, documents.",
    "Dependencies are in the state file, not in sibling order.",
    "",
  ];
  for (const { node, depth } of treeOrder(state)) {
    const indent = "  ".repeat(depth);
    const hold = node.hold ? ` [${node.hold.kind}: ${node.hold.reason}]` : "";
    lines.push(
      `${indent}- ${node.id} [${node.stage}]${hold} ${node.title}${registerLinks(node)}`,
    );
  }
  return lines.join("\n") + "\n";
}

function md(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function nodeLabel(n: Node): string {
  return `${n.title} (${n.id})`;
}

function docLinks(n: Node): string {
  const parts: string[] = [];
  if (n.docs.plan) parts.push(`[plan](${stripDocs(n.docs.plan)})`);
  if (n.docs.spec) parts.push(`[spec](${stripDocs(n.docs.spec)})`);
  return parts.join(", ");
}

function decisionLine(d: Decision, byId: Map<string, Node>): string {
  const where = d.node ? ` on ${nodeLabel(byId.get(d.node)!)}` : "";
  const dflt = d.default ? ` Default: ${md(d.default)}` : "";
  return `- ${d.id}${where}: ${md(d.question)}${dflt}`;
}

export function renderPlan(state: State): string {
  const byId = nodesById(state);
  const classes = classifyAll(state);
  const open = state.decisions.filter((d) => d.chosen === null);
  const lines: string[] = [
    "# The project plan",
    "",
    GENERATED_LINE,
    "",
    "Reader: the owner, and any session working on the project. The reader",
    "knows the README. Each node is shown as its title, its identifier,",
    "its stage and its outcome. The state file holds the rest.",
    "",
    "## Waiting on the owner",
    "",
  ];
  const gated = state.nodes.filter((n) => classes.get(n.id) === "gated");
  if (open.length === 0 && gated.length === 0) {
    lines.push("Nothing.", "");
  } else {
    if (open.length > 0) {
      lines.push("Open decisions:", "");
      for (const d of open) lines.push(decisionLine(d, byId));
      lines.push("");
    }
    if (gated.length > 0) {
      lines.push("Gated nodes:", "");
      for (const n of gated)
        lines.push(`- ${nodeLabel(n)}: ${md(attentionReason(n))}`);
      lines.push("");
    }
  }

  const byClass = (c: NodeClass): Node[] =>
    state.nodes.filter((n) => classes.get(n.id) === c);
  for (const [heading, cls] of [
    ["Ready, starting automatically when the loop runs", "actionable"],
    ["In flight", "in-flight"],
    ["In progress, children carry the work", "in-progress"],
    ["Waiting on a dependency", "waiting"],
    ["Blocked", "blocked"],
  ] as const) {
    const nodes = byClass(cls);
    lines.push(`## ${heading}`, "");
    if (nodes.length === 0) {
      lines.push("None.", "");
      continue;
    }
    for (const n of nodes) {
      let extra = "";
      if (cls === "waiting") {
        const pending = n.after.filter((d) => byId.get(d)?.stage !== "done");
        extra = ` — after ${pending.map((d) => nodeLabel(byId.get(d)!)).join(", ")}`;
      } else if (cls === "blocked") {
        extra = ` — ${md(n.hold!.reason)}`;
      } else if (cls === "in-flight") {
        const tasks = state.tasks.filter(
          (t) => t.node === n.id && t.status === "open",
        );
        extra = ` — ${tasks.map((t) => t.id).join(", ")}`;
      }
      lines.push(`- ${nodeLabel(n)} [${n.stage}]${extra}`);
    }
    lines.push("");
  }

  lines.push("## The plan", "");
  const children = childrenOf(state);
  for (const root of state.nodes.filter((n) => n.parent === null)) {
    lines.push(`### ${nodeLabel(root)}`, "");
    lines.push(
      `Stage: ${root.stage}, ${NODE_CLASS_LABELS[classes.get(root.id)!]}.`,
    );
    if (root.outcome) lines.push("", md(root.outcome));
    const links = docLinks(root);
    if (links) lines.push("", `Documents: ${links}.`);
    if (root.note) lines.push("", `Note: ${md(root.note)}`);
    lines.push("");
    const visit = (n: Node, depth: number): void => {
      const indent = "  ".repeat(depth);
      const cls = classes.get(n.id)!;
      const hold = n.hold ? `, ${n.hold.kind}: ${md(n.hold.reason)}` : "";
      const stage = n.stage === "done" && n.done ? `done ${n.done}` : n.stage;
      const head = `${indent}- **${md(n.title)}** (${n.id}, ${stage}${hold})`;
      lines.push(head);
      if (n.outcome) lines.push(`${indent}  ${md(n.outcome)}`);
      const detail: string[] = [];
      if (cls === "waiting") {
        const pending = n.after.filter((d) => byId.get(d)?.stage !== "done");
        detail.push(`after ${pending.join(", ")}`);
      } else if (n.after.length > 0) {
        detail.push(`after ${n.after.join(", ")}`);
      }
      const dl = docLinks(n);
      if (dl) detail.push(dl);
      const decisions = state.decisions.filter(
        (d) => d.node === n.id && d.chosen === null,
      );
      if (decisions.length > 0) {
        detail.push(
          `${decisions.length} open decision${decisions.length > 1 ? "s" : ""}`,
        );
      }
      if (detail.length > 0) lines.push(`${indent}  ${detail.join(" · ")}`);
      if (n.note) lines.push(`${indent}  Note: ${md(n.note)}`);
      for (const c of children.get(n.id) ?? []) visit(c, depth + 1);
    };
    for (const c of children.get(root.id) ?? []) visit(c, 0);
    lines.push("");
  }

  lines.push("## Decisions taken", "");
  const closed = state.decisions.filter((d) => d.chosen !== null);
  if (closed.length === 0) {
    lines.push("None.", "");
  } else {
    for (const d of closed) {
      const where = d.node ? ` on ${d.node}` : "";
      const standing = d.standing ? ", standing" : "";
      lines.push(
        `- ${d.id}${where} (${d.decided}${standing}): ${md(d.question)} Chosen: ${md(d.chosen!)}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
