import { describe, expect, it, vi } from "vitest";

import type { FireResponse } from "../src/fire/client.js";
import { FireHttpError } from "../src/fire/client.js";
import { parseJournal } from "../src/fire/ledger.js";
import { runFireCheck, type FireRuntime } from "../src/fire/run.js";
import { StateStore } from "../src/model/store.js";
import type { State } from "../src/model/schema.js";
import { FakeRepository, NOW, SHA_A } from "./support/view.js";
import { decision, node, stateJson } from "./support/states.js";

const PROJECT = "majodali/project-orchestrator";
const SERVICE_REPO = "majodali/project-orchestrator-service";

function baseState(): State {
  return {
    schema: 0,
    project: PROJECT,
    nodes: [
      node({
        id: "P2-N001",
        title: "A node that offers execute",
        stage: "specified",
        repository: SERVICE_REPO,
      }),
    ],
    tasks: [],
    decisions: [],
  };
}

function repoWith(
  state: State,
  orchestratorJson?: Record<string, unknown>,
): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", SHA_A);
  repo.setFile(SHA_A, "orchestration/state.json", stateJson(state));
  repo.setFile(SHA_A, "orchestration/journal.jsonl", "");
  if (orchestratorJson) {
    repo.setFile(
      SHA_A,
      "orchestration/orchestrator.json",
      JSON.stringify(orchestratorJson),
    );
  }
  return repo;
}

function fakeRuntime(
  repo: FakeRepository,
  fire: FireRuntime["fire"],
  now: () => Date = () => NOW,
): FireRuntime {
  return {
    settingsReader: repo,
    getToken: async () => "sk-ant-oat01-fake",
    fire,
    now,
  };
}

const ENABLED_SETTINGS = {
  fire: {
    enabled: true,
    repositories: {
      [SERVICE_REPO]: {
        implementer: { trig: "trig_impl", secret: "fire/impl" },
      },
    },
  },
};

function journalAt(repo: FakeRepository): string {
  return repo.files
    .get(repo.heads.get("main")!)!
    .get("orchestration/journal.jsonl")!;
}

function stateAt(repo: FakeRepository): State {
  return JSON.parse(
    repo.files.get(repo.heads.get("main")!)!.get("orchestration/state.json")!,
  ) as State;
}

const OK_RESPONSE: FireResponse = {
  type: "routine_fire",
  claudeCodeSessionId: "session_fired",
  claudeCodeSessionUrl: "https://claude.ai/code/session_fired",
};

describe("runFireCheck", () => {
  it("does nothing when the settings file has no fire section", async () => {
    const repo = repoWith(baseState());
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    let fireCalls = 0;
    await runFireCheck(
      store,
      fakeRuntime(repo, async () => {
        fireCalls += 1;
        return OK_RESPONSE;
      }),
      { session: "session_x" },
    );
    expect(fireCalls).toBe(0);
    expect(repo.commits).toHaveLength(0);
  });

  it("writes the fired journal line before calling the endpoint, then fires", async () => {
    const repo = repoWith(baseState(), ENABLED_SETTINGS);
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    const callsAtFireTime: number[] = [];
    let captured: { trigId: string; token: string; text: string } | undefined;
    await runFireCheck(
      store,
      fakeRuntime(repo, async (trigId, token, text) => {
        callsAtFireTime.push(repo.commits.length);
        captured = { trigId, token, text };
        return OK_RESPONSE;
      }),
      { session: "session_x" },
    );

    // The journal commit landed before the endpoint was called.
    expect(callsAtFireTime).toEqual([1]);
    expect(captured?.trigId).toBe("trig_impl");
    expect(captured?.token).toBe("sk-ant-oat01-fake");
    expect(captured?.text).toContain("P2-N001");

    const { fired, firedSession } = parseJournal(journalAt(repo));
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      node: "P2-N001",
      step: "execute",
      task: "trig_impl",
      session: "session_x",
    });

    // A second line records the session the call started, tied to
    // the fired line above by node, step, task and ts.
    expect(firedSession).toHaveLength(1);
    expect(firedSession[0]).toEqual({
      ts: fired[0]?.ts,
      node: "P2-N001",
      step: "execute",
      task: "trig_impl",
      sessionId: "session_fired",
      sessionUrl: "https://claude.ai/code/session_fired",
    });
  });

  it("writes no fired-session line when the call fails", async () => {
    const repo = repoWith(baseState(), ENABLED_SETTINGS);
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    await runFireCheck(
      store,
      fakeRuntime(repo, async () => {
        throw new Error("network blip");
      }),
      { session: "session_x" },
    );
    const { fired, firedSession } = parseJournal(journalAt(repo));
    expect(fired).toHaveLength(1);
    expect(firedSession).toHaveLength(0);
  });

  it("records a 429's Retry-After and does not fire again before it passes", async () => {
    const repo = repoWith(baseState(), ENABLED_SETTINGS);
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    let fireCalls = 0;
    const flakyFire: FireRuntime["fire"] = async () => {
      fireCalls += 1;
      throw new FireHttpError("rate limited", 429, 1800, "");
    };

    await runFireCheck(store, fakeRuntime(repo, flakyFire), { session: null });
    expect(fireCalls).toBe(1);
    const { fired, fire429 } = parseJournal(journalAt(repo));
    expect(fired).toHaveLength(1);
    expect(fire429).toHaveLength(1);
    expect(fire429[0]?.task).toBe("trig_impl");

    // The node and step are still eligible (no second fired line, no
    // open task), but the 429's Retry-After has not passed yet.
    await runFireCheck(store, fakeRuntime(repo, flakyFire), { session: null });
    expect(fireCalls).toBe(1);
  });

  it("fires again once a recorded 429's Retry-After has passed", async () => {
    const repo = repoWith(baseState(), {
      checkAfterMinutes: 1,
      ...ENABLED_SETTINGS,
    });
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    let fireCalls = 0;
    await runFireCheck(
      store,
      fakeRuntime(repo, async () => {
        fireCalls += 1;
        throw new FireHttpError("rate limited", 429, 60, "");
      }),
      { session: null },
    );
    expect(fireCalls).toBe(1);

    const later = new Date(NOW.getTime() + 2 * 60 * 1000);
    await runFireCheck(
      store,
      fakeRuntime(
        repo,
        async () => {
          fireCalls += 1;
          return OK_RESPONSE;
        },
        () => later,
      ),
      { session: null },
    );
    expect(fireCalls).toBe(2);
  });

  it("logs, rather than opening a decision, when no scheduled task is configured for the offered role (T250 rework)", async () => {
    // D122 leaves most role/repository pairs unconfigured at first, so
    // this is the ordinary case, not an anomaly: a decision here would
    // gate the node for every session until merely acknowledged.
    const repo = repoWith(baseState(), {
      fire: { enabled: true, repositories: {} },
    });
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    let fireCalls = 0;
    const runtime = fakeRuntime(repo, async () => {
      fireCalls += 1;
      return OK_RESPONSE;
    });
    const logged: unknown[][] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logged.push(args);
    });

    await runFireCheck(store, runtime, { session: null });
    await runFireCheck(store, runtime, { session: null });

    logSpy.mockRestore();
    expect(fireCalls).toBe(0);
    expect(repo.commits).toHaveLength(0); // nothing committed: no decision opened
    const state = stateAt(repo);
    expect(state.decisions.filter((d) => d.node === "P2-N001")).toHaveLength(0);
    expect(
      logged.some((args) =>
        String(args[0]).includes("no scheduled task is configured"),
      ),
    ).toBe(true);
  });

  it("still opens a decision, once, when two bare fires stand with nothing claimed (a real anomaly)", async () => {
    const repo = repoWith(baseState(), ENABLED_SETTINGS);
    repo.setFile(
      SHA_A,
      "orchestration/journal.jsonl",
      [
        JSON.stringify({
          ts: "2026-10-30T10:00:00Z",
          event: "fired",
          node: "P2-N001",
          step: "execute",
          task: "trig_impl",
          session: null,
        }),
        JSON.stringify({
          ts: "2026-10-30T11:00:00Z",
          event: "fired",
          node: "P2-N001",
          step: "execute",
          task: "trig_impl",
          session: null,
        }),
      ].join("\n"),
    );
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    let fireCalls = 0;
    const runtime = fakeRuntime(repo, async () => {
      fireCalls += 1;
      return OK_RESPONSE;
    });

    await runFireCheck(store, runtime, { session: null });
    await runFireCheck(store, runtime, { session: null });

    expect(fireCalls).toBe(0);
    const reports = stateAt(repo).decisions.filter(
      (d) =>
        d.node === "P2-N001" &&
        d.question.startsWith("Fire: too many bare attempts"),
    );
    expect(reports).toHaveLength(1); // not duplicated on the second check
  });

  it("recovers from an acknowledged too-many-attempts report: fires once, then re-reports after two further bare fires (P2-N082, criteria 2 and 3)", async () => {
    const state = baseState();
    state.decisions.push(
      decision({
        id: "D173",
        node: "P2-N001",
        question:
          "Fire: too many bare attempts: P2-N001 execute has been fired twice since its last close with no task opened.",
        options: ["acknowledge", "fire it by hand with Run now"],
        default: "acknowledge",
        chosen: "acknowledge",
        decided: "2026-11-27",
      }),
    );
    const repo = repoWith(state, ENABLED_SETTINGS);
    // Shaped like P2-N033's own record on 2026-11-27: two bare fires,
    // then the owner's answer closing the report that gated it — the
    // journal's last line, as it always is right after that write.
    repo.setFile(
      SHA_A,
      "orchestration/journal.jsonl",
      [
        JSON.stringify({
          ts: "2026-11-27T09:05:41Z",
          event: "fired",
          node: "P2-N001",
          step: "execute",
          task: "trig_impl",
          session: null,
        }),
        JSON.stringify({
          ts: "2026-11-27T11:06:20Z",
          event: "fired",
          node: "P2-N001",
          step: "execute",
          task: "trig_impl",
          session: null,
        }),
        JSON.stringify({
          ts: "2026-11-27T11:22:31Z",
          event: "state-written",
          task: null,
          node: "P2-N001",
          stage: null,
          role: null,
          model: null,
          session: null,
          ref: SHA_A,
          note: "decision_close D173: acknowledge",
        }),
      ].join("\n"),
    );
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    let fireCalls = 0;
    const fire: FireRuntime["fire"] = async () => {
      fireCalls += 1;
      return OK_RESPONSE;
    };
    const openReportsOn = (nodeId: string) =>
      stateAt(repo).decisions.filter(
        (d) =>
          d.node === nodeId &&
          d.chosen === null &&
          d.question.startsWith("Fire: too many bare attempts"),
      );

    // The write that closes the report: fires the node once, and
    // opens no new report (criterion 2).
    await runFireCheck(
      store,
      fakeRuntime(repo, fire, () => new Date("2026-11-27T11:22:35Z")),
      { session: null },
    );
    expect(fireCalls).toBe(1);
    expect(openReportsOn("P2-N001")).toHaveLength(0);

    // A second bare attempt, past checkAfterMinutes: only one fire
    // stands since the restart, so it fires again rather than report.
    await runFireCheck(
      store,
      fakeRuntime(repo, fire, () => new Date("2026-11-27T12:08:35Z")),
      { session: null },
    );
    expect(fireCalls).toBe(2);
    expect(openReportsOn("P2-N001")).toHaveLength(0);

    // A third bare attempt: two fires now stand since the restart, so
    // this one is reported instead of fired — the same rule as the
    // first time (criterion 3).
    await runFireCheck(
      store,
      fakeRuntime(repo, fire, () => new Date("2026-11-27T12:09:00Z")),
      { session: null },
    );
    expect(fireCalls).toBe(2);
    expect(openReportsOn("P2-N001")).toHaveLength(1);
  });

  it('does not fire on the write that closes a report with "fire it by hand with Run now", but fires again on the next write (P2-N082, criterion 4)', async () => {
    const state = baseState();
    state.decisions.push(
      decision({
        id: "D175",
        node: "P2-N001",
        question:
          "Fire: too many bare attempts: P2-N001 execute has been fired twice since its last close with no task opened.",
        options: ["acknowledge", "fire it by hand with Run now"],
        default: "acknowledge",
        chosen: "fire it by hand with Run now",
        decided: "2026-11-27",
      }),
    );
    const repo = repoWith(state, ENABLED_SETTINGS);
    repo.setFile(
      SHA_A,
      "orchestration/journal.jsonl",
      [
        JSON.stringify({
          ts: "2026-11-27T09:05:41Z",
          event: "fired",
          node: "P2-N001",
          step: "execute",
          task: "trig_impl",
          session: null,
        }),
        JSON.stringify({
          ts: "2026-11-27T11:06:20Z",
          event: "fired",
          node: "P2-N001",
          step: "execute",
          task: "trig_impl",
          session: null,
        }),
        JSON.stringify({
          ts: "2026-11-27T11:22:31Z",
          event: "state-written",
          task: null,
          node: "P2-N001",
          stage: null,
          role: null,
          model: null,
          session: null,
          ref: SHA_A,
          note: "decision_close D175: fire it by hand with Run now",
        }),
      ].join("\n"),
    );
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    let fireCalls = 0;
    const fire: FireRuntime["fire"] = async () => {
      fireCalls += 1;
      return OK_RESPONSE;
    };

    // The write that closes the report with "Run now": the owner said
    // they would fire it, so the service does not.
    await runFireCheck(
      store,
      fakeRuntime(repo, fire, () => new Date("2026-11-27T11:22:35Z")),
      { session: null },
    );
    expect(fireCalls).toBe(0);

    // Some unrelated write happens — all that matters is that it is
    // not the decision's own closing write any more.
    await store.appendJournalLine("an unrelated write", () =>
      JSON.stringify({
        ts: "2026-11-27T11:30:00Z",
        event: "fired",
        node: "P9-N999",
        step: "plan",
        task: "trig_other",
        session: null,
      }),
    );

    // The next write after that: the hand-off no longer suppresses
    // firing, so the node fires normally again.
    await runFireCheck(
      store,
      fakeRuntime(repo, fire, () => new Date("2026-11-27T11:30:05Z")),
      { session: null },
    );
    expect(fireCalls).toBe(1);
  });

  it("leaves a fire's failure (other than 429) for the next check to retry", async () => {
    const repo = repoWith(baseState(), ENABLED_SETTINGS);
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    await runFireCheck(
      store,
      fakeRuntime(repo, async () => {
        throw new Error("network blip");
      }),
      { session: null },
    );
    // The fired line was still written before the failed call.
    const { fired } = parseJournal(journalAt(repo));
    expect(fired).toHaveLength(1);
  });
});
