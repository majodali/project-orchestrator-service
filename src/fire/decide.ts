/**
 * The fire decision (P2-N048, design 1, 3 and 4): pure, synchronous,
 * no I/O — `src/fire/run.ts` reads the state, the settings and the
 * journal and hands them here, then carries out whatever this
 * decides. Kept separate so the three no-fire rules and the two caps
 * are each testable without a store, a secret or a network call
 * (mirrors `plugin/scripts/lib/orchestrate.ts`'s own split in the
 * coordinating repository).
 */

import { candidates, repositoryOf } from "../model/loop.js";
import type { Node, State, Step } from "../model/schema.js";
import type { Fire429Line, FiredLine } from "./ledger.js";
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

    const since = lastCloseTimestamp(state, candidate.node.id);
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
