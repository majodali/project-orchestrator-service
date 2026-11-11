import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { checkState } from "../src/model/check.js";
import {
  TASK_TIME_LIMIT_HOURS,
  candidates,
  offerOn,
  scopeOf,
} from "../src/model/loop.js";
import { StateStore } from "../src/model/store.js";
import type { State } from "../src/model/schema.js";
import {
  decision,
  node,
  sampleState,
  stateJson,
  task,
} from "./support/states.js";
import {
  FAKE_MCP_TOKEN,
  FakeRepository,
  NOW,
  SHA_A,
  viewEnv,
} from "./support/view.js";

/**
 * The task loop (the rebuild plan, "The loop and the close-out"):
 * which node `task_next` answers, the claim, and the close-out that
 * moves nodes and raises check nodes, decisions and holds.
 */

const ORIGINAL_ENV = { ...process.env };

function repoWith(state: State): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", SHA_A);
  repo.setFile(SHA_A, "orchestration/state.json", stateJson(state));
  return repo;
}

function appOver(repo: FakeRepository, now: () => Date = () => NOW) {
  const store = new StateStore({ reader: repo, writer: repo, now });
  return createApp({ state: { store, now } });
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
      params: { name, arguments: args },
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

/** A small plan: a broken-down root with one done child and two to do,
 * the second waiting for the first. */
function plan(): State {
  return {
    schema: 0,
    project: "majodali/project-orchestrator",
    nodes: [
      node({ id: "P1-N001", title: "The line of work", stage: "broken-down" }),
      node({
        id: "P1-N002",
        title: "The done part",
        stage: "done",
        parent: "P1-N001",
        done: "2026-10-01",
      }),
      node({
        id: "P1-N003",
        title: "The part to build",
        stage: "specified",
        parent: "P1-N001",
        docs: { plan: "docs/plans/first.md", spec: "docs/specs/third.md" },
      }),
      node({
        id: "P1-N004",
        title: "The part to plan",
        stage: "identified",
        parent: "P1-N001",
        after: ["P1-N003"],
        outcome: null,
      }),
    ],
    tasks: [],
    decisions: [
      decision({
        id: "D001",
        node: "P1-N001",
        question: "Which runtime?",
        default: "node",
        chosen: "node",
        decided: "2026-10-01",
      }),
    ],
  };
}

beforeEach(() => viewEnv());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("what a node offers", () => {
  it("offers the step its stage admits, and nothing when held, gated, waiting, taken or questioned", () => {
    const state = sampleState();
    const offer = (id: string) =>
      offerOn(
        state.nodes.find((n) => n.id === id)!,
        state,
      );
    expect(offer("P1-N006")).toEqual({
      offered: true,
      steps: ["execute", "break down"],
      role: "implementer",
    });
    expect(offer("P1-N005")).toMatchObject({
      offered: false,
      why: { reason: "dependency", pending: ["P1-N004"] },
    });
    expect(offer("P1-N003")).toMatchObject({ why: { reason: "hold" } });
    expect(offer("P1-N007")).toMatchObject({ why: { reason: "hold" } });
    expect(offer("P1-N008")).toMatchObject({ why: { reason: "approval" } });
    expect(offer("P1-N004")).toMatchObject({
      why: { reason: "open-task", task: "T002" },
    });
    expect(offer("P1-N001")).toMatchObject({ why: { reason: "in-progress" } });
    expect(offer("P1-N002")).toMatchObject({ why: { reason: "done" } });
    expect(offer("P2-N001")).toMatchObject({ why: { reason: "parked" } });
  });

  it("passes a node by when a decision is open on it, and a child when its parent waits", () => {
    const state = plan();
    state.decisions.push(
      decision({
        id: "D002",
        node: "P1-N003",
        question: "Which?",
        default: "a",
      }),
    );
    expect(
      offerOn(
        state.nodes.find((n) => n.id === "P1-N003")!,
        state,
      ),
    ).toMatchObject({ why: { reason: "open-decision", decisions: ["D002"] } });
    const waiting = plan();
    waiting.nodes.push(
      node({ id: "P2-N001", title: "An earlier line", stage: "specified" }),
    );
    waiting.nodes[0]!.after = ["P2-N001"];
    expect(
      offerOn(
        waiting.nodes.find((n) => n.id === "P1-N003")!,
        waiting,
      ),
    ).toMatchObject({ why: { reason: "dependency", pending: ["P2-N001"] } });
  });

  it("lists the candidates in tree order, filtered by role", () => {
    const all = candidates(sampleState()).map((c) => `${c.node.id} ${c.step}`);
    expect(all).toEqual(["P1-N006 execute"]);
    expect(candidates(sampleState(), "planner")).toEqual([]);
    const state = plan();
    expect(
      candidates(state).map((c) => `${c.node.id} ${c.step} ${c.role}`),
    ).toEqual(["P1-N003 execute implementer"]);
  });
});

describe("task_next", () => {
  it("answers the first candidate with its brief, and the next candidates", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    const next = await call(app, "task_next", { role: "implementer" });
    expect(next.isError).toBeUndefined();
    const content = next.structuredContent!;
    expect(content.sha).toBe(SHA_A);
    const brief = content.next as {
      node: { id: string; class: string };
      step: string;
      role: string;
      ancestors: Array<{ id: string }>;
      documents: { plan: string; spec: string };
      decisions: Array<{ id: string }>;
      tasks: unknown[];
    };
    expect(brief.node.id).toBe("P1-N003");
    expect(brief.node.class).toBe("actionable");
    expect(brief.step).toBe("execute");
    expect(brief.role).toBe("implementer");
    expect(brief.ancestors.map((a) => a.id)).toEqual(["P1-N001"]);
    expect(brief.documents.spec).toBe(
      `https://github.com/majodali/project-orchestrator/blob/${SHA_A}/docs/specs/third.md`,
    );
    expect(brief.decisions.map((d) => d.id)).toEqual(["D001"]);
    expect(content.candidates).toEqual([
      {
        id: "P1-N003",
        title: "The part to build",
        step: "execute",
        role: "implementer",
      },
    ]);
    expect(repo.commits).toHaveLength(0);

    const none = await call(app, "task_next", { role: "reviewer" });
    expect(none.structuredContent!.next).toBeNull();
    expect(none.structuredContent!.message).toContain("for reviewer");
  });

  it("closes a task open past the time limit as stale first, in one commit", async () => {
    const state = plan();
    const opened = new Date(
      NOW.getTime() - (TASK_TIME_LIMIT_HOURS + 1) * 3600 * 1000,
    )
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    state.tasks.push(
      task({
        id: "T001",
        node: "P1-N003",
        status: "open",
        opened,
        closed: null,
        summary: null,
      }),
    );
    const repo = repoWith(state);
    const next = await call(appOver(repo), "task_next");
    expect(next.structuredContent!.staleClosed).toEqual(["T001"]);
    expect(repo.commits).toHaveLength(1);
    const t = stateAtHead(repo).tasks[0]!;
    expect(t.status).toBe("stale");
    expect(t.closed).toBe("2026-10-30T12:00:00Z");
    expect(t.summary).toContain("stale");
    // The node is free again, so it is the answer.
    expect(
      (next.structuredContent!.next as { node: { id: string } }).node.id,
    ).toBe("P1-N003");
  });
});

describe("the claim and the close-out", () => {
  it("moves a node from specified to done through execute and verify, with a check node between", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    const opened = await call(app, "task_open", {
      nodeId: "P1-N003",
      step: "execute",
      session: "session one",
    });
    expect(opened.isError).toBeUndefined();
    expect(opened.structuredContent!.taskId).toBe("T001");
    expect(opened.structuredContent!.moved).toEqual(["P1-N003 executing"]);
    let s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N003")!.stage).toBe("executing");
    expect(s.tasks[0]).toMatchObject({
      id: "T001",
      base: SHA_A,
      role: "implementer",
      status: "open",
    });

    // The node offers nothing while the task is open.
    const busy = await call(app, "task_next", { role: "implementer" });
    expect(busy.structuredContent!.next).toBeNull();

    const closed = await call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Built the part.",
      pr: "majodali/project-orchestrator#40",
    });
    expect(closed.isError).toBeUndefined();
    expect(closed.structuredContent!.nodeStage).toBe("verifying");
    expect(closed.structuredContent!.moved).toEqual([
      "P1-N003 verifying, check node P1-N005",
    ]);
    expect(closed.structuredContent!.stop).toBeNull();
    s = stateAtHead(repo);
    const check = s.nodes.find((n) => n.id === "P1-N005")!;
    expect(check).toMatchObject({
      kind: "check",
      parent: "P1-N003",
      stage: "specified",
      title: "Verification of The part to build",
      docs: { plan: "docs/plans/first.md", spec: "docs/specs/third.md" },
    });
    expect(checkState(s).findings).toEqual([]);

    // The reviewer's turn is the check node.
    const review = await call(app, "task_next", { role: "reviewer" });
    const brief = review.structuredContent!.next as {
      node: { id: string };
      step: string;
      ancestors: Array<{ id: string }>;
    };
    expect(brief.node.id).toBe("P1-N005");
    expect(brief.step).toBe("verify");
    expect(brief.ancestors.map((a) => a.id)).toEqual(["P1-N001", "P1-N003"]);
    const implementer = await call(app, "task_next", { role: "implementer" });
    expect(implementer.structuredContent!.next).toBeNull();

    const verifying = await call(app, "task_open", {
      nodeId: "P1-N005",
      step: "verify",
      session: "session two",
    });
    expect(verifying.structuredContent!.taskId).toBe("T002");
    const verified = await call(app, "task_close", {
      taskId: "T002",
      status: "closed",
      summary: "Meets its outcome.",
    });
    expect(verified.structuredContent!.moved).toEqual([
      "P1-N005 done",
      "P1-N003 done 2026-10-30",
    ]);
    s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N003")).toMatchObject({
      stage: "done",
      done: "2026-10-30",
    });
    expect(s.nodes.find((n) => n.id === "P1-N005")!.stage).toBe("done");
    // P1-N004 waited for P1-N003 and is now the planner's.
    const planner = await call(app, "task_next", { role: "planner" });
    expect(
      planner.structuredContent!.next as { node: { id: string }; step: string },
    ).toMatchObject({ node: { id: "P1-N004" }, step: "plan" });
    expect(repo.commits).toHaveLength(4);
    const journal = repo.files
      .get(repo.heads.get("main")!)!
      .get("orchestration/journal.jsonl")!
      .trim()
      .split("\n")
      .map(
        (l) => JSON.parse(l) as { task: string; session: string; note: string },
      );
    expect(journal.map((e) => `${e.task} ${e.session}`)).toEqual([
      "T001 session one",
      "T001 null",
      "T002 session two",
      "T002 null",
    ]);
  });

  it("completes a broken-down parent when its last work child is done: the parent enters verifying", async () => {
    const state = plan();
    // Leave one child to do.
    state.nodes = state.nodes.filter((n) => n.id !== "P1-N004");
    const repo = repoWith(state);
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N003", step: "execute" });
    await call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Built.",
    });
    await call(app, "task_open", { nodeId: "P1-N004", step: "verify" });
    const done = await call(app, "task_close", {
      taskId: "T002",
      status: "closed",
      summary: "Verified.",
    });
    expect(done.structuredContent!.moved).toEqual([
      "P1-N004 done",
      "P1-N003 done 2026-10-30",
      "P1-N001 verifying, check node P1-N005",
    ]);
    const s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N001")!.stage).toBe("verifying");
    expect(s.nodes.find((n) => n.id === "P1-N005")).toMatchObject({
      kind: "check",
      parent: "P1-N001",
    });
    expect(checkState(s).findings).toEqual([]);
  });

  it("hands a failed verification back for rework, and the rework starts a new round", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N003", step: "execute" });
    await call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Built.",
    });
    await call(app, "task_open", { nodeId: "P1-N005", step: "verify" });
    const failed = await call(app, "task_close", {
      taskId: "T002",
      status: "blocked",
      summary: "The outcome is not met: no tests.",
    });
    expect(failed.structuredContent!.moved).toEqual(["P1-N005 held blocked"]);
    expect(failed.structuredContent!.stop).toContain("blocked");
    let s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N005")!.hold).toEqual({
      kind: "blocked",
      reason: "T002: The outcome is not met: no tests.",
    });
    // The parent stays verifying and offers the rework.
    const next = await call(app, "task_next", { role: "implementer" });
    expect(next.structuredContent!.next).toMatchObject({
      node: { id: "P1-N003", stage: "verifying", class: "actionable" },
      step: "execute",
    });
    await call(app, "task_open", { nodeId: "P1-N003", step: "execute" });
    const reworked = await call(app, "task_close", {
      taskId: "T003",
      status: "closed",
      summary: "Tests added.",
    });
    expect(reworked.structuredContent!.moved).toEqual([
      "P1-N005 specified again",
    ]);
    s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N005")).toMatchObject({
      stage: "specified",
      hold: null,
    });
    expect(checkState(s).findings).toEqual([]);
    const review = await call(app, "task_next", { role: "reviewer" });
    expect(
      (review.structuredContent!.next as { node: { id: string } }).node.id,
    ).toBe("P1-N005");
  });

  it("moves plan, specify and break down steps, and refuses a step the node does not offer", async () => {
    const state = plan();
    state.nodes.find((n) => n.id === "P1-N004")!.after = [];
    const repo = repoWith(state);
    const app = appOver(repo);
    const wrong = await call(app, "task_open", {
      nodeId: "P1-N004",
      step: "execute",
    });
    expect(wrong.isError).toBe(true);
    expect(wrong.content[0]!.text).toContain("offers plan, not execute");
    await call(app, "task_open", { nodeId: "P1-N004", step: "plan" });
    // A planned node needs an outcome: the plan step delivers it at close.
    const refused = await call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Planned.",
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("no outcome sentence");
    const planned = await call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Planned.",
      outcome: "The part is planned.",
      docs: { plan: "docs/plans/fourth.md" },
    });
    expect(planned.isError).toBeUndefined();
    expect(
      stateAtHead(repo).nodes.find((n) => n.id === "P1-N004"),
    ).toMatchObject({
      stage: "planned",
      outcome: "The part is planned.",
      docs: { plan: "docs/plans/fourth.md", spec: null },
    });
    await call(app, "task_open", { nodeId: "P1-N004", step: "specify" });
    await call(app, "task_close", {
      taskId: "T002",
      status: "closed",
      summary: "Specified.",
      docs: { spec: "docs/specs/fourth.md" },
    });
    expect(
      stateAtHead(repo).nodes.find((n) => n.id === "P1-N004"),
    ).toMatchObject({
      stage: "specified",
      docs: { plan: "docs/plans/fourth.md", spec: "docs/specs/fourth.md" },
    });
    await call(app, "task_open", { nodeId: "P1-N004", step: "break down" });
    const added = await call(app, "node_add", {
      parentId: "P1-N004",
      title: "The first piece",
      outcome: "The first piece exists.",
      stage: "specified",
    });
    expect(added.structuredContent!.nodeId).toBe("P1-N005");
    await call(app, "task_close", {
      taskId: "T003",
      status: "closed",
      summary: "Broken down.",
    });
    const s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N004")!.stage).toBe("broken-down");
    expect(s.nodes.find((n) => n.id === "P1-N005")).toMatchObject({
      kind: "work",
      parent: "P1-N004",
      stage: "specified",
    });
    expect(checkState(s).findings).toEqual([]);
  });

  it("refuses a claim that another session's claim beat, with nothing committed twice", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    // Another session's claim lands between this call's read and its commit.
    let raced = false;
    repo.afterResolve = () => {
      if (raced) return;
      raced = true;
      const other = plan();
      other.tasks.push(
        task({
          id: "T001",
          node: "P1-N003",
          status: "open",
          closed: null,
          summary: null,
        }),
      );
      const sha = "f".repeat(40);
      repo.setFile(sha, "orchestration/state.json", stateJson(other));
      repo.heads.set("main", sha);
    };
    const claim = await call(app, "task_open", {
      nodeId: "P1-N003",
      step: "execute",
    });
    expect(claim.isError).toBe(true);
    expect(claim.content[0]!.text).toContain("task T001 is open on it");
    expect(repo.commits).toHaveLength(0);
  });

  it("opens the asks as decisions on the node and tells the session to stop", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N003", step: "execute" });
    const closed = await call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Built, with one question.",
      asks: [
        {
          question: "Keep the old route?",
          options: ["yes", "no"],
          default: "no",
        },
      ],
    });
    expect(closed.structuredContent!.decisionsOpened).toEqual(["D002"]);
    expect(closed.structuredContent!.stop).toContain("D002 opened on P1-N003");
    const s = stateAtHead(repo);
    expect(s.decisions.find((d) => d.id === "D002")).toMatchObject({
      node: "P1-N003",
      question: "Keep the old route?",
      options: ["yes", "no"],
      default: "no",
      chosen: null,
    });
    // The check node was still raised; the node itself waits on the owner
    // for anything further, and the check node is not: review proceeds.
    expect(s.nodes.find((n) => n.id === "P1-N003")!.stage).toBe("verifying");
    const next = await call(app, "task_next", { role: "reviewer" });
    expect(
      (next.structuredContent!.next as { node: { id: string } }).node.id,
    ).toBe("P1-N005");
  });

  it("holds the node for the owner on blocked and needs-judgment", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N003", step: "execute" });
    const blocked = await call(app, "task_close", {
      taskId: "T001",
      status: "needs-judgment",
      summary: "Two designs fit; the owner picks.",
    });
    expect(blocked.structuredContent!.stop).toContain("judgment");
    const n = stateAtHead(repo).nodes.find((x) => x.id === "P1-N003")!;
    expect(n.stage).toBe("executing");
    expect(n.hold).toEqual({
      kind: "gated",
      reason: "T001: Two designs fit; the owner picks.",
    });
    const next = await call(app, "task_next");
    expect(next.structuredContent!.next).toBeNull();
  });

  it("closes a task whose node's scope changed as needs-judgment, whatever status was given", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N003", step: "execute" });
    await call(app, "node_update", {
      nodeId: "P1-N003",
      reason: "the owner narrowed it",
      outcome: "A smaller part exists.",
    });
    const closed = await call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Built the part as first described.",
    });
    expect(closed.structuredContent!.status).toBe("needs-judgment");
    expect(closed.structuredContent!.stop).toContain("scope changed");
    const s = stateAtHead(repo);
    expect(s.tasks[0]!.summary).toContain("Scope changed during T001");
    expect(s.nodes.find((n) => n.id === "P1-N003")).toMatchObject({
      stage: "executing",
      hold: { kind: "gated" },
    });
    expect(s.nodes.some((n) => n.kind === "check")).toBe(false);
  });

  it("keeps a task from before the loop closable: no base, no scope check", async () => {
    const state = plan();
    state.tasks.push(
      task({
        id: "T001",
        node: "P1-N003",
        status: "open",
        closed: null,
        summary: null,
      }),
    );
    const repo = repoWith(state);
    const closed = await call(appOver(repo), "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Done the old way.",
    });
    expect(closed.structuredContent!.status).toBe("closed");
    expect(closed.structuredContent!.nodeStage).toBe("verifying");
  });

  it("scopes a node by its title, outcome, parent, dependencies and documents only", () => {
    const a = node({ id: "P1-N001", title: "A node", stage: "specified" });
    const b = {
      ...a,
      stage: "executing" as const,
      note: "changed",
      hold: null,
    };
    expect(scopeOf(a)).toBe(scopeOf(b));
    expect(scopeOf({ ...a, outcome: "other" })).not.toBe(scopeOf(a));
  });
});

describe("node_add", () => {
  it("adds a root in a named line and a child in its parent's, and refuses a root without a line", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    const root = await call(app, "node_add", {
      parentId: null,
      line: "P2",
      title: "A new line of work",
      outcome: null,
    });
    expect(root.structuredContent!.nodeId).toBe("P2-N001");
    const child = await call(app, "node_add", {
      parentId: "P1-N001",
      title: "Another part",
      outcome: "Another part exists.",
      after: ["P1-N003"],
      start: "approve",
    });
    expect(child.structuredContent!.nodeId).toBe("P1-N005");
    const s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N005")).toMatchObject({
      parent: "P1-N001",
      after: ["P1-N003"],
      start: "approve",
      stage: "identified",
    });
    const bad = await call(app, "node_add", {
      parentId: null,
      title: "No line",
      outcome: null,
    });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toContain("plan line");
  });
});

describe("the owner's acceptance", () => {
  it("marks the open check node done when the owner moves the node to done", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N003", step: "execute" });
    await call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Built.",
    });
    const accepted = await call(app, "node_update", {
      nodeId: "P1-N003",
      reason: "accepted by the owner",
      stage: "done",
    });
    expect(accepted.structuredContent!.changes).toEqual([
      "stage verifying -> done",
      "P1-N005 done",
    ]);
    const s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N005")).toMatchObject({
      stage: "done",
      done: "2026-10-30",
    });
    expect(checkState(s).findings).toEqual([]);
  });
});
