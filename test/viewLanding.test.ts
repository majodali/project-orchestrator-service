import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { StateStore } from "../src/model/store.js";
import type { State } from "../src/model/schema.js";
import { nodeActionSentence } from "../src/view/actions.js";
import { needsYouRows, reviewRefOf } from "../src/view/landing.js";
import type { CommitChecks } from "../src/planRegister/commitChecks.js";
import {
  decision,
  MINIMAL_STATE,
  node,
  sampleState,
  stateJson,
  task,
} from "./support/states.js";
import {
  FakePullRequests,
  FakeRepository,
  NOW,
  SHA_A,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The first screen of `/view` (the specification of P2-N028, section
 * 1, criteria 7 to 11): "Needs you", "Ready", "Running" and "Just
 * finished", ahead of the tree, and the sentence beside every
 * lifecycle action.
 */

function appOver(
  repo: FakeRepository,
  pullRequests = new FakePullRequests(),
  checks?: CommitChecks,
) {
  const store = new StateStore({ reader: repo, writer: repo, now: () => NOW });
  return createApp({
    view: {
      reader: repo,
      store,
      pullRequests,
      ...(checks ? { checks } : {}),
      now: () => NOW,
    },
  });
}

function repoWith(state: State): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", SHA_A);
  repo.setFile(SHA_A, "orchestration/state.json", stateJson(state));
  return repo;
}

async function get(app: ReturnType<typeof createApp>, path: string) {
  const res = await app.request(path, { headers: { Cookie: validCookie() } });
  return { res, html: await res.text() };
}

async function post(
  app: ReturnType<typeof createApp>,
  path: string,
  fields: Record<string, string>,
) {
  const body = new URLSearchParams(fields).toString();
  const res = await app.request(path, {
    method: "POST",
    headers: {
      Cookie: validCookie(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return { res, html: await res.text() };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => viewEnv());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("needsYouRows (criterion 8)", () => {
  it("orders every open decision, then every held node, then every node whose start waits for approval", () => {
    const state = sampleState();
    const rows = needsYouRows(state);
    expect(rows.map((r) => `${r.kind}:${r.node.id}`)).toEqual([
      "decision:P1-N003",
      "hold:P1-N003",
      "hold:P1-N007",
      "approval:P1-N008",
    ]);
  });

  it("gives a node below a held or parked node no row of its own", () => {
    const state = sampleState();
    state.nodes.push(
      node({
        id: "P1-N020",
        title: "A child under the held node",
        stage: "planned",
        parent: "P1-N003",
        hold: { kind: "gated", reason: "a hold of its own" },
      }),
    );
    state.decisions.push(
      decision({
        id: "D900",
        node: "P1-N020",
        question: "Should this child be asked too?",
        default: "no",
      }),
    );
    const rows = needsYouRows(state);
    expect(rows.map((r) => r.node.id)).not.toContain("P1-N020");
  });

  it("excepts a check node held blocked: its hold only offers the rework, not the owner's to lift", () => {
    const state: State = {
      schema: 0,
      project: "majodali/project-orchestrator",
      nodes: [
        node({
          id: "P1-N001",
          title: "The work being reworked",
          stage: "verifying",
        }),
        node({
          id: "P1-N002",
          kind: "check",
          title: "Verification of the work",
          stage: "specified",
          parent: "P1-N001",
          hold: { kind: "blocked", reason: "T001: no tests" },
        }),
      ],
      tasks: [],
      decisions: [],
    };
    expect(needsYouRows(state)).toEqual([]);
  });
});

describe("reviewRefOf", () => {
  it("names the pull request of a held node's most recent task, or none", () => {
    const state = sampleState();
    state.tasks.push(
      task({
        id: "T010",
        node: "P1-N007",
        status: "blocked",
        pr: "majodali/project-orchestrator-service#42",
        summary: "needs owner",
      }),
    );
    expect(reviewRefOf(state, "P1-N007")).toBe(
      "majodali/project-orchestrator-service#42",
    );
    expect(reviewRefOf(state, "P1-N003")).toBeNull();
  });
});

describe("nodeActionSentence (criterion 11)", () => {
  it("names the step lifting a hold offers next, when something else still gates it", () => {
    const state = sampleState();
    const gated = state.nodes.find((n) => n.id === "P1-N003")!;
    expect(nodeActionSentence("lift-hold", gated, state)).toBe(
      "P1-N003 then decision D001 is open on it; the owner answers it in the view.",
    );
  });

  it("names the step approving a start offers next", () => {
    const state = sampleState();
    const approve = state.nodes.find((n) => n.id === "P1-N008")!;
    expect(nodeActionSentence("approve-start", approve, state)).toBe(
      "P1-N008 then offers execute or break down to the implementer next, starting without you.",
    );
  });

  it("says a node becomes done and names its pull request, or that it carries none", () => {
    const state = sampleState();
    const noPr = state.nodes.find((n) => n.id === "P1-N004")!;
    state.tasks = state.tasks.filter((t) => t.node !== "P1-N004");
    expect(nodeActionSentence("accept-review", noPr, state)).toBe(
      "P1-N004 becomes done, and it carries no pull request to merge.",
    );
    const withPr = state.nodes.find((n) => n.id === "P1-N002")!;
    expect(nodeActionSentence("accept-review", withPr, state)).toBe(
      "P1-N002 becomes done, and pull request majodali/project-orchestrator-service#18 is merged.",
    );
  });
});

describe("the four sections ahead of the tree, over HTTP (criterion 7)", () => {
  it("renders each section, in order, with its empty line when a state has nothing for it", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    repo.setFile(SHA_A, "orchestration/state.json", MINIMAL_STATE);
    const { html } = await get(appOver(repo), "/view");
    const landing = html.slice(
      html.indexOf("data-landing"),
      html.indexOf("data-plan"),
    );
    expect(landing.indexOf("data-needs-you")).toBeGreaterThanOrEqual(0);
    expect(landing.indexOf("data-needs-you")).toBeLessThan(
      landing.indexOf("data-ready"),
    );
    expect(landing.indexOf("data-ready")).toBeLessThan(
      landing.indexOf("data-running"),
    );
    expect(landing.indexOf("data-running")).toBeLessThan(
      landing.indexOf("data-just-finished"),
    );
    expect(landing).toContain('data-empty="needs-you">Nothing needs you.');
    expect(landing).toContain(
      'data-empty="ready">Nothing is ready to start without you.',
    );
    expect(landing).toContain('data-empty="running">Nothing is running.');
    expect(landing).toContain(
      'data-empty="just-finished">Nothing finished in the last 24 hours.',
    );
  });

  it("fills each section from a state with rows for it", async () => {
    const { html } = await get(appOver(repoWith(sampleState())), "/view");
    const landing = html.slice(
      html.indexOf("data-landing"),
      html.indexOf("data-plan"),
    );
    expect(landing).not.toContain("data-empty");
    expect(landing).toContain('data-needs-you-row="decision"');
    expect(landing).toContain('data-needs-you-row="hold"');
    expect(landing).toContain('data-needs-you-row="approval"');
    expect(landing).toContain('data-node="P1-N006"'); // Ready
    expect(landing).toContain('data-task="T002"'); // Running
    expect(landing).toContain('data-task="T001"'); // Just finished
  });
});

describe("a decision's form in its 'Needs you' row (criterion 9)", () => {
  it("is the same form the node page carries, and closes the decision from /view", async () => {
    const repo = repoWith(sampleState());
    const app = appOver(repo);
    const { html } = await get(app, "/view");
    const row = html.slice(
      html.indexOf('data-needs-you-row="decision" data-node="P1-N003"'),
    );
    const form = row.slice(0, row.indexOf("</li>"));
    expect(form).toContain('data-decision-form="D001"');
    expect(form).toContain('action="/view/decision/D001/close"');
    expect(form).toContain("Which store holds the answers?");

    const { res } = await post(app, "/view/decision/D001/close", {
      chosen: "git",
    });
    expect(res.status).toBe(303);
    const sha = repo.heads.get("main")!;
    const closed = JSON.parse(
      repo.files.get(sha)!.get("orchestration/state.json")!,
    ) as State;
    expect(closed.decisions.find((d) => d.id === "D001")!.chosen).toBe("git");
  });
});

describe("a review row's pull request and checks (criterion 10)", () => {
  function heldWithPr(): State {
    const state = sampleState();
    state.tasks.push(
      task({
        id: "T010",
        node: "P1-N007",
        status: "blocked",
        pr: "majodali/project-orchestrator-service#42",
        summary: "needs owner",
      }),
    );
    return state;
  }

  it("links the pull request and names the state of its checks", async () => {
    const pullRequests = new FakePullRequests();
    pullRequests.set("majodali/project-orchestrator-service#42", {
      headSha: "f".repeat(40),
    });
    const checks: CommitChecks = {
      summary: async () => ({ state: "failing", failing: ["Tests"] }),
    };
    const app = appOver(repoWith(heldWithPr()), pullRequests, checks);
    const { html } = await get(app, "/view");
    const row = html.slice(
      html.indexOf('data-needs-you-row="hold" data-node="P1-N007"'),
    );
    const li = row.slice(0, row.indexOf("</li>"));
    expect(li).toContain(
      "https://github.com/majodali/project-orchestrator-service/pull/42",
    );
    expect(li).toContain('data-review-checks="failing"');
    expect(li).toContain("Tests");
  });

  it("says the checks are unavailable when they cannot be read", async () => {
    const pullRequests = new FakePullRequests();
    pullRequests.set("majodali/project-orchestrator-service#42", {
      headSha: "f".repeat(40),
    });
    const checks: CommitChecks = {
      summary: async () => {
        throw new Error("HTTP 403");
      },
    };
    const app = appOver(repoWith(heldWithPr()), pullRequests, checks);
    const { html } = await get(app, "/view");
    const row = html.slice(
      html.indexOf('data-needs-you-row="hold" data-node="P1-N007"'),
    );
    const li = row.slice(0, row.indexOf("</li>"));
    expect(li).toContain('data-review-checks="unavailable"');
  });

  it("shows no review line on a held node whose task carries no pull request", async () => {
    const app = appOver(repoWith(sampleState()));
    const { html } = await get(app, "/view");
    const row = html.slice(
      html.indexOf('data-needs-you-row="hold" data-node="P1-N003"'),
    );
    const li = row.slice(0, row.indexOf("</li>"));
    expect(li).not.toContain("data-review");
  });
});

describe("every action button's sentence, on every page (criterion 11)", () => {
  it("shows the sentence beside the button on the node page and in the 'Needs you' row", async () => {
    const app = appOver(repoWith(sampleState()));
    const onNodePage = await get(app, "/view/node/P1-N003");
    expect(onNodePage.html).toContain(
      'data-action-sentence="lift-hold">P1-N003 then decision D001 is open on it',
    );
    const onLanding = await get(app, "/view");
    const row = onLanding.html.slice(
      onLanding.html.indexOf('data-needs-you-row="hold" data-node="P1-N003"'),
    );
    expect(row.slice(0, row.indexOf("</li>"))).toContain(
      'data-action-sentence="lift-hold">P1-N003 then decision D001 is open on it',
    );
  });
});
