/**
 * The Project model's two renderings, beside the tree on the tree page
 * (node P2-N021, the web view's first version, task E3; the
 * specification of P2-N003 in the coordinating repository, "The tree
 * page" and "What "what is next" means", decisions 9 and 11).
 *
 * Each rendering applies the type's procedure as written, reading the
 * instance and the Plan register at the page's SHA and nothing else
 * (docs/process/project-model.md, "The two renderings": "The
 * implementation map", steps 1 to 7, and "The list of what is next",
 * steps 1 to 6). Each carries the facets its procedure carries and
 * omits those it names as omitted. The view adds no rule of its own
 * (decision 9). Where the procedure cannot finish, the item is marked
 * not computable, naming the file, the line and the missing input, in
 * decision 11's three cases only: the instance absent, an entry that
 * fails the entry grammar, and a step-6 disagreement. A line reading
 * `not yet derived` is not a case: the rendering carries the type's
 * note and the procedure finishes.
 *
 * The renderings are not the referent for what is done and what is
 * next while K-003 (the Backlog is the single source of progress truth)
 * as released at methodology 1.6.0 stands; every page's limit line says
 * so.
 */

import type { PlanNode, RegisterParseResult } from "../planRegister/types.js";
import type {
  DerivedValue,
  ModelEntry,
  ModelItem,
  ModelParseResult,
} from "../planRegister/vendored/project-model.js";
import type { PageCommit } from "./html.js";
import { escapeHtml } from "./html.js";
import type { ModelAtPage, NotComputable } from "./projectModel.js";
import {
  MODEL_PATH,
  entryHref,
  entryPointer,
  instanceAbsent,
  isStanding,
  itemsOf,
  namingUnsettled,
  notComputableText,
  readFailure,
  readsNotYetDerived,
  stageOf,
} from "./projectModel.js";
import { nodePageHref } from "./registerNote.js";

// ---- State derivation (the map's step 6 re-derives it) ----------------

/** A stage at which a node is in flight ("State derivation", step 4). */
const IN_FLIGHT = new Set(["broken-down", "executing", "verifying"]);

/** One node the state derivation counts, with its stage. */
export interface CountedNode {
  id: string;
  gate: boolean;
  stage: string;
  listed: boolean;
}

function counted(
  register: RegisterParseResult,
  item: ModelItem,
): CountedNode | null {
  if (item.form.kind === "gate") {
    // A gate item counts as `done` (step 3).
    return { id: item.form.node, gate: true, stage: "done", listed: true };
  }
  if (item.form.kind === "node") {
    const { stage, listed } = stageOf(register, item.form.node);
    return { id: item.form.node, gate: false, stage, listed };
  }
  return null;
}

/**
 * The derived value of an entry's `state:` line, by the table of "State
 * derivation", rows 1 to 4, with the nodes it counted.
 */
export function deriveState(
  entry: ModelEntry,
  register: RegisterParseResult,
): {
  value: DerivedValue;
  creating: CountedNode[];
  modifying: CountedNode[];
  creatingItems: ModelItem[];
  modifyingItems: ModelItem[];
} {
  const creatingItems = itemsOf(entry, "created-by").filter(
    (item) => item.form.kind === "node" || item.form.kind === "gate",
  );
  // A standing resource's modifying nodes are not counted (step 2).
  const modifyingItems = isStanding(entry)
    ? []
    : itemsOf(entry, "modified-by").filter((item) => item.form.kind === "node");
  const creating = creatingItems.map((item) => counted(register, item)!);
  const modifying = modifyingItems.map((item) => counted(register, item)!);
  let value: DerivedValue;
  if (creating.some((n) => IN_FLIGHT.has(n.stage))) value = "building";
  else if (creating.length > 0 && !creating.some((n) => n.stage === "done")) {
    value = "planned";
  } else if (modifying.some((n) => IN_FLIGHT.has(n.stage))) {
    value = "built, changing";
  } else value = "built";
  return { value, creating, modifying, creatingItems, modifyingItems };
}

// ---- The implementation map -------------------------------------------

/** One row of the map: its text in the Backlog's row shape, or the
 * marking that says why the procedure could not finish it. */
export interface MapRow {
  entry: ModelEntry;
  /** `- [<mark>] **<what>** — When: … Status: … Pointer: <link>.` */
  text: string | null;
  mark: "x" | " ";
  what: string;
  when: string;
  status: string;
  pointer: string;
  notComputable: NotComputable | null;
}

export type MapRendering =
  | { kind: "not-computable"; notComputable: NotComputable }
  | { kind: "rows"; rows: MapRow[] };

/** The first sentence of a text: up to the first `.`, `!` or `?` that
 * ends the text or precedes white space. */
export function firstSentence(text: string): string {
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(text);
  return (m ? m[0] : text).trim();
}

/** The documents the type names as the record of a date: the Cost log
 * row of the accepting task, or a gate record in a plan or a
 * specification ("The implementation map", after step 7). */
const DATE_RECORD = /(^|\/)(cost-log\.md|plans\/[^)]*|specs\/[^)]*)$/;

function dateSources(item: ModelItem): string {
  const records = item.sources.filter((source) => {
    const target = source.link?.target.split("#")[0] ?? "";
    return DATE_RECORD.test(target);
  });
  const chosen = records.length > 0 ? records : item.sources;
  return chosen.map((source) => source.text).join("; ");
}

function stageWords(node: CountedNode): string {
  if (node.gate) return `${node.id} gate done`;
  if (!node.listed) return `${node.id} done (not in the register)`;
  return `${node.id} ${node.stage}`;
}

/** One row, by steps 2 to 7. */
export function mapRow(
  entry: ModelEntry,
  parsed: ModelParseResult,
  register: RegisterParseResult,
): MapRow {
  const pointer = entryPointer(entry);
  const blank = {
    entry,
    text: null,
    mark: " " as const,
    what: "",
    when: "",
    status: "",
    pointer,
  };
  // The lines the map reads: is, state and created-by, and modified-by
  // unless the resource is standing.
  const failure =
    readFailure(parsed, entry, ["is", "state", "created-by"]) ??
    (isStanding(entry) ? null : readFailure(parsed, entry, ["modified-by"]));
  if (failure !== null) return { ...blank, notComputable: failure };

  const derived = deriveState(entry, register);
  const stateItems = itemsOf(entry, "state");
  const written = stateItems[0]!.form;
  // Step 6: the stages give a value other than the state line's.
  if (written.kind === "derived-value" && written.value !== derived.value) {
    return {
      ...blank,
      notComputable: {
        file: MODEL_PATH,
        line: stateItems[0]!.line,
        input: `the state line of ${entry.slug}`,
        reason: `It reads "${written.value}", and the stages give "${derived.value}"`,
      },
    };
  }

  // Step 3: the mark.
  const mark: "x" | " " =
    derived.value === "built" || derived.value === "built, changing"
      ? "x"
      : " ";
  // Step 4: the first sentence of the is item, then the slug.
  const is = itemsOf(entry, "is")[0]!;
  const what = `${firstSentence(is.body)} (${entry.slug})`;
  // Step 5: the latest date note among the counted items.
  let latest: ModelItem | null = null;
  for (const item of [...derived.creatingItems, ...derived.modifyingItems]) {
    if (item.dateNote === null) continue;
    if (latest === null || item.dateNote > latest.dateNote!) latest = item;
  }
  const when =
    latest === null
      ? "the model holds no date"
      : `${latest.dateNote}, ${dateSources(latest)}`;
  // Step 6: the derived value, each counted node with its stage, the
  // type's note for a counted line not yet derived, then standing and
  // the own status.
  const parts: string[] = [derived.value];
  const seen = new Set<string>();
  const nodes: string[] = [];
  for (const node of [...derived.creating, ...derived.modifying]) {
    const words = stageWords(node);
    if (!seen.has(words)) {
      seen.add(words);
      nodes.push(words);
    }
  }
  if (nodes.length > 0) parts.push(nodes.join(", "));
  const counts = isStanding(entry)
    ? (["created-by"] as const)
    : (["created-by", "modified-by"] as const);
  for (const label of counts) {
    if (readsNotYetDerived(entry, label)) {
      parts.push(`the ${label} line reads not yet derived`);
    }
  }
  for (const item of stateItems.slice(1)) {
    if (item.form.kind === "standing") parts.push("standing");
    if (item.form.kind === "own-status") {
      parts.push(`own status ${item.form.status}`);
    }
  }
  const status = parts.join("; ");
  return {
    entry,
    text: `- [${mark}] **${what}** — When: ${when}. Status: ${status}. Pointer: ${pointer}.`,
    mark,
    what,
    when,
    status,
    pointer,
    notComputable: null,
  };
}

/** The implementation map: steps 1 and 2, one row per entry, in file
 * order. */
export function implementationMap(
  model: ModelAtPage,
  register: RegisterParseResult,
): MapRendering {
  if (model.kind === "absent") {
    return { kind: "not-computable", notComputable: instanceAbsent(model.sha) };
  }
  return {
    kind: "rows",
    rows: model.parsed.entries.map((entry) =>
      mapRow(entry, model.parsed, register),
    ),
  };
}

// ---- The list of what is next -----------------------------------------

/** One resource a node uses, as the list carries it: the used-by item
 * that names the node, with its after qualifier, and the creating
 * nodes of the resource, with their stages. */
export interface CarriedUse {
  entry: ModelEntry;
  after: string[];
  creators: string[];
}

export type Classification = "in flight" | "held" | "waiting on" | "actionable";

export interface NextItem {
  node: PlanNode;
  uses: CarriedUse[];
  /** Null when the waits are not computable and no earlier rule held. */
  classification: Classification | null;
  waitingOn: Array<{ node: string; slug: string }>;
  noRecordedUses: boolean;
  next: string;
  notComputable: NotComputable[];
  /** The item in words, or null when not computable. */
  text: string | null;
}

export type NextRendering =
  | { kind: "not-computable"; notComputable: NotComputable }
  | {
      kind: "items";
      items: NextItem[];
      /** Entries whose used-by line reads not yet derived. */
      usedByNotYetDerived: ModelEntry[];
    };

/** Step 6: the next stage, from the node lifecycle of the plan model
 * (docs/process/plan-model.md, "The node lifecycle", the exit
 * conditions). */
export function nextStage(stage: string): string {
  switch (stage) {
    case "identified":
      return "planned";
    case "planned":
      return "specified";
    case "specified":
      return "broken-down (interior) or executing (leaf)";
    case "broken-down":
      return "its children's work";
    case "executing":
      return "verifying";
    case "verifying":
      return "done";
    default:
      return `none known for the stage "${stage}"`;
  }
}

function creatorsOf(
  entry: ModelEntry,
  register: RegisterParseResult,
): string[] {
  const out: string[] = [];
  for (const item of itemsOf(entry, "created-by")) {
    const form = item.form;
    if (form.kind === "node") {
      const { stage, listed } = stageOf(register, form.node);
      out.push(
        listed
          ? `${form.node} ${stage}`
          : `${form.node} done (not in the register)`,
      );
    } else if (form.kind === "gate") out.push(`${form.node} gate`);
    else if (form.kind === "none") out.push("none");
    else if (form.kind === "not-yet-derived") out.push("not yet derived");
  }
  return out;
}

/** How the list names a used resource's creating nodes. Where the
 * created-by line reads `not yet derived`, it carries the type's note. */
function creatorsPhrase(use: CarriedUse): string {
  if (use.creators.length === 1 && use.creators[0] === "not yet derived") {
    return "its created-by line reads not yet derived";
  }
  return `created by ${use.creators.length > 0 ? use.creators.join(", ") : "no item"}`;
}

function hold(node: PlanNode): string {
  return node.hold ? ` [${node.hold.kind}: ${node.hold.reason}]` : "";
}

function itemText(item: NextItem): string | null {
  if (item.notComputable.length > 0) return null;
  const head = `${item.node.id} ${item.node.title} [${item.node.stage}]${hold(item.node)}`;
  let state: string = item.classification!;
  if (item.classification === "waiting on") {
    state = `waiting on: ${item.waitingOn.map((w) => `${w.node} (${w.slug})`).join(", ")}`;
  }
  if (item.noRecordedUses) state += ", no recorded uses edge";
  const uses = item.uses.map((use) => {
    const after = use.after.length > 0 ? ` after ${use.after.join(", ")}` : "";
    return `${use.entry.slug}${after}, ${creatorsPhrase(use)}`;
  });
  const usesText = uses.length > 0 ? ` Uses: ${uses.join("; ")}.` : "";
  return `${head} — ${state}.${usesText} Next: ${item.next}.`;
}

/** One item, by steps 2 to 6. */
export function nextItem(
  node: PlanNode,
  parsed: ModelParseResult,
  register: RegisterParseResult,
): NextItem {
  const uses: CarriedUse[] = [];
  const waits: Array<{ node: string; slug: string }> = [];
  const notComputable: NotComputable[] = [];
  // Step 3: each used-by item that names the node.
  for (const entry of parsed.entries) {
    const unsettled = namingUnsettled(parsed, entry, "used-by", node.id);
    if (unsettled !== null) {
      notComputable.push(unsettled);
      continue;
    }
    for (const item of itemsOf(entry, "used-by")) {
      if (item.form.kind !== "node" || item.form.node !== node.id) continue;
      const created = readFailure(parsed, entry, ["created-by"]);
      if (created !== null) {
        notComputable.push(created);
        continue;
      }
      uses.push({
        entry,
        after: item.form.after,
        creators: creatorsOf(entry, register),
      });
      // The creating nodes and the after qualifier's nodes; gate items,
      // none and outside items add nothing; leave out the node itself.
      for (const creator of itemsOf(entry, "created-by")) {
        if (creator.form.kind === "node" && creator.form.node !== node.id) {
          waits.push({ node: creator.form.node, slug: entry.slug });
        }
      }
      for (const after of item.form.after) {
        if (after !== node.id) waits.push({ node: after, slug: entry.slug });
      }
    }
  }

  // Step 4: the first rule that holds.
  let classification: Classification | null;
  const waitingOn: Array<{ node: string; slug: string }> = [];
  if (node.stage === "executing" || node.stage === "verifying") {
    classification = "in flight";
  } else if (node.hold !== null) {
    classification = "held";
  } else if (notComputable.length > 0) {
    classification = null;
  } else {
    for (const wait of waits) {
      const done = stageOf(register, wait.node).stage === "done";
      const dup = waitingOn.some(
        (w) => w.node === wait.node && w.slug === wait.slug,
      );
      if (!done && !dup) waitingOn.push(wait);
    }
    classification = waitingOn.length > 0 ? "waiting on" : "actionable";
  }
  // Step 5.
  const noRecordedUses =
    classification === "actionable" &&
    uses.length === 0 &&
    notComputable.length === 0;
  const item: NextItem = {
    node,
    uses,
    classification,
    waitingOn,
    noRecordedUses,
    next: nextStage(node.stage),
    notComputable,
    text: null,
  };
  item.text = itemText(item);
  return item;
}

/** The list of what is next: step 1, every node not `done`, in register
 * order. */
export function listOfWhatIsNext(
  model: ModelAtPage,
  register: RegisterParseResult,
): NextRendering {
  if (model.kind === "absent") {
    return { kind: "not-computable", notComputable: instanceAbsent(model.sha) };
  }
  const items = register.order
    .map((id) => register.nodes.get(id)!)
    .filter((node) => node.stage !== "done")
    .map((node) => nextItem(node, model.parsed, register));
  const usedByNotYetDerived = model.parsed.entries.filter((entry) =>
    readsNotYetDerived(entry, "used-by"),
  );
  return { kind: "items", items, usedByNotYetDerived };
}

// ---- HTML -------------------------------------------------------------

export function notComputableHtml(nc: NotComputable): string {
  return `<p class="error" data-not-computable>${escapeHtml(notComputableText(nc))}</p>`;
}

function rowHtml(row: MapRow, commit: PageCommit): string {
  const href = entryHref(commit, commit.sha, row.entry);
  const pointer = `<a data-pointer href="${escapeHtml(href)}">${escapeHtml(row.pointer)}</a>`;
  if (row.notComputable !== null) {
    return `<li data-map-row="${escapeHtml(row.entry.slug)}"><strong>${escapeHtml(row.entry.slug)}</strong> — ${notComputableHtml(row.notComputable)} Pointer: ${pointer}.</li>`;
  }
  return [
    `<li data-map-row="${escapeHtml(row.entry.slug)}">`,
    `<span data-mark>[${row.mark}]</span> `,
    `<strong data-what>${escapeHtml(row.what)}</strong>`,
    ` — When: <span data-when>${escapeHtml(row.when)}</span>.`,
    ` Status: <span data-status>${escapeHtml(row.status)}</span>.`,
    ` Pointer: ${pointer}.`,
    "</li>",
  ].join("");
}

/** The map's section on the tree page. */
export function implementationMapHtml(
  rendering: MapRendering,
  commit: PageCommit,
): string {
  const head = [
    `<section data-rendering="implementation-map">`,
    "<h2>Implementation map</h2>",
    `<p class="note">One row per resource of the Project model, in file order, by the type's procedure. Each row carries the first sentence of <code>is:</code>, the <code>state:</code> line and the nodes that create and modify the resource, with their dates; its pointer reaches the entry's other lines.</p>`,
  ];
  if (rendering.kind === "not-computable") {
    return [
      ...head,
      notComputableHtml(rendering.notComputable),
      "</section>",
    ].join("\n");
  }
  const rows = rendering.rows.map((row) => rowHtml(row, commit)).join("\n");
  return [...head, `<ul class="rendering">\n${rows}\n</ul>`, "</section>"].join(
    "\n",
  );
}

function nextItemHtml(item: NextItem, commit: PageCommit): string {
  const node = item.node;
  const link = (id: string): string =>
    `<a href="${escapeHtml(nodePageHref(id, commit.requestedRef))}">${escapeHtml(id)}</a>`;
  const entryLink = (entry: ModelEntry): string =>
    `<a href="${escapeHtml(entryHref(commit, commit.sha, entry))}">${escapeHtml(entry.slug)}</a>`;
  const parts = [
    `<li data-next-item="${escapeHtml(node.id)}">`,
    `${link(node.id)} ${escapeHtml(node.title)} <span class="stage">[${escapeHtml(node.stage)}]</span>`,
    node.hold
      ? ` <span class="hold">[${escapeHtml(node.hold.kind)}: ${escapeHtml(node.hold.reason)}]</span>`
      : "",
    " — ",
  ];
  if (item.classification === null) {
    parts.push(`<span data-classification>not computable</span>.`);
  } else if (item.classification === "waiting on") {
    const waits = item.waitingOn
      .map((w) => {
        const entry = item.uses.find((u) => u.entry.slug === w.slug)!.entry;
        return `${link(w.node)} (${entryLink(entry)})`;
      })
      .join(", ");
    parts.push(`<span data-classification>waiting on</span>: ${waits}.`);
  } else {
    parts.push(
      `<span data-classification>${escapeHtml(item.classification)}</span>${item.noRecordedUses ? ", no recorded uses edge" : ""}.`,
    );
  }
  if (item.uses.length > 0) {
    const uses = item.uses
      .map((use) => {
        const after =
          use.after.length > 0
            ? ` after ${use.after.map((id) => link(id)).join(", ")}`
            : "";
        return `${entryLink(use.entry)}${after}, ${escapeHtml(creatorsPhrase(use))}`;
      })
      .join("; ");
    parts.push(` Uses: ${uses}.`);
  }
  parts.push(` Next: <span data-next-stage>${escapeHtml(item.next)}</span>.`);
  for (const nc of item.notComputable) parts.push(` ${notComputableHtml(nc)}`);
  parts.push("</li>");
  return parts.join("");
}

/** The list's section on the tree page. */
export function listOfWhatIsNextHtml(
  rendering: NextRendering,
  commit: PageCommit,
): string {
  const head = [
    `<section data-rendering="what-is-next">`,
    "<h2>What is next</h2>",
    `<p class="note" data-recorded-only>This list holds recorded dependency only: the Project model's uses edges, by the type's procedure. Which node is dispatched also depends on the approved scope, which the model does not hold.</p>`,
  ];
  if (rendering.kind === "not-computable") {
    return [
      ...head,
      notComputableHtml(rendering.notComputable),
      "</section>",
    ].join("\n");
  }
  const notes =
    rendering.usedByNotYetDerived.length === 0
      ? ""
      : `<p class="note" data-not-yet-derived>The used-by lines of these entries read not yet derived, so they name no node yet: ${rendering.usedByNotYetDerived
          .map(
            (entry) =>
              `<a href="${escapeHtml(entryHref(commit, commit.sha, entry))}">${escapeHtml(entry.slug)}</a>`,
          )
          .join(", ")}.</p>`;
  const items = rendering.items
    .map((item) => nextItemHtml(item, commit))
    .join("\n");
  return [
    ...head,
    notes,
    `<ul class="rendering">\n${items}\n</ul>`,
    "</section>",
  ].join("\n");
}
