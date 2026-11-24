/**
 * A hand-run check of the view's self-updating script (node P2-N037;
 * the specification of P2-N028, section 3), against a real browser.
 * Playwright is not a dependency of this repository (as `view:shots`
 * already notes): this script `require`s the copy pre-installed in
 * Claude Code sessions, the same way.
 *
 *   npx tsx src/view/preview/selfUpdateCheck.ts
 *
 * It starts `createApp()` on a free port over an in-memory repository
 * this script can move the head of, so it can simulate a new commit
 * mid-check without touching GitHub. It checks, in one browser
 * session:
 *
 *   1. the open tree page shows a new commit within 30 seconds, with
 *      no reload, the scroll position and the manually-toggled
 *      `<details>` kept (criterion 3);
 *   2. typed, unsent text in a form is kept, with "The plan changed"
 *      shown instead of a silent replace, until "Update" is clicked
 *      (criterion 4);
 *   3. with scripts disabled, the page still renders and a form still
 *      commits a real write (criterion 6).
 *
 * Exits non-zero naming the first check that failed; prints each
 * check's result otherwise.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";

import { serve } from "@hono/node-server";

import { createApp } from "../../httpApp.js";
import type { State } from "../../model/schema.js";
import { StateStore } from "../../model/store.js";
import type {
  CommitRequest,
  CommitResult,
  GitWriter,
} from "../../planRegister/gitWriter.js";
import { GitConflictError } from "../../planRegister/gitWriter.js";
import type {
  CommitReader,
  ResolvedCommit,
} from "../../planRegister/registerFetcher.js";
import { GithubFetchError } from "../../planRegister/registerFetcher.js";
import { signViewCookie, VIEW_COOKIE_NAME } from "../viewAuth.js";

const VIEW_TOKEN = "preview-self-update-check-token";

/** The same shape as `test/support/view.ts`'s `FakeRepository`, kept
 * apart from `test/` so this script does not import test-only code
 * into the preview path. */
class InMemoryRepo implements CommitReader, GitWriter {
  readonly owner = "majodali";
  readonly repo = "project-orchestrator";
  readonly heads = new Map<string, string>();
  readonly files = new Map<string, Map<string, string>>();

  setFile(sha: string, path: string, content: string): void {
    const atSha = this.files.get(sha) ?? new Map<string, string>();
    atSha.set(path, content);
    this.files.set(sha, atSha);
  }

  async resolveRef(ref?: string): Promise<ResolvedCommit> {
    const name = ref ?? "main";
    const sha = this.heads.get(name);
    if (sha === undefined) {
      throw new GithubFetchError(`could not resolve ref ${name}`, 422, "none");
    }
    return { ref: name, sha };
  }

  async readFileAtSha(sha: string, path: string): Promise<string> {
    const content = this.files.get(sha)?.get(path);
    if (content === undefined) {
      throw new GithubFetchError(`no ${path} at ${sha}`, 404, "Not Found");
    }
    return content;
  }

  async commitFiles(request: CommitRequest): Promise<CommitResult> {
    const head = this.heads.get(request.branch);
    if (head !== request.expectedHeadSha) {
      throw new GitConflictError(
        request.branch,
        request.expectedHeadSha,
        head ?? null,
      );
    }
    const hash = createHash("sha1").update(
      request.expectedHeadSha + request.message,
    );
    for (const [path, content] of request.files)
      hash.update(path).update(content);
    const sha = hash.digest("hex");
    const files = new Map(this.files.get(request.expectedHeadSha) ?? []);
    for (const [path, content] of request.files) files.set(path, content);
    this.files.set(sha, files);
    this.heads.set(request.branch, sha);
    return { sha };
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

/** A small state with two roots, each with one child, so the tree
 * carries two `<details>` elements to toggle, and one project
 * decision, whose form carries the "note" text field and the submit
 * button this script checks against. Its node's title names the
 * revision, so each commit's content differs. */
function stateAt(revision: number): State {
  return {
    schema: 0,
    project: "majodali/project-orchestrator",
    nodes: [
      {
        id: "P1-N001",
        kind: "work",
        title: `Root one, revision ${revision}`,
        outcome: "Root one exists and works.",
        stage: "broken-down",
        parent: null,
        repository: null,
        after: [],
        hold: null,
        start: "auto",
        docs: { plan: null, spec: null },
        done: null,
        note: null,
      },
      {
        id: "P1-N002",
        kind: "work",
        title: "A child of root one",
        outcome: "The child exists and works.",
        stage: "specified",
        parent: "P1-N001",
        repository: null,
        after: [],
        hold: null,
        start: "auto",
        docs: { plan: null, spec: null },
        done: null,
        note: null,
      },
      {
        id: "P1-N010",
        kind: "work",
        title: "Root two",
        outcome: "Root two exists and works.",
        stage: "broken-down",
        parent: null,
        repository: null,
        after: [],
        hold: null,
        start: "auto",
        docs: { plan: null, spec: null },
        done: null,
        note: null,
      },
      {
        id: "P1-N011",
        kind: "work",
        title: "A child of root two",
        outcome: "The other child exists and works.",
        stage: "specified",
        parent: "P1-N010",
        repository: null,
        after: [],
        hold: null,
        start: "auto",
        docs: { plan: null, spec: null },
        done: null,
        note: null,
      },
    ],
    tasks: [],
    decisions: [
      {
        id: "D900",
        node: null,
        question: "A decision for the self-update check",
        options: ["yes", "no"],
        default: "yes",
        chosen: null,
        decided: null,
        rationale: null,
        standing: false,
        source: null,
      },
    ],
  };
}

function stateJson(state: State): string {
  return JSON.stringify(state, null, 2) + "\n";
}

function commit(repo: InMemoryRepo, revision: number): string {
  const content = stateJson(stateAt(revision));
  const hash = createHash("sha1").update(`rev-${revision}`).digest("hex");
  repo.setFile(hash, "orchestration/state.json", content);
  repo.heads.set("main", hash);
  return hash;
}

interface Chromium {
  launch(options?: { args?: string[] }): Promise<Browser>;
}
interface Browser {
  newContext(options: object): Promise<BrowserContext>;
  close(): Promise<void>;
}
interface BrowserContext {
  newPage(): Promise<Page>;
  addCookies(cookies: object[]): Promise<void>;
  close(): Promise<void>;
}
interface Page {
  goto(url: string): Promise<{ status(): number } | null>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  textContent(selector: string): Promise<string | null>;
  isVisible(selector: string): Promise<boolean>;
  /** A real function, run in the page over CDP: a *string* here would
   * be parsed by the page's own `eval`, which the strict CSP this
   * node adds (`script-src 'self'`, no `'unsafe-eval'`) refuses. */
  evaluate<T>(fn: (arg: never) => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  waitForFunction<A>(
    fn: (arg: A) => unknown,
    arg: A,
    options?: { timeout?: number },
  ): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
}

/** Ambient, browser-side only: every `page.evaluate`/`waitForFunction`
 * callback below runs inside the page over CDP, never in this
 * process, but this file is checked against Node's lib (no DOM), so
 * `document` and `window` are declared loosely here rather than by
 * adding the DOM lib to the whole project for one script. */
declare const document: {
  querySelector(selector: string): {
    textContent?: string | null;
    value?: string;
  } | null;
  querySelectorAll(selector: string): Array<{
    open: boolean;
    parentElement: { getAttribute(name: string): string | null } | null;
  }>;
};
declare const window: { scrollTo(x: number, y: number): void; scrollY: number };

let failed = false;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`PASS — ${name}${detail ? `: ${detail}` : ""}`);
  } else {
    failed = true;
    console.error(`FAIL — ${name}${detail ? `: ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  process.env.VIEW_TOKEN = VIEW_TOKEN;
  delete process.env.MCP_AUTH_TOKEN;

  const repo = new InMemoryRepo();
  const rev1 = commit(repo, 1);

  const app = createApp({
    view: {
      reader: repo,
      store: new StateStore({ reader: repo, writer: repo }),
    },
  });
  const port = await freePort();
  const server = serve({ fetch: app.fetch, port });
  const base = `http://127.0.0.1:${port}`;

  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright") as { chromium: Chromium };
  const browser = await chromium.launch();
  try {
    const cookieValue = signViewCookie(
      VIEW_TOKEN,
      Math.floor(Date.now() / 1000) + 3600,
    );

    // 1. The open tree page picks up a new commit within 30 seconds,
    // keeping scroll and the manually-toggled `<details>` (criterion 3).
    {
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
      });
      await context.addCookies([
        {
          name: VIEW_COOKIE_NAME,
          value: cookieValue,
          url: base,
        },
      ]);
      const page = await context.newPage();
      await page.goto(`${base}/view`);
      const initialSha = await page.textContent("[data-sha]");
      check(
        "tree page loads at the first commit",
        initialSha?.trim() === rev1,
        initialSha ?? "",
      );

      // Fold what the default unfolds, and unfold a leaf that starts folded.
      await page.evaluate(() => {
        document.querySelectorAll("li[data-node] > details").forEach((d) => {
          d.open = !d.open;
        });
        window.scrollTo(0, 100000);
      });
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const foldsOf = (): Record<string, boolean> => {
        const out: Record<string, boolean> = {};
        document.querySelectorAll("li[data-node] > details").forEach((d) => {
          const id = d.parentElement?.getAttribute("data-node");
          if (id) out[id] = d.open;
        });
        return out;
      };
      const toggled = await page.evaluate(foldsOf);

      const rev2 = commit(repo, 2);
      await page.waitForFunction(
        (expected) =>
          document.querySelector("[data-sha]")?.textContent?.trim() ===
          expected,
        rev2,
        { timeout: 30_000 },
      );
      check(
        "the open tree page shows the new commit within 30 seconds, with no reload",
        true,
      );

      const scrollY = await page.evaluate(() => window.scrollY);
      check(
        "scroll position is kept across the replace",
        scrollY === scrollBefore && scrollY > 0,
        `scrollY=${scrollY}, was ${scrollBefore}`,
      );

      const after = await page.evaluate(foldsOf);
      const keptFolds = Object.keys(toggled).every(
        (id) => after[id] === toggled[id],
      );
      check(
        "the manually-toggled fold state is kept across the replace",
        keptFolds,
      );

      await context.close();
    }

    // 2. Typed, unsent text is kept; "The plan changed" shows instead
    // of a silent replace, until "Update" is clicked (criterion 4).
    {
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
      });
      await context.addCookies([
        { name: VIEW_COOKIE_NAME, value: cookieValue, url: base },
      ]);
      const page = await context.newPage();
      await page.goto(`${base}/view`);
      const shaBefore = await page.textContent("[data-sha]");

      await page.fill('input[name="note"]', "typed but not sent");

      const rev3 = commit(repo, 3);
      await page.waitForTimeout(21_000); // past one poll tick
      const bannerVisible = await page.isVisible("[data-plan-changed]");
      check(
        '"The plan changed" shows instead of a silent replace',
        bannerVisible,
      );
      const shaStillOld = await page.textContent("[data-sha]");
      check(
        "the page is not replaced while typed text is unsent",
        shaStillOld?.trim() === shaBefore?.trim(),
      );
      const keptText = await page.evaluate(
        () => document.querySelector('input[name="note"]')?.value,
      );
      check("the typed text itself is kept", keptText === "typed but not sent");

      await page.click("[data-plan-changed] button");
      await page.waitForFunction(
        (expected) =>
          document.querySelector("[data-sha]")?.textContent?.trim() ===
          expected,
        rev3,
        { timeout: 10_000 },
      );
      check('"Update" applies the change', true);

      await context.close();
    }

    // 3. With scripts disabled, the page renders and a form commits a
    // real write (criterion 6).
    {
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
        javaScriptEnabled: false,
      });
      await context.addCookies([
        { name: VIEW_COOKIE_NAME, value: cookieValue, url: base },
      ]);
      const page = await context.newPage();
      const res = await page.goto(`${base}/view`);
      const status = res?.status();
      check(
        "the page renders with scripts disabled",
        status === 200,
        `status=${status}`,
      );

      await page.click('form[data-decision-form="D900"] button[type="submit"]');
      const committed = await page.textContent("[data-committed]");
      check("a form still commits with scripts disabled", !!committed);

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failed) {
    console.error("\nsome checks failed");
    process.exitCode = 1;
  } else {
    console.log("\nall checks passed");
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
