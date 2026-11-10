import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import {
  COMMIT_325C502,
  repository325c502,
} from "./support/fixtures325c502.js";
import { sampleState, stateJson } from "./support/states.js";
import {
  FakeRepository,
  NOW,
  SHA_A,
  SHA_B,
  attributeText,
  expectLinksPinned,
  expectViewHeaders,
  textOf,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The web view over the state file (the rebuild plan, milestone 2):
 * the tree page, the node page and the task page, each reading
 * `orchestration/state.json` at one commit and nothing else.
 */

const ORIGINAL_ENV = { ...process.env };

function appOver(repo: FakeRepository) {
  return createApp({ view: { reader: repo, now: () => NOW } });
}

function sampleRepo(): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", SHA_A);
  repo.setFile(SHA_A, "orchestration/state.json", stateJson(sampleState()));
  return repo;
}

async function get(app: ReturnType<typeof createApp>, path: string) {
  const res = await app.request(path, { headers: { Cookie: validCookie() } });
  return { res, html: await res.text() };
}

/** The text of the `<dd data-field="name">` element. */
function fieldText(html: string, name: string): string {
  const at = html.indexOf(`data-field="${name}"`);
  const start = html.indexOf(">", at) + 1;
  return textOf(html.slice(start, html.indexOf("</dd>", start)));
}

/** Every `data-<name>` element's text, in page order. */
function all(html: string, attribute: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `<(\\w+)[^>]*\\b${attribute}(?:="[^"]*")?(?=[\\s>])[^>]*>`,
    "g",
  );
  for (const m of html.matchAll(re)) {
    const tag = m[1]!;
    const start = m.index! + m[0].length;
    const end = html.indexOf(`</${tag}>`, start);
    out.push(textOf(html.slice(start, end)));
  }
  return out;
}

beforeEach(() => viewEnv());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("the tree page", () => {
  it("reads only the state file, at the SHA the ref resolved to", async () => {
    const repo = sampleRepo();
    const { res, html } = await get(appOver(repo), "/view");
    expect(res.status).toBe(200);
    expectViewHeaders(res);
    expect(repo.readCalls).toEqual([
      { sha: SHA_A, path: "orchestration/state.json" },
    ]);
    expect(attributeText(html, "data-sha")).toBe(SHA_A);
    expect(textOf(attributeText(html, "data-source") ?? "")).toContain(
      "orchestration/state.json at aaaaaaa",
    );
    expect(html).not.toMatch(/<script/i);
  });

  it("leads with what waits on the owner: open decisions and gated nodes", async () => {
    const { html } = await get(appOver(sampleRepo()), "/view");
    const waiting = html.slice(
      html.indexOf("data-waiting"),
      html.indexOf("data-ready"),
    );
    expect(textOf(waiting)).toContain("2 open decisions");
    expect(all(waiting, "data-open-decision")).toEqual([
      expect.stringContaining(
        "D001 on The part the owner reviews P1-N003: Which store holds the answers? Default: git",
      ),
      expect.stringContaining(
        "D002: A project decision with no node? Default: yes",
      ),
    ]);
    expect(all(waiting, "data-gated")).toEqual([
      expect.stringContaining("The part the owner reviews"),
    ]);
    expect(textOf(waiting)).toContain("owner review of the plan");
  });

  it("lists what is ready, in flight and waiting, with titles first", async () => {
    const { html } = await get(appOver(sampleRepo()), "/view");
    const section = (attr: string): string => {
      const start = html.indexOf(attr);
      return textOf(html.slice(start, html.indexOf("</section>", start)));
    };
    expect(section("data-ready")).toContain("The part that is ready");
    expect(section("data-ready")).not.toContain("The first line of work");
    expect(section("data-in-flight")).toContain("The part in flight");
    expect(section("data-in-flight")).toContain("T002");
    expect(section("data-waiting-on")).toContain("The part that waits");
    expect(section("data-waiting-on")).toContain("after The part in flight");
  });

  it("shows every node in its tree with its class, identifier and outcome, and folds below the roots", async () => {
    const { html } = await get(appOver(sampleRepo()), "/view");
    const tree = html.slice(html.indexOf("data-tree"));
    expect(all(tree, "data-node-id")).toEqual([
      "P1-N001",
      "P1-N002",
      "P1-N003",
      "P1-N004",
      "P1-N005",
      "P1-N006",
      "P1-N007",
      "P2-N001",
    ]);
    const classes = [...tree.matchAll(/data-class="([a-z-]+)"/g)].map(
      (m) => m[1],
    );
    expect(classes.slice(0, 8)).toEqual([
      "in-progress",
      "done",
      "gated",
      "in-flight",
      "waiting",
      "actionable",
      "blocked",
      "parked",
    ]);
    expect(all(tree, "data-outcome")[0]).toBe(
      "The first line of work exists and works.",
    );
    expect(tree).toContain("<details open>");
    expect(all(tree, "data-hold")).toEqual([
      "gated: owner review of the plan",
      "blocked: no credential",
    ]);
    expect(expectLinksPinned(html, undefined).pageLinks).toBeGreaterThan(8);
  });

  it("carries the received ref on every page link", async () => {
    const repo = sampleRepo();
    repo.heads.set("feature", SHA_A);
    const { html } = await get(appOver(repo), "/view?ref=feature");
    expectLinksPinned(html, "feature");
  });

  it("lists the problems check reports, and renders nothing else when the file fails the schema", async () => {
    const repo = sampleRepo();
    const state = sampleState();
    state.nodes[1]!.outcome = null; // a done node with no outcome: invariant 4
    repo.setFile(SHA_A, "orchestration/state.json", stateJson(state));
    const { html } = await get(appOver(repo), "/view");
    expect(all(html, "data-problem")).toEqual([
      expect.stringContaining(
        "violation, invariant 4, P1-N002: is done and has no outcome sentence",
      ),
    ]);
    expect(html).toContain("data-tree");

    repo.setFile(
      SHA_A,
      "orchestration/state.json",
      '{"schema": 0, "nodes": "nope"}',
    );
    const broken = await get(appOver(repo), "/view");
    expect(broken.res.status).toBe(200);
    expect(broken.html).not.toContain("data-tree");
    expect(all(broken.html, "data-problem").join("\n")).toContain(
      "invariant 1",
    );

    repo.setFile(SHA_A, "orchestration/state.json", "not json");
    const notJson = await get(appOver(repo), "/view");
    expect(all(notJson.html, "data-problem")[0]).toContain(
      "orchestration/state.json is not JSON",
    );
  });

  it("answers the error page when the state file is missing at the commit", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_B);
    const { res, html } = await get(appOver(repo), "/view");
    expect(res.status).toBe(404);
    expect(attributeText(html, "data-failing-file")).toBe(
      "orchestration/state.json",
    );
  });
});

describe("the node page", () => {
  it("shows the node in its tree: crumbs, class, stage, outcome, position, dependencies, decisions and tasks", async () => {
    const { res, html } = await get(
      appOver(sampleRepo()),
      "/view/node/P1-N003",
    );
    expect(res.status).toBe(200);
    expect(attributeText(html, "data-crumbs")).toBe(
      "Plan › The first line of work",
    );
    expect(attributeText(html, "data-title")).toBe(
      "The part the owner reviewsP1-N003",
    );
    expect(attributeText(html, "data-stage")).toBe("planned");
    expect(attributeText(html, "data-hold")).toBe(
      "gated: owner review of the plan",
    );
    expect(attributeText(html, "data-outcome")).toBe(
      "The part the owner reviews exists and works.",
    );
    const field = (name: string): string => fieldText(html, name);
    expect(field("parent")).toContain("The first line of work");
    expect(field("children")).toContain("none");
    expect(field("documents")).toContain("plan: docs/plans/third.md");
    expect(field("documents")).toContain("spec: docs/specs/third.md");
    expect(html).toContain(`/blob/${SHA_A}/docs/plans/third.md`);
    expect(all(html, "data-decision")).toEqual([
      expect.stringContaining("D001 Which store holds the answers?"),
    ]);
    expect(textOf(html)).toContain("No task has run on this node");
    expectLinksPinned(html, undefined);
  });

  it("names what a node waits on and what waits on it, and its tasks with pull request links", async () => {
    const { html } = await get(appOver(sampleRepo()), "/view/node/P1-N002");
    const field = (name: string): string => fieldText(html, name);
    expect(field("needed-by")).toContain("The part that is ready");
    expect(field("waits-on")).toContain("nothing recorded");
    expect(all(html, "data-task")).toEqual([
      expect.stringContaining("T001"),
      expect.stringContaining("T003"),
    ]);
    expect(html).toContain(
      "https://github.com/majodali/project-orchestrator-service/pull/18",
    );
    expect(all(html, "data-decision")[0]).toContain(
      "RU-001 Sketch or full implementation?",
    );
    expect(all(html, "data-decision")[0]).toContain("standing");
  });

  it("answers 404 for a node the state file lacks, naming the SHA", async () => {
    const { res, html } = await get(
      appOver(sampleRepo()),
      "/view/node/P9-N999",
    );
    expect(res.status).toBe(404);
    expect(attributeText(html, "data-not-found")).toBe(
      `No node P9-N999 in orchestration/state.json at ${SHA_A}.`,
    );
  });
});

describe("the task page", () => {
  it("shows the task's fields and notes, escaped, with its node linked", async () => {
    const { res, html } = await get(appOver(sampleRepo()), "/view/task/T003");
    expect(res.status).toBe(200);
    expect(attributeText(html, "data-task-id")).toBe("T003");
    const field = (name: string): string => fieldText(html, name);
    expect(field("node")).toBe("The part that is done P1-N002");
    expect(field("step")).toBe("verify");
    expect(field("role")).toBe("reviewer");
    expect(field("tokens")).toBe("not recorded");
    expect(html).toContain(`/commit/abc1234`);
    const notes = html.slice(html.indexOf("data-notes"));
    expect(notes).toContain("&lt;tags&gt; &amp; ampersands");
    expect(textOf(notes)).toContain("A long\nnote with <tags> & ampersands.");
  });

  it("answers 404 for a task the state file lacks", async () => {
    const { res } = await get(appOver(sampleRepo()), "/view/task/T999");
    expect(res.status).toBe(404);
  });
});

describe("over the coordinating repository's state file at 325c502", () => {
  it("renders the tree with 59 nodes, two gated nodes, no open decision, and no problem", async () => {
    const { res, html } = await get(appOver(repository325c502()), "/view");
    expect(res.status).toBe(200);
    expect(attributeText(html, "data-sha")).toBe(COMMIT_325C502);
    expect(
      all(html.slice(html.indexOf("data-tree")), "data-node-id"),
    ).toHaveLength(59);
    expect(all(html, "data-gated")).toHaveLength(2);
    expect(html).not.toContain("data-open-decision");
    expect(html).not.toContain("data-problems");
  });

  it("renders the node page of P2-N021 and the task page of T094", async () => {
    const app = appOver(repository325c502());
    const node = await get(app, "/view/node/P2-N021");
    expect(node.res.status).toBe(200);
    expect(attributeText(node.html, "data-crumbs")).toContain(
      "Owner questions and the plan view",
    );
    expect(all(node.html, "data-task").join(" ")).toContain("T094");
    const task = await get(app, "/view/task/T094");
    expect(task.res.status).toBe(200);
    expect(task.html).toContain("/pull/18");
  });
});
