import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/httpApp.js";
import { parseRegister } from "../src/planRegister/parser.js";
import { GithubAppRegisterFetcher } from "../src/planRegister/registerFetcher.js";
import { ShaPathCache } from "../src/view/commitRead.js";
import {
  FakeRepository,
  NOW,
  OWNER,
  REPO,
  SHA_A,
  SHA_B,
  SHA_C,
  attributeText,
  expectLinksPinned,
  expectPhoneWidth,
  expectViewHeaders,
  textOf,
  unescapeHtml,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The tree page, `GET /view` (node P2-N021, task E1; criteria V1 to V4,
 * V7 and V10 to V13 of the specification of P2-N003, child 1). Pages
 * are rendered in-process through `createApp()` with a fake repository
 * or a fake GitHub, never a real credential.
 */

const REGISTER = "docs/plan-register.md";

/** A copy of the coordinating repository's register at commit
 * 1b9e2074ae87bda7dc4e0ad44060ec06b045a23d (1b9e207, the register after
 * the specification gates of 2026-10-30), byte for byte (V7). */
const FIXTURE_COMMIT = "1b9e2074ae87bda7dc4e0ad44060ec06b045a23d";
const FIXTURE_REGISTER = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "plan-register.1b9e207.txt",
  ),
  "utf-8",
);

const SMALL_REGISTER_A = [
  "# Plan register",
  "",
  "- P1-N001 [broken-down] Commit A root — plan: plans/a.md",
  "  - P1-N002 [executing] Commit A child",
].join("\n");

const SMALL_REGISTER_B = [
  "# Plan register",
  "",
  "- P1-N001 [done] Commit B root — plan: plans/b.md",
].join("\n");

const ORIGINAL_ENV = { ...process.env };

function appFor(repo: FakeRepository) {
  return createApp({ view: { reader: repo, now: () => NOW } });
}

async function getView(
  app: ReturnType<typeof createApp>,
  query = "",
): Promise<{ res: Response; html: string }> {
  const res = await app.request(`/view${query}`, {
    headers: { Cookie: validCookie() },
  });
  expectViewHeaders(res);
  return { res, html: await res.text() };
}

function nodeIds(html: string): string[] {
  return [...html.matchAll(/<li data-node="([^"]+)"/g)].map((m) => m[1]!);
}

beforeEach(() => {
  viewEnv();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("V7 — the tree, from the register at a named commit", () => {
  it(`lists every node the vendored parser returns from the register at ${FIXTURE_COMMIT}, once each, with its nesting, stage, hold marker, title and note`, async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", FIXTURE_COMMIT);
    repo.setFile(FIXTURE_COMMIT, REGISTER, FIXTURE_REGISTER);
    const { res, html } = await getView(appFor(repo));
    expect(res.status).toBe(200);

    const parsed = parseRegister(FIXTURE_REGISTER);
    expect(parsed.errors).toEqual([]);
    expect(parsed.order.length).toBeGreaterThan(50);

    // Every node, once each, in register order.
    const ids = nodeIds(html);
    expect(ids).toEqual(parsed.order);
    expect(new Set(ids).size).toBe(ids.length);

    // The nesting: rebuild each node's parent from the page's own
    // list structure and compare it with the parser's.
    const parents = new Map<string, string | null>();
    const stack: string[] = [];
    for (const m of html.matchAll(/<li data-node="([^"]+)"|<\/li>/g)) {
      if (m[1]) {
        parents.set(m[1], stack.at(-1) ?? null);
        stack.push(m[1]);
      } else {
        stack.pop();
      }
    }
    expect(stack).toEqual([]);
    for (const id of parsed.order) {
      expect(parents.get(id), id).toBe(parsed.nodes.get(id)!.parentId);
    }

    // Per node: stage, hold marker, title and note as the register gives.
    for (const id of parsed.order) {
      const node = parsed.nodes.get(id)!;
      const start = html.indexOf(`<li data-node="${id}"`);
      const own = html.slice(start, html.indexOf("</div>", start) + 6);
      const afterOwn = html.slice(start + own.length);
      expect(attributeText(own, "data-stage"), id).toBe(`[${node.stage}]`);
      expect(attributeText(own, "data-title"), id).toBe(node.title);
      expect(attributeText(own, "data-hold"), id).toBe(
        node.hold ? `[${node.hold.kind}: ${node.hold.reason}]` : null,
      );
      const noteMatch = /^<div class="note" data-note>([\s\S]*?)<\/div>/.exec(
        afterOwn,
      );
      expect(noteMatch ? textOf(noteMatch[1]!) : null, id).toBe(
        node.annotation,
      );
    }

    // Spot checks against the register text itself.
    expect(html).toContain(
      "[gated: owner review of the plan]</span> <span data-title>Process spec maintenance: branch lifecycle, PR citation, packet table</span>",
    );
    expect(textOf(html)).toContain(
      "P2-N021 [identified] The web view's first version",
    );
  });

  it("links each node ID to its node page, and each register document link to GitHub at the page's SHA", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", FIXTURE_COMMIT);
    repo.setFile(FIXTURE_COMMIT, REGISTER, FIXTURE_REGISTER);
    const { html } = await getView(appFor(repo), "?ref=main");
    expect(html).toContain(
      '<a data-node-link href="/view/node/P2-N021?ref=main">P2-N021</a>',
    );
    expect(html).toContain(
      `href="https://github.com/${OWNER}/${REPO}/blob/${FIXTURE_COMMIT}/docs/specs/p2-n003-owner-questions-and-plan-view.md"`,
    );
    expect(html).toContain(
      `href="https://github.com/${OWNER}/${REPO}/blob/${FIXTURE_COMMIT}/docs/plans/orchestrator-v1.md"`,
    );
  });
});

describe("V1 — one commit per page", () => {
  it("shows one SHA, and only that SHA's facts, when the branch head moves between the page's reads", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    repo.setFile(SHA_A, REGISTER, SMALL_REGISTER_A);
    repo.setFile(SHA_B, REGISTER, SMALL_REGISTER_B);
    // The head moves the moment the page has resolved its ref, before
    // any file is read.
    repo.afterResolve = () => repo.heads.set("main", SHA_B);

    const { html } = await getView(appFor(repo));
    expect(attributeText(html, "data-sha")).toBe(SHA_A);
    expect(html).not.toContain(SHA_B);
    expect(html).toContain("Commit A root");
    expect(html).not.toContain("Commit B root");
    expect(repo.resolveCalls).toEqual([undefined]);
    expect(repo.readCalls).toEqual([{ sha: SHA_A, path: REGISTER }]);
  });

  it("reads every file through the GitHub App at the resolved SHA, never by branch name, while the real branch head moves", async () => {
    const heads = [SHA_A, SHA_B];
    const contentsUrls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith(`/repos/${OWNER}/${REPO}`)) {
        return Response.json({ default_branch: "main" });
      }
      if (url.includes("/commits/main")) {
        return Response.json({ sha: heads.shift() ?? SHA_B });
      }
      if (url.includes("/contents/")) {
        contentsUrls.push(url);
        const sha = new URL(url).searchParams.get("ref");
        const text = sha === SHA_A ? SMALL_REGISTER_A : SMALL_REGISTER_B;
        return Response.json({
          encoding: "base64",
          content: Buffer.from(text).toString("base64"),
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const reader = new GithubAppRegisterFetcher(
      OWNER,
      REPO,
      async () => "fake-installation-token",
      fetchImpl,
    );
    const app = createApp({ view: { reader, now: () => NOW } });
    const { html } = await getView(app);
    expect(attributeText(html, "data-sha")).toBe(SHA_A);
    expect(html).toContain("Commit A root");
    expect(contentsUrls).toHaveLength(1);
    for (const url of contentsUrls) {
      expect(new URL(url).searchParams.get("ref")).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("refuses, in the production reader, to read a file by anything but a full SHA", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const reader = new GithubAppRegisterFetcher(
      OWNER,
      REPO,
      async () => "fake-installation-token",
      fetchImpl,
    );
    await expect(reader.readFileAtSha("main", REGISTER)).rejects.toThrow(
      /full 40-character commit SHA/,
    );
    await expect(reader.readFileAtSha("abc1234", REGISTER)).rejects.toThrow(
      /full 40-character commit SHA/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("V2 — the header", () => {
  it("names the requested ref, the full SHA and the fetch time on the tree page", async () => {
    const repo = new FakeRepository();
    repo.heads.set("release/1", SHA_A);
    repo.setFile(SHA_A, REGISTER, SMALL_REGISTER_A);
    const { html } = await getView(appFor(repo), "?ref=release%2F1");
    expect(attributeText(html, "data-ref")).toBe("release/1");
    expect(attributeText(html, "data-sha")).toBe(SHA_A);
    expect(attributeText(html, "data-fetched")).toBe(NOW.toISOString());
    expect(html).toContain(
      `href="https://github.com/${OWNER}/${REPO}/commit/${SHA_A}"`,
    );
  });

  it("names the requested ref, the full SHA, the failing file and the fetch time on a read-failure error page", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    repo.failRead = { path: REGISTER, status: 403 };
    const { res, html } = await getView(appFor(repo), "?ref=main");
    expect(res.status).toBe(502);
    expect(attributeText(html, "data-ref")).toBe("main");
    expect(attributeText(html, "data-sha")).toBe(SHA_A);
    expect(attributeText(html, "data-fetched")).toBe(NOW.toISOString());
    expect(attributeText(html, "data-failing-file")).toBe(REGISTER);
    expect(attributeText(html, "data-github-status")).toBe("403");
    expect(html).not.toContain("data-node");
  });

  it("names the requested ref and the fetch time, and says no SHA resolved, on an unresolved-ref error page", async () => {
    const repo = new FakeRepository();
    const { res, html } = await getView(appFor(repo), "?ref=no-such-branch");
    expect(res.status).toBe(404);
    expect(attributeText(html, "data-ref")).toBe("no-such-branch");
    expect(attributeText(html, "data-sha")).toBe(
      "none, the ref did not resolve",
    );
    expect(attributeText(html, "data-fetched")).toBe(NOW.toISOString());
  });
});

describe("V3 — the ref parameter, through the GitHub App reader", () => {
  const BRANCH_HEAD = SHA_B;
  const DEFAULT_HEAD = SHA_A;

  function fakeGithub() {
    const calls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith(`/repos/${OWNER}/${REPO}`)) {
        return Response.json({ default_branch: "main" });
      }
      const commit = /\/commits\/([^/?]+)$/.exec(url);
      if (commit) {
        const ref = decodeURIComponent(commit[1]!);
        const sha =
          ref === "main"
            ? DEFAULT_HEAD
            : ref === "feature"
              ? BRANCH_HEAD
              : [SHA_A, SHA_B, SHA_C].find(
                  (candidate) => ref.length >= 7 && candidate.startsWith(ref),
                );
        return sha
          ? Response.json({ sha })
          : Response.json(
              { message: `No commit found for SHA: ${ref}` },
              { status: 422 },
            );
      }
      if (url.includes("/contents/")) {
        const sha = new URL(url).searchParams.get("ref")!;
        return Response.json({
          encoding: "base64",
          content: Buffer.from(`- P1-N001 [done] Register at ${sha}`).toString(
            "base64",
          ),
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const reader = new GithubAppRegisterFetcher(
      OWNER,
      REPO,
      async () => "fake-installation-token",
      fetchImpl,
    );
    return { app: createApp({ view: { reader, now: () => NOW } }), calls };
  }

  it("with no ref, reads the default branch's head", async () => {
    const { app, calls } = fakeGithub();
    const { res, html } = await getView(app);
    expect(res.status).toBe(200);
    expect(attributeText(html, "data-sha")).toBe(DEFAULT_HEAD);
    expect(attributeText(html, "data-ref")).toBe("the default branch, main");
    expect(html).toContain(`Register at ${DEFAULT_HEAD}`);
    expect(calls[0]).toMatch(new RegExp(`/repos/${OWNER}/${REPO}$`));
  });

  it("with a branch name, reads that branch's head", async () => {
    const { app } = fakeGithub();
    const { html } = await getView(app, "?ref=feature");
    expect(attributeText(html, "data-ref")).toBe("feature");
    expect(attributeText(html, "data-sha")).toBe(BRANCH_HEAD);
    expect(html).toContain(`Register at ${BRANCH_HEAD}`);
  });

  it("with a SHA, short or full, reads that commit", async () => {
    const { app } = fakeGithub();
    const short = await getView(app, `?ref=${SHA_C.slice(0, 7)}`);
    expect(attributeText(short.html, "data-ref")).toBe(SHA_C.slice(0, 7));
    expect(attributeText(short.html, "data-sha")).toBe(SHA_C);
    expect(short.html).toContain(`Register at ${SHA_C}`);
    const full = await getView(app, `?ref=${SHA_C}`);
    expect(attributeText(full.html, "data-sha")).toBe(SHA_C);
    expect(full.html).toContain(`Register at ${SHA_C}`);
  });

  it("with a ref that does not resolve, answers a page naming the ref and GitHub's status, with no plan content", async () => {
    const { app } = fakeGithub();
    const { res, html } = await getView(app, "?ref=no-such-ref");
    expect(res.status).toBe(404);
    expect(attributeText(html, "data-ref")).toBe("no-such-ref");
    expect(attributeText(html, "data-github-status")).toBe("422");
    expect(textOf(html)).toContain('The ref "no-such-ref" did not resolve');
    expect(html).not.toContain("data-node");
    expect(html).not.toContain("Register at");
  });
});

describe("V4 — the cache answers no state", () => {
  it("shows two SHAs for two requests with the branch head moved between them", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    repo.setFile(SHA_A, REGISTER, SMALL_REGISTER_A);
    repo.setFile(SHA_B, REGISTER, SMALL_REGISTER_B);
    const app = appFor(repo);

    const first = await getView(app);
    expect(attributeText(first.html, "data-sha")).toBe(SHA_A);
    expect(first.html).toContain("Commit A root");

    repo.heads.set("main", SHA_B);
    const second = await getView(app);
    expect(attributeText(second.html, "data-sha")).toBe(SHA_B);
    expect(second.html).toContain("Commit B root");
    expect(second.html).not.toContain("Commit A root");
    expect(repo.resolveCalls).toEqual([undefined, undefined]);
  });

  it("resolves the ref on every request, and reuses content only for the same SHA and path", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    repo.setFile(SHA_A, REGISTER, SMALL_REGISTER_A);
    const app = appFor(repo);
    await getView(app);
    await getView(app);
    expect(repo.resolveCalls).toHaveLength(2);
    expect(repo.readCalls).toEqual([{ sha: SHA_A, path: REGISTER }]);
  });

  it("keys the cache by a full SHA and a path, and refuses any other key", () => {
    const cache = new ShaPathCache(2);
    cache.set(SHA_A, REGISTER, "a");
    expect(cache.get(SHA_A, REGISTER)).toBe("a");
    expect(cache.get(SHA_B, REGISTER)).toBeUndefined();
    expect(() => cache.get("main", REGISTER)).toThrow(/full SHA/);
    expect(() => cache.set("main", REGISTER, "x")).toThrow(/full SHA/);
    cache.set(SHA_B, REGISTER, "b");
    cache.set(SHA_C, REGISTER, "c");
    expect(cache.get(SHA_A, REGISTER)).toBeUndefined();
  });
});

describe("V10 to V13 — what every page carries", () => {
  function fixtureRepo(): FakeRepository {
    const repo = new FakeRepository();
    repo.heads.set("main", FIXTURE_COMMIT);
    repo.heads.set("feature/a b", SHA_A);
    repo.setFile(FIXTURE_COMMIT, REGISTER, FIXTURE_REGISTER);
    repo.setFile(SHA_A, REGISTER, FIXTURE_REGISTER);
    return repo;
  }

  const REFS: Array<string | undefined> = [
    undefined,
    "main",
    "feature/a b",
    FIXTURE_COMMIT,
  ];

  it("V10 — on the tree page, pins every document link to a full SHA, names no branch, and carries the received ref unchanged on every link between pages", async () => {
    for (const ref of REFS) {
      const app = appFor(fixtureRepo());
      const query = ref === undefined ? "" : `?ref=${encodeURIComponent(ref)}`;
      const { res, html } = await getView(app, query);
      expect(res.status, String(ref)).toBe(200);
      const counts = expectLinksPinned(html, ref);
      // Backlog, register, and the register's own document links.
      expect(counts.documentLinks).toBeGreaterThan(30);
      // Reload link, plus one node link per node.
      expect(counts.pageLinks).toBe(
        parseRegister(FIXTURE_REGISTER).order.length + 1,
      );
    }
  });

  it("V10 — on both error pages, the same holds", async () => {
    for (const ref of ["main", "no-such-ref"]) {
      const repo = new FakeRepository();
      repo.heads.set("main", SHA_A);
      repo.failRead = { path: REGISTER, status: 500 };
      const { html } = await getView(appFor(repo), `?ref=${ref}`);
      expectLinksPinned(html, ref);
    }
  });

  it("V10 — the sign-in page links no branch", async () => {
    const res = await createApp().request("/view/sign-in");
    expectViewHeaders(res);
    expectLinksPinned(await res.text(), undefined);
  });

  it("V11 — renders a register title holding a <script> tag as text", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    repo.setFile(
      SHA_A,
      REGISTER,
      [
        '- P1-N001 [identified] <script>alert("fake")</script> title — note <img src=x onerror=alert(1)> & "quoted" · plan: plans/x.md',
        "  - P1-N002 [done] [gated: <b>bold</b> reason] Child",
      ].join("\n"),
    );
    const { html } = await getView(appFor(repo));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<b>/);
    expect(html).toContain(
      "&lt;script&gt;alert(&quot;fake&quot;)&lt;/script&gt; title",
    );
    expect(textOf(html)).toContain('<script>alert("fake")</script> title');
    expect(unescapeHtml(html)).toContain("[gated: <b>bold</b> reason]");
  });

  it("V12 — every page carries a viewport meta tag, runs no script, and no style sets a width above 360 CSS pixels", async () => {
    const tree = await getView(appFor(fixtureRepo()));
    expectPhoneWidth(tree.html);
    const error = await getView(appFor(fixtureRepo()), "?ref=no-such-ref");
    expectPhoneWidth(error.html);
    const signIn = await createApp().request("/view/sign-in");
    expectPhoneWidth(await signIn.text());
  });

  it("V13 — every page carries the no-progress-authority line, linking the Backlog at the page's SHA where it has one", async () => {
    const tree = await getView(appFor(fixtureRepo()), "?ref=main");
    const treeLimit = /<p class="limit" data-limit>([\s\S]*?)<\/p>/.exec(
      tree.html,
    );
    expect(textOf(treeLimit![1]!)).toContain(
      "This page carries no progress authority",
    );
    expect(treeLimit![1]).toContain(
      `href="https://github.com/${OWNER}/${REPO}/blob/${FIXTURE_COMMIT}/docs/backlog.md"`,
    );

    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    repo.failRead = { path: REGISTER, status: 500 };
    const readFailure = await getView(appFor(repo), "?ref=main");
    expect(readFailure.html).toContain(
      `href="https://github.com/${OWNER}/${REPO}/blob/${SHA_A}/docs/backlog.md"`,
    );

    const unresolved = await getView(appFor(repo), "?ref=no-such-ref");
    const signIn = await (await createApp().request("/view/sign-in")).text();
    for (const html of [unresolved.html, signIn]) {
      expect(textOf(html)).toContain("This page carries no progress authority");
      expect(textOf(html)).toContain(
        "not linked because this page resolved no commit",
      );
    }
  });
});
