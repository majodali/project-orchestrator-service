/**
 * The fire check (P2-N048): the I/O glue around `decideFires`. Called
 * once after every write a session's tool call commits
 * (src/stateTools.ts) — never on a timer or a poll (criterion 1).
 * Reads the state and the settings at the commit the triggering write
 * just produced, decides what to fire and what to report, then writes
 * the journal's `fired` line *before* calling the endpoint (criterion
 * 2), records a 429's `Retry-After`, and opens a decision for whatever
 * the plan could not fire for lack of a configured task or too many
 * bare attempts (design 2 and 3).
 *
 * A failure anywhere here — an unreadable settings file, a network
 * error, a 500 from the endpoint — is swallowed by the caller, not by
 * this module: the triggering write already committed, so a fire that
 * fails leaves the plan correct and the work merely unstarted (design
 * 1), never a reason to fail the tool call that got us here.
 *
 * A role and repository with no scheduled task configured
 * (`no-task-configured`) is logged, not opened as a decision: D122
 * sets up only some role/repository pairs at first, so this is the
 * ordinary case for the rest, and an open decision would gate the
 * node for every session until the owner merely acknowledges it
 * (owner, 2026-11-24, the T250 rework). `too-many-attempts` is a real
 * anomaly — a node fired twice with nothing claiming it — and keeps
 * gating the node with a decision, as design 3's "the third case is
 * reported to the owner" already did.
 */

import { nextDecisionId } from "../model/loop.js";
import type { Decision, State } from "../model/schema.js";
import type { StateStore } from "../model/store.js";
import { GithubFetchError } from "../planRegister/registerFetcher.js";
import type { CommitReader } from "../planRegister/registerFetcher.js";
import {
  ACKNOWLEDGE_ANSWER,
  decideFires,
  REPORT_QUESTION_PREFIX,
  RUN_NOW_ANSWER,
  type FireAttempt,
  type FireReport,
} from "./decide.js";
import { FireHttpError, type FireFn } from "./client.js";
import {
  lastLineDecisionClose,
  parseDecisionCloses,
  parseJournal,
} from "./ledger.js";
import { parseFireSettings } from "./settings.js";

const SETTINGS_PATH = "orchestration/orchestrator.json";

export interface FireRuntime {
  /** Reads `orchestration/orchestrator.json` from the project's own,
   * coordinating repository (the only repository it lives in). */
  readonly settingsReader: CommitReader;
  readonly getToken: (secretName: string) => Promise<string>;
  readonly fire: FireFn;
  readonly now: () => Date;
}

async function readSettingsAt(reader: CommitReader, sha: string) {
  try {
    const text = await reader.readFileAtSha(sha, SETTINGS_PATH);
    return parseFireSettings(text);
  } catch (err) {
    if (err instanceof GithubFetchError && err.status === 404) {
      return parseFireSettings(null);
    }
    throw err;
  }
}

function fireText(attempt: FireAttempt, sha: string): string {
  return `Node ${attempt.node.id}, step ${attempt.step}, repository ${attempt.repository}, commit ${sha}.`;
}

function isoNoMillis(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function hasOpenReport(state: State, nodeId: string): boolean {
  const prefix = REPORT_QUESTION_PREFIX["too-many-attempts"];
  return state.decisions.some(
    (d) =>
      d.node === nodeId && d.chosen === null && d.question.startsWith(prefix),
  );
}

/** Opens a decision for the one report reason that is a real anomaly
 * (`too-many-attempts`): a node fired twice with nothing claiming it.
 * `no-task-configured` never reaches here — see `runFireCheck` below. */
async function reportToOwner(
  store: StateStore,
  report: FireReport,
  session: string | null,
): Promise<void> {
  await store.write(
    `${report.node.id}: fire reported to the owner`,
    (state) => {
      const id = nextDecisionId(state);
      const decision: Decision = {
        id,
        node: report.node.id,
        question: `${REPORT_QUESTION_PREFIX[report.reason]}: ${report.detail}.`,
        options: [ACKNOWLEDGE_ANSWER, RUN_NOW_ANSWER],
        default: ACKNOWLEDGE_ANSWER,
        chosen: null,
        decided: null,
        rationale:
          "Opened by the service's fire check (P2-N048, design 2 and 3).",
        standing: false,
        source: null,
      };
      state.decisions.push(decision);
      return {
        task: null,
        node: report.node.id,
        session,
        note: `fire reported on ${report.node.id} (${decision.id}): ${report.detail}`,
      };
    },
  );
}

/**
 * Runs one fire check against the store's current head. `session` is
 * the session whose write this check follows — the one the `fired`
 * line and any report name, never the session a fire goes on to
 * create.
 */
export async function runFireCheck(
  store: StateStore,
  runtime: FireRuntime,
  trigger: { session: string | null },
): Promise<void> {
  const read = await store.read();
  if (read.state === null) return;
  const state = read.state;

  const settings = await readSettingsAt(runtime.settingsReader, read.sha);
  if (!settings.enabled) return;

  const journalText = await store.readJournalAt(read.sha);
  const { fired, fire429 } = parseJournal(journalText);
  const decisionCloses = parseDecisionCloses(journalText);
  const lastDecisionClose = lastLineDecisionClose(journalText);
  const now = runtime.now();
  const plan = decideFires(
    state,
    settings,
    fired,
    fire429,
    now,
    decisionCloses,
    lastDecisionClose,
  );

  for (const report of plan.reports) {
    if (report.reason === "no-task-configured") {
      // The ordinary case while D122 leaves most role/repository
      // pairs unconfigured: logged for the owner to see in the
      // function's logs, never a decision that would gate the node
      // for every session until merely acknowledged.
      console.log(`fire: ${report.node.id} not fired: ${report.detail}`);
      continue;
    }
    if (hasOpenReport(state, report.node.id)) continue;
    await reportToOwner(store, report, trigger.session);
  }

  for (const attempt of plan.attempts) {
    // Written before the HTTP call (criterion 2): a crash between the
    // two loses a fire rather than risking a second one for the same
    // attempt.
    const firedTs = isoNoMillis(now);
    await store.appendJournalLine(
      `fire ${attempt.node.id} ${attempt.step}`,
      () =>
        JSON.stringify({
          ts: firedTs,
          event: "fired",
          node: attempt.node.id,
          step: attempt.step,
          task: attempt.ref.trig,
          session: trigger.session,
        }),
    );
    try {
      const token = await runtime.getToken(attempt.ref.secret);
      const response = await runtime.fire(
        attempt.ref.trig,
        token,
        fireText(attempt, read.sha),
      );
      // Tied to the `fired` line just written by matching `ts`,
      // `node`, `step` and `task`: the session a fire started
      // (provenance gap D127 / P2-N047's record; owner, 2026-11-24,
      // note (b)). Today that identifier was discarded.
      await store.appendJournalLine(
        `fire-session ${attempt.node.id} ${attempt.step}`,
        () =>
          JSON.stringify({
            ts: firedTs,
            event: "fired-session",
            node: attempt.node.id,
            step: attempt.step,
            task: attempt.ref.trig,
            sessionId: response.claudeCodeSessionId,
            sessionUrl: response.claudeCodeSessionUrl,
          }),
      );
    } catch (err) {
      if (err instanceof FireHttpError && err.status === 429) {
        const retryAfterSeconds = err.retryAfterSeconds ?? 3600;
        const retryAfter = new Date(
          now.getTime() + retryAfterSeconds * 1000,
        ).toISOString();
        await store.appendJournalLine(`fire 429 ${attempt.ref.trig}`, () =>
          JSON.stringify({
            ts: runtime
              .now()
              .toISOString()
              .replace(/\.\d{3}Z$/, "Z"),
            event: "fire-429",
            task: attempt.ref.trig,
            retryAfter,
          }),
        );
      }
      // Any other failure (network, 4xx/5xx besides 429): the fired
      // line already written stands, and the next write's fire check
      // may try this node and step again, subject to the same
      // checkAfterMinutes and twice-since-last-close rules.
    }
  }
}
