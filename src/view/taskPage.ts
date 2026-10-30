/**
 * The task page, `GET /view/task/<task ID>` (node P2-N021, the web
 * view's first version, task E2; the specification of P2-N003, "The
 * task page"):
 *
 *   - the task's Cost log row, all nine fields, or "no Cost log row at
 *     this commit";
 *   - the task's journal events, in file order: `ts`, `event`, `node`,
 *     `stage`, `role`, `model`, `ref` and `note`, each verbatim, or a
 *     line saying there are none;
 *   - a link to the task's node page.
 *
 * A task ID that no Cost log row and no journal event names answers
 * `404`, naming the ID and the SHA.
 */

import type { PageCommit } from "./html.js";
import {
  escapeHtml,
  limitLine,
  pageHeader,
  pageShell,
  viewLink,
} from "./html.js";
import { nodePageHref } from "./registerNote.js";
import type {
  CostLog,
  CostLogRow,
  Journal,
  JournalEntry,
} from "./runRecords.js";
import {
  COST_LOG_PATH,
  JOURNAL_PATH,
  eventField,
  eventString,
  skippedNote,
} from "./runRecords.js";

/** The journal fields the task page shows, in this order. */
export const TASK_EVENT_FIELDS = [
  "ts",
  "event",
  "node",
  "stage",
  "role",
  "model",
  "ref",
  "note",
] as const;

export function taskPagePath(id: string): string {
  return `/view/task/${encodeURIComponent(id)}`;
}

export interface TaskRecords {
  rows: CostLogRow[];
  events: JournalEntry[];
}

/** The rows and events that name `taskId`. */
export function recordsOf(
  taskId: string,
  costLog: CostLog,
  journal: Journal,
): TaskRecords {
  return {
    rows: costLog.rows.filter((row) => row.task === taskId),
    events: journal.events.filter(
      ({ event }) => eventString(event, "task") === taskId,
    ),
  };
}

function rowSection(rows: CostLogRow[], header: string[]): string {
  if (rows.length === 0) {
    return `<section data-field="cost-log-row">\n<h2>Cost log row</h2>\n<p data-no-row>no Cost log row at this commit</p>\n</section>`;
  }
  const blocks = rows
    .map((row) => {
      const items = row.cells
        .map(
          (cell, i) =>
            `<dt>${escapeHtml(header[i] ?? `field ${i + 1}`)}</dt><dd data-cell="${i + 1}">${escapeHtml(cell)}</dd>`,
        )
        .join("\n");
      return `<dl data-row-line="${row.line}">\n${items}\n</dl>`;
    })
    .join("\n");
  return `<section data-field="cost-log-row">\n<h2>Cost log row</h2>\n${blocks}\n</section>`;
}

function eventsSection(events: JournalEntry[], notes: string): string {
  if (events.length === 0) {
    return `<section data-field="events">\n<h2>Journal events</h2>\n<p data-no-events>no journal event names this task at this commit</p>${notes}\n</section>`;
  }
  const items = events
    .map(({ line, event }) => {
      const fields = TASK_EVENT_FIELDS.map(
        (name) =>
          `<dt>${name}</dt><dd data-event-field="${name}">${escapeHtml(eventField(event, name))}</dd>`,
      ).join("\n");
      return `<li data-event-line="${line}"><dl>\n${fields}\n</dl></li>`;
    })
    .join("\n");
  return `<section data-field="events">\n<h2>Journal events</h2>\n<ol class="events">\n${items}\n</ol>${notes}\n</section>`;
}

function nodeSection(records: TaskRecords, commit: PageCommit): string {
  const nodes: string[] = [];
  for (const row of records.rows) nodes.push(row.node);
  for (const { event } of records.events) {
    const node = eventString(event, "node");
    if (node !== undefined) nodes.push(node);
  }
  const distinct = [...new Set(nodes)];
  const body =
    distinct.length === 0
      ? `<p class="note">The row and the events name no node.</p>`
      : `<ul>\n${distinct
          .map(
            (id) =>
              `<li data-task-node="${escapeHtml(id)}"><a href="${escapeHtml(nodePageHref(id, commit.requestedRef))}">${escapeHtml(id)}</a></li>`,
          )
          .join("\n")}\n</ul>`;
  return `<section data-field="node">\n<h2>Node</h2>\n${body}\n</section>`;
}

/** Renders the task page from the files at `commit.sha`. */
export function renderTaskPage(
  taskId: string,
  costLog: CostLog,
  journal: Journal,
  commit: PageCommit,
): string {
  const records = recordsOf(taskId, costLog, journal);
  const notes = [
    skippedNote(COST_LOG_PATH, costLog.skippedLines),
    skippedNote(JOURNAL_PATH, journal.skippedLines),
  ]
    .filter((note) => note !== "")
    .map((note) => `\n<p class="note" data-skipped>${escapeHtml(note)}</p>`)
    .join("");
  const body = [
    pageHeader(commit, taskPagePath(taskId)),
    limitLine(commit, commit.sha),
    "<main>",
    `<p><a href="${escapeHtml(viewLink("/view", commit.requestedRef))}">Plan tree</a></p>`,
    `<h1>Task <span data-task-id>${escapeHtml(taskId)}</span></h1>`,
    rowSection(records.rows, costLog.header),
    eventsSection(records.events, notes),
    nodeSection(records, commit),
    "</main>",
  ].join("\n");
  return pageShell(`${taskId}: task`, body);
}
