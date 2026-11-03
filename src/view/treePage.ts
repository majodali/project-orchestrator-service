/**
 * The tree page, `GET /view` (node P2-N021, task E1; the specification
 * of P2-N003, "The tree page"). Every node of the Plan register, once,
 * nested as the register nests it. The register is parsed by the
 * vendored grammar (RU-012, how two repositories share one unit of
 * code), which this page uses and does not change.
 *
 * From node P2-N023, iteration 2 (the owner, 2026-11-03), the tree
 * folds. Each row leads with the node's title, linked to its node page,
 * then its ID, its stage and its hold marker, if any, behind an icon
 * for the node's aggregate status (./treeModel.ts). Opening a node
 * shows its register note, verbatim, the Project model resources placed
 * under it, each as its implementation-map row, and its children. The
 * separate implementation map and list of what is next are gone from
 * this page: the tree now carries both. From iteration 3, anything that
 * did not read as expected, unplaced resources included, is listed in
 * one section after the tree. The page runs no script: the
 * folding is HTML's own `details` element.
 */

import { parseRegister } from "../planRegister/parser.js";
import type { RegisterParseResult } from "../planRegister/types.js";
import type { PageCommit } from "./html.js";
import {
  blobUrl,
  escapeHtml,
  limitLine,
  pageHeader,
  pageShell,
} from "./html.js";
import type { DerivedValue } from "../planRegister/vendored/project-model.js";
import type { MapRow } from "./modelRenderings.js";
import { listOfWhatIsNext, notComputableHtml } from "./modelRenderings.js";
import type { ModelAtPage } from "./projectModel.js";
import { MODEL_PATH, entryHref, instanceAbsent } from "./projectModel.js";
import { nodePageHref, renderNote } from "./registerNote.js";
import type { PlacedResource, TreeStatus } from "./treeModel.js";
import { STATUS_LABELS, placeResources, treeStatuses } from "./treeModel.js";

export const REGISTER_PATH = "docs/plan-register.md";

const ICON_SHAPES: Readonly<Record<TreeStatus, string>> = {
  done: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  owner:
    '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.2v4.6" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="11.6" r="1.15" fill="#fff"/>',
  progress:
    '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 3.6a4.4 4.4 0 0 1 0 8.8z" fill="currentColor"/>',
  pending:
    '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.6 1.9"/><path d="M8 4.9v3.4l2.1 1.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  ready:
    '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.6 5.3v5.4l4.3-2.7z" fill="currentColor"/>',
};

/** The status icon, with its label as the accessible name. */
export function statusIcon(status: TreeStatus): string {
  const label = escapeHtml(STATUS_LABELS[status]);
  return `<svg class="icon s-${status}" data-status-icon="${status}" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="${label}"><title>${label}</title>${ICON_SHAPES[status]}</svg>`;
}

/** The resource's state as its icon: built (and built, changing)
 * filled, building half filled in its own colour, planned or not
 * computable empty (node P2-N023, iterations 2 and 3). */
function resourceIcon(value: DerivedValue | null): string {
  const kind =
    value === "built" || value === "built, changing"
      ? "built"
      : value === "building"
        ? "building"
        : "open";
  const label =
    kind === "built"
      ? "Built"
      : kind === "building"
        ? "Building"
        : "Not built yet";
  const fill =
    kind === "built"
      ? '<rect x="2.5" y="2.5" width="11" height="11" rx="2.5" fill="currentColor"/>'
      : kind === "building"
        ? '<path d="M2.5 8v3a2.5 2.5 0 0 0 2.5 2.5h6a2.5 2.5 0 0 0 2.5-2.5V8z" fill="currentColor"/>'
        : "";
  return `<svg class="icon r-${kind}" data-resource-icon="${kind}" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="${label}">${fill}<rect x="2.5" y="2.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
}

/** The map's words for a row with no date (step 5), which the tree
 * leaves out (the owner, 2026-11-03). */
const NO_DATE = "the model holds no date";

/** One resource, as its implementation-map row. */
function resourceHtml(placed: PlacedResource, commit: PageCommit): string {
  const row: MapRow = placed.row;
  const slug = escapeHtml(row.entry.slug);
  const href = escapeHtml(entryHref(commit, commit.sha, row.entry));
  const pointer = `<a data-pointer href="${href}">${escapeHtml(row.pointer)}</a>`;
  const reason =
    placed.reason === null
      ? ""
      : ` <p class="note" data-unplaced-reason>${escapeHtml(placed.reason)}</p>`;
  if (row.notComputable !== null) {
    return [
      `<li class="resource" data-map-row="${slug}">`,
      `<div class="resource-head">${resourceIcon(null)} <strong>${slug}</strong></div> `,
      notComputableHtml(row.notComputable),
      `<p class="note">Pointer: ${pointer}.</p>`,
      reason,
      "</li>",
    ].join("");
  }
  return [
    `<li class="resource" data-map-row="${slug}" data-mark="${row.mark === "x" ? "x" : " "}" data-value="${escapeHtml(row.value ?? "")}">`,
    `<div class="resource-head">${resourceIcon(row.value)} <strong data-what>${escapeHtml(row.what)}</strong></div> `,
    `<p class="note">${row.when === NO_DATE ? "" : `When: <span data-when>${escapeHtml(row.when)}</span>. `}Status: <span data-status>${escapeHtml(row.status)}</span>. Pointer: ${pointer}.</p>`,
    reason,
    "</li>",
  ].join("");
}

interface TreeContext {
  parsed: RegisterParseResult;
  commit: PageCommit;
  statuses: Map<string, TreeStatus>;
  resources: Map<string, PlacedResource[]>;
}

function renderNode(context: TreeContext, id: string, depth: number): string {
  const { parsed, commit } = context;
  const node = parsed.nodes.get(id)!;
  const status = context.statuses.get(id)!;
  const row = [
    `<span class="row">`,
    statusIcon(status),
    ` <a class="title" data-title data-node-link href="${escapeHtml(nodePageHref(node.id, commit.requestedRef))}">${escapeHtml(node.title)}</a>`,
    ` <span class="meta"><span class="id" data-node-id>${escapeHtml(node.id)}</span>`,
    ` <span class="stage" data-stage>[${escapeHtml(node.stage)}]</span>`,
    node.hold?.kind === "blocked"
      ? ` <span class="hold" data-hold>[${escapeHtml(node.hold.kind)}: ${escapeHtml(node.hold.reason)}]</span>`
      : "",
    "</span>",
    // A gate gets its own line, linked to the node page's Gate field
    // (node P2-N023, iteration 3).
    node.hold?.kind === "gated"
      ? `<a class="gate" data-hold href="${escapeHtml(nodePageHref(node.id, commit.requestedRef))}#gate">Gated: ${escapeHtml(node.hold.reason)}</a>`
      : "",
    "</span>",
  ].join("");
  const inner: string[] = [];
  if (node.annotation !== null) {
    inner.push(
      `<div class="note" data-note>${renderNote(node, commit, commit.sha)}</div>`,
    );
  }
  const placed = context.resources.get(id) ?? [];
  if (placed.length > 0) {
    inner.push(
      `<ul class="resources" data-resources>${placed.map((p) => resourceHtml(p, commit)).join("")}</ul>`,
    );
  }
  if (node.childIds.length > 0) {
    inner.push(
      `<ul>${node.childIds.map((child) => renderNode(context, child, depth + 1)).join("")}</ul>`,
    );
  }
  const attrs = `data-node="${escapeHtml(node.id)}" data-depth="${depth}" data-status="${status}"`;
  if (inner.length === 0) {
    return `<li ${attrs}><div class="leaf">${row}</div></li>`;
  }
  const open = status === "owner" || status === "progress" ? " open" : "";
  return `<li ${attrs}><details${open}><summary>${row}</summary><div class="fold">${inner.join("")}</div></details></li>`;
}

function legend(): string {
  const items = (Object.keys(STATUS_LABELS) as TreeStatus[])
    .map(
      (status) =>
        `<li>${statusIcon(status)} ${escapeHtml(STATUS_LABELS[status])}</li>`,
    )
    .join("");
  return `<ul class="legend" data-legend>${items}</ul>`;
}

/**
 * What did not read as expected, at the bottom of the page (node
 * P2-N023, iteration 3): register lines that did not parse, the
 * Project model absent or departing from its entry grammar, map rows
 * and next-list items that are not computable, and resources no rule
 * places. Absent when there is none.
 */
function problemsHtml(
  parsed: RegisterParseResult,
  model: ModelAtPage,
  placed: PlacedResource[],
  commit: PageCommit,
): string {
  const parts: string[] = [];
  if (parsed.errors.length > 0) {
    const items = parsed.errors
      .map(
        (error) =>
          `<li>line ${error.line}: ${escapeHtml(error.reason)}: <code>${escapeHtml(error.raw)}</code></li>`,
      )
      .join("");
    parts.push(
      `<div data-problem="register"><p class="label">Register lines that did not parse (${escapeHtml(REGISTER_PATH)}):</p><ul class="error">${items}</ul></div>`,
    );
  }
  if (model.kind === "absent") {
    parts.push(
      `<div data-problem="model-absent"><p class="label">The Project model, so no resource is placed and no dependency is read:</p>${notComputableHtml(instanceAbsent(model.sha))}</div>`,
    );
  } else {
    if (model.parsed.errors.length > 0) {
      const items = model.parsed.errors
        .map(
          (error) =>
            `<li>line ${error.line}${error.slug ? ` (${escapeHtml(error.slug)})` : ""}: ${escapeHtml(error.reason)}: <code>${escapeHtml(error.raw)}</code></li>`,
        )
        .join("");
      parts.push(
        `<div data-problem="model-grammar"><p class="label">Project model lines that depart from the entry grammar (${escapeHtml(MODEL_PATH)}):</p><ul class="error">${items}</ul></div>`,
      );
    }
    const stopped = placed.filter((p) => p.row.notComputable !== null);
    if (stopped.length > 0) {
      parts.push(
        `<div data-problem="not-computable"><p class="label">Resources whose map row is not computable:</p><ul class="resources">${stopped.map((p) => resourceHtml({ ...p, reason: null }, commit)).join("")}</ul></div>`,
      );
    }
    const next = listOfWhatIsNext(model, parsed);
    const nodes =
      next.kind === "items"
        ? next.items.filter((i) => i.notComputable.length > 0)
        : [];
    if (nodes.length > 0) {
      const items = nodes
        .map(
          (item) =>
            `<li data-problem-node="${escapeHtml(item.node.id)}"><a href="${escapeHtml(nodePageHref(item.node.id, commit.requestedRef))}">${escapeHtml(item.node.id)}</a>: ${item.notComputable.map((nc) => notComputableHtml(nc)).join("")}</li>`,
        )
        .join("");
      parts.push(
        `<div data-problem="dependencies"><p class="label">Nodes whose recorded dependencies cannot be read, so their status ignores them:</p><ul>${items}</ul></div>`,
      );
    }
    const apart = placed.filter((p) => p.nodeId === null);
    if (apart.length > 0) {
      parts.push(
        `<div data-problem="unplaced"><p class="label">Unplaced resources: Project model entries that no node in the register creates, modifies or uses:</p><ul class="resources">${apart.map((p) => resourceHtml(p, commit)).join("")}</ul></div>`,
      );
    }
  }
  if (parts.length === 0) return "";
  return `<section class="problems" data-problems><h2>Problems found</h2>${parts.join("")}</section>`;
}

/** Renders the tree page from the register's text and the Project
 * model instance at `commit.sha`. */
export function renderTreePage(
  registerText: string,
  model: ModelAtPage,
  commit: PageCommit,
): string {
  const parsed = parseRegister(registerText);
  const placed = placeResources(parsed, model);
  const resources = new Map<string, PlacedResource[]>();
  for (const p of placed) {
    if (p.nodeId === null) continue;
    resources.set(p.nodeId, [...(resources.get(p.nodeId) ?? []), p]);
  }
  const context: TreeContext = {
    parsed,
    commit,
    statuses: treeStatuses(parsed, model),
    resources,
  };
  const tree = parsed.rootIds.map((id) => renderNode(context, id, 0)).join("");
  const body = [
    pageHeader(commit, "/view"),
    limitLine(commit, commit.sha),
    "<main>",
    "<h1>Plan tree</h1>",
    `<p class="note">From <a href="${escapeHtml(blobUrl(commit, commit.sha, REGISTER_PATH))}">${escapeHtml(REGISTER_PATH)}</a> and the Project model at this commit. Open a node for its note, its resources and its children.</p>`,
    legend(),
    `<ul class="tree">${tree}</ul>`,
    problemsHtml(parsed, model, placed, commit),
    "</main>",
  ].join("\n");
  return pageShell("Plan tree", body);
}
