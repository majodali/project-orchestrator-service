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
 */

import { nextDecisionId } from "../model/loop.js";
import type { Decision, State } from "../model/schema.js";
import type { StateStore } from "../model/store.js";
import { GithubFetchError } from "../planRegister/registerFetcher.js";
import type { CommitReader } from "../planRegister/registerFetcher.js";
import { decideFires, type FireAttempt, type FireReport } from "./decide.js";
import { FireHttpError, type FireFn } from "./client.js";
import { parseJournal } from "./ledger.js";
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

const REPORT_QUESTION_PREFIX: Record<FireReport["reason"], string> = {
  "no-task-configured": "Fire: no scheduled task is configured",
  "too-many-attempts": "Fire: too many bare attempts",
};

function hasOpenReport(
  state: State,
  nodeId: string,
  reason: FireReport["reason"],
): boolean {
  const prefix = REPORT_QUESTION_PREFIX[reason];
  return state.decisions.some(
    (d) =>
      d.node === nodeId && d.chosen === null && d.question.startsWith(prefix),
  );
}

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
        options: ["acknowledge", "fire it by hand with Run now"],
        default: "acknowledge",
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
  const now = runtime.now();
  const plan = decideFires(state, settings, fired, fire429, now);

  for (const report of plan.reports) {
    if (hasOpenReport(state, report.node.id, report.reason)) continue;
    await reportToOwner(store, report, trigger.session);
  }

  for (const attempt of plan.attempts) {
    // Written before the HTTP call (criterion 2): a crash between the
    // two loses a fire rather than risking a second one for the same
    // attempt.
    await store.appendJournalLine(
      `fire ${attempt.node.id} ${attempt.step}`,
      () =>
        JSON.stringify({
          ts: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
          event: "fired",
          node: attempt.node.id,
          step: attempt.step,
          task: attempt.ref.trig,
          session: trigger.session,
        }),
    );
    try {
      const token = await runtime.getToken(attempt.ref.secret);
      await runtime.fire(attempt.ref.trig, token, fireText(attempt, read.sha));
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
