import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/httpApp.js";
import { checkState, classifyAll } from "../src/model/check.js";
import { candidates, offerOn } from "../src/model/loop.js";
import { renderPlan } from "../src/model/render.js";
import { StateStore } from "../src/model/store.js";
import type { State } from "../src/model/schema.js";
import { summarizeCheckRuns } from "../src/planRegister/commitChecks.js";
import {
  GithubAppPullRequests,
  NotMergeableError,
  ensureMerged,
} from "../src/planRegister/pullRequests.js";
import { SERVER_INSTRUCTIONS } from "../src/stateTools.js";
import { decision, node, stateJson, task } from "./support/states.js";
import {
  FAKE_MCP_TOKEN,
  FakePullRequests,
  FakeRepository,
  NOW,
  SHA_A,
  attributeText,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The fixes of 2026-11-11, after the loop's first real use: a hold or
 * a park pauses what is below it; an obsolete node is removed; a node
 * is done only when its pull requests are merged, and the service
 * merges them; every standing decision reaches a task; `node_update`
 * can move a node to verifying; a session is told the protocol; the
 * view shows the commit's check status.
 */

const ORIGINAL_ENV = { ...process.env };
const PR = "majodali/project-orchestrator#40";

function plan(): State {
  return {
    schema: 0,
    project: "majodali/project-orchestrator",
    nodes: [
      node({ id: "P1-N001", title: "The line of work", stage: "broken-down" }),
      node({
        id: "P1-N002",
        title: "The part to build",
        stage: "specified",
        parent: "P1-N001",
      }),
      node({
        id: "P1-N003",
        title: "The part to plan",
        stage: "identified",
        parent: "P1-N001",
        after: ["P1-N002"],
        outcome: null,
      }),
      node({ id: "P2-N001", title: "Another line", stage: "broken-down" }),
      node({
        id: "P2-N002",
        title: "Its only part",
        stage: "specified",
        parent: "P2-N001",
      }),
    ],
    tasks: [],
    decisions: [],
  };
}

function repoWith(state: State): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", SHA_A);
  repo.setFile(SHA_A, "orchestration/state.json", stateJson(state));
  return repo;
}

function appOver(repo: FakeRepository, pullRequests = new FakePullRequests()) {
  const store = new StateStore({ reader: repo, writer: repo, now: () => NOW });
  return createApp({
    state: { store, now: () => NOW, pullRequests },
    view: { reader: repo, store, pullRequests, now: () => NOW },
  });
}

async function rpc(
  app: ReturnType<typeof createApp>,
  method: string,
  params: Record<string, unknown>,
) {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${FAKE_MCP_TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await res.json()) as { result: Record<string, unknown> };
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
  const body = await rpc(app, "tools/call", {
    name,
    arguments: withAuthority(name, args),
  });
  return body.result as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content: Array<{ text: string }>;
  };
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

describe("a hold or a park above", () => {
  it("pauses everything below a held node and below a parked one", () => {
    const state = plan();
    state.nodes[0]!.hold = {
      kind: "gated",
      reason: "the owner reviews the line",
    };
    state.nodes[3]!.stage = "parked";
    const classes = classifyAll(state);
    expect(classes.get("P1-N001")).toBe("gated");
    expect(classes.get("P1-N002")).toBe("paused");
    expect(classes.get("P1-N003")).toBe("paused");
    expect(classes.get("P2-N002")).toBe("paused");
    expect(offerOn(state.nodes[1]!, state)).toEqual({
      offered: false,
      why: {
        reason: "paused",
        by: "P1-N001",
        how: "held gated: the owner reviews the line",
      },
    });
    expect(offerOn(state.nodes[4]!, state)).toMatchObject({
      why: { reason: "paused", by: "P2-N001", how: "parked" },
    });
    expect(candidates(state)).toEqual([]);
    expect(renderPlan(state)).toContain(
      "## Paused by a hold or a park above\n\n- The part to build (P1-N002) [specified] — under The line of work (P1-N001)",
    );
  });

  it("leaves a plan with nothing paused rendering as before, and refuses a claim under a hold", async () => {
    expect(renderPlan(plan())).not.toContain("Paused");
    const state = plan();
    state.nodes[0]!.hold = { kind: "blocked", reason: "no budget" };
    const claim = await call(appOver(repoWith(state)), "task_open", {
      nodeId: "P1-N002",
      step: "execute",
    });
    expect(claim.isError).toBe(true);
    expect(claim.content[0]!.text).toContain(
      "P1-N001 above it is held blocked: no budget",
    );
  });

  it("shows what pauses a node in the tree", async () => {
    const state = plan();
    state.nodes[3]!.stage = "parked";
    const res = await appOver(repoWith(state)).request("/view?open=all", {
      headers: { Cookie: validCookie() },
    });
    const html = await res.text();
    expect(html).toContain('data-paused-by="P2-N001"');
    expect(html).toContain("paused by Another line (P2-N001), parked");
  });
});

describe("node_remove", () => {
  it("removes a node with its subtree, tasks and decisions, drops dependencies on it, and climbs", async () => {
    const state = plan();
    state.nodes[1]!.stage = "done";
    state.nodes[1]!.done = "2026-10-01";
    state.nodes[2]!.after = [];
    state.nodes[4]!.after = ["P1-N003"];
    state.tasks.push(task({ id: "T001", node: "P1-N003" }));
    state.decisions.push(
      decision({
        id: "D001",
        node: "P1-N003",
        question: "Keep it?",
        default: "no",
        chosen: "no",
        decided: "2026-10-01",
      }),
    );
    const repo = repoWith(state);
    const removed = await call(appOver(repo), "node_remove", {
      nodeId: "P1-N003",
      reason: "superseded by the rebuilt loop",
      session: "session one",
    });
    expect(removed.isError).toBeUndefined();
    expect(removed.structuredContent).toMatchObject({
      removed: ["P1-N003"],
      tasks: ["T001"],
      decisions: ["D001"],
      unlinked: ["P2-N002 no longer waits for P1-N003"],
      // Its last open sibling gone, the parent's work is all done.
      moved: ["P1-N001 verifying, check node P1-N004"],
    });
    const s = stateAtHead(repo);
    expect(s.nodes.some((n) => n.id === "P1-N003")).toBe(false);
    expect(s.tasks).toEqual([]);
    expect(s.decisions).toEqual([]);
    expect(s.nodes.find((n) => n.id === "P2-N002")!.after).toEqual([]);
    // No identifier is reused: the check node took P1-N004, not the
    // removed P1-N003, and the next task and decision skip theirs.
    expect(s.highWater).toEqual({ P1: 3, T: 1, D: 1 });
    expect(checkState(s).findings).toEqual([]);
    expect(repo.commits[0]!.message).toBe(
      "P1-N003 removed: superseded by the rebuilt loop (no task: the owner's instruction)",
    );
    expect(
      repo.files
        .get(repo.heads.get("main")!)!
        .get("orchestration/journal.jsonl"),
    ).toContain('node_remove P1-N003 \\"The part to plan\\"');
    const opened = await call(appOver(repo), "decision_open", {
      nodeId: null,
      question: "A new question?",
      default: "yes",
    });
    expect(opened.structuredContent!.decisionId).toBe("D002");
  });

  it("removes a whole subtree, and refuses while a task is open under it", async () => {
    const state = plan();
    state.tasks.push(
      task({ id: "T001", node: "P2-N002", status: "open", closed: null }),
    );
    const repo = repoWith(state);
    const app = appOver(repo);
    const refused = await call(app, "node_remove", {
      nodeId: "P2-N001",
      reason: "the line is obsolete",
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain(
      "task T001 is open under P2-N001",
    );
    expect(repo.commits).toHaveLength(0);
    const ok = await call(app, "node_remove", {
      nodeId: "P1-N001",
      reason: "the line is obsolete",
    });
    expect(ok.structuredContent!.removed).toEqual([
      "P1-N001",
      "P1-N002",
      "P1-N003",
    ]);
    expect(stateAtHead(repo).nodes.map((n) => n.id)).toEqual([
      "P2-N001",
      "P2-N002",
    ]);
  });
});

describe("node_update and verifying", () => {
  it("raises the check node when a node is moved to verifying, and removes it when the node is moved back", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    const up = await call(app, "node_update", {
      nodeId: "P1-N002",
      reason: "built outside the loop",
      stage: "verifying",
    });
    expect(up.isError).toBeUndefined();
    expect(up.structuredContent!.changes).toEqual([
      "stage specified -> verifying",
      "check node P1-N004",
    ]);
    let s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N004")).toMatchObject({
      kind: "check",
      parent: "P1-N002",
      stage: "specified",
    });
    expect(checkState(s).findings).toEqual([]);
    const back = await call(app, "node_update", {
      nodeId: "P1-N002",
      reason: "not built after all",
      stage: "executing",
    });
    expect(back.structuredContent!.changes).toEqual([
      "stage verifying -> executing",
      "P1-N004 removed",
    ]);
    s = stateAtHead(repo);
    expect(s.nodes.some((n) => n.kind === "check")).toBe(false);
    expect(checkState(s).findings).toEqual([]);
  });
});

describe("done needs the pull request merged", () => {
  async function built(app: ReturnType<typeof createApp>) {
    await call(app, "task_open", { nodeId: "P1-N002", step: "execute" });
    return call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Built.",
      pr: PR,
    });
  }

  it("leaves an execute step's pull request open at its close, and merges it when the verification closes", async () => {
    const prs = new FakePullRequests();
    const repo = repoWith(plan());
    const app = appOver(repo, prs);
    const closed = await built(app);
    expect(closed.structuredContent).toMatchObject({ pr: PR, merged: [] });
    expect(prs.merges).toEqual([]);
    await call(app, "task_open", { nodeId: "P1-N004", step: "verify" });
    const verified = await call(app, "task_close", {
      taskId: "T002",
      status: "closed",
      summary: "Meets its outcome.",
    });
    expect(verified.isError).toBeUndefined();
    expect(verified.structuredContent!.merged).toEqual([PR]);
    expect(prs.merges).toEqual([PR]);
    expect(stateAtHead(repo).nodes.find((n) => n.id === "P1-N002")!.stage).toBe(
      "done",
    );
  });

  it("refuses the verification's close, with nothing committed, while the pull request cannot be merged", async () => {
    const prs = new FakePullRequests();
    const repo = repoWith(plan());
    const app = appOver(repo, prs);
    await built(app);
    await call(app, "task_open", { nodeId: "P1-N004", step: "verify" });
    const before = repo.commits.length;
    prs.set(PR, { mergeableState: "unstable" });
    const refused = await call(app, "task_close", {
      taskId: "T002",
      status: "closed",
      summary: "Meets its outcome.",
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain(
      `${PR} cannot be merged: its checks are failing or still running`,
    );
    expect(refused.content[0]!.text).toContain("Nothing was committed");
    expect(repo.commits).toHaveLength(before);
    expect(stateAtHead(repo).tasks.find((t) => t.id === "T002")!.status).toBe(
      "open",
    );
    // A failed verification merges nothing.
    const failed = await call(app, "task_close", {
      taskId: "T002",
      status: "blocked",
      summary: "No tests.",
    });
    expect(failed.isError).toBeUndefined();
    expect(prs.merges).toEqual([]);
  });

  it("merges a planning step's pull request at its close, and opens one for a branch", async () => {
    const prs = new FakePullRequests();
    const state = plan();
    state.nodes[2]!.after = [];
    const repo = repoWith(state);
    const app = appOver(repo, prs);
    await call(app, "task_open", { nodeId: "P1-N003", step: "plan" });
    const planned = await call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Planned.",
      outcome: "The part is planned.",
      branch: "plan-the-part",
    });
    expect(planned.isError).toBeUndefined();
    expect(prs.created).toEqual([
      {
        repo: "majodali/project-orchestrator",
        branch: "plan-the-part",
        title: "P1-N003 plan: The part to plan",
      },
    ]);
    expect(planned.structuredContent).toMatchObject({
      pr: "majodali/project-orchestrator#901",
      merged: ["majodali/project-orchestrator#901"],
    });
    expect(stateAtHead(repo).tasks[0]!.pr).toBe(
      "majodali/project-orchestrator#901",
    );
  });

  it("merges on the owner's acceptance in the view, and on node_update to done", async () => {
    const prs = new FakePullRequests();
    const repo = repoWith(plan());
    const app = appOver(repo, prs);
    await built(app);
    prs.set(PR, { mergeableState: "dirty" });
    const post = () =>
      app.request("/view/node/P1-N002/action", {
        method: "POST",
        headers: {
          Cookie: validCookie(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "action=accept-review",
      });
    const refused = await post();
    expect(refused.status).toBe(409);
    expect(attributeText(await refused.text(), "data-error")).toContain(
      `${PR} cannot be merged: it conflicts with its base branch`,
    );
    expect(stateAtHead(repo).nodes.find((n) => n.id === "P1-N002")!.stage).toBe(
      "verifying",
    );
    prs.set(PR, { mergeableState: "clean" });
    const accepted = await post();
    expect(accepted.status).toBe(303);
    expect(prs.merges).toEqual([PR]);
    expect(stateAtHead(repo).nodes.find((n) => n.id === "P1-N002")!.stage).toBe(
      "done",
    );

    // The same rule on node_update: an already merged one is not merged twice.
    const repo2 = repoWith(plan());
    const prs2 = new FakePullRequests();
    const app2 = appOver(repo2, prs2);
    await built(app2);
    prs2.set(PR, { open: false, merged: true });
    const done = await call(app2, "node_update", {
      nodeId: "P1-N002",
      reason: "accepted",
      stage: "done",
    });
    expect(done.isError).toBeUndefined();
    expect(prs2.merges).toEqual([]);
  });

  it("waits briefly for GitHub to compute mergeability, and names each reason a pull request cannot merge", async () => {
    const prs = new FakePullRequests();
    let asked = 0;
    const get = prs.get.bind(prs);
    prs.get = async (ref) => {
      asked += 1;
      return {
        ...(await get(ref)),
        mergeableState: asked < 3 ? "unknown" : "clean",
      };
    };
    const waits: number[] = [];
    const result = await ensureMerged(
      () => prs,
      [PR, PR],
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(result).toEqual({ merged: [PR], already: [] });
    expect(waits).toEqual([1000, 1000]);
    const closed = new FakePullRequests();
    closed.set(PR, { open: false });
    await expect(ensureMerged(() => closed, [PR])).rejects.toThrow(
      "it was closed without merging",
    );
    const draft = new FakePullRequests();
    draft.set(PR, { draft: true });
    await expect(ensureMerged(() => draft, [PR])).rejects.toBeInstanceOf(
      NotMergeableError,
    );
    // Nothing to merge builds no client at all.
    await expect(
      ensureMerged(() => {
        throw new Error("not configured");
      }, []),
    ).resolves.toEqual({ merged: [], already: [] });
  });
});

describe("GithubAppPullRequests", () => {
  it("reads, merges with the head it read, and opens a pull request into the default branch", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (path.endsWith("/pulls/40") && method === "GET") {
        return Response.json({
          state: "open",
          merged: false,
          draft: false,
          mergeable_state: "clean",
          head: { sha: "abc" },
        });
      }
      if (path.endsWith("/pulls/40/merge")) return Response.json({ sha: "m1" });
      if (path === "/repos/majodali/project-orchestrator")
        return Response.json({ default_branch: "main" });
      if (path.endsWith("/pulls") && method === "POST")
        return Response.json({ number: 41 }, { status: 201 });
      return new Response("no", { status: 403 });
    });
    const client = new GithubAppPullRequests(
      async () => "fake-token",
      fetchImpl,
    );
    expect(await client.get(PR)).toEqual({
      ref: PR,
      open: true,
      merged: false,
      draft: false,
      mergeableState: "clean",
      headSha: "abc",
    });
    expect(await client.merge(PR, "abc")).toEqual({ sha: "m1" });
    expect(calls[1]).toEqual({
      method: "PUT",
      path: "/repos/majodali/project-orchestrator/pulls/40/merge",
      body: { sha: "abc", merge_method: "merge" },
    });
    expect(
      await client.create({
        repo: "majodali/project-orchestrator",
        branch: "a-branch",
        title: "t",
        body: "b",
      }),
    ).toBe("majodali/project-orchestrator#41");
    expect(calls[3]!.body).toEqual({
      head: "a-branch",
      base: "main",
      title: "t",
      body: "b",
    });
    await expect(client.get("majodali/other#1")).rejects.toThrow(
      "the GitHub App needs `Pull requests: Read and write`",
    );
  });
});

describe("what a session is told", () => {
  it("sends the loop's protocol as the server's instructions, and lists eleven tools", async () => {
    const app = appOver(repoWith(plan()));
    const init = await rpc(app, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(init.result.instructions).toBe(SERVER_INSTRUCTIONS);
    for (const word of [
      "task_next",
      "task_open",
      "task_close",
      "node_remove",
      "Never edit",
    ]) {
      expect(SERVER_INSTRUCTIONS).toContain(word);
    }
    const tools = await rpc(app, "tools/list", {});
    expect((tools.result.tools as unknown[]).length).toBe(11);
  });
});

describe("the commit's check status in the view", () => {
  it("summarizes check runs: failing names the checks, running and passing say so", () => {
    expect(summarizeCheckRuns([])).toEqual({ state: "none", failing: [] });
    expect(
      summarizeCheckRuns([
        { name: "Tests", status: "completed", conclusion: "success" },
        { name: "Form check", status: "completed", conclusion: "failure" },
        { name: "Lint", status: "in_progress", conclusion: null },
      ]),
    ).toEqual({ state: "failing", failing: ["Form check"] });
    expect(
      summarizeCheckRuns([
        { name: "Tests", status: "queued", conclusion: null },
      ]).state,
    ).toBe("running");
    expect(
      summarizeCheckRuns([
        { name: "Tests", status: "completed", conclusion: "success" },
        { name: "Docs", status: "completed", conclusion: "skipped" },
      ]).state,
    ).toBe("passing");
  });

  it("shows the status in the header, and says unavailable when it cannot be read", async () => {
    const repo = repoWith(plan());
    const store = new StateStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    const page = async (checks: {
      summary: () => Promise<{ state: "failing"; failing: string[] }>;
    }) => {
      const app = createApp({
        view: { reader: repo, store, checks, now: () => NOW },
      });
      const res = await app.request("/view", {
        headers: { Cookie: validCookie() },
      });
      return res.text();
    };
    const failing = await page({
      summary: async () => ({ state: "failing", failing: ["State check"] }),
    });
    expect(failing).toContain('data-checks="failing"');
    expect(attributeText(failing, "data-checks")).toBe("failing: State check");
    const unavailable = await page({
      summary: async () => {
        throw new Error("HTTP 403");
      },
    });
    expect(attributeText(unavailable, "data-checks")).toBe("unavailable");
  });
});

describe("task_cost", () => {
  it("records measured tokens by type, the model and the source on a closed task, and a later record replaces it", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N002", step: "execute" });
    await call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Built.",
    });
    expect(stateAtHead(repo).tasks[0]!.costSource).toBeUndefined();
    const first = await call(app, "task_cost", {
      taskId: "T001",
      tokensIn: 1200,
      tokensOut: 300,
      cacheRead: 90000,
      cacheWrite: 15000,
      model: "recorded-model",
      source: "transcript",
      session: "the hook",
    });
    expect(first.isError).toBeUndefined();
    let t = stateAtHead(repo).tasks[0]!;
    expect(t.tokens).toEqual({
      in: 1200,
      out: 300,
      cacheRead: 90000,
      cacheWrite: 15000,
    });
    expect(t.costSource).toBe("transcript");
    expect(t.model).toBe("recorded-model");
    expect(t.status).toBe("closed");
    expect(
      repo.files
        .get(repo.heads.get("main")!)!
        .get("orchestration/journal.jsonl"),
    ).toContain(
      "task_cost T001: 1200 in, 300 out, 90000 cache read, 15000 cache write, recorded-model (transcript)",
    );
    await call(app, "task_cost", {
      taskId: "T001",
      tokensIn: 2000,
      tokensOut: 500,
      source: "headless",
    });
    t = stateAtHead(repo).tasks[0]!;
    expect(t.tokens).toEqual({ in: 2000, out: 500 });
    expect(t.costSource).toBe("headless");
    expect(checkState(stateAtHead(repo)).findings).toEqual([]);
    const page = await app.request("/view/task/T001", {
      headers: { Cookie: validCookie() },
    });
    expect(await page.text()).toContain("2000 in, 500 out (headless)");
  });

  it("marks tokens given at task_close as reported, and refuses an unknown task", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N002", step: "execute" });
    await call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: "Built.",
      tokensIn: 10,
      tokensOut: 5,
    });
    expect(stateAtHead(repo).tasks[0]!.costSource).toBe("reported");
    const missing = await call(app, "task_cost", {
      taskId: "T999",
      tokensIn: 1,
      tokensOut: 1,
      source: "transcript",
    });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]!.text).toBe("no task T999");
  });
});

describe("a session's write needs a task", () => {
  const raw = (
    app: ReturnType<typeof createApp>,
    name: string,
    args: Record<string, unknown>,
  ) =>
    rpc(app, "tools/call", { name, arguments: args }).then(
      (b) =>
        b.result as {
          isError?: boolean;
          structuredContent?: Record<string, unknown>;
          content: Array<{ text: string }>;
        },
    );

  it("refuses every node and decision write that names neither a task nor the owner's instruction, and commits nothing", async () => {
    const state = plan();
    state.decisions.push(
      decision({
        id: "D001",
        node: "P1-N002",
        question: "Which?",
        default: "a",
      }),
    );
    const repo = repoWith(state);
    const app = appOver(repo);
    const attempts: Array<[string, Record<string, unknown>]> = [
      ["node_update", { nodeId: "P1-N002", reason: "x", note: "edited" }],
      ["node_update", { nodeId: "P1-N002", reason: "x", stage: "done" }],
      ["node_add", { parentId: "P1-N001", title: "A new part", outcome: null }],
      ["node_remove", { nodeId: "P1-N003", reason: "x" }],
      ["decision_open", { nodeId: "P1-N002", question: "Why?", default: "b" }],
      ["decision_close", { decisionId: "D001", chosen: "a" }],
      [
        "node_update",
        { nodeId: "P1-N002", reason: "x", note: "n", ownerInstruction: "   " },
      ],
    ];
    for (const [name, args] of attempts) {
      const result = await raw(app, name, args);
      expect(result.isError, name).toBe(true);
      expect(result.content[0]!.text, name).toContain(
        "refused: this write is not under a task",
      );
    }
    expect(repo.commits).toHaveLength(0);
  });

  it("accepts a write under an open task, and records the task on the commit and the journal event", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N002", step: "break down" });
    const added = await raw(app, "node_add", {
      parentId: "P1-N002",
      title: "A first piece",
      outcome: "The first piece exists.",
      task: "T001",
      session: "session one",
    });
    expect(added.isError).toBeUndefined();
    expect(repo.commits.at(-1)!.message).toBe("P1-N002: node added (T001)");
    const events = repo.files
      .get(repo.heads.get("main")!)!
      .get("orchestration/journal.jsonl")!
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { task: string | null; note: string });
    expect(events.at(-1)!.task).toBe("T001");
    expect(events.at(-1)!.note).not.toContain("no task");
  });

  it("refuses a task that is closed or unknown, and one closed since the write began", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N002", step: "execute" });
    await call(app, "task_close", {
      taskId: "T001",
      status: "blocked",
      summary: "Stuck.",
    });
    const closed = await raw(app, "node_update", {
      nodeId: "P1-N002",
      reason: "x",
      note: "n",
      task: "T001",
    });
    expect(closed.isError).toBe(true);
    expect(closed.content[0]!.text).toContain(
      "task T001 is blocked, not open; a write needs an open task",
    );
    const unknown = await raw(app, "decision_open", {
      nodeId: null,
      question: "Why?",
      default: "b",
      task: "T999",
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]!.text).toBe("no task T999");
  });

  it("accepts a change the owner dictated, and says so on the commit and in the journal", async () => {
    const repo = repoWith(plan());
    const held = await raw(appOver(repo), "node_update", {
      nodeId: "P1-N003",
      reason: "held until the next milestone",
      hold: { kind: "blocked", reason: "until the next milestone" },
      ownerInstruction: "Hold P1-N003 until the next milestone",
    });
    expect(held.isError).toBeUndefined();
    expect(repo.commits[0]!.message).toBe(
      "P1-N003: held until the next milestone (no task: the owner's instruction)",
    );
    expect(
      repo.files
        .get(repo.heads.get("main")!)!
        .get("orchestration/journal.jsonl"),
    ).toContain(
      '[no task; the owner\'s instruction: \\"Hold P1-N003 until the next milestone\\"]',
    );
  });

  it("leaves the loop's own tools and the view's actions as they were", async () => {
    const state = plan();
    state.nodes[1]!.hold = { kind: "gated", reason: "owner review" };
    const repo = repoWith(state);
    const app = appOver(repo);
    const lifted = await app.request("/view/node/P1-N002/action", {
      method: "POST",
      headers: {
        Cookie: validCookie(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "action=lift-hold",
    });
    expect(lifted.status).toBe(303);
    const opened = await raw(app, "task_open", {
      nodeId: "P1-N002",
      step: "execute",
    });
    expect(opened.isError).toBeUndefined();
    const cost = await raw(app, "task_cost", {
      taskId: "T001",
      tokensIn: 1,
      tokensOut: 1,
      source: "transcript",
    });
    expect(cost.isError).toBeUndefined();
  });
});

describe("acceptance and holds", () => {
  it("lifts a node's hold when the node is accepted as done", async () => {
    const state = plan();
    state.nodes[1]!.stage = "executing";
    state.nodes[1]!.hold = { kind: "gated", reason: "the owner accepts it" };
    const repo = repoWith(state);
    const done = await call(appOver(repo), "node_update", {
      nodeId: "P1-N002",
      reason: "accepted",
      stage: "done",
    });
    expect(done.structuredContent!.changes).toEqual([
      "stage executing -> done",
      "hold lifted",
    ]);
    const s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N002")!.hold).toBeNull();
    expect(checkState(s).findings).toEqual([]);
  });
});
