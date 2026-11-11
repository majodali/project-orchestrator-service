/**
 * The state store (the rebuild plan, milestone 3): reads the state
 * file at a commit, and writes a mutation of it as one commit on the
 * default branch. Every write checks the result and refuses a
 * violation, renders the Markdown register and plan from the new
 * state, appends one journal event, and writes only the paths on the
 * allowlist. The branch head the state was read at is the commit's
 * parent; if the branch moved meanwhile the store reads again and
 * retries once. There is no lease and no other store: git is the only
 * state.
 */

import { checkState, type Finding } from "./check.js";
import { orderSiblingsByDependency } from "./order.js";
import { renderPlan, renderRegister } from "./render.js";
import { formatState, type State } from "./schema.js";
import type { CommitReader } from "../planRegister/registerFetcher.js";
import { GithubFetchError } from "../planRegister/registerFetcher.js";
import { GitConflictError, type GitWriter } from "../planRegister/gitWriter.js";

export const STATE_PATH = "orchestration/state.json";
export const JOURNAL_PATH = "orchestration/journal.jsonl";
export const REGISTER_PATH = "docs/plan-register.md";
export const PLAN_PATH = "docs/plan.md";

/** The only paths a service write may touch. Enforced here, so no
 * tool can reach past it. */
export const WRITABLE_PATHS: ReadonlySet<string> = new Set([
  STATE_PATH,
  JOURNAL_PATH,
  REGISTER_PATH,
  PLAN_PATH,
]);

/** The journal event a write appends. `ref` is the commit the write
 * was based on: the new commit's parent. The new commit is the one
 * that carries the line. */
export interface WriteEvent {
  task: string | null;
  node: string | null;
  session: string | null;
  note: string;
}

export interface ReadResult {
  state: State | null;
  findings: Finding[];
  ref: string;
  sha: string;
  fetchedAt: string;
}

export interface WriteResult {
  /** The new commit. */
  sha: string;
  /** The commit the write was based on. */
  parentSha: string;
  branch: string;
  warnings: Finding[];
}

/** The state at the head does not validate; nothing can be written
 * until it does. */
export class StateUnreadableError extends Error {
  readonly findings: Finding[];
  constructor(sha: string, findings: Finding[]) {
    super(`${STATE_PATH} at ${sha} does not validate`);
    this.name = "StateUnreadableError";
    this.findings = findings;
  }
}

/** The mutation would leave the state invalid; it is refused. */
export class WriteRefusedError extends Error {
  readonly findings: Finding[];
  constructor(findings: Finding[]) {
    super(
      `the change would violate ${findings.length} invariant(s): ${findings
        .map((f) => `${f.subject ?? "-"}: ${f.message}`)
        .join("; ")}`,
    );
    this.name = "WriteRefusedError";
    this.findings = findings;
  }
}

/** A mutation names what it needs: the file's own record. */
export class NotFoundError extends Error {
  constructor(what: string) {
    super(what);
    this.name = "NotFoundError";
  }
}

export interface StateStoreOptions {
  reader: CommitReader;
  writer: GitWriter;
  now?: () => Date;
}

export class StateStore {
  private readonly reader: CommitReader;
  private readonly writer: GitWriter;
  private readonly now: () => Date;

  constructor(options: StateStoreOptions) {
    this.reader = options.reader;
    this.writer = options.writer;
    this.now = options.now ?? (() => new Date());
  }

  async read(ref?: string): Promise<ReadResult> {
    const resolved = await this.reader.resolveRef(ref);
    const text = await this.reader.readFileAtSha(resolved.sha, STATE_PATH);
    const { state, findings } = parseState(text);
    return {
      state,
      findings,
      ref: resolved.ref,
      sha: resolved.sha,
      fetchedAt: this.now().toISOString(),
    };
  }

  /** The state at one commit, or null with the findings when it does
   * not validate. */
  async readStateAt(sha: string): Promise<{
    state: State | null;
    findings: Finding[];
  }> {
    return parseState(await this.reader.readFileAtSha(sha, STATE_PATH));
  }

  /**
   * Applies `mutate` to the state at the default branch's head and
   * commits the result. `mutate` edits the state it is given in place
   * and returns the journal event's fields; it may throw
   * `NotFoundError` or `WriteRefusedError` of its own. It is also told
   * the commit the state was read at, the new commit's parent.
   */
  async write(
    message: string,
    mutate: (state: State, context: { baseSha: string }) => WriteEvent,
  ): Promise<WriteResult> {
    let lastConflict: GitConflictError | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const resolved = await this.reader.resolveRef();
      const branch = resolved.ref;
      const baseSha = resolved.sha;
      const text = await this.reader.readFileAtSha(baseSha, STATE_PATH);
      const parsed = parseState(text);
      if (parsed.state === null) {
        throw new StateUnreadableError(baseSha, parsed.findings);
      }
      const journal = await this.readOptional(baseSha, JOURNAL_PATH);

      const next = structuredClone(parsed.state);
      const event = mutate(next, { baseSha });
      next.nodes = orderSiblingsByDependency(next);
      const { findings } = checkState(next);
      const violations = findings.filter((f) => f.severity === "violation");
      if (violations.length > 0) throw new WriteRefusedError(violations);

      const line = JSON.stringify({
        ts: this.now()
          .toISOString()
          .replace(/\.\d{3}Z$/, "Z"),
        event: "state-written",
        task: event.task,
        node: event.node,
        stage: null,
        role: null,
        model: null,
        session: event.session,
        ref: baseSha,
        note: event.note,
      });
      const files = new Map<string, string>([
        [STATE_PATH, formatState(next)],
        [REGISTER_PATH, renderRegister(next)],
        [PLAN_PATH, renderPlan(next)],
        [JOURNAL_PATH, appendLine(journal, line)],
      ]);
      for (const path of files.keys()) {
        if (!WRITABLE_PATHS.has(path)) {
          throw new Error(`refusing to write ${path}: not on the allowlist`);
        }
      }
      try {
        const result = await this.writer.commitFiles({
          branch,
          expectedHeadSha: baseSha,
          message,
          files,
        });
        return {
          sha: result.sha,
          parentSha: baseSha,
          branch,
          warnings: findings.filter((f) => f.severity === "warning"),
        };
      } catch (err) {
        if (err instanceof GitConflictError) {
          lastConflict = err;
          continue;
        }
        throw err;
      }
    }
    throw lastConflict!;
  }

  private async readOptional(sha: string, path: string): Promise<string> {
    try {
      return await this.reader.readFileAtSha(sha, path);
    } catch (err) {
      if (err instanceof GithubFetchError && err.status === 404) return "";
      throw err;
    }
  }
}

function appendLine(text: string, line: string): string {
  if (text === "") return line + "\n";
  return (text.endsWith("\n") ? text : text + "\n") + line + "\n";
}

export function parseState(text: string): {
  state: State | null;
  findings: Finding[];
} {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return {
      state: null,
      findings: [
        {
          severity: "violation",
          invariant: 1,
          subject: null,
          message: `${STATE_PATH} is not JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
  return checkState(value);
}
