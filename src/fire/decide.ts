/**
 * The fire decision (P2-N048, design 1, 3 and 4): pure, synchronous,
 * no I/O — `src/fire/run.ts` reads the state, the settings and the
 * journal and hands them here, then carries out whatever this
 * decides. Kept separate so the three no-fire rules and the two caps
 * are each testable without a store, a secret or a network call
 * (mirrors `plugin/scripts/lib/orchestrate.ts`'s own split in the
 * coordinating repository).
 *
 * Recovery after a report (P2-N082). A node fired twice since its
 * last close with no task opened is reported to the owner
 * (`too-many-attempts`), and the open decision gates it meanwhile: no
 * further fire can reach it. Closing that decision — "acknowledge" or
 * "fire it by hand with Run now" — restarts the node's count at the
 * moment the answer committed, the same as a task close does, so the
 * next write's fire check can fire it again rather than finding the
 * same two stale fires and reporting it right back. Two further bare
 * fires after that restart open one new report, the same way the
 * first one did. The one difference between the two answers: the
 * write that closes the decision with "fire it by hand with Run now"
 * does not itself fire the node, because the owner said they would —
 * every write after that one is unaffected.
 */

import { candidates, repositoryOf } from "../model/loop.js";
import type { Node, State, Step } from "../model/schema.js";
import type { DecisionCloseLine, Fire429Line, FiredLine } from "./ledger.js";
import type { FireRole, FireSettings, FireTaskRef } from "./settings.js";

/** At most two fires leave one write (criterion 5). */
export const MAX_FIRES_PER_WRITE = 2;

export interface FireAttempt {
  readonly node: Node;
  readonly step: Step;
  readonly role: FireRole;
  readonly repository: string;
  readonly ref: FireTaskRef;
}

export type ReportReason = "no-task-configured" | "too-many-attempts";

export interface FireReport {
  readonly node: Node;
  readonly reason: ReportReason;
  readonly detail: string;
}

/** The start of the question a report opens as a decision — only
 * `too-many-attempts` ever does (`no-task-configured` is logged, never
 * a decision: see `src/fire/run.ts`). Shared with `decide.ts`'s own
 * recovery rule, which needs to recognise such a decision's closing by
 * its question, not only by its reason. */
export const REPORT_QUESTION_PREFIX: Record<ReportReason, string> = {
  "no-task-configured": "Fire: no scheduled task is configured",
  "too-many-attempts": "Fire: too many bare attempts",
};

/** The two answers a too-many-attempts report offers the owner. */
export const ACKNOWLEDGE_ANSWER = "acknowledge";
export const RUN_NOW_ANSWER = "fire it by hand with Run now";

export interface FirePlan {
  readonly attempts: readonly FireAttempt[];
  readonly reports: readonly FireReport[];
}

const NO_PLAN: FirePlan = { attempts: [], reports: [] };

/** The timestamp of the node's last task close, or null when none of
 * its tasks has closed: the boundary "since its last close" (design
 * 3, criterion 3) counts fired lines from. Timestamps are fixed-width
 * ISO-8601 UTC, so lexical order is chronological order. */
function lastCloseTimestamp(state: State, nodeId: string): string | null {
  let latest: string | null = null;
  for (const task of state.tasks) {
    if (task.node !== nodeId || task.closed === null) continue;
    if (latest === null || task.closed > latest) latest = task.closed;
  }
  return latest;
}

/**
 * The latest moment a closed too-many-attempts report on this node
 * restarted its count (criterion 1), read from the journal's own
 * `decision_close` line for each such decision — a decision's
 * `decided` field holds only a date, which could sit before or after
 * other fires the same day and either miss a stale fire or double
 * count one already reported, so the exact commit the journal records
 * is what this reads instead.
 *
 * Returns null when no such report has closed yet, or — defensively,
 * since every `decision_close` commits its journal line in the same
 * atomic write as the decision itself, so this should not happen —
 * when a closed report's line cannot be found there. Either way the
 * count then stays exactly as it stood before that report closed: no
 * restart, which never double counts a fire and never fires the node
 * on a guessed boundary, at the cost of leaving it gated until some
 * other close occurs.
 */
function lastReportClosingTimestamp(
  state: State,
  decisionCloses: readonly DecisionCloseLine[],
  nodeId: string,
): string | null {
  const prefix = REPORT_QUESTION_PREFIX["too-many-attempts"];
  const reportIds = new Set(
    state.decisions
      .filter(
        (d) =>
          d.node === nodeId &&
          d.chosen !== null &&
          d.question.startsWith(prefix),
      )
      .map((d) => d.id),
  );
  let latest: string | null = null;
  for (const dc of decisionCloses) {
    if (!reportIds.has(dc.decisionId)) continue;
    if (latest === null || dc.ts > latest) latest = dc.ts;
  }
  return latest;
}

/** The later of two timestamps, either of which may be absent. */
function laterOf(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * True when this round's own trigger was the owner closing a
 * too-many-attempts report on `node` with "fire it by hand with Run
 * now" (criterion 4): the service does not fire the node on that one
 * write, because the owner said they would. `lastDecisionClose` is
 * null on every later round, once some other write's line follows it
 * in the journal, so the suppression never outlives that single
 * write.
 */
function suppressedByHandOff(
  node: Node,
  state: State,
  lastDecisionClose: DecisionCloseLine | null,
): boolean {
  if (lastDecisionClose === null) return false;
  if (lastDecisionClose.node !== node.id) return false;
  if (lastDecisionClose.chosen !== RUN_NOW_ANSWER) return false;
  const decision = state.decisions.find(
    (d) => d.id === lastDecisionClose.decisionId,
  );
  return (
    decision !== undefined &&
    decision.question.startsWith(REPORT_QUESTION_PREFIX["too-many-attempts"])
  );
}

/** The latest `Retry-After` deadline recorded for a scheduled task,
 * across every `fire-429` line, or undefined when none stands. */
function retryAfterOf(
  fire429: readonly Fire429Line[],
  trig: string,
): string | undefined {
  let latest: string | undefined;
  for (const line of fire429) {
    if (line.task !== trig) continue;
    if (latest === undefined || line.retryAfter > latest)
      latest = line.retryAfter;
  }
  return latest;
}

/**
 * What to fire and what to report, given the state a write just
 * produced, the settings, the journal's ledger lines, and the time.
 * Candidates come from `candidates(state)` in tree order, the same
 * order `task_next` offers them in, so a fire session and a session
 * pulling by hand race for the same first node rather than two
 * different ones.
 */
export function decideFires(
  state: State,
  settings: FireSettings,
  fired: readonly FiredLine[],
  fire429: readonly Fire429Line[],
  now: Date,
  decisionCloses: readonly DecisionCloseLine[] = [],
  lastDecisionClose: DecisionCloseLine | null = null,
): FirePlan {
  if (!settings.enabled) return NO_PLAN;

  const attempts: FireAttempt[] = [];
  const reports: FireReport[] = [];
  const nowIso = now.toISOString();
  const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();

  // Running counts: two attempts accepted in the same plan still
  // respect the hourly and daily caps against each other, not just
  // against the journal as it stood before this write.
  let perAccountHourlyCount = fired.filter((f) => f.ts > hourAgo).length;
  let perAccountDailyCount = fired.filter((f) => f.ts > dayAgo).length;
  const perTaskCount = new Map<string, number>();
  for (const f of fired) {
    if (f.ts <= hourAgo) continue;
    perTaskCount.set(f.task, (perTaskCount.get(f.task) ?? 0) + 1);
  }

  for (const candidate of candidates(state)) {
    if (attempts.length >= MAX_FIRES_PER_WRITE) break;
    // candidates() only ever answers a step from STEP_ROLES, whose
    // three values are exactly FireRole's.
    const role = candidate.role as FireRole;
    const repository = repositoryOf(candidate.node, state);
    const ref = settings.repositories.get(repository)?.[role];
    if (ref === undefined) {
      reports.push({
        node: candidate.node,
        reason: "no-task-configured",
        detail: `no scheduled task is configured for ${role} in ${repository}`,
      });
      continue;
    }

    const retryAfter = retryAfterOf(fire429, ref.trig);
    if (retryAfter !== undefined && retryAfter > nowIso) continue;

    const since = laterOf(
      lastCloseTimestamp(state, candidate.node.id),
      lastReportClosingTimestamp(state, decisionCloses, candidate.node.id),
    );
    const pairFired = fired.filter(
      (f) =>
        f.node === candidate.node.id &&
        f.step === candidate.step &&
        (since === null || f.ts > since),
    );
    if (pairFired.length >= 2) {
      reports.push({
        node: candidate.node,
        reason: "too-many-attempts",
        detail: `${candidate.node.id} ${candidate.step} has been fired twice since its last close with no task opened`,
      });
      continue;
    }
    if (pairFired.length === 1) {
      const minutesSinceLastFire =
        (now.getTime() - new Date(pairFired[0]!.ts).getTime()) / 60_000;
      if (minutesSinceLastFire < settings.checkAfterMinutes) continue;
    }

    if (suppressedByHandOff(candidate.node, state, lastDecisionClose)) continue;

    if ((perTaskCount.get(ref.trig) ?? 0) >= settings.perTaskHourlyCap)
      continue;
    if (perAccountHourlyCount >= settings.perAccountHourlyCap) continue;
    if (perAccountDailyCount >= settings.perAccountDailyCap) continue;

    attempts.push({
      node: candidate.node,
      step: candidate.step,
      role,
      repository,
      ref,
    });
    perTaskCount.set(ref.trig, (perTaskCount.get(ref.trig) ?? 0) + 1);
    perAccountHourlyCount += 1;
    perAccountDailyCount += 1;
  }

  return { attempts, reports };
}
