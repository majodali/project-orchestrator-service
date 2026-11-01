/**
 * The node page, `GET /view/node/<node ID>` (node P2-N021, the web
 * view's first version, task E2; the specification of P2-N003, "The
 * node page", and decision 14). Seven fields, in the order of the hand
 * rendering `docs/plan.md` (stage, outcome, depends on, needed by,
 * documents), then resources and tasks:
 *
 *   1. Stage, with the hold marker, and the date of the latest
 *      `gate-crossed` or `accepted` journal event for the node,
 *      labelled as telemetry.
 *   2. Outcome: the first paragraph of the *Outcome* section of the
 *      plan the node's line links; or "the plan has no Outcome
 *      section", with the link; or "no plan linked".
 *   3. Depends on: the register's note, verbatim, node IDs linked.
 *   4. Needed by: the nodes whose register notes name this node.
 *   5. Documents: the line's links, or the nearest ancestor's,
 *      labelled with that ancestor's ID.
 *   6. Resources: task E3's, not read in this version.
 *   7. Tasks: every task a Cost log row or a journal event names with
 *      this node, in task-number order.
 *
 * The parts the specification assigns to task E3 (the edge
 * dependencies in fields 3 and 4, and field 6's content) are absent.
 * The view parses no prose for dependencies.
 */

import type { PlanNode, RegisterParseResult } from "../planRegister/types.js";
import type { PageCommit } from "./html.js";
import {
  blobUrl,
  escapeHtml,
  limitLine,
  pageHeader,
  pageShell,
  viewLink,
} from "./html.js";
import {
  documentPath,
  nodePageHref,
  renderNote,
  renderRegisterLink,
} from "./registerNote.js";
import type { CostLog, Journal } from "./runRecords.js";
import {
  COST_LOG_PATH,
  JOURNAL_PATH,
  byTaskNumber,
  eventString,
  skippedNote,
} from "./runRecords.js";

/** The journal events whose date field 1 shows. */
const STAGE_EVENTS = new Set(["gate-crossed", "accepted"]);

export function nodePagePath(id: string): string {
  return `/view/node/${encodeURIComponent(id)}`;
}

/** The register link a node's line names as its plan, if any. */
export function planLink(
  node: PlanNode,
): { target: string; path: string } | undefined {
  for (const link of node.links) {
    if (link.label !== "plan") continue;
    const path = documentPath(link.target);
    if (path !== undefined) return { target: link.target, path };
  }
  return undefined;
}

/**
 * The first paragraph of a Markdown document's *Outcome* section: the
 * first run of non-blank lines after a heading that reads exactly
 * "Outcome", joined by spaces. `null` when the document has no such
 * heading; the empty string when the section holds no paragraph
 * before the next heading.
 */
export function outcomeParagraph(markdown: string): string | null {
  const lines = markdown.split(/\r\n|\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s+Outcome\s*$/.test(line));
  if (start === -1) return null;
  const paragraph: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (line.trim() === "") {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  return paragraph.join(" ");
}

export interface NodePageInput {
  parsed: RegisterParseResult;
  node: PlanNode;
  costLog: CostLog;
  journal: Journal;
  /** The linked plan's text at the page's SHA, when the line links one. */
  planText: string | undefined;
}

function field(name: string, heading: string, body: string): string {
  return `<section data-field="${name}">\n<h2>${escapeHtml(heading)}</h2>\n${body}\n</section>`;
}

function stageField(input: NodePageInput): string {
  const { node, journal } = input;
  const parts = [
    `<p><span class="stage" data-stage>[${escapeHtml(node.stage)}]</span>`,
    node.hold
      ? ` <span class="hold" data-hold>[${escapeHtml(node.hold.kind)}: ${escapeHtml(node.hold.reason)}]</span>`
      : "",
    "</p>",
  ];
  let latest: { ts: string; kind: string } | undefined;
  for (const { event } of journal.events) {
    const kind = eventString(event, "event");
    const ts = eventString(event, "ts");
    if (eventString(event, "node") !== node.id) continue;
    if (kind === undefined || !STAGE_EVENTS.has(kind) || ts === undefined) {
      continue;
    }
    if (latest === undefined || ts >= latest.ts) latest = { ts, kind };
  }
  if (latest !== undefined) {
    parts.push(
      `<p class="note" data-journal-date><time>${escapeHtml(latest.ts.slice(0, 10))}</time>: last journal event, telemetry (<code>${escapeHtml(latest.kind)}</code>). The run journal is never authoritative.</p>`,
    );
  }
  return field("stage", "Stage", parts.join(""));
}

function outcomeField(input: NodePageInput, commit: PageCommit): string {
  const plan = planLink(input.node);
  if (plan === undefined) {
    return field(
      "outcome",
      "Outcome",
      `<p data-outcome-state="no-plan">no plan linked</p>`,
    );
  }
  const href = blobUrl(commit, commit.sha, plan.path);
  const link = `<a href="${escapeHtml(href)}">${escapeHtml(plan.path)}</a>`;
  const paragraph = outcomeParagraph(input.planText ?? "");
  if (paragraph === null) {
    return field(
      "outcome",
      "Outcome",
      `<p data-outcome-state="no-section">the plan has no Outcome section: ${link}</p>`,
    );
  }
  if (paragraph === "") {
    return field(
      "outcome",
      "Outcome",
      `<p data-outcome-state="empty-section">the plan's Outcome section holds no paragraph: ${link}</p>`,
    );
  }
  return field(
    "outcome",
    "Outcome",
    `<p data-outcome>${escapeHtml(paragraph)}</p>\n<p class="note">From the Outcome section of ${link}.</p>`,
  );
}

function dependsOnField(input: NodePageInput, commit: PageCommit): string {
  const { node, parsed } = input;
  if (node.annotation === null) {
    return field(
      "depends-on",
      "Depends on",
      `<p class="note">The register's line carries no note.</p>`,
    );
  }
  const note = renderNote(node, commit, commit.sha, {
    known: new Set(parsed.order),
    requestedRef: commit.requestedRef,
  });
  return field(
    "depends-on",
    "Depends on",
    `<p><span class="label">From the register's note:</span> <span data-note>${note}</span></p>`,
  );
}

function neededByField(input: NodePageInput, commit: PageCommit): string {
  const { node, parsed } = input;
  const pattern = new RegExp(`(?<![A-Za-z0-9-])${node.id}(?![0-9])`);
  const naming = parsed.order.filter((id) => {
    if (id === node.id) return false;
    const other = parsed.nodes.get(id)!;
    return other.annotation !== null && pattern.test(other.annotation);
  });
  if (naming.length === 0) {
    return field(
      "needed-by",
      "Needed by",
      `<p class="note">No register note names ${escapeHtml(node.id)}.</p>`,
    );
  }
  const items = naming
    .map((id) => {
      const other = parsed.nodes.get(id)!;
      return `<li data-needed-by="${escapeHtml(id)}"><a href="${escapeHtml(nodePageHref(id, commit.requestedRef))}">${escapeHtml(id)}</a> ${escapeHtml(other.title)}</li>`;
    })
    .join("\n");
  return field(
    "needed-by",
    "Needed by",
    `<p class="label">Named in the register notes of:</p>\n<ul>\n${items}\n</ul>`,
  );
}

function documentsField(input: NodePageInput, commit: PageCommit): string {
  const { node, parsed } = input;
  const list = (owner: PlanNode): string =>
    `<ul>\n${owner.links.map((link) => renderRegisterLink(link, commit, commit.sha)).join("\n")}\n</ul>`;
  if (node.links.length > 0) {
    return field("documents", "Documents", list(node));
  }
  let ancestorId = node.parentId;
  while (ancestorId !== null) {
    const ancestor = parsed.nodes.get(ancestorId)!;
    if (ancestor.links.length > 0) {
      return field(
        "documents",
        "Documents",
        `<p class="label" data-documents-from="${escapeHtml(ancestor.id)}">This line links no document. The nearest ancestor's links, from <a href="${escapeHtml(nodePageHref(ancestor.id, commit.requestedRef))}">${escapeHtml(ancestor.id)}</a>:</p>\n${list(ancestor)}`,
      );
    }
    ancestorId = ancestor.parentId;
  }
  return field(
    "documents",
    "Documents",
    `<p class="note">No document is linked on this line or any ancestor's.</p>`,
  );
}

function resourcesField(): string {
  return field(
    "resources",
    "Resources",
    `<p class="note">Not shown in this version. Task E3 adds the resources, from the Project model.</p>`,
  );
}

function tasksField(input: NodePageInput, commit: PageCommit): string {
  const { node, costLog, journal } = input;
  const withRow = new Set(
    costLog.rows.filter((row) => row.node === node.id).map((row) => row.task),
  );
  const withEvent = new Set<string>();
  for (const { event } of journal.events) {
    const task = eventString(event, "task");
    if (eventString(event, "node") === node.id && task !== undefined) {
      withEvent.add(task);
    }
  }
  const tasks = [...new Set([...withRow, ...withEvent])].sort(byTaskNumber);
  const notes = [
    skippedNote(COST_LOG_PATH, costLog.skippedLines),
    skippedNote(JOURNAL_PATH, journal.skippedLines),
  ]
    .filter((note) => note !== "")
    .map((note) => `<p class="note" data-skipped>${escapeHtml(note)}</p>`)
    .join("\n");
  if (tasks.length === 0) {
    return field(
      "tasks",
      "Tasks",
      `<p class="note">No Cost log row and no journal event names a task with ${escapeHtml(node.id)}.</p>${notes ? `\n${notes}` : ""}`,
    );
  }
  const items = tasks
    .map((task) => {
      const label = withRow.has(task)
        ? ""
        : ` <span class="note" data-no-row>no Cost log row</span>`;
      return `<li data-task="${escapeHtml(task)}"><a href="${escapeHtml(viewLink(`/view/task/${encodeURIComponent(task)}`, commit.requestedRef))}">${escapeHtml(task)}</a>${label}</li>`;
    })
    .join("\n");
  return field(
    "tasks",
    "Tasks",
    `<ul>\n${items}\n</ul>${notes ? `\n${notes}` : ""}`,
  );
}

/** Renders the node page from the files at `commit.sha`. */
export function renderNodePage(
  input: NodePageInput,
  commit: PageCommit,
): string {
  const { node } = input;
  const body = [
    pageHeader(commit, nodePagePath(node.id)),
    limitLine(commit, commit.sha),
    "<main>",
    `<p><a href="${escapeHtml(viewLink("/view", commit.requestedRef))}">Plan tree</a></p>`,
    `<h1><span data-node-id>${escapeHtml(node.id)}</span> <span data-title>${escapeHtml(node.title)}</span></h1>`,
    stageField(input),
    outcomeField(input, commit),
    dependsOnField(input, commit),
    neededByField(input, commit),
    documentsField(input, commit),
    resourcesField(),
    tasksField(input, commit),
    "</main>",
  ].join("\n");
  return pageShell(`${node.id}: node`, body);
}
