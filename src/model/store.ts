/**
 * The state store (the rebuild plan, milestone 3): reads the state
 * file at a commit, and writes a mutation of it as one commit on the
 * default branch. Every write checks the result and refuses a
 * violation, renders the Markdown register, plan and Backlog from the
 * new state, appends one journal event, and writes only the paths on the
 * allowlist. The branch head the state was read at is the commit's
 * parent; if the branch moved meanwhile the store reads again and
 * retries once. There is no lease and no other store: git is the only
 * state.
 */

import { checkState, type Finding } from "./check.js";
import { orderSiblingsByDependency } from "./order.js";
import { renderBacklog, renderPlan, renderRegister } from "./render.js";
import { formatState, type State } from "./schema.js";
import type { CommitReader } from "../planRegister/registerFetcher.js";
import {
  FileTooLargeError,
  GithubFetchError,
} from "../planRegister/registerFetcher.js";
import { GitConflictError, type GitWriter } from "../planRegister/gitWriter.js";

export const STATE_PATH = "orchestration/state.json";
export const JOURNAL_PATH = "orchestration/journal.jsonl";
export const REGISTER_PATH = "docs/plan-register.md";
export const PLAN_PATH = "docs/plan.md";
export const BACKLOG_PATH = "docs/backlog.md";

/** The only paths a service write may touch. Enforced here, so no
 * tool can reach past it. */
export const WRITABLE_PATHS: ReadonlySet<string> = new Set([
  STATE_PATH,
  JOURNAL_PATH,
  REGISTER_PATH,
  PLAN_PATH,
  BACKLOG_PATH,
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

/** The mutation would leave the state invalid; it is refused. `merged`
 * names a pull request a `step` merged earlier in the same `write`
 * call, before a later attempt's trial found this violation: nothing
 * from this call was committed, but those stay merged. */
export class WriteRefusedError extends Error {
  readonly findings: Finding[];
  readonly merged: readonly string[];
  constructor(findings: Finding[], merged: readonly string[] = []) {
    super(
      `the change would violate ${findings.length} invariant(s): ${findings
        .map((f) => `${f.subject ?? "-"}: ${f.message}`)
        .join("; ")}`,
    );
    this.name = "WriteRefusedError";
    this.findings = findings;
    this.merged = merged;
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

  /** The head of the default branch. */
  async headSha(): Promise<string> {
    return (await this.reader.resolveRef()).sha;
  }

  /** Whether the repository has a file at `path` at one commit. */
  async fileExistsAt(sha: string, path: string): Promise<boolean> {
    try {
      await this.reader.readFileAtSha(sha, path);
      return true;
    } catch (err) {
      if (err instanceof FileTooLargeError) return true;
      if (err instanceof GithubFetchError && err.status === 404) return false;
      throw err;
    }
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
   *
   * `step` is an irreversible action (opening a pull request, merging
   * one) a caller needs to run as part of the same close, such as
   * `task_close` or a node's move to `done`. It runs at most once per
   * `write` call, after `mutate` has been trialled on a throwaway copy
   * of the state this attempt read and found no invariant violation
   * (and raised none of `mutate`'s own refusals), and before `mutate`
   * runs again for real on a fresh copy that is committed. So nothing
   * irreversible happens for a close the invariants would refuse. A
   * `GitConflictError` retries both the read and the trial against the
   * branch's new head, but reuses `step`'s result rather than running
   * it again.
   */
  async write(
    message: string,
    mutate: (state: State, context: { baseSha: string }) => WriteEvent,
    step?: (state: State, context: { baseSha: string }) => Promise<void> | void,
  ): Promise<WriteResult> {
    let lastConflict: GitConflictError | null = null;
    let stepRan = false;
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

      if (step !== undefined) {
        const trial = structuredClone(parsed.state);
        mutate(trial, { baseSha });
        trial.nodes = orderSiblingsByDependency(trial);
        const trialViolations = checkState(trial).findings.filter(
          (f) => f.severity === "violation",
        );
        if (trialViolations.length > 0) {
          throw new WriteRefusedError(trialViolations);
        }
        if (!stepRan) {
          await step(parsed.state, { baseSha });
          stepRan = true;
        }
      }

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
        [BACKLOG_PATH, renderBacklog(next)],
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
