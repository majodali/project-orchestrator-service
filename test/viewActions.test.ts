import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { StateStore, WriteRefusedError } from "../src/model/store.js";
import type { State } from "../src/model/schema.js";
import { sampleState, stateJson } from "./support/states.js";
import type { CommitChecks } from "../src/planRegister/commitChecks.js";
import {
  FakePullRequests,
  FakeRepository,
  NOW,
  SHA_A,
  attributeText,
  expectViewHeaders,
  textOf,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The view's writes (the rebuild plan, milestone 4): the owner closes
 * an open decision where it is shown and acts on a node's lifecycle
 * with one click; each is one commit through the store, named on the
 * page the browser returns to; a refused change commits nothing.
 */

const ORIGINAL_ENV = { ...process.env };

function repoWith(state: State = sampleState()): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", SHA_A);
  repo.setFile(SHA_A, "orchestration/state.json", stateJson(state));
  return repo;
}

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

async function get(app: ReturnType<typeof createApp>, path: string) {
  const res = await app.request(path, { headers: { Cookie: validCookie() } });
  return { res, html: await res.text() };
}

async function post(
  app: ReturnType<typeof createApp>,
  path: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const body = new URLSearchParams(fields).toString();
  const res = await app.request(path, {
    method: "POST",
    headers: {
      Cookie: validCookie(),
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body,
  });
  return { res, html: await res.text() };
}

function stateAtHead(repo: FakeRepository): State {
  const sha = repo.heads.get("main")!;
  return JSON.parse(repo.files.get(sha)!.get("orchestration/state.json")!);
}

function journalAtHead(repo: FakeRepository): Record<string, unknown>[] {
  const sha = repo.heads.get("main")!;
  const text = repo.files.get(sha)!.get("orchestration/journal.jsonl") ?? "";
  return text
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l));
}

beforeEach(() => viewEnv());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("the forms on the pages", () => {
  it("puts the closing form under an open decision, the default preselected, and none under a closed one", async () => {
    const { html } = await get(appOver(repoWith()), "/view/node/P1-N003");
    expect(html).toContain('data-decision-form="D001"');
    expect(html).toContain('action="/view/decision/D001/close"');
    expect(html).toMatch(
      /<input type="radio" name="chosen" value="git" checked> git <span class="note">\(the default\)<\/span>/,
    );
    expect(html).toContain('name="chosen" value="__other__"');
    expect(html).toContain('name="standing"');
    const closed = await get(appOver(repoWith()), "/view/node/P1-N002");
    expect(closed.html).not.toContain("data-decision-form");
  });

  it("offers each lifecycle action open on a node, and none on a node with none", async () => {
    const app = appOver(repoWith());
    const gated = await get(app, "/view/node/P1-N003");
    expect(attributeText(gated.html, "data-actions")).toContain(
      "Lift the hold",
    );
    expect(gated.html).toContain('data-node-action="lift-hold"');
    expect(gated.html).toContain('action="/view/node/P1-N003/action"');
    const approve = await get(app, "/view/node/P1-N008");
    expect(approve.html).toContain('data-node-action="approve-start"');
    expect(approve.html).not.toContain('data-node-action="lift-hold"');
    const done = await get(app, "/view/node/P1-N002");
    expect(done.html).not.toContain("data-actions");
  });

  it("shows the accept-review action on a node under review", async () => {
    const state = sampleState();
    state.nodes.find((n) => n.id === "P1-N004")!.stage = "verifying";
    state.tasks = state.tasks.filter((t) => t.node !== "P1-N004");
    const { html } = await get(appOver(repoWith(state)), "/view/node/P1-N004");
    expect(html).toContain('data-node-action="accept-review"');
  });

  it("links an open decision in the tree to its node page, and puts the form under a project decision", async () => {
    const state = sampleState();
    state.decisions.push({
      id: "D009",
      node: null,
      question: "Which branch is the default?",
      options: ["main", "trunk"],
      default: "main",
      chosen: null,
      decided: null,
      rationale: null,
      standing: false,
      source: null,
    });
    const { html } = await get(appOver(repoWith(state)), "/view");
    expect(html).toContain('href="/view/node/P1-N003#D001">answer</a>');
    expect(html).toContain('data-decision-form="D009"');
    expect(html).toContain('action="/view/decision/D009/close"');
  });
});

describe("closing a decision", () => {
  it("commits the chosen option with today's date and the note, appends the journal event, and returns to the node page naming the commit", async () => {
    const repo = repoWith();
    const app = appOver(repo);
    const { res } = await post(app, "/view/decision/D001/close", {
      chosen: "git",
      note: "git is the only state",
    });
    expect(res.status).toBe(303);
    expectViewHeaders(res);
    const sha = repo.heads.get("main")!;
    expect(res.headers.get("Location")).toBe(
      `/view/node/P1-N003?committed=${sha}`,
    );
    expect(repo.commits).toHaveLength(1);
    expect(repo.commits[0]!.message).toBe("D001: git");
    expect([...repo.commits[0]!.files.keys()].sort()).toEqual([
      "docs/plan-register.md",
      "docs/plan.md",
      "orchestration/journal.jsonl",
      "orchestration/state.json",
    ]);
    const d = stateAtHead(repo).decisions.find((x) => x.id === "D001")!;
    expect(d.chosen).toBe("git");
    expect(d.decided).toBe("2026-10-30");
    expect(d.rationale).toBe("git is the only state");
    expect(d.standing).toBe(false);
    const event = journalAtHead(repo).at(-1)!;
    expect(event.event).toBe("state-written");
    expect(event.node).toBe("P1-N003");
    expect(event.session).toBe("the owner, in the view");
    expect(event.ref).toBe(SHA_A);
    expect(event.note).toBe("decision_close D001: git");

    const page = await get(app, `/view/node/P1-N003?committed=${sha}`);
    expect(page.res.status).toBe(200);
    expect(attributeText(page.html, "data-committed")).toContain(
      `Committed as ${sha.slice(0, 7)}. This page reads it.`,
    );
    expect(page.html).not.toContain("data-decision-form");
  });

  it("takes another answer from the text field, and the standing flag", async () => {
    const repo = repoWith();
    await post(appOver(repo), "/view/decision/D001/close", {
      chosen: "__other__",
      other: "a file in S3",
      standing: "yes",
    });
    const d = stateAtHead(repo).decisions.find((x) => x.id === "D001")!;
    expect(d.chosen).toBe("a file in S3");
    expect(d.standing).toBe(true);
    expect(d.rationale).toBeNull();
  });

  it("returns to the tree page for a project decision", async () => {
    const state = sampleState();
    state.decisions.push({
      id: "D009",
      node: null,
      question: "Which branch is the default?",
      options: ["main"],
      default: "main",
      chosen: null,
      decided: null,
      rationale: null,
      standing: false,
      source: null,
    });
    const repo = repoWith(state);
    const { res } = await post(appOver(repo), "/view/decision/D009/close", {
      chosen: "main",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(
      `/view?committed=${repo.heads.get("main")}`,
    );
  });

  it("refuses an empty answer, an unknown decision and a closed one, committing nothing", async () => {
    const repo = repoWith();
    const app = appOver(repo);
    const empty = await post(app, "/view/decision/D001/close", {
      chosen: "__other__",
      other: "  ",
    });
    expect(empty.res.status).toBe(400);
    expect(textOf(empty.html)).toContain("Nothing was committed");
    const unknown = await post(app, "/view/decision/D999/close", {
      chosen: "x",
    });
    expect(unknown.res.status).toBe(404);
    expect(attributeText(unknown.html, "data-error")).toBe(
      "no decision D999. Nothing was committed.",
    );
    const closed = await post(app, "/view/decision/RU-001/close", {
      chosen: "x",
    });
    expect(closed.res.status).toBe(404);
    expect(textOf(closed.html)).toContain("already closed");
    expect(repo.commits).toHaveLength(0);
  });
});

describe("acting on a node", () => {
  it("lifts a hold, with the note as the reason, and names the commit on the node page", async () => {
    const repo = repoWith();
    const app = appOver(repo);
    const { res } = await post(app, "/view/node/P1-N003/action", {
      action: "lift-hold",
      note: "plan reviewed",
    });
    expect(res.status).toBe(303);
    const sha = repo.heads.get("main")!;
    expect(res.headers.get("Location")).toBe(
      `/view/node/P1-N003?committed=${sha}`,
    );
    expect(repo.commits[0]!.message).toBe("P1-N003: plan reviewed");
    const n = stateAtHead(repo).nodes.find((x) => x.id === "P1-N003")!;
    expect(n.hold).toBeNull();
    expect(journalAtHead(repo).at(-1)!.note).toBe(
      "node_update P1-N003: hold lifted. plan reviewed",
    );
    const page = await get(app, `/view/node/P1-N003?committed=${sha}`);
    expect(page.html).not.toContain('data-node-action="lift-hold"');
    expect(attributeText(page.html, "data-committed")).toContain(
      "This page reads it.",
    );
  });

  it("approves a start: the node then starts automatically", async () => {
    const repo = repoWith();
    await post(appOver(repo), "/view/node/P1-N008/action", {
      action: "approve-start",
    });
    const n = stateAtHead(repo).nodes.find((x) => x.id === "P1-N008")!;
    expect(n.start).toBe("auto");
    expect(repo.commits[0]!.message).toBe("P1-N008: Approve the start");
  });

  it("accepts a review: the node is done with today's date", async () => {
    const state = sampleState();
    state.nodes.find((n) => n.id === "P1-N004")!.stage = "verifying";
    state.tasks = state.tasks.filter((t) => t.node !== "P1-N004");
    const repo = repoWith(state);
    await post(appOver(repo), "/view/node/P1-N004/action", {
      action: "accept-review",
    });
    const n = stateAtHead(repo).nodes.find((x) => x.id === "P1-N004")!;
    expect(n.stage).toBe("done");
    expect(n.done).toBe("2026-10-30");
  });

  it("answers a change the invariants refuse with the violations, and commits nothing", async () => {
    // No action the view offers can break an invariant of the sample
    // state, so the store's refusal is stood in for here; the store's
    // own tests cover what it refuses.
    const repo = repoWith();
    class RefusingStore extends StateStore {
      override write(): Promise<never> {
        return Promise.reject(
          new WriteRefusedError([
            {
              severity: "violation",
              invariant: 3,
              subject: "P1-N001",
              message: "has 7 child node(s) but stage is planned",
            },
          ]),
        );
      }
    }
    const store = new RefusingStore({
      reader: repo,
      writer: repo,
      now: () => NOW,
    });
    const app = createApp({ view: { reader: repo, store, now: () => NOW } });
    const { res, html } = await post(app, "/view/node/P1-N001/action", {
      action: "accept-review",
    });
    expect(res.status).toBe(422);
    expectViewHeaders(res);
    expect(attributeText(html, "data-error")).toContain(
      "Nothing was committed",
    );
    expect(attributeText(html, "data-error")).toContain("violation 3");
    expect(repo.commits).toHaveLength(0);
    expect(html).toContain('href="/view/node/P1-N001"');
  });

  it("refuses an action it does not offer and an unknown node, committing nothing", async () => {
    const repo = repoWith();
    const app = appOver(repo);
    const bad = await post(app, "/view/node/P1-N003/action", {
      action: "delete",
    });
    expect(bad.res.status).toBe(400);
    const missing = await post(app, "/view/node/P9-N999/action", {
      action: "lift-hold",
    });
    expect(missing.res.status).toBe(404);
    // A hold already lifted: nothing differs, so nothing to change.
    const nothing = await post(app, "/view/node/P1-N004/action", {
      action: "lift-hold",
    });
    expect(nothing.res.status).toBe(404);
    expect(textOf(nothing.html)).toContain("nothing to change");
    expect(repo.commits).toHaveLength(0);
  });

  it("reports a branch that moved twice as a conflict, committing nothing", async () => {
    const repo = repoWith();
    // Every resolution moves the head away from what the write expects.
    let n = 0;
    repo.afterResolve = () => {
      n += 1;
      const sha = `${n}`.padStart(40, "f");
      repo.setFile(sha, "orchestration/state.json", stateJson(sampleState()));
      repo.heads.set("main", sha);
    };
    const { res, html } = await post(
      appOver(repo),
      "/view/node/P1-N003/action",
      { action: "lift-hold" },
    );
    expect(res.status).toBe(409);
    expect(textOf(html)).toContain("Nothing was committed");
    expect(repo.commits).toHaveLength(0);
  });
});

describe("what a write route refuses before reading anything", () => {
  it("sends a request without the cookie to sign in", async () => {
    const repo = repoWith();
    const res = await appOver(repo).request("/view/decision/D001/close", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "chosen=git",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/view/sign-in");
    expect(repo.commits).toHaveLength(0);
  });

  it("refuses a POST the browser marks cross-site or whose Origin is another host, and accepts the request's own origin, a null one or none", async () => {
    const repo = repoWith();
    const app = appOver(repo);
    const foreign = await post(
      app,
      "/view/node/P1-N003/action",
      { action: "lift-hold" },
      { Origin: "https://evil.example" },
    );
    expect(foreign.res.status).toBe(403);
    expectViewHeaders(foreign.res);
    const marked = await post(
      app,
      "/view/node/P1-N003/action",
      { action: "lift-hold" },
      { "Sec-Fetch-Site": "cross-site", Origin: "http://localhost" },
    );
    expect(marked.res.status).toBe(403);
    expect(repo.commits).toHaveLength(0);
    // `app.request` makes its requests to http://localhost. A browser
    // posting under `Referrer-Policy: no-referrer` sends `Origin: null`.
    const same = await post(
      app,
      "/view/node/P1-N003/action",
      { action: "lift-hold" },
      { "Sec-Fetch-Site": "same-origin", Origin: "null" },
    );
    expect(same.res.status).toBe(303);
    expect(repo.commits).toHaveLength(1);
    const plain = await post(
      app,
      "/view/node/P1-N008/action",
      { action: "approve-start" },
      { Origin: "http://localhost" },
    );
    expect(plain.res.status).toBe(303);
    expect(repo.commits).toHaveLength(2);
  });

  it("accepts no method but POST on a write path, and no POST on a read path", async () => {
    const app = appOver(repoWith());
    const read = await app.request("/view/decision/D001/close", {
      headers: { Cookie: validCookie() },
    });
    expect(read.status).toBe(405);
    expect(read.headers.get("Allow")).toBe("POST");
    const write = await app.request("/view/node/P1-N003", {
      method: "POST",
      headers: { Cookie: validCookie() },
    });
    expect(write.status).toBe(405);
    expect(write.headers.get("Allow")).toBe("GET");
  });
});
