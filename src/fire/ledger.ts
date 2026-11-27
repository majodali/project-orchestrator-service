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

/** One `decision_close` of the store's own `state-written` lines
 * (`src/model/mutations.ts`'s `closeDecision`), read back for the
 * fire check's recovery rule (P2-N082, criterion 1): a closed
 * too-many-attempts report restarts the bare-attempt count for its
 * node at the moment the owner's answer committed. */
export interface DecisionCloseLine {
  readonly ts: string;
  readonly node: string | null;
  readonly decisionId: string;
  readonly chosen: string;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function parseLine(raw: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** `obj` as a `decision_close` line, or null when it is some other
 * `state-written` line, or not one at all. */
function asDecisionClose(
  obj: Record<string, unknown>,
): DecisionCloseLine | null {
  if (
    obj.event !== "state-written" ||
    !isString(obj.ts) ||
    !isString(obj.note)
  ) {
    return null;
  }
  const m = /^decision_close (\S+): ([\s\S]*)$/.exec(obj.note);
  if (!m) return null;
  return {
    ts: obj.ts,
    node: isString(obj.node) ? obj.node : null,
    decisionId: m[1]!,
    chosen: m[2]!,
  };
}

/** Every `decision_close` line in the journal, in file order. */
export function parseDecisionCloses(text: string): DecisionCloseLine[] {
  const out: DecisionCloseLine[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    const obj = parseLine(line);
    if (obj === null) continue;
    const dc = asDecisionClose(obj);
    if (dc !== null) out.push(dc);
  }
  return out;
}

/**
 * The journal's very last line, parsed as a `decision_close`, or null
 * when the journal is empty or that line is something else. Every
 * write appends its own line before the fire check that runs right
 * after it (`src/fire/run.ts`), and nothing else writes to the journal
 * in between, so this is how a fire check tells whether *this* round's
 * own trigger was the owner answering a report (P2-N082, criterion 4)
 * — never true on a later round, once some other write has appended
 * its own line after it.
 */
export function lastLineDecisionClose(text: string): DecisionCloseLine | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const last = lines[lines.length - 1];
  if (last === undefined) return null;
  const obj = parseLine(last);
  return obj === null ? null : asDecisionClose(obj);
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
