/**
 * One-time import of the frozen Markdown registers into a state file
 * (the rebuild plan, milestone 1). Reads the Plan register, the Cost
 * log, the run journal, the Ruling register and the plan documents of
 * a repository, and produces the state plus an import record naming
 * everything it could not map or had to propose.
 *
 * The import is reproducible: hand corrections go in an overrides
 * file, applied last, and the record lists each one for review.
 */

import { parseRegister } from "../planRegister/vendored/plan-register.js";
import {
  costLogTableRows,
  journalLines,
  type JournalEvent,
} from "../planRegister/vendored/cost-log-and-journal.js";
import {
  OUTCOME_MAX_WORDS,
  SCHEMA_VERSION,
  STEPS,
  SUMMARY_MAX_WORDS,
  wordCount,
  type Decision,
  type Node,
  type State,
  type Step,
  type Task,
} from "./schema.js";

export interface ImportInput {
  project: string;
  /** `docs/plan-register.md`. */
  register: string;
  /** `docs/cost-log.md`, or null when absent. */
  costLog: string | null;
  /** `orchestration/journal.jsonl`, or null when absent. */
  journal: string | null;
  /** `docs/rulings.md`, or null when absent. */
  rulings: string | null;
  /** Plan documents by repository path (`docs/plans/x.md`). */
  plans: Map<string, string>;
  /** Plans whose decisions the owner accepted in one go, by path, with
   * the date: every decision imports closed at its default. */
  acceptedPlans: Record<string, string>;
  /** Repository paths that exist, for link checks. */
  exists: (relativePath: string) => boolean;
  overrides: Overrides | null;
}

/** Hand corrections, applied after the mechanical import. */
export interface Overrides {
  nodes?: Record<
    string,
    Partial<Pick<Node, "title" | "outcome" | "after" | "done" | "note">>
  >;
  tasks?: Record<
    string,
    Partial<Pick<Task, "pr" | "summary" | "status" | "closed">>
  >;
  decisions?: Record<
    string,
    Partial<Pick<Decision, "chosen" | "decided" | "rationale">>
  >;
}

export interface ImportRecord {
  counts: { nodes: number; tasks: number; decisions: number };
  /** Nodes whose outcome no record gave. */
  noOutcome: string[];
  /** Nodes whose outcome exceeds the bound, from a plan's first sentence. */
  longOutcome: string[];
  /** Titles to review: short, or carrying a chunk or child reference. */
  reviewTitle: Array<{ id: string; title: string; reason: string }>;
  /** Open nodes with no explicit dependency; the sibling before them. */
  noDependency: Array<{ id: string; previousSibling: string | null }>;
  /** Done nodes with no date in the journal. */
  noDoneDate: string[];
  /** Plan documents linked by filename, not by the register. */
  linkedByFilename: Array<{ id: string; plan: string }>;
  /** Tasks whose result was received and never accepted. */
  neverAccepted: string[];
  /** Tasks in the journal with no Cost log row. */
  noCostRow: string[];
  /** Ruling entries that did not parse. */
  rulingsUnparsed: string[];
  /** Plans whose decision sections were read, with the counts. */
  decisionsRead: Array<{ plan: string; count: number; unparsed: number }>;
  /** Plans with a gate record, whose adopted decisions stay in the plan. */
  gateRecordsNotImported: string[];
  /** Overrides applied. */
  overridesApplied: string[];
}

const PLAN_FILENAME = /^docs\/plans\/(p\d+)-(n\d+)-/;

function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first sentence of a text, on a terminal period, question mark
 * or exclamation mark followed by a space or the end. */
export function firstSentence(text: string): string {
  const clean = stripMarkdown(text);
  const m = /^(.*?[.!?])(?:\s|$)/.exec(clean);
  return (m ? m[1]! : clean).trim();
}

/** A one- or two-word answer loses its trailing period. */
function tidy(text: string): string {
  return wordCount(text) <= 2 ? text.replace(/\.$/, "") : text;
}

function limitWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  return words.slice(0, max - 1).join(" ") + " …";
}

/** The `## Outcome` section of a plan, as its first sentence. */
export function outcomeFromPlan(plan: string): string | null {
  const lines = plan.split(/\r\n|\n/);
  const start = lines.findIndex((l) => /^## Outcome\b/.test(l));
  if (start === -1) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    if (line.startsWith("<!--")) continue;
    body.push(line);
  }
  // The first paragraph, skipping a leading list or label line.
  const paragraphs = body
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const first = paragraphs.find(
    (p) => !p.startsWith("-") && !/^At `?done`?[:,]?$/i.test(p),
  );
  if (!first) return null;
  const sentence = firstSentence(first);
  return sentence.length > 0 ? sentence : null;
}

function nodeIds(text: string): string[] {
  return [...text.matchAll(/P\d+-N\d+/g)].map((m) => m[0]);
}

/** Dependencies the register line states: "depends on X and Y", "after X". */
export function dependenciesFromAnnotation(annotation: string): string[] {
  const out = new Set<string>();
  const cleaned = annotation.replace(/independent of [^;—·()]*/g, "");
  for (const m of cleaned.matchAll(/depends on ([^;—·]*)/g)) {
    for (const id of nodeIds(m[1]!)) out.add(id);
  }
  for (const m of cleaned.matchAll(/\bafter (P\d+-N\d+)/g)) out.add(m[1]!);
  return [...out];
}

interface SplitAnnotation {
  plan: string | null;
  spec: string | null;
  note: string | null;
}

/** Splits a register annotation into its plan and spec links and the
 * prose that remains. */
export function splitAnnotation(annotation: string | null): SplitAnnotation {
  const out: SplitAnnotation = { plan: null, spec: null, note: null };
  if (annotation === null) return out;
  const prose: string[] = [];
  for (const segment of annotation.split(" — ")) {
    const rest: string[] = [];
    for (const item of segment.split(" · ")) {
      const m = /^(plan|spec): (\S+)$/.exec(item.trim());
      if (m) {
        const target = m[2]!.startsWith("docs/") ? m[2]! : `docs/${m[2]!}`;
        if (m[1] === "plan") out.plan = target;
        else out.spec = target;
      } else {
        rest.push(item.trim());
      }
    }
    if (rest.length > 0) prose.push(rest.join(" · "));
  }
  if (prose.length > 0) out.note = prose.join("; ");
  return out;
}

function titleReview(title: string): string | null {
  if (wordCount(title) < 4) return "fewer than four words";
  if (/\(chunk \d+\)/i.test(title) || /\bchild [A-Z]\b/.test(title)) {
    return "carries a chunk or child reference";
  }
  if (/^the \w+$/i.test(title))
    return "names a thing without saying what changes";
  return null;
}

// ---- Tasks --------------------------------------------------------------

interface JournalTask {
  node: string | null;
  step: string | null;
  role: string | null;
  model: string | null;
  opened: string | null;
  accepted: string | null;
  ref: string | null;
  last: string | null;
  resultReceived: boolean;
  notes: string[];
}

function journalTasks(journal: string | null): Map<string, JournalTask> {
  const out = new Map<string, JournalTask>();
  if (journal === null) return out;
  const TASK_EVENTS = new Set([
    "dispatched",
    "result-received",
    "accepted",
    "needs-judgment",
    "blocked",
    "stale",
    "check-failed",
  ]);
  for (const line of journalLines(journal)) {
    if (line.status !== "event") continue;
    const e: JournalEvent = line.event;
    const task = typeof e["task"] === "string" ? e["task"] : null;
    const kind = String(e["event"]);
    if (task === null || !TASK_EVENTS.has(kind)) continue;
    const t = out.get(task) ?? {
      node: null,
      step: null,
      role: null,
      model: null,
      opened: null,
      accepted: null,
      ref: null,
      last: null,
      resultReceived: false,
      notes: [],
    };
    const ts = typeof e["ts"] === "string" ? e["ts"] : null;
    const str = (k: string): string | null =>
      typeof e[k] === "string" && (e[k] as string).length > 0
        ? (e[k] as string)
        : null;
    t.node ??= str("node");
    t.step ??= str("stage");
    t.role ??= str("role");
    t.model ??= str("model");
    if (kind === "dispatched" && t.opened === null) t.opened = ts;
    if (kind === "accepted") {
      t.accepted = ts;
      t.ref = str("ref") ?? t.ref;
    }
    if (kind === "result-received") {
      t.resultReceived = true;
      t.ref ??= str("ref");
    }
    if (kind !== "dispatched") t.last = kind;
    const note = str("note");
    if (note) t.notes.push(note);
    out.set(task, t);
  }
  return out;
}

function pullRequestFrom(texts: string[], project: string): string | null {
  for (const text of texts) {
    const m = /(?:pull request|PR) #(\d+)/i.exec(text);
    if (!m) continue;
    const repo = /project-orchestrator-service/.test(text)
      ? "majodali/project-orchestrator-service"
      : project;
    return `${repo}#${m[1]}`;
  }
  return null;
}

function tokens(cell: string): number | null {
  const m = /^\s*(\d[\d,]*)\s*$/.exec(cell);
  return m ? Number(m[1]!.replace(/,/g, "")) : null;
}

function asStep(value: string | null): Step {
  const v = (value ?? "").trim();
  return (STEPS as readonly string[]).includes(v) ? (v as Step) : "execute";
}

function dateToTimestamp(date: string): string {
  return `${date}T00:00:00Z`;
}

// ---- Decisions ----------------------------------------------------------

interface ParsedDecision {
  number: number;
  title: string;
  default: string | null;
  rationale: string | null;
}

function parseDecisionSection(plan: string): {
  decisions: ParsedDecision[];
  unparsed: number;
  hasGateRecord: boolean;
  hasSection: boolean;
} {
  const lines = plan.split(/\r\n|\n/);
  const hasGateRecord = lines.some((l) => /^##+ Gate record/.test(l));
  const start = lines.findIndex((l) =>
    /^## Decisions( for the gate)?\b/.test(l),
  );
  if (start === -1) {
    return { decisions: [], unparsed: 0, hasGateRecord, hasSection: false };
  }
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    section.push(line);
  }
  const items: string[][] = [];
  for (const line of section) {
    if (/^\d+\. /.test(line)) items.push([line]);
    else if (
      items.length > 0 &&
      (line.startsWith("   ") || line.startsWith("  ") || line.trim() === "")
    ) {
      items[items.length - 1]!.push(line);
    } else if (items.length > 0 && line.trim() !== "" && !/^[-*] /.test(line)) {
      // A continuation without indent ends the item list.
      break;
    }
  }
  const decisions: ParsedDecision[] = [];
  let unparsed = 0;
  for (const item of items) {
    const text = item.join(" ").replace(/\s+/g, " ").trim();
    let m: RegExpExecArray | null = /^(\d+)\. \*\*(.+?)\*\*[:.]?\s*(.*)$/.exec(
      text,
    );
    if (!m) {
      // An unbolded item: the title runs to "Default:", or is its
      // first sentence.
      const plain = /^(\d+)\. (.*)$/.exec(text);
      if (plain) {
        const body = plain[2]!;
        const at = body.search(/\bdefault:/i);
        const title = at >= 0 ? body.slice(0, at) : firstSentence(body);
        const rest = at >= 0 ? body.slice(at) : body.slice(title.length);
        m = [
          text,
          plain[1]!,
          title.trim(),
          rest.trim(),
        ] as unknown as RegExpExecArray;
      }
    }
    if (!m) {
      unparsed += 1;
      continue;
    }
    const rest = m[3]!;
    const dflt =
      /(?:\*\*Default\*\*:?|\bdefault:)\s*(.*?)(?=\s*(?:\*\*Rationale\*\*|\brationale:|\*\*Affected locations\*\*|\baffected locations:|$))/is.exec(
        rest,
      );
    const rat =
      /(?:\*\*Rationale\*\*:?|\brationale:)\s*(.*?)(?=\s*(?:\*\*Affected locations\*\*|\baffected locations:|$))/is.exec(
        rest,
      );
    decisions.push({
      number: Number(m[1]),
      title: stripMarkdown(m[2]!).replace(/\.$/, ""),
      default:
        dflt && dflt[1]!.trim()
          ? tidy(limitWords(firstSentence(dflt[1]!), SUMMARY_MAX_WORDS))
          : null,
      rationale:
        rat && rat[1]!.trim()
          ? limitWords(firstSentence(rat[1]!), SUMMARY_MAX_WORDS)
          : null,
    });
  }
  return { decisions, unparsed, hasGateRecord, hasSection: true };
}

interface RulingParse {
  decisions: Decision[];
  unparsed: string[];
}

export function parseRulings(text: string): RulingParse {
  const entries: string[] = [];
  for (const line of text.split(/\r\n|\n/)) {
    if (/^- RU-\d+/.test(line)) entries.push(line);
    else if (entries.length > 0 && /^ {2}\S/.test(line)) {
      entries[entries.length - 1] += " " + line.trim();
    } else if (entries.length > 0 && line.trim() === "") {
      // A blank line ends the entry; the next `- RU-` opens another.
    }
  }
  const decisions: Decision[] = [];
  const unparsed: string[] = [];
  for (const entry of entries) {
    const head = /^- (RU-\d+) \[(\w+)\] ([\w/ -]+?) — (.*)$/.exec(
      entry.replace(/\s+/g, " "),
    );
    if (!head) {
      unparsed.push(entry.slice(0, 40));
      continue;
    }
    const [, id, status, , body] = head;
    const ruling = /Ruling: (.*?)(?= Rationale:| Source:| Applied:|$)/.exec(
      body!,
    );
    const rationale = /Rationale: (.*?)(?= Source:| Applied:|$)/.exec(body!);
    const source = /Source: (.*?)(?= Applied:|$)/.exec(body!);
    if (!ruling) {
      unparsed.push(id!);
      continue;
    }
    let question = body!.split(" Ruling:")[0]!;
    const options: string[] = [];
    const opt = /Options seen: (.*)$/.exec(question);
    if (opt) {
      question = question.slice(0, opt.index).trim();
      for (const o of opt[1]!.split(/;\s*(?=\()/))
        options.push(stripMarkdown(o).replace(/\.$/, ""));
    }
    const sourceText = source ? source[1]!.trim() : null;
    const date = sourceText ? /(\d{4}-\d{2}-\d{2})/.exec(sourceText) : null;
    const node = sourceText ? (nodeIds(sourceText)[0] ?? null) : null;
    const chosen = stripMarkdown(ruling[1]!);
    decisions.push({
      id: id!,
      node,
      question: stripMarkdown(question),
      options,
      default: null,
      chosen: status === "active" ? chosen : `${chosen} (${status})`,
      decided: date ? date[1]! : null,
      rationale: rationale
        ? limitWords(stripMarkdown(rationale[1]!), SUMMARY_MAX_WORDS)
        : null,
      standing: true,
      source: `docs/rulings.md, ${id}`,
    });
  }
  return { decisions, unparsed };
}

// ---- The import ---------------------------------------------------------

export function importState(input: ImportInput): {
  state: State;
  record: ImportRecord;
} {
  const record: ImportRecord = {
    counts: { nodes: 0, tasks: 0, decisions: 0 },
    noOutcome: [],
    longOutcome: [],
    reviewTitle: [],
    noDependency: [],
    noDoneDate: [],
    linkedByFilename: [],
    neverAccepted: [],
    noCostRow: [],
    rulingsUnparsed: [],
    decisionsRead: [],
    gateRecordsNotImported: [],
    overridesApplied: [],
  };

  // Nodes.
  const parsed = parseRegister(input.register);
  if (parsed.errors.length > 0) {
    throw new Error(
      `the register does not parse: ${parsed.errors.map((e) => `line ${e.line}: ${e.reason}`).join("; ")}`,
    );
  }
  const planByNode = new Map<string, string>();
  for (const p of input.plans.keys()) {
    const m = PLAN_FILENAME.exec(p);
    if (m) planByNode.set(`${m[1]!.toUpperCase()}-${m[2]!.toUpperCase()}`, p);
  }
  const jt = journalTasks(input.journal);
  const doneDates = new Map<string, string>();
  for (const t of jt.values()) {
    if (t.node && t.accepted) {
      const d = t.accepted.slice(0, 10);
      if (!doneDates.has(t.node) || doneDates.get(t.node)! < d)
        doneDates.set(t.node, d);
    }
  }

  const nodes: Node[] = [];
  for (const id of parsed.order) {
    const r = parsed.nodes.get(id)!;
    const ann = splitAnnotation(r.annotation);
    // A chunk number is a reference, not a title: it moves to the note.
    let title = r.title;
    const chunk = /^(.*?)\s*\((chunk \d+)\)$/.exec(title);
    if (chunk) {
      title = chunk[1]!.trim();
      ann.note = [
        `${chunk[2]![0]!.toUpperCase()}${chunk[2]!.slice(1)} of the parent plan`,
        ann.note,
      ]
        .filter((x) => x !== null)
        .join("; ");
    }
    let plan = ann.plan;
    if (plan === null && planByNode.has(id)) {
      plan = planByNode.get(id)!;
      record.linkedByFilename.push({ id, plan });
    }
    let outcome: string | null = null;
    if (plan !== null && input.plans.has(plan))
      outcome = outcomeFromPlan(input.plans.get(plan)!);
    if (outcome !== null && wordCount(outcome) > OUTCOME_MAX_WORDS)
      record.longOutcome.push(id);
    if (outcome === null && r.stage !== "identified") record.noOutcome.push(id);
    const after = dependenciesFromAnnotation(r.annotation ?? "").filter(
      (d) => d !== id && parsed.nodes.has(d),
    );
    const done = r.stage === "done" ? (doneDates.get(id) ?? null) : null;
    if (r.stage === "done" && done === null) record.noDoneDate.push(id);
    nodes.push({
      id,
      title,
      outcome,
      stage: r.stage as Node["stage"],
      parent: r.parentId,
      after,
      hold: r.hold,
      docs: { plan, spec: ann.spec },
      done,
      note: ann.note,
    });
  }
  for (const n of nodes) {
    if (n.stage === "done" || n.after.length > 0) continue;
    const siblings = nodes.filter((s) => s.parent === n.parent);
    const i = siblings.findIndex((s) => s.id === n.id);
    record.noDependency.push({
      id: n.id,
      previousSibling: i > 0 ? siblings[i - 1]!.id : null,
    });
  }

  // Tasks.
  const tasks: Task[] = [];
  const seen = new Set<string>();
  if (input.costLog !== null) {
    for (const row of costLogTableRows(input.costLog)) {
      if (row.kind !== "data" || row.cells.length < 9) continue;
      const [date, id, node, stage, role, model, tin, tout, ...noteCells] =
        row.cells;
      if (!/^T\d{3,}$/.test(id!)) continue;
      seen.add(id!);
      const j = jt.get(id!);
      const note = noteCells.join(" | ").trim();
      const nodeId = /^P\d+-N\d+$/.test(node!) ? node! : (j?.node ?? null);
      if (nodeId === null) continue;
      tasks.push({
        id: id!,
        node: nodeId,
        step: asStep(stage!),
        status: "closed",
        role: role!.trim() || null,
        model: model!.trim() || null,
        tokens: { in: tokens(tin!), out: tokens(tout!) },
        opened: j?.opened ?? null,
        closed: j?.accepted ?? dateToTimestamp(date!),
        ref: j?.ref ?? null,
        pr: pullRequestFrom([note, ...(j?.notes ?? [])], input.project),
        summary: note
          ? limitWords(firstSentence(note), SUMMARY_MAX_WORDS)
          : null,
        notes: note || null,
      });
    }
  }
  for (const [id, j] of jt) {
    if (seen.has(id) || j.node === null) continue;
    record.noCostRow.push(id);
    let status: Task["status"];
    let closed: string | null = j.accepted;
    if (j.accepted) status = "closed";
    else if (j.last === "needs-judgment") status = "needs-judgment";
    else if (j.last === "blocked") status = "blocked";
    else if (j.last === "stale") status = "stale";
    else if (j.resultReceived) {
      status = "closed";
      record.neverAccepted.push(id);
    } else status = "open";
    if (status !== "open" && closed === null) closed = j.opened;
    const summary =
      j.notes.length > 0
        ? limitWords(
            firstSentence(j.notes[j.notes.length - 1]!),
            SUMMARY_MAX_WORDS,
          )
        : null;
    tasks.push({
      id,
      node: j.node,
      step: asStep(j.step),
      status,
      role: j.role,
      model: j.model,
      tokens: { in: null, out: null },
      opened: j.opened,
      closed,
      ref: j.ref,
      pr: pullRequestFrom(j.notes, input.project),
      summary,
      notes: null,
    });
  }
  tasks.sort((a, b) => a.id.localeCompare(b.id));

  // Decisions: rulings first, then the plans' decision sections.
  const decisions: Decision[] = [];
  if (input.rulings !== null) {
    const r = parseRulings(input.rulings);
    decisions.push(...r.decisions);
    record.rulingsUnparsed = r.unparsed;
  }
  let next = 1;
  const nextId = (): string => `D${String(next++).padStart(3, "0")}`;
  const planPaths = [...input.plans.keys()].sort((a, b) => {
    const ra = a in input.acceptedPlans ? 0 : 1;
    const rb = b in input.acceptedPlans ? 0 : 1;
    return ra - rb || a.localeCompare(b);
  });
  for (const p of planPaths) {
    const text = input.plans.get(p)!;
    const owner = nodes.find((n) => n.docs.plan === p) ?? null;
    const accepted = input.acceptedPlans[p] ?? null;
    const section = parseDecisionSection(text);
    if (!section.hasSection) continue;
    if (section.hasGateRecord && accepted === null) {
      record.gateRecordsNotImported.push(p);
      continue;
    }
    if (owner === null && accepted === null) continue;
    if (owner !== null && owner.stage === "done") continue;
    record.decisionsRead.push({
      plan: p,
      count: section.decisions.length,
      unparsed: section.unparsed,
    });
    for (const d of section.decisions) {
      decisions.push({
        id: nextId(),
        node: owner?.id ?? null,
        question: d.title,
        options: [],
        default: d.default,
        chosen: accepted ? (d.default ?? "as stated") : null,
        decided: accepted,
        rationale: d.rationale,
        standing: false,
        source: `${p}, decision ${d.number}`,
      });
    }
  }

  // Overrides.
  const o = input.overrides;
  if (o?.nodes) {
    for (const [id, patch] of Object.entries(o.nodes)) {
      const n = nodes.find((x) => x.id === id);
      if (!n) throw new Error(`override names unknown node ${id}`);
      Object.assign(n, patch);
      record.overridesApplied.push(`${id}: ${Object.keys(patch).join(", ")}`);
    }
  }
  if (o?.tasks) {
    for (const [id, patch] of Object.entries(o.tasks)) {
      const t = tasks.find((x) => x.id === id);
      if (!t) throw new Error(`override names unknown task ${id}`);
      Object.assign(t, patch);
      record.overridesApplied.push(`${id}: ${Object.keys(patch).join(", ")}`);
    }
  }
  if (o?.decisions) {
    for (const [id, patch] of Object.entries(o.decisions)) {
      const d = decisions.find((x) => x.id === id);
      if (!d) throw new Error(`override names unknown decision ${id}`);
      Object.assign(d, patch);
      record.overridesApplied.push(`${id}: ${Object.keys(patch).join(", ")}`);
    }
  }
  record.reviewTitle = [];
  for (const n of nodes) {
    const reason = titleReview(n.title);
    if (reason) record.reviewTitle.push({ id: n.id, title: n.title, reason });
  }
  record.noOutcome = record.noOutcome.filter(
    (id) => nodes.find((n) => n.id === id)!.outcome === null,
  );
  record.longOutcome = record.longOutcome.filter(
    (id) =>
      wordCount(nodes.find((n) => n.id === id)!.outcome ?? "") >
      OUTCOME_MAX_WORDS,
  );

  const state: State = {
    schema: SCHEMA_VERSION,
    project: input.project,
    nodes,
    tasks,
    decisions,
  };
  record.counts = {
    nodes: nodes.length,
    tasks: tasks.length,
    decisions: decisions.length,
  };
  return { state, record };
}

export function renderImportRecord(record: ImportRecord, date: string): string {
  const list = (items: string[]): string =>
    items.length === 0 ? "- none" : items.map((i) => `- ${i}`).join("\n");
  return [
    "# Import record",
    "",
    `Written by \`plan-state import\` on ${date}. Reader: the owner reviewing the first state file, and any session. Each list below names what the import could not take from a record, or took with a proposal to review.`,
    "",
    `Counts: ${record.counts.nodes} nodes, ${record.counts.tasks} tasks, ${record.counts.decisions} decisions.`,
    "",
    "## Nodes without an outcome from any record",
    "",
    list(record.noOutcome),
    "",
    "## Outcomes over the forty-word bound, taken from a plan's first sentence",
    "",
    list(record.longOutcome),
    "",
    "## Titles to review",
    "",
    list(record.reviewTitle.map((t) => `${t.id}: "${t.title}" (${t.reason})`)),
    "",
    "## Open nodes with no recorded dependency",
    "",
    "The register's sibling order used to imply one. Each line names the sibling before the node, for the owner to confirm or dismiss as a dependency.",
    "",
    list(
      record.noDependency.map(
        (d) => `${d.id} (previous sibling: ${d.previousSibling ?? "none"})`,
      ),
    ),
    "",
    "## Done nodes with no date in the journal",
    "",
    list(record.noDoneDate),
    "",
    "## Plans linked by filename",
    "",
    "The register line had no plan link; the plan document's name carries the node identifier.",
    "",
    list(record.linkedByFilename.map((l) => `${l.id}: ${l.plan}`)),
    "",
    "## Tasks in the journal with no Cost log row",
    "",
    list(record.noCostRow),
    "",
    "## Tasks whose result was received and never accepted",
    "",
    list(record.neverAccepted),
    "",
    "## Ruling entries that did not parse",
    "",
    list(record.rulingsUnparsed),
    "",
    "## Decision sections read",
    "",
    list(
      record.decisionsRead.map(
        (d) =>
          `${d.plan}: ${d.count} decisions read, ${d.unparsed} items not parsed`,
      ),
    ),
    "",
    "## Plans with a gate record, not imported",
    "",
    "Their decisions were adopted at a gate; the plan holds them. Recurring ones are rulings, imported above.",
    "",
    list(record.gateRecordsNotImported),
    "",
    "## Overrides applied",
    "",
    list(record.overridesApplied),
    "",
  ].join("\n");
}
