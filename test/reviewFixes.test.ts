import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { checkState, classifyAll } from "../src/model/check.js";
import { expectedHeads, fitWords, removeNode } from "../src/model/loop.js";
import { nodeActions } from "../src/model/mutations.js";
import { SUMMARY_MAX_WORDS, type State } from "../src/model/schema.js";
import { StateStore } from "../src/model/store.js";
import { SERVER_INSTRUCTIONS } from "../src/stateTools.js";
import { node, stateJson, task } from "./support/states.js";
import {
  FAKE_MCP_TOKEN,
  FakePullRequestDetails,
  FakePullRequests,
  FakeRepository,
  NOW,
  SHA_A,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The corrections of 2026-11-16, after the review of the loop's first
 * three days on milestone 6:
 *
 * - A failed verification hands the node back for rework by itself.
 *   The service told everyone "the owner lifts the hold", the view
 *   offered that, and lifting it withdrew the rework (P4-N033).
 * - A question asked at a close is kept whatever the status, and gates
 *   the node until it is answered; it was dropped unless the task
 *   closed `closed`.
 * - A pull request with commits made after its last execute task
 *   closed is not merged: three commits on one pull request belonged
 *   to no task.
 * - A node gated under a paused line is paused, not "waiting on you".
 */

const ORIGINAL_ENV = { ...process.env };
const PR = "majodali/project-orchestrator#51";
const HEAD_1 = "1".repeat(40);
const HEAD_2 = "2".repeat(40);

/** A broken-down root with one specified leaf. */
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

function appOver(
  repo: FakeRepository,
  pullRequests = new FakePullRequests(),
  pullRequestDetails = new FakePullRequestDetails(),
) {
  const store = new StateStore({ reader: repo, writer: repo, now: () => NOW });
  return createApp({
    state: { store, now: () => NOW, pullRequests, pullRequestDetails },
    view: { reader: repo, store, pullRequests, now: () => NOW },
  });
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
  const body = (await res.json()) as { result: Record<string, unknown> };
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

/** Executes P1-N002 on `PR` at `head` and closes; answers the app. */
async function executed(
  repo: FakeRepository,
  prs: FakePullRequests,
  head = HEAD_1,
  pullRequestDetails = new FakePullRequestDetails(),
) {
  const app = appOver(repo, prs, pullRequestDetails);
  prs.set(PR, { headSha: head });
  await call(app, "task_open", { nodeId: "P1-N002", step: "execute" });
  const closed = await call(app, "task_close", {
    taskId: "T001",
    status: "closed",
    summary: "Built.",
    pr: PR,
  });
  expect(closed.isError).toBeFalsy();
  return app;
}

beforeEach(() => viewEnv());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("a failed verification", () => {
  it("is not the owner's to lift, on the node or in the view", async () => {
    const repo = repoWith(plan());
    const prs = new FakePullRequests();
    const app = await executed(repo, prs);
    await call(app, "task_open", { nodeId: "P1-N003", step: "verify" });
    const failed = await call(app, "task_close", {
      taskId: "T002",
      status: "blocked",
      summary: "Criterion 3 is not met.",
    });
    expect(failed.structuredContent!.stop).toBeNull();
    const s = stateAtHead(repo);
    const check = s.nodes.find((n) => n.id === "P1-N003")!;
    expect(check.hold?.kind).toBe("blocked");
    expect(nodeActions(check)).toEqual([]);
    // The verified node still offers the owner's overrule.
    expect(nodeActions(s.nodes.find((n) => n.id === "P1-N002")!)).toEqual([
      "accept-review",
    ]);
    const page = await app.request("/view/node/P1-N003", {
      headers: { Cookie: validCookie() },
    });
    const html = await page.text();
    expect(html).toContain("data-failed-check");
    expect(html).toContain("starts without you");
    expect(html).not.toContain('data-node-action="lift-hold"');
    // The view refuses the lift even when it is posted by hand.
    const lift = await app.request("/view/node/P1-N003/action", {
      method: "POST",
      headers: {
        Cookie: validCookie(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ action: "lift-hold", note: "" }).toString(),
    });
    expect(lift.status).not.toBe(303);
    expect(
      stateAtHead(repo).nodes.find((n) => n.id === "P1-N003")!.hold,
    ).not.toBeNull();
  });

  it("is not what a reviewer's question is: a gated check node offers no rework", async () => {
    const repo = repoWith(plan());
    const prs = new FakePullRequests();
    const app = await executed(repo, prs);
    await call(app, "task_open", { nodeId: "P1-N003", step: "verify" });
    await call(app, "task_close", {
      taskId: "T002",
      status: "needs-judgment",
      summary: "The criterion can be read two ways.",
    });
    const s = stateAtHead(repo);
    expect(s.nodes.find((n) => n.id === "P1-N003")!.hold?.kind).toBe("gated");
    const next = await call(app, "task_next", { role: "implementer" });
    expect(next.structuredContent!.next).toBeNull();
    // This one the owner does lift.
    expect(nodeActions(s.nodes.find((n) => n.id === "P1-N003")!)).toEqual([
      "lift-hold",
    ]);
  });
});

describe("a question asked at a close", () => {
  it("gates the node without a hold when the task could not finish, and the step is offered again once it is answered", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N002", step: "execute" });
    const closed = await call(app, "task_close", {
      taskId: "T001",
      status: "needs-judgment",
      summary: "Criterion 4 needs a tool the session does not have.",
      asks: [
        {
          question: "How should criterion 4 be met?",
          options: ["install the tool", "move the criterion"],
          default: "install the tool",
        },
      ],
    });
    expect(closed.structuredContent!.decisionsOpened).toEqual(["D001"]);
    expect(closed.structuredContent!.stop).toContain(
      "offers its step again once they are answered",
    );
    let s = stateAtHead(repo);
    const n = s.nodes.find((x) => x.id === "P1-N002")!;
    expect(n.stage).toBe("executing");
    expect(n.hold).toBeNull();
    expect(checkState(s).findings).toEqual([]);
    const waiting = await call(app, "task_next", { role: "implementer" });
    expect(waiting.structuredContent!.next).toBeNull();

    await call(app, "decision_close", {
      decisionId: "D001",
      chosen: "install the tool",
      ownerInstruction: "install the tool",
    });
    const again = await call(app, "task_next", { role: "implementer" });
    expect(again.structuredContent!.next).toMatchObject({
      node: { id: "P1-N002", stage: "executing" },
      step: "execute",
    });
    s = stateAtHead(repo);
    expect(checkState(s).findings).toEqual([]);
  });

  it("is kept on a blocked close too", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N002", step: "execute" });
    const closed = await call(app, "task_close", {
      taskId: "T001",
      status: "blocked",
      summary: "The repository is not reachable.",
      asks: [{ question: "Grant access?", default: "yes" }],
    });
    expect(closed.structuredContent!.decisionsOpened).toEqual(["D001"]);
    expect(stateAtHead(repo).decisions[0]).toMatchObject({
      node: "P1-N002",
      chosen: null,
    });
  });

  it("goes on the verified node when a verification closes, not on its hidden check node", async () => {
    const repo = repoWith(plan());
    const prs = new FakePullRequests();
    const app = await executed(repo, prs);
    await call(app, "task_open", { nodeId: "P1-N003", step: "verify" });
    const closed = await call(app, "task_close", {
      taskId: "T002",
      status: "closed",
      summary: "Verified.",
      asks: [{ question: "Reword the note later?", default: "yes" }],
    });
    expect(closed.structuredContent!.decisionsOpened).toEqual(["D001"]);
    expect(stateAtHead(repo).decisions[0]!.node).toBe("P1-N002");
  });
});

describe("commits on a pull request after its task closed", () => {
  it("records the pull request's head when an execute task closes", async () => {
    const repo = repoWith(plan());
    const prs = new FakePullRequests();
    await executed(repo, prs);
    const s = stateAtHead(repo);
    expect(s.tasks[0]!.ref).toBe(HEAD_1);
    expect(expectedHeads(s, "P1-N002").get(PR)).toEqual({
      sha: HEAD_1,
      task: "T001",
    });
  });

  it("refuses the verification's merge when the head has moved, and merges after a rework covers the commits", async () => {
    const repo = repoWith(plan());
    const prs = new FakePullRequests();
    const app = await executed(repo, prs);
    // Someone pushes to the pull request with no task open.
    prs.set(PR, { headSha: HEAD_2 });
    await call(app, "task_open", { nodeId: "P1-N003", step: "verify" });
    const refused = await call(app, "task_close", {
      taskId: "T002",
      status: "closed",
      summary: "Verified.",
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain(
      "commits made after T001 closed",
    );
    expect(prs.merges).toEqual([]);
    // The reviewer fails the verification; the rework covers them.
    await call(app, "task_close", {
      taskId: "T002",
      status: "blocked",
      summary: "Commits after T001 closed belong to no task.",
    });
    await call(app, "task_open", { nodeId: "P1-N002", step: "execute" });
    await call(app, "task_close", {
      taskId: "T003",
      status: "closed",
      summary: "The later commits are this task's.",
      pr: PR,
    });
    expect(expectedHeads(stateAtHead(repo), "P1-N002").get(PR)!.sha).toBe(
      HEAD_2,
    );
    await call(app, "task_open", { nodeId: "P1-N003", step: "verify" });
    const verified = await call(app, "task_close", {
      taskId: "T004",
      status: "closed",
      summary: "Verified.",
    });
    expect(verified.isError).toBeFalsy();
    expect(verified.structuredContent!.merged).toEqual([PR]);
  });

  it("refuses the owner's acceptance in the view the same way", async () => {
    const repo = repoWith(plan());
    const prs = new FakePullRequests();
    const app = await executed(repo, prs);
    prs.set(PR, { headSha: HEAD_2 });
    const res = await app.request("/view/node/P1-N002/action", {
      method: "POST",
      headers: {
        Cookie: validCookie(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        action: "accept-review",
        note: "",
      }).toString(),
    });
    expect(res.status).not.toBe(303);
    expect(await res.text()).toContain("commits made after T001 closed");
    expect(prs.merges).toEqual([]);
    expect(stateAtHead(repo).nodes.find((n) => n.id === "P1-N002")!.stage).toBe(
      "verifying",
    );
  });

  it("asks nothing of a pull request whose task recorded no head", () => {
    const state = plan();
    state.tasks.push(task({ id: "T001", node: "P1-N002", pr: PR }));
    // `abc1234` is not a full commit: tasks from before this check.
    expect(expectedHeads(state, "P1-N002").size).toBe(0);
  });
});

describe("a node gated under a paused line", () => {
  it("is paused, and the view does not count it as waiting on the owner", async () => {
    const state = plan();
    state.nodes[0]!.hold = { kind: "blocked", reason: "paused by the owner" };
    state.nodes[1]!.hold = { kind: "gated", reason: "owner review" };
    state.nodes.push(
      node({ id: "P2-N001", title: "A ready node", stage: "specified" }),
    );
    const classes = classifyAll(state);
    expect(classes.get("P1-N001")).toBe("blocked");
    expect(classes.get("P1-N002")).toBe("paused");
    const app = appOver(repoWith(state));
    const page = await app.request("/view", {
      headers: { Cookie: validCookie() },
    });
    const html = await page.text();
    expect(html).toContain('data-count-owner="0"');
    expect(html).toContain('data-count-ready="1"');
  });

  it("is still shown as in flight while a task is open on it", () => {
    const state = plan();
    state.nodes[0]!.hold = { kind: "blocked", reason: "paused by the owner" };
    state.nodes[1]!.stage = "executing";
    state.tasks.push(
      task({ id: "T001", node: "P1-N002", status: "open", closed: null }),
    );
    expect(classifyAll(state).get("P1-N002")).toBe("in-flight");
  });
});

describe("smaller corrections", () => {
  it("keeps the cost of removed tasks on the removal's journal line", async () => {
    const state = plan();
    state.nodes.push(
      node({
        id: "P1-N003",
        title: "A scratch node",
        stage: "planned",
        parent: "P1-N001",
      }),
    );
    state.tasks.push(
      task({
        id: "T001",
        node: "P1-N003",
        step: "plan",
        tokens: { in: 4, out: 818, cacheRead: 176380, cacheWrite: 10364 },
      }),
    );
    const removed = removeNode(state, {
      nodeId: "P1-N003",
      reason: "Obsolete: the trial has run.",
    });
    expect(removed.event.note).toContain(
      "tasks T001, which cost 4 in, 818 out, 176380 cache read, 10364 cache write",
    );
  });

  it("keeps a scope-changed close within the summary limit", async () => {
    const repo = repoWith(plan());
    const app = appOver(repo);
    await call(app, "task_open", { nodeId: "P1-N002", step: "execute" });
    await call(app, "node_update", {
      nodeId: "P1-N002",
      reason: "The owner renamed it.",
      title: "The part to build, renamed",
      ownerInstruction: "rename it",
    });
    const long = Array.from({ length: 58 }, (_, i) => `word${i}`).join(" ");
    const closed = await call(app, "task_close", {
      taskId: "T001",
      status: "closed",
      summary: long,
    });
    expect(closed.isError).toBeFalsy();
    expect(closed.structuredContent!.status).toBe("needs-judgment");
    const summary = stateAtHead(repo).tasks[0]!.summary!;
    expect(summary.split(/\s+/).length).toBeLessThanOrEqual(SUMMARY_MAX_WORDS);
    expect(summary.endsWith("[cut]")).toBe(true);
    expect(fitWords("a b c", 3)).toBe("a b c");
  });

  it("tells a session what each close status does", () => {
    expect(SERVER_INSTRUCTIONS).toContain(
      "Never close `closed` with a criterion unmet",
    );
    expect(SERVER_INSTRUCTIONS).toContain(
      "A reviewer closes a failed verification as `blocked`",
    );
    expect(SERVER_INSTRUCTIONS).toContain(
      "commits made after its last execute task closed",
    );
  });
});

describe("a verify claim's pull requests (P2-N087)", () => {
  it("carries the pull request's description, head commit and checks", async () => {
    const repo = repoWith(plan());
    const prs = new FakePullRequests();
    const details = new FakePullRequestDetails();
    const app = await executed(repo, prs, HEAD_1, details);
    details.set(PR, {
      title: "The part to build",
      description: "What this pull request does.",
      headSha: HEAD_1,
      checks: [
        { name: "build", conclusion: "success" },
        { name: "lint", conclusion: "failure" },
      ],
    });
    const opened = await call(app, "task_open", {
      nodeId: "P1-N003",
      step: "verify",
    });
    expect(opened.isError).toBeFalsy();
    expect(opened.structuredContent!.pullRequests).toEqual({
      readable: [
        {
          ref: PR,
          repository: "majodali/project-orchestrator",
          number: 51,
          title: "The part to build",
          description: "What this pull request does.",
          headSha: HEAD_1,
          open: true,
          mergeable: true,
          checks: [
            { name: "build", conclusion: "success" },
            { name: "lint", conclusion: "failure" },
          ],
        },
      ],
      unreadable: [],
    });
  });

  it("carries each pull request's detail, whichever repository it is in", () => {
    const state: State = {
      schema: 0,
      project: "majodali/project-orchestrator",
      nodes: [
        node({
          id: "P1-N001",
          title: "The line of work",
          stage: "broken-down",
        }),
        node({
          id: "P1-N002",
          title: "The part to build",
          stage: "verifying",
          parent: "P1-N001",
        }),
        node({
          id: "P1-N003",
          title: "Verification of The part to build",
          kind: "check",
          stage: "specified",
          parent: "P1-N002",
          outcome: "P1-N002 is verified against its outcome.",
        }),
      ],
      tasks: [
        task({ id: "T001", node: "P1-N002", pr: PR }),
        task({
          id: "T002",
          node: "P1-N002",
          pr: "majodali/project-orchestrator-service#12",
        }),
      ],
      decisions: [],
    };
    expect(checkState(state).findings).toEqual([]);
  });

  it("names an unreadable pull request, with the reason, and still commits the claim", async () => {
    const repo = repoWith(plan());
    const prs = new FakePullRequests();
    const details = new FakePullRequestDetails();
    details.fail(PR, "could not read it: HTTP 404");
    const app = await executed(repo, prs, HEAD_1, details);
    const opened = await call(app, "task_open", {
      nodeId: "P1-N003",
      step: "verify",
    });
    expect(opened.isError).toBeFalsy();
    expect(opened.structuredContent!.taskId).toBe("T002");
    expect(opened.structuredContent!.pullRequests).toEqual({
      readable: [],
      unreadable: [{ ref: PR, reason: "could not read it: HTTP 404" }],
    });
  });

  it("is not fetched for task_next's preview, only for the claim itself", async () => {
    const repo = repoWith(plan());
    const prs = new FakePullRequests();
    const details = new FakePullRequestDetails();
    const app = await executed(repo, prs, HEAD_1, details);
    const next = await call(app, "task_next", { role: "reviewer" });
    expect(next.structuredContent!.next).toMatchObject({ step: "verify" });
    expect(
      (next.structuredContent!.next as Record<string, unknown>).pullRequests,
    ).toBeUndefined();
  });

  it("answers the same from plan_read, so a reviewer can read it again later in the run", async () => {
    const repo = repoWith(plan());
    const prs = new FakePullRequests();
    const details = new FakePullRequestDetails();
    const app = await executed(repo, prs, HEAD_1, details);
    details.set(PR, { title: "The part to build" });
    const opened = await call(app, "task_open", {
      nodeId: "P1-N003",
      step: "verify",
    });
    const read = await call(app, "plan_read", { node: "P1-N003" });
    expect(read.isError).toBeFalsy();
    expect(
      (read.structuredContent!.node as Record<string, unknown>).pullRequests,
    ).toEqual(
      (opened.structuredContent as Record<string, unknown>).pullRequests,
    );
  });
});
