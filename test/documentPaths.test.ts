import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { StateStore } from "../src/model/store.js";
import type { State } from "../src/model/schema.js";
import { node, stateJson } from "./support/states.js";
import {
  FAKE_MCP_TOKEN,
  FakePullRequests,
  FakeRepository,
  NOW,
  SHA_A,
  viewEnv,
} from "./support/view.js";

/**
 * Document paths changed through the service (P4-N031): a node's plan
 * and specification paths are set by `node_update`, and a linked
 * document is moved in an order that keeps invariant 8, every path
 * under `docs` in the state file exists in the repository, true on
 * the default branch and on the pull request at every commit.
 */

const ORIGINAL_ENV = { ...process.env };
const OLD = "docs/plans/first.md";
const NEW = "docs/archive/plans/first.md";
const PR = "majodali/project-orchestrator#70";
const PR_HEAD = "b".repeat(40);

/** A done node that links a plan, and a node whose work moves it. */
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
        docs: { plan: OLD, spec: null },
      }),
      node({
        id: "P1-N003",
        title: "The archive move",
        stage: "specified",
        parent: "P1-N001",
      }),
    ],
    tasks: [],
    decisions: [],
  };
}

function setUp() {
  const repo = new FakeRepository();
  repo.heads.set("main", SHA_A);
  repo.setFile(SHA_A, "orchestration/state.json", stateJson(plan()));
  repo.setFile(SHA_A, OLD, "the plan");
  const pullRequests = new FakePullRequests();
  pullRequests.set(PR, { headSha: PR_HEAD });
  const store = new StateStore({ reader: repo, writer: repo, now: () => NOW });
  const app = createApp({ state: { store, now: () => NOW, pullRequests } });
  return { repo, pullRequests, app };
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

/** Invariant 8 over a tree: the document paths the state names that
 * the tree lacks. */
function dangling(state: State, tree: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const n of state.nodes) {
    for (const path of [n.docs.plan, n.docs.spec]) {
      if (path !== null && !tree.has(path)) out.push(`${n.id} ${path}`);
    }
  }
  return out;
}

const OWNER = { ownerInstruction: "the owner dictated this change" };

beforeEach(() => viewEnv());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("node_update: document paths", () => {
  it("sets a path that is a file on the default branch, and clears one", async () => {
    const { repo, app } = setUp();
    repo.setFile(SHA_A, "docs/specs/first.md", "the specification");
    const set = await call(app, "node_update", {
      nodeId: "P1-N002",
      reason: "The specification was never linked.",
      docs: { spec: "docs/specs/first.md" },
      ...OWNER,
    });
    expect(set.isError).toBeUndefined();
    expect(set.structuredContent!.changes).toEqual([
      "spec docs/specs/first.md",
    ]);
    expect(stateAtHead(repo).nodes[1]!.docs).toEqual({
      plan: OLD,
      spec: "docs/specs/first.md",
    });
    const cleared = await call(app, "node_update", {
      nodeId: "P1-N002",
      reason: "The plan is retired.",
      docs: { plan: null },
      ...OWNER,
    });
    expect(cleared.structuredContent!.changes).toEqual(["plan none"]);
    expect(stateAtHead(repo).nodes[1]!.docs.plan).toBeNull();
  });

  it("refuses a path that is not a file on the default branch, with nothing committed", async () => {
    const { repo, app } = setUp();
    const refused = await call(app, "node_update", {
      nodeId: "P1-N002",
      reason: "The plan moved.",
      docs: { plan: NEW },
      ...OWNER,
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain(
      `${NEW} is not a file on the default branch`,
    );
    expect(repo.commits).toHaveLength(0);
  });

  it("refuses docsOnMerge without an open execute task", async () => {
    const { repo, app } = setUp();
    const refused = await call(app, "node_update", {
      nodeId: "P1-N002",
      reason: "The plan moves.",
      docsOnMerge: { plan: NEW },
      ...OWNER,
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("an open execute task");
    expect(repo.commits).toHaveLength(0);
  });
});

describe("moving a linked document", () => {
  it("keeps every named path a file on the default branch and on the pull request at every commit", async () => {
    const { repo, pullRequests, app } = setUp();
    // The trees the check would see. The pull request moves the file.
    const main = new Set([OLD]);
    const branch = new Set([NEW]);
    repo.setFile(PR_HEAD, NEW, "the plan");
    expect(dangling(stateAtHead(repo), main)).toEqual([]);

    // 1. The claim.
    const opened = await call(app, "task_open", {
      nodeId: "P1-N003",
      step: "execute",
    });
    const task = opened.structuredContent!.taskId as string;
    expect(dangling(stateAtHead(repo), main)).toEqual([]);

    // 2. The new path is named under the task: the old one is cleared.
    const named = await call(app, "node_update", {
      nodeId: "P1-N002",
      reason: "The plan moves to the archive.",
      docsOnMerge: { plan: NEW },
      task,
    });
    expect(named.isError).toBeUndefined();
    expect(named.structuredContent!.changes).toEqual([
      `plan cleared, ${NEW} when ${task}'s node is done`,
    ]);
    let s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N002")!.docs.plan).toBeNull();
    expect(s.tasks[0]!.docsOnMerge).toEqual([{ node: "P1-N002", plan: NEW }]);
    // Green on the default branch, and on the pull request, whose
    // check runs on the merge of the branch into it.
    expect(dangling(s, main)).toEqual([]);
    expect(dangling(s, branch)).toEqual([]);

    // 3. The task closes with its pull request; nothing merges yet.
    const closed = await call(app, "task_close", {
      taskId: task,
      status: "closed",
      summary: "Moved the plan to the archive.",
      pr: PR,
    });
    expect(closed.structuredContent!.merged).toEqual([]);
    s = stateAtHead(repo);
    expect(dangling(s, main)).toEqual([]);
    expect(dangling(s, branch)).toEqual([]);

    // 4. The verification closes: the service merges, then commits
    // the new path with the done decision.
    const check = s.nodes.find((n) => n.kind === "check")!.id;
    const verifying = await call(app, "task_open", {
      nodeId: check,
      step: "verify",
    });
    const verified = await call(app, "task_close", {
      taskId: verifying.structuredContent!.taskId,
      status: "closed",
      summary: "The plan is in the archive.",
    });
    expect(verified.isError).toBeUndefined();
    expect(verified.structuredContent!.merged).toEqual([PR]);
    expect(pullRequests.merges).toEqual([PR]);
    expect(verified.structuredContent!.moved).toContain(`P1-N002 plan ${NEW}`);
    // After the merge the default branch has the pull request's tree.
    // The state before the service's commit named no path for the
    // plan, so the merge commit itself was green; the commit after it
    // names the new path, which is there.
    expect(dangling(s, branch)).toEqual([]);
    s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N002")!.docs.plan).toBe(NEW);
    expect(dangling(s, branch)).toEqual([]);
  });

  it("refuses the done decision when the pull request brings no file to the path, merging nothing", async () => {
    const { repo, pullRequests, app } = setUp();
    // The pull request's head has no file at the new path.
    repo.setFile(PR_HEAD, "docs/plans/other.md", "something else");
    const opened = await call(app, "task_open", {
      nodeId: "P1-N003",
      step: "execute",
    });
    const task = opened.structuredContent!.taskId as string;
    await call(app, "node_update", {
      nodeId: "P1-N002",
      reason: "The plan moves to the archive.",
      docsOnMerge: { plan: NEW },
      task,
    });
    await call(app, "task_close", {
      taskId: task,
      status: "closed",
      summary: "Moved the plan to the archive.",
      pr: PR,
    });
    const check = stateAtHead(repo).nodes.find((n) => n.kind === "check")!.id;
    const verifying = await call(app, "task_open", {
      nodeId: check,
      step: "verify",
    });
    const commits = repo.commits.length;
    const verified = await call(app, "task_close", {
      taskId: verifying.structuredContent!.taskId,
      status: "closed",
      summary: "Looks right.",
    });
    expect(verified.isError).toBe(true);
    expect(verified.content[0]!.text).toContain(NEW);
    expect(verified.content[0]!.text).toContain(
      "Nothing was merged or committed",
    );
    expect(pullRequests.merges).toEqual([]);
    expect(repo.commits).toHaveLength(commits);

    // The owner's acceptance runs the same check.
    const accepted = await call(app, "node_update", {
      nodeId: "P1-N003",
      reason: "Accept the review.",
      stage: "done",
      ...OWNER,
    });
    expect(accepted.isError).toBe(true);
    expect(pullRequests.merges).toEqual([]);
  });

  it("sets the new path when the owner accepts the node", async () => {
    const { repo, pullRequests, app } = setUp();
    repo.setFile(PR_HEAD, NEW, "the plan");
    const opened = await call(app, "task_open", {
      nodeId: "P1-N003",
      step: "execute",
    });
    const task = opened.structuredContent!.taskId as string;
    await call(app, "node_update", {
      nodeId: "P1-N002",
      reason: "The plan moves to the archive.",
      docsOnMerge: { plan: NEW },
      task,
    });
    await call(app, "task_close", {
      taskId: task,
      status: "closed",
      summary: "Moved the plan to the archive.",
      pr: PR,
    });
    const accepted = await call(app, "node_update", {
      nodeId: "P1-N003",
      reason: "Accept the review.",
      stage: "done",
      ...OWNER,
    });
    expect(accepted.isError).toBeUndefined();
    expect(pullRequests.merges).toEqual([PR]);
    expect(
      stateAtHead(repo).nodes.find((n) => n.id === "P1-N002")!.docs.plan,
    ).toBe(NEW);
  });
});
