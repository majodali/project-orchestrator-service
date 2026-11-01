/**
 * The Cost log and the run journal, as the node and task pages read
 * them (node P2-N021, the web view's first version, task E2; the
 * specification of P2-N003, "What it reads: four files at one
 * commit"). The row split, the task ID, the event kinds and the line
 * classes come from the vendored shared unit,
 * `../planRegister/vendored/cost-log-and-journal.js`, the same code
 * the coordinating repository's form checker runs (RU-012, how two
 * repositories share one unit of code; criterion V23, no copied
 * parsing). This module only selects rows and events for a page.
 */

import {
  COST_LOG_CELL_COUNT,
  TASK_ID,
  costLogTableRows,
  journalLines,
} from "../planRegister/vendored/cost-log-and-journal.js";
import type { JournalEvent } from "../planRegister/vendored/cost-log-and-journal.js";

export const COST_LOG_PATH = "docs/cost-log.md";
export const JOURNAL_PATH = "orchestration/journal.jsonl";

/** One Cost log row, all nine cells as written. */
export interface CostLogRow {
  line: number;
  cells: string[];
  task: string;
  node: string;
}

export interface CostLog {
  /** The header's cells: the field names, as the file writes them. */
  header: string[];
  rows: CostLogRow[];
  /** File line numbers of data rows that are not nine cells with a
   * task ID: shown as skipped, never silently dropped. */
  skippedLines: number[];
}

export function readCostLog(text: string): CostLog {
  let header: string[] = [];
  const rows: CostLogRow[] = [];
  const skippedLines: number[] = [];
  for (const row of costLogTableRows(text)) {
    if (row.kind === "header") {
      header = row.cells;
      continue;
    }
    if (row.kind !== "data") continue;
    const task = row.cells[1];
    const node = row.cells[2];
    if (
      row.cells.length !== COST_LOG_CELL_COUNT ||
      task === undefined ||
      node === undefined ||
      !TASK_ID.test(task)
    ) {
      skippedLines.push(row.line);
      continue;
    }
    rows.push({ line: row.line, cells: row.cells, task, node });
  }
  return { header, rows, skippedLines };
}

/** One journal event, with its line in the file. */
export interface JournalEntry {
  line: number;
  event: JournalEvent;
}

export interface Journal {
  events: JournalEntry[];
  /** File line numbers that are not events: not JSON, missing `ts` or
   * `event`, or an unknown kind. */
  skippedLines: number[];
}

export function readJournal(text: string): Journal {
  const events: JournalEntry[] = [];
  const skippedLines: number[] = [];
  for (const entry of journalLines(text)) {
    if (entry.status === "event") {
      events.push({ line: entry.line, event: entry.event });
    } else {
      skippedLines.push(entry.line);
    }
  }
  return { events, skippedLines };
}

/** A field of an event as a string, or undefined when it is absent or
 * not a string. */
export function eventString(
  event: JournalEvent,
  field: string,
): string | undefined {
  const value = event[field];
  return typeof value === "string" ? value : undefined;
}

/** A field of an event exactly as the file holds it: a string as
 * written, any other JSON value in its JSON form, an absent field as
 * "absent". */
export function eventField(event: JournalEvent, field: string): string {
  if (!(field in event)) return "absent";
  const value = event[field];
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Task IDs in task-number order. */
export function byTaskNumber(a: string, b: string): number {
  return Number(a.slice(1)) - Number(b.slice(1)) || a.localeCompare(b);
}

/** A note listing skipped lines of a file, or the empty string. */
export function skippedNote(path: string, lines: number[]): string {
  if (lines.length === 0) return "";
  return `${path}: ${lines.length === 1 ? "line" : "lines"} ${lines.join(", ")} did not parse at this commit and ${lines.length === 1 ? "is" : "are"} not read here.`;
}
