import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import type { FireResponse } from "../src/fire/client.js";
import type { FireRuntime } from "../src/fire/run.js";
import { StateStore } from "../src/model/store.js";
import type { State } from "../src/model/schema.js";
import { node, sampleState, stateJson } from "./support/states.js";
import {
  FakePullRequests,
  FakeRepository,
  NOW,
  SHA_A,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The view's own writes run the fire check too (P2-N048, design 1;
 * the T250 rework): a decision answered or a node action taken here
 * is a write exactly like a session's tool call, so it is followed by
 * the same check, over the same store.
 */

const ORIGINAL_ENV = { ...process.env };

const OK_RESPONSE: FireResponse = {
  type: "routine_fire",
  claudeCodeSessionId: "session_fired",
  claudeCodeSessionUrl: "https://claude.ai/code/session_fired",
};

const FIRE_SETTINGS = {
  fire: {
    enabled: true,
    repositories: {
      "majodali/project-orchestrator": {
        planner: { trig: "trig_planner", secret: "fire/planner" },
      },
    },
  },
};

/** A single held node, planned, with no open decision of its own: the
 * smallest state from which lifting the hold alone moves it straight
 * to offering `specify` for `planner` (unlike P1-N003 of
 * `sampleState()`, which also carries an open decision, D001, that
 * keeps it gated after the hold is lifted). */
function heldPlannedState(): State {
  return {
    schema: 0,
    project: "majodali/project-orchestrator",
    nodes: [
      node({
        id: "P1-N001",
        title: "The part the owner reviews",
        stage: "planned",
        hold: { kind: "gated", reason: "owner review of the plan" },
      }),
    ],
    tasks: [],
    decisions: [],
  };
}

function repoWithFireSettings(state: State = sampleState()): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", SHA_A);
  repo.setFile(SHA_A, "orchestration/state.json", stateJson(state));
  repo.setFile(SHA_A, "orchestration/journal.jsonl", "");
  repo.setFile(
    SHA_A,
    "orchestration/orchestrator.json",
    JSON.stringify(FIRE_SETTINGS),
  );
  return repo;
}

function journalAtHead(repo: FakeRepository): Record<string, unknown>[] {
  const sha = repo.heads.get("main")!;
  const text = repo.files.get(sha)!.get("orchestration/journal.jsonl") ?? "";
  return text
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l));
}

function post(
  app: ReturnType<typeof createApp>,
  path: string,
  fields: Record<string, string>,
) {
  const body = new URLSearchParams(fields).toString();
  return app.request(path, {
    method: "POST",
    headers: {
      Cookie: validCookie(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

beforeEach(() => viewEnv());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("the fire check after the view's own writes", () => {
  it("fires the scheduled task once a lifted hold offers specify for planner (lift-hold)", async () => {
    const repo = repoWithFireSettings(heldPlannedState());
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    const calls: { trigId: string; token: string; text: string }[] = [];
    const fire: FireRuntime = {
      settingsReader: repo,
      getToken: async () => "sk-ant-oat01-fake",
      fire: async (trigId, token, text) => {
        calls.push({ trigId, token, text });
        return OK_RESPONSE;
      },
      now: () => NOW,
    };
    const app = createApp({
      view: {
        reader: repo,
        store,
        pullRequests: new FakePullRequests(),
        now: () => NOW,
        fire,
      },
    });

    const res = await post(app, "/view/node/P1-N001/action", {
      action: "lift-hold",
      note: "plan reviewed",
    });

    expect(res.status).toBe(303);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.trigId).toBe("trig_planner");
    const fired = journalAtHead(repo).filter((l) => l.event === "fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      node: "P1-N001",
      step: "specify",
      session: "the owner, in the view",
    });
  });

  it("fires after closing a decision too", async () => {
    const repo = repoWithFireSettings();
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    let fireCalls = 0;
    const fire: FireRuntime = {
      settingsReader: repo,
      getToken: async () => "sk-ant-oat01-fake",
      fire: async () => {
        fireCalls += 1;
        return OK_RESPONSE;
      },
      now: () => NOW,
    };
    const app = createApp({
      view: {
        reader: repo,
        store,
        pullRequests: new FakePullRequests(),
        now: () => NOW,
        fire,
      },
    });

    // D001 is on P1-N003, which is held; closing it alone does not
    // move the node, but the fire check still runs over the write.
    const res = await post(app, "/view/decision/D001/close", {
      chosen: "git",
    });

    expect(res.status).toBe(303);
    // No step is newly offered (the node is still held), so nothing
    // fires, but the check ran without upsetting the write.
    expect(fireCalls).toBe(0);
  });

  it("never lets a fire-check failure undo or fail the write", async () => {
    const repo = repoWithFireSettings(heldPlannedState());
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    const fire: FireRuntime = {
      settingsReader: repo,
      getToken: async () => {
        throw new Error("secrets manager unreachable");
      },
      fire: async () => OK_RESPONSE,
      now: () => NOW,
    };
    const app = createApp({
      view: {
        reader: repo,
        store,
        pullRequests: new FakePullRequests(),
        now: () => NOW,
        fire,
      },
    });

    const res = await post(app, "/view/node/P1-N001/action", {
      action: "lift-hold",
      note: "plan reviewed",
    });

    expect(res.status).toBe(303);
    // The hold-lift itself committed, and the fired line committed
    // before the token read failed (criterion 2): a lost fire, not a
    // reason to fail or undo the write.
    expect(repo.commits).toHaveLength(2);
    const fired = journalAtHead(repo).filter((l) => l.event === "fired");
    expect(fired).toHaveLength(1);
  });

  it("does not fire when no fire runtime resolves (no fire option, project unreachable in tests)", async () => {
    const repo = repoWithFireSettings(heldPlannedState());
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    const app = createApp({
      view: {
        reader: repo,
        store,
        pullRequests: new FakePullRequests(),
        now: () => NOW,
      },
    });

    const res = await post(app, "/view/node/P1-N001/action", {
      action: "lift-hold",
      note: "plan reviewed",
    });

    expect(res.status).toBe(303);
    expect(repo.commits).toHaveLength(1);
    const fired = journalAtHead(repo).filter((l) => l.event === "fired");
    expect(fired).toHaveLength(0);
  });
});
