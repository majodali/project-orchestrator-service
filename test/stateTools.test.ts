import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { StateStore, WriteRefusedError } from "../src/model/store.js";
import type { State } from "../src/model/schema.js";
import { GitConflictError } from "../src/planRegister/gitWriter.js";
import { sampleState, stateJson } from "./support/states.js";
import {
  FAKE_MCP_TOKEN,
  FakePullRequests,
  FakeRepository,
  NOW,
  SHA_A,
  viewEnv,
} from "./support/view.js";

/**
 * The state tools and the store (the rebuild plan, milestone 3): every
 * write is one commit on the default branch with the state file, its
 * two renderings and one journal event; a write the invariants refuse
 * commits nothing; a branch that moved is read again once.
 */

const ORIGINAL_ENV = { ...process.env };

function repoWith(state: State): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", SHA_A);
  repo.setFile(SHA_A, "orchestration/state.json", stateJson(state));
  repo.setFile(
    SHA_A,
    "orchestration/journal.jsonl",
    '{"ts":"2026-10-01T00:00:00Z","event":"accepted","task":"T001"}\n',
  );
  return repo;
}

function appOver(repo: FakeRepository) {
  const store = new StateStore({ reader: repo, writer: repo, now: () => NOW });
  return createApp({
    state: { store, now: () => NOW, pullRequests: new FakePullRequests() },
  });
}

/** The tools a session may call only under a task or on the owner's
 * instruction. A test that gives neither writes as the owner
 * dictated, so that it tests the write and not the authority. */
const GUARDED = new Set([
  "node_update",
  "node_add",
  "node_remove",
  "decision_open",
  "decision_close",
]);
const AS_OWNER = "the owner dictated this change";

function withAuthority(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!GUARDED.has(name) || "task" in args || "ownerInstruction" in args) {
    return args;
  }
  return { ...args, ownerInstruction: AS_OWNER };
}

async function call(
  app: ReturnType<typeof createApp>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${FAKE_MCP_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: withAuthority(name, args) },
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result: {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
      content: Array<{ text: string }>;
    };
  };
  return body.result;
}

function stateAtHead(repo: FakeRepository): State {
  return JSON.parse(
    repo.files.get(repo.heads.get("main")!)!.get("orchestration/state.json")!,
  ) as State;
}

beforeEach(() => viewEnv());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("plan_read", () => {
  it("answers every node with its class at the commit, and one node in full", async () => {
    const repo = repoWith(sampleState());
    const app = appOver(repo);
    const all = await call(app, "plan_read");
    expect(all.isError).toBeUndefined();
    const content = all.structuredContent!;
    expect(content.sha).toBe(SHA_A);
    expect(
      (content.nodes as Array<{ id: string; class: string }>).map(
        (n) => `${n.id}:${n.class}`,
      ),
    ).toContain("P1-N003:gated");
    expect((content.openDecisions as unknown[]).length).toBe(2);
    expect(content.counts).toMatchObject({ gated: 2, done: 1 });

    const one = await call(app, "plan_read", { node: "P1-N002" });
    const node = one.structuredContent!.node as {
      tasks: unknown[];
      decisions: unknown[];
      neededBy: string[];
      classLabel: string;
    };
    expect(node.tasks).toHaveLength(2);
    expect(node.decisions).toHaveLength(1);
    expect(node.neededBy).toEqual(["P1-N006"]);
    expect(node.classLabel).toBe("done");

    const missing = await call(app, "plan_read", { node: "P9-N999" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]!.text).toContain("no node P9-N999");
  });
});

describe("node_update", () => {
  it("moves a node in one commit that carries the state file, both renderings and a journal event", async () => {
    const repo = repoWith(sampleState());
    const app = appOver(repo);
    const result = await call(app, "node_update", {
      nodeId: "P1-N006",
      stage: "executing",
      reason: "work started",
      session: "test-session",
    });
    expect(result.isError).toBeUndefined();
    const content = result.structuredContent!;
    expect(content.committed).toBe(true);
    expect(content.parentSha).toBe(SHA_A);
    expect(content.changes).toEqual(["stage specified -> executing"]);

    expect(repo.commits).toHaveLength(1);
    const commit = repo.commits[0]!;
    expect(commit.message).toBe(
      "P1-N006: work started (no task: the owner's instruction)",
    );
    expect([...commit.files.keys()].sort()).toEqual([
      "docs/plan-register.md",
      "docs/plan.md",
      "orchestration/journal.jsonl",
      "orchestration/state.json",
    ]);
    expect(repo.heads.get("main")).toBe(content.sha);
    expect(stateAtHead(repo).nodes.find((n) => n.id === "P1-N006")!.stage).toBe(
      "executing",
    );
    expect(commit.files.get("docs/plan-register.md")).toContain(
      "- P1-N006 [executing] The part that is ready",
    );
    const journal = commit.files
      .get("orchestration/journal.jsonl")!
      .trim()
      .split("\n");
    expect(journal).toHaveLength(2);
    expect(JSON.parse(journal[1]!)).toMatchObject({
      event: "state-written",
      node: "P1-N006",
      session: "test-session",
      ref: SHA_A,
      note: expect.stringContaining(
        "node_update P1-N006: stage specified -> executing",
      ),
    });
  });

  it("dates a node moved to done, lifts a hold, and changes start, outcome and dependencies", async () => {
    const repo = repoWith(sampleState());
    const app = appOver(repo);
    const done = await call(app, "node_update", {
      nodeId: "P1-N004",
      stage: "done",
      reason: "finished",
    });
    expect(done.isError).toBeUndefined();
    const n4 = stateAtHead(repo).nodes.find((n) => n.id === "P1-N004")!;
    expect(n4.done).toBe("2026-10-30");

    const lifted = await call(app, "node_update", {
      nodeId: "P1-N003",
      hold: null,
      start: "approve",
      outcome: "A new outcome sentence.",
      after: ["P1-N002"],
      reason: "the owner reviewed the plan",
    });
    expect(lifted.structuredContent!.changes).toEqual([
      "hold lifted",
      "start approve",
      "outcome",
      "after P1-N002",
    ]);
    const n3 = stateAtHead(repo).nodes.find((n) => n.id === "P1-N003")!;
    expect(n3.hold).toBeNull();
    expect(n3.start).toBe("approve");
    expect(n3.after).toEqual(["P1-N002"]);
  });

  it("refuses a change that violates an invariant, and commits nothing", async () => {
    const repo = repoWith(sampleState());
    const app = appOver(repo);
    // A child cannot be executing under a parent that is only planned.
    const result = await call(app, "node_update", {
      nodeId: "P1-N001",
      stage: "planned",
      reason: "oops",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("refused");
    expect(result.content[0]!.text).toContain("violation 3");
    expect(repo.commits).toHaveLength(0);

    const unknown = await call(app, "node_update", {
      nodeId: "P9-N999",
      stage: "done",
      reason: "oops",
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]!.text).toBe("no node P9-N999");

    const nothing = await call(app, "node_update", {
      nodeId: "P1-N002",
      reason: "nothing",
    });
    expect(nothing.isError).toBe(true);
    expect(nothing.content[0]!.text).toContain("nothing to change");
  });
});

describe("tasks and decisions", () => {
  it("answers, on task_open, the closed decisions on the node and its ancestors, and every standing decision wherever it arose", async () => {
    const state = sampleState();
    state.decisions.push(
      {
        id: "D020",
        node: "P1-N001",
        question: "Which runtime?",
        options: ["node"],
        default: "node",
        chosen: "node",
        decided: "2026-10-01",
        rationale: null,
        standing: false,
        source: null,
      },
      {
        id: "D021",
        node: null,
        question: "Which licence?",
        options: [],
        default: "MIT",
        chosen: "MIT",
        decided: "2026-10-01",
        rationale: null,
        standing: true,
        source: null,
      },
      {
        id: "D022",
        node: null,
        question: "A one-off project decision",
        options: [],
        default: "yes",
        chosen: "yes",
        decided: "2026-10-01",
        rationale: null,
        standing: false,
        source: null,
      },
    );
    const opened = await call(appOver(repoWith(state)), "task_open", {
      nodeId: "P1-N006",
      step: "execute",
    });
    expect(opened.isError).toBeUndefined();
    expect(
      (opened.structuredContent!.decisions as Array<{ id: string }>).map(
        (d) => d.id,
      ),
    ).toEqual(["D020"]);
    // RU-001 is standing and sits on another node; D021 on none. The
    // one-off project decision D022 is not a precedent.
    const standing = opened.structuredContent!.standing as Array<
      Record<string, unknown>
    >;
    expect(standing.map((d) => d.id)).toEqual(["RU-001", "D021"]);
    expect(Object.keys(standing[1]!).sort()).toEqual([
      "chosen",
      "id",
      "question",
      "source",
    ]);
  });

  it("opens and closes a task with the next identifier, one commit each", async () => {
    const repo = repoWith(sampleState());
    const app = appOver(repo);
    const opened = await call(app, "task_open", {
      nodeId: "P1-N006",
      step: "execute",
      role: "implementer",
      summary: "Build it.",
    });
    expect(opened.isError).toBeUndefined();
    expect(opened.structuredContent!.taskId).toBe("T004");

    const again = await call(app, "task_open", {
      nodeId: "P1-N006",
      step: "execute",
    });
    expect(again.isError).toBe(true);
    expect(again.content[0]!.text).toContain("task T004 is open on it");

    const closed = await call(app, "task_close", {
      taskId: "T004",
      status: "closed",
      summary: "Built it.",
      pr: "majodali/project-orchestrator-service#99",
      tokensIn: 1000,
      tokensOut: 200,
    });
    expect(closed.isError).toBeUndefined();
    const t = stateAtHead(repo).tasks.find((x) => x.id === "T004")!;
    expect(t).toMatchObject({
      status: "closed",
      pr: "majodali/project-orchestrator-service#99",
      tokens: { in: 1000, out: 200 },
    });
    expect(t.closed).toBe("2026-10-30T12:00:00Z");
    expect(repo.commits).toHaveLength(2);

    const twice = await call(app, "task_close", {
      taskId: "T004",
      status: "closed",
      summary: "again",
    });
    expect(twice.isError).toBe(true);
    expect(twice.content[0]!.text).toContain("not open");
  });

  it("opens a decision on a node or the project, and closes it with the answer", async () => {
    const repo = repoWith(sampleState());
    const app = appOver(repo);
    const opened = await call(app, "decision_open", {
      nodeId: null,
      question: "Which way?",
      default: "left",
      options: ["left", "right"],
    });
    expect(opened.structuredContent!.decisionId).toBe("D003");
    const closed = await call(app, "decision_close", {
      decisionId: "D003",
      chosen: "right",
      rationale: "the owner said so",
    });
    expect(closed.isError).toBeUndefined();
    const d = stateAtHead(repo).decisions.find((x) => x.id === "D003")!;
    expect(d).toMatchObject({
      chosen: "right",
      decided: "2026-10-30",
      rationale: "the owner said so",
      node: null,
    });

    const unknownNode = await call(app, "decision_open", {
      nodeId: "P9-N999",
      question: "?",
      default: "x",
    });
    expect(unknownNode.isError).toBe(true);
    const closedAgain = await call(app, "decision_close", {
      decisionId: "D003",
      chosen: "left",
    });
    expect(closedAgain.content[0]!.text).toContain("already closed");
  });
});

describe("the store", () => {
  it("retries once when the branch moved, then reports the conflict", async () => {
    const repo = repoWith(sampleState());
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    // Someone else commits between the read and the write, once.
    let moved = false;
    const original = repo.commitFiles.bind(repo);
    repo.commitFiles = async (request) => {
      if (!moved) {
        moved = true;
        await original({
          branch: "main",
          expectedHeadSha: request.expectedHeadSha,
          message: "someone else",
          files: new Map([["orchestration/journal.jsonl", "{}\n"]]),
        });
      }
      return original(request);
    };
    const result = await store.write("a write", (state) => {
      state.nodes[1]!.note = "touched";
      return { task: null, node: "P1-N002", session: null, note: "touched" };
    });
    expect(result.parentSha).not.toBe(SHA_A);
    expect(repo.commits).toHaveLength(2);
    expect(repo.commits[1]!.message).toBe("a write");

    // Moving every time exhausts the one retry.
    repo.commitFiles = async (request) => {
      await original({
        branch: "main",
        expectedHeadSha: request.expectedHeadSha,
        message: "someone else again",
        files: new Map([["orchestration/journal.jsonl", "{}\n"]]),
      });
      return original(request);
    };
    await expect(
      store.write("another", (state) => {
        state.nodes[1]!.note = "again";
        return { task: null, node: null, session: null, note: "again" };
      }),
    ).rejects.toBeInstanceOf(GitConflictError);
  });

  it("refuses to write when the file at the head does not validate, and surfaces a mutation's own refusal", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    repo.setFile(SHA_A, "orchestration/state.json", "not json");
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    await expect(
      store.write("x", () => ({
        task: null,
        node: null,
        session: null,
        note: "x",
      })),
    ).rejects.toThrow(/does not validate/);

    const good = repoWith(sampleState());
    const store2 = new StateStore({
      reader: good,
      writer: good,
      now: () => NOW,
    });
    await expect(
      store2.write("x", () => {
        throw new WriteRefusedError([]);
      }),
    ).rejects.toBeInstanceOf(WriteRefusedError);
    expect(good.commits).toHaveLength(0);
  });
});
