import { describe, expect, it } from "vitest";

import type { FireResponse } from "../src/fire/client.js";
import { FireHttpError } from "../src/fire/client.js";
import { parseJournal } from "../src/fire/ledger.js";
import { runFireCheck, type FireRuntime } from "../src/fire/run.js";
import { StateStore } from "../src/model/store.js";
import type { State } from "../src/model/schema.js";
import { FakeRepository, NOW, SHA_A } from "./support/view.js";
import { node, stateJson } from "./support/states.js";

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

    const { fired } = parseJournal(journalAt(repo));
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      node: "P2-N001",
      step: "execute",
      task: "trig_impl",
      session: "session_x",
    });
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

  it("opens a decision, once, when no scheduled task is configured for the offered role", async () => {
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

    await runFireCheck(store, runtime, { session: null });
    await runFireCheck(store, runtime, { session: null });

    expect(fireCalls).toBe(0);
    const state = stateAt(repo);
    const reports = state.decisions.filter(
      (d) =>
        d.node === "P2-N001" &&
        d.question.startsWith("Fire: no scheduled task"),
    );
    expect(reports).toHaveLength(1); // not duplicated on the second check
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
