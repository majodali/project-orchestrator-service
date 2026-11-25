/**
 * The fire ledger: the `fired` and `fire-429` lines `orchestration/
 * journal.jsonl` carries alongside the store's own `state-written`
 * lines (P2-N048, design 3). Parsing only, no I/O: `src/fire/run.ts`
 * reads the file and hands its text here.
 */

export interface FiredLine {
  readonly ts: string;
  readonly node: string;
  readonly step: string;
  /** The scheduled task's `trig_` identifier, not a plan task ID. */
  readonly task: string;
  /** The session whose write this fire followed, or null when none
   * was given. Never the session the fire goes on to create: this
   * line is written before that session exists (criterion 2). */
  readonly session: string | null;
}

export interface Fire429Line {
  readonly ts: string;
  /** The scheduled task's `trig_` identifier the 429 named. */
  readonly task: string;
  /** The ISO timestamp the endpoint's `Retry-After` resolves to:
   * firing stays off for this task until then. */
  readonly retryAfter: string;
}

/** Written after a successful fire call, tied to the `fired` line
 * that preceded it by matching `ts`, `node`, `step` and `task`: the
 * provenance gap D127 and P2-N047's record named — which session a
 * fire started (owner, 2026-11-24, note (b)). */
export interface FiredSessionLine {
  readonly ts: string;
  readonly node: string;
  readonly step: string;
  readonly task: string;
  readonly sessionId: string;
  readonly sessionUrl: string;
}

export interface ParsedJournal {
  readonly fired: readonly FiredLine[];
  readonly fire429: readonly Fire429Line[];
  readonly firedSession: readonly FiredSessionLine[];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Parses every `fired` and `fire-429` line of a journal's text. A
 * line that is not JSON, or JSON missing a field either shape needs,
 * is skipped rather than thrown on: the ledger reads what the service
 * itself wrote, but it is still read as data, not trusted blindly. */
export function parseJournal(text: string): ParsedJournal {
  const fired: FiredLine[] = [];
  const fire429: Fire429Line[] = [];
  const firedSession: FiredSessionLine[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    const obj = value as Record<string, unknown>;
    if (
      obj.event === "fired" &&
      isString(obj.ts) &&
      isString(obj.node) &&
      isString(obj.step) &&
      isString(obj.task)
    ) {
      fired.push({
        ts: obj.ts,
        node: obj.node,
        step: obj.step,
        task: obj.task,
        session: isString(obj.session) ? obj.session : null,
      });
    } else if (
      obj.event === "fire-429" &&
      isString(obj.ts) &&
      isString(obj.task) &&
      isString(obj.retryAfter)
    ) {
      fire429.push({ ts: obj.ts, task: obj.task, retryAfter: obj.retryAfter });
    } else if (
      obj.event === "fired-session" &&
      isString(obj.ts) &&
      isString(obj.node) &&
      isString(obj.step) &&
      isString(obj.task) &&
      isString(obj.sessionId) &&
      isString(obj.sessionUrl)
    ) {
      firedSession.push({
        ts: obj.ts,
        node: obj.node,
        step: obj.step,
        task: obj.task,
        sessionId: obj.sessionId,
        sessionUrl: obj.sessionUrl,
      });
    }
  }
  return { fired, fire429, firedSession };
}
