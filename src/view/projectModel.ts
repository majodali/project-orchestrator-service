/**
 * The Project model as the web view reads it (node P2-N021, the web
 * view's first version, task E3; the specification of P2-N003 in the
 * coordinating repository, "What it reads", "The node page" and "What
 * "what is next" means", decisions 9 and 11).
 *
 * The instance, `docs/project-model.md`, is read at the page's SHA,
 * beside the register, and parsed by the vendored shared unit,
 * `../planRegister/vendored/project-model.js`, the same parser the
 * coordinating repository owns (RU-012, how two repositories share one
 * unit of code; decision 7). This module adds no grammar. It applies
 * two of the type's rules as written (docs/process/project-model.md):
 * "State derivation" and "Node-to-node dependency". Where a rule reads
 * a line the parser reported as departing from the entry grammar, the
 * answer is not computable, naming the file, the line and the missing
 * input (decision 11, case (b)); where the instance is absent at the
 * page's SHA, every answer from it is (case (a)).
 */

import type { PlanNode, RegisterParseResult } from "../planRegister/types.js";
import type {
  FacetLabel,
  ModelEntry,
  ModelItem,
  ModelParseError,
  ModelParseResult,
} from "../planRegister/vendored/project-model.js";
import {
  PROJECT_MODEL_PATH,
  facetLine,
  parseProjectModel,
} from "../planRegister/vendored/project-model.js";
import type { RepoCoordinates } from "./html.js";
import { blobUrl } from "./html.js";

export const MODEL_PATH = PROJECT_MODEL_PATH;

/** The instance as a page read it: absent at the page's SHA, or
 * parsed. */
export type ModelAtPage =
  | { kind: "absent"; sha: string }
  | { kind: "read"; sha: string; parsed: ModelParseResult };

export function modelAtPage(
  sha: string,
  text: string | undefined,
): ModelAtPage {
  if (text === undefined) return { kind: "absent", sha };
  const parsed = parseProjectModel(text);
  recordAnchors(text, parsed);
  return { kind: "read", sha, parsed };
}

/**
 * The view's marking where the type's procedure cannot finish from the
 * files at the page's commit (the specification's term *not
 * computable*). It names the file, the line and the missing input.
 */
export interface NotComputable {
  file: string;
  /** The line, or null when the file itself is absent. */
  line: number | null;
  input: string;
  reason: string;
}

export function notComputableText(nc: NotComputable): string {
  const where = nc.line === null ? "no line" : `line ${nc.line}`;
  const reason = /[.!?]$/.test(nc.reason) ? nc.reason : `${nc.reason}.`;
  return `Not computable: ${nc.file}, ${where}. Missing input: ${nc.input}. ${reason}`;
}

/** Case (a): the instance is absent at the page's SHA. */
export function instanceAbsent(sha: string): NotComputable {
  return {
    file: MODEL_PATH,
    line: null,
    input: "the Project model instance",
    reason: `${MODEL_PATH} is absent at ${sha}`,
  };
}

/**
 * The anchor GitHub gives a heading in a rendered Markdown file:
 * lowercased, with punctuation other than hyphens removed and each
 * space made a hyphen.
 */
export function headingAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Each entry's anchor, as GitHub names it in the whole file: a heading
 * whose anchor an earlier heading already took gets `-1`, `-2` and so
 * on. The instance's title, `# Project model`, takes `project-model`,
 * so the entry `## project-model` is `#project-model-1`.
 */
const ANCHORS = new WeakMap<ModelEntry, string>();

function recordAnchors(text: string, parsed: ModelParseResult): void {
  const taken = new Map<string, number>();
  const byLine = new Map<number, string>();
  let fenced = false;
  text.split(/\r\n|\n/).forEach((line, i) => {
    if (/^(```|~~~)/.test(line)) fenced = !fenced;
    const m = fenced ? null : /^#{1,6} +(.*?)\s*#*\s*$/.exec(line);
    if (!m) return;
    const base = headingAnchor(m[1]!);
    let anchor = base;
    while (taken.has(anchor)) {
      const n = taken.get(base)! + 1;
      taken.set(base, n);
      anchor = `${base}-${n}`;
    }
    taken.set(anchor, 0);
    byLine.set(i + 1, anchor);
  });
  for (const entry of parsed.entries) {
    const anchor = byLine.get(entry.line);
    if (anchor !== undefined) ANCHORS.set(entry, anchor);
  }
}

function anchorOf(entry: ModelEntry): string {
  return ANCHORS.get(entry) ?? headingAnchor(entry.heading);
}

/** The entry's anchor in the instance, as the pointer names it. */
export function entryPointer(entry: ModelEntry): string {
  return `${MODEL_PATH}#${anchorOf(entry)}`;
}

/** A link to the entry in GitHub's file view at `sha` (decision 6). */
export function entryHref(
  repo: RepoCoordinates,
  sha: string,
  entry: ModelEntry,
): string {
  return `${blobUrl(repo, sha, MODEL_PATH)}#${anchorOf(entry)}`;
}

function errorsOf(
  parsed: ModelParseResult,
  entry: ModelEntry,
): ModelParseError[] {
  return parsed.errors.filter(
    (error) => error.line >= entry.line && error.line <= entry.endLine,
  );
}

function failureOf(entry: ModelEntry, error: ModelParseError): NotComputable {
  return {
    file: MODEL_PATH,
    line: error.line,
    input:
      error.label === null
        ? `the entry ${entry.slug}`
        : `the ${error.label} line of ${entry.slug}`,
    reason: `It fails the type's entry grammar: ${error.reason}`,
  };
}

/**
 * The first parse error a reader of `labels` meets in the entry: one in
 * a line it reads, or one of the entry's own, such as its heading.
 * Null when every line it reads follows the grammar.
 */
export function readFailure(
  parsed: ModelParseResult,
  entry: ModelEntry,
  labels: readonly FacetLabel[],
): NotComputable | null {
  const error = errorsOf(parsed, entry).find(
    (e) => e.label === null || labels.includes(e.label),
  );
  return error === undefined ? null : failureOf(entry, error);
}

const NODE_IDS = /P\d+-N\d+/g;

function namesInText(text: string, id: string): boolean {
  return [...text.matchAll(NODE_IDS)].some((m) => m[0] === id);
}

/**
 * Whether a line might name `id` in a way the grammar does not let a
 * reader settle: an item whose body the parser could not give a form,
 * or a line the parser could not place, that writes `id`. An item
 * names a node only by writing its identifier, so text that does not
 * write it names it in no form. Returns the marking, or null.
 */
export function namingUnsettled(
  parsed: ModelParseResult,
  entry: ModelEntry,
  label: FacetLabel,
  id: string,
): NotComputable | null {
  const line = facetLine(entry, label);
  const malformed = line?.items.find(
    (item) => item.form.kind === "malformed" && namesInText(item.text, id),
  );
  if (malformed !== undefined) {
    const error = errorsOf(parsed, entry).find(
      (e) => e.label === label && e.line === malformed.line,
    );
    if (error !== undefined) return failureOf(entry, error);
  }
  const stray = errorsOf(parsed, entry).find(
    (e) => e.label === null && namesInText(e.raw, id),
  );
  return stray === undefined ? null : failureOf(entry, stray);
}

/** The items of a line, or none when the entry lacks it. */
export function itemsOf(entry: ModelEntry, label: FacetLabel): ModelItem[] {
  return facetLine(entry, label)?.items ?? [];
}

/** True when the line reads `not yet derived`. */
export function readsNotYetDerived(
  entry: ModelEntry,
  label: FacetLabel,
): boolean {
  return itemsOf(entry, label).some(
    (item) => item.form.kind === "not-yet-derived",
  );
}

/** True when the entry's state line carries the `standing` item. */
export function isStanding(entry: ModelEntry): boolean {
  return itemsOf(entry, "state").some((item) => item.form.kind === "standing");
}

/** A node's stage from the register. A node the register no longer
 * lists counts as `done`, because the register prunes only completed
 * trees ("State derivation", step 3). */
export function stageOf(
  register: RegisterParseResult,
  id: string,
): { stage: string; listed: boolean } {
  const node = register.nodes.get(id);
  return node === undefined
    ? { stage: "done", listed: false }
    : { stage: node.stage, listed: true };
}

// ---- Node-to-node dependency ------------------------------------------
//
// Node X depends on node Y when X has a `uses` edge on a resource R and
// either Y has a `creates` edge on R, or X's edge on R names Y in its
// after qualifier. A gate item, `created-by: none` and an outside item
// add no dependency. A node never depends on itself through its own
// edges (docs/process/project-model.md, "Node-to-node dependency").

/** One dependency the rule derives: `from` depends on `on`, through a
 * use of `entry`. */
export interface EdgeDependency {
  from: string;
  on: string;
  entry: ModelEntry;
  /** Why: `on` creates the resource, or the after qualifier names it. */
  via: "creates" | "after";
}

export interface DependencyAnswer {
  dependencies: EdgeDependency[];
  notComputable: NotComputable[];
}

/** The nodes `id` depends on by recorded edges, in file order. */
export function dependenciesOf(
  parsed: ModelParseResult,
  id: string,
): DependencyAnswer {
  const dependencies: EdgeDependency[] = [];
  const notComputable: NotComputable[] = [];
  for (const entry of parsed.entries) {
    const unsettled = namingUnsettled(parsed, entry, "used-by", id);
    if (unsettled !== null) {
      notComputable.push(unsettled);
      continue;
    }
    const uses = itemsOf(entry, "used-by").filter(
      (item) => item.form.kind === "node" && item.form.node === id,
    );
    if (uses.length === 0) continue;
    const created = readFailure(parsed, entry, ["created-by"]);
    if (created !== null) {
      notComputable.push(created);
      continue;
    }
    for (const item of itemsOf(entry, "created-by")) {
      if (item.form.kind === "node" && item.form.node !== id) {
        dependencies.push({
          from: id,
          on: item.form.node,
          entry,
          via: "creates",
        });
      }
    }
    for (const use of uses) {
      if (use.form.kind !== "node") continue;
      for (const after of use.form.after) {
        if (after !== id) {
          dependencies.push({ from: id, on: after, entry, via: "after" });
        }
      }
    }
  }
  return { dependencies, notComputable };
}

/** The nodes that depend on `id` by recorded edges, in file order. */
export function dependentsOf(
  parsed: ModelParseResult,
  id: string,
): DependencyAnswer {
  const dependencies: EdgeDependency[] = [];
  const notComputable: NotComputable[] = [];
  for (const entry of parsed.entries) {
    const createsUnsettled = namingUnsettled(parsed, entry, "created-by", id);
    const usesUnsettled = namingUnsettled(parsed, entry, "used-by", id);
    if (createsUnsettled !== null || usesUnsettled !== null) {
      notComputable.push((createsUnsettled ?? usesUnsettled)!);
      continue;
    }
    const creates = itemsOf(entry, "created-by").some(
      (item) => item.form.kind === "node" && item.form.node === id,
    );
    if (creates) {
      // Every user of a resource `id` creates depends on it, so the
      // whole used-by line must be read.
      const users = readFailure(parsed, entry, ["used-by"]);
      if (users !== null) {
        notComputable.push(users);
        continue;
      }
    }
    for (const item of itemsOf(entry, "used-by")) {
      if (item.form.kind !== "node" || item.form.node === id) continue;
      if (creates) {
        dependencies.push({
          from: item.form.node,
          on: id,
          entry,
          via: "creates",
        });
      } else if (item.form.after.includes(id)) {
        dependencies.push({
          from: item.form.node,
          on: id,
          entry,
          via: "after",
        });
      }
    }
  }
  return { dependencies, notComputable };
}

// ---- The node page's Resources field ----------------------------------

/** One entry whose edge line names a node. */
export interface ResourceMention {
  entry: ModelEntry;
  label: "created-by" | "modified-by" | "used-by";
  /** How the line names the node. */
  as: "node item" | "gate item" | "after qualifier";
  /** For an after qualifier: the using node whose item names it. */
  of?: string;
}

export interface ResourcesAnswer {
  mentions: ResourceMention[];
  notComputable: NotComputable[];
}

/** The entries whose created-by, modified-by or used-by lines name
 * `id`, in file order, by label. */
export function resourcesOf(
  parsed: ModelParseResult,
  id: string,
): ResourcesAnswer {
  const mentions: ResourceMention[] = [];
  const notComputable: NotComputable[] = [];
  for (const label of ["created-by", "modified-by", "used-by"] as const) {
    for (const entry of parsed.entries) {
      const unsettled = namingUnsettled(parsed, entry, label, id);
      if (unsettled !== null) {
        if (
          !notComputable.some(
            (nc) => nc.line === unsettled.line && nc.input === unsettled.input,
          )
        ) {
          notComputable.push(unsettled);
        }
        continue;
      }
      for (const item of itemsOf(entry, label)) {
        const form = item.form;
        if (form.kind === "node" && form.node === id) {
          mentions.push({ entry, label, as: "node item" });
        } else if (form.kind === "gate" && form.node === id) {
          mentions.push({ entry, label, as: "gate item" });
        } else if (form.kind === "node" && form.after.includes(id)) {
          mentions.push({ entry, label, as: "after qualifier", of: form.node });
        }
      }
    }
  }
  return { mentions, notComputable };
}

/** The register's title for a node, or the empty string. */
export function titleOf(register: RegisterParseResult, id: string): string {
  const node: PlanNode | undefined = register.nodes.get(id);
  return node?.title ?? "";
}
