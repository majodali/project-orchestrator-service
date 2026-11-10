import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { GithubFetchError } from "../src/planRegister/registerFetcher.js";
import {
  FixtureDirReader,
  PREVIEW_SHA,
  previewViewOptions,
} from "../src/view/fixtureReader.js";
import { COMMIT_325C502, FILES_325C502 } from "./support/fixtures325c502.js";
import {
  FAKE_VIEW_TOKEN,
  attributeText,
  expectLinksPinned,
  expectViewHeaders,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The web view's preview mode (node P2-N023, iteration 1): the
 * fixture-backed reader the local server uses when `VIEW_FIXTURE_DIR`
 * is set, and the proof that the production path does not change.
 */

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  viewEnv();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** A temporary directory holding the 2da1843 files at their paths. */
function fixtureDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "view-fixture-"));
  for (const [repoPath, content] of FILES_325C502) {
    const file = path.join(dir, repoPath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

/** A view cookie valid on the real clock, which these apps run on. */
function liveCookie(): string {
  return validCookie(FAKE_VIEW_TOKEN, Math.floor(Date.now() / 1000) + 3600);
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(GithubFetchError);
    return (err as GithubFetchError).status;
  }
  throw new Error("expected a GithubFetchError");
}

describe("FixtureDirReader", () => {
  it("resolves the default branch, main and prefixes of its SHA to one pretend SHA", async () => {
    const reader = new FixtureDirReader(fixtureDir());
    expect(PREVIEW_SHA).toMatch(/^[0-9a-f]{40}$/);
    expect(await reader.resolveRef()).toEqual({
      ref: "main",
      sha: PREVIEW_SHA,
    });
    expect(await reader.resolveRef("main")).toEqual({
      ref: "main",
      sha: PREVIEW_SHA,
    });
    expect((await reader.resolveRef(PREVIEW_SHA.slice(0, 7))).sha).toBe(
      PREVIEW_SHA,
    );
    expect((await reader.resolveRef(PREVIEW_SHA)).sha).toBe(PREVIEW_SHA);
  });

  it("answers 422 for any other ref, as GitHub does for an unknown one", async () => {
    const reader = new FixtureDirReader(fixtureDir());
    expect(await statusOf(reader.resolveRef("feature"))).toBe(422);
    expect(await statusOf(reader.resolveRef("abcdef0"))).toBe(422);
  });

  it("takes the SHA from VIEW_FIXTURE_SHA and refuses one that is not a full SHA", async () => {
    const reader = new FixtureDirReader(fixtureDir(), { sha: COMMIT_325C502 });
    expect((await reader.resolveRef()).sha).toBe(COMMIT_325C502);
    expect(
      () => new FixtureDirReader(fixtureDir(), { sha: "325c502" }),
    ).toThrow(/full/);
  });

  it("reads files at their repository paths, byte for byte", async () => {
    const reader = new FixtureDirReader(fixtureDir());
    expect(
      await reader.readFileAtSha(PREVIEW_SHA, "orchestration/state.json"),
    ).toBe(FILES_325C502.get("orchestration/state.json"));
  });

  it("answers 404 for a missing file, another SHA and a path outside the directory", async () => {
    const dir = fixtureDir();
    writeFileSync(path.join(dir, "..", "outside-secret.txt"), "not served");
    const reader = new FixtureDirReader(dir);
    expect(
      await statusOf(reader.readFileAtSha(PREVIEW_SHA, "docs/plans/none.md")),
    ).toBe(404);
    expect(
      await statusOf(
        reader.readFileAtSha("b".repeat(40), "orchestration/state.json"),
      ),
    ).toBe(404);
    expect(
      await statusOf(
        reader.readFileAtSha(PREVIEW_SHA, "../outside-secret.txt"),
      ),
    ).toBe(404);
    expect(await statusOf(reader.readFileAtSha(PREVIEW_SHA, "docs"))).toBe(404);
  });
});

describe("previewViewOptions", () => {
  it("answers undefined while VIEW_FIXTURE_DIR is unset or blank", () => {
    expect(previewViewOptions({})).toBeUndefined();
    expect(previewViewOptions({ VIEW_FIXTURE_DIR: "  " })).toBeUndefined();
  });

  it("answers a fixture reader at VIEW_FIXTURE_SHA when the directory is set", async () => {
    const options = previewViewOptions({
      VIEW_FIXTURE_DIR: fixtureDir(),
      VIEW_FIXTURE_SHA: COMMIT_325C502,
    });
    expect(options?.reader).toBeInstanceOf(FixtureDirReader);
    expect((await options!.reader!.resolveRef()).sha).toBe(COMMIT_325C502);
  });
});

describe("the preview serves the three reference pages from the directory", () => {
  const PAGES = ["/view", "/view/node/P2-N021", "/view/task/T094"];

  it.each(PAGES)(
    "%s answers 200 with the SHA in the header, the limit line and pinned links",
    async (page) => {
      const app = createApp({
        view: previewViewOptions({
          VIEW_FIXTURE_DIR: fixtureDir(),
          VIEW_FIXTURE_SHA: COMMIT_325C502,
        }),
      });
      const res = await app.request(page, {
        headers: { Cookie: liveCookie() },
      });
      expect(res.status).toBe(200);
      expectViewHeaders(res);
      const html = await res.text();
      expect(attributeText(html, "data-sha")).toBe(COMMIT_325C502);
      expect(html).toContain("the progress truth during the rebuild");
      expectLinksPinned(html, undefined);
    },
  );

  it("keeps the sign-in flow: no cookie redirects, and VIEW_TOKEN signs in", async () => {
    const app = createApp({
      view: previewViewOptions({ VIEW_FIXTURE_DIR: fixtureDir() }),
    });
    const refused = await app.request("/view");
    expect(refused.status).toBe(303);
    expect(refused.headers.get("Location")).toBe("/view/sign-in");

    const body = new URLSearchParams({ token: FAKE_VIEW_TOKEN });
    const signIn = await app.request("/view/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(signIn.status).toBe(303);
    const cookie = signIn.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/view");
    const page = await app.request("/view", {
      headers: { Cookie: cookie.split(";")[0]! },
    });
    expect(page.status).toBe(200);
  });
});

describe("the production path does not change", () => {
  it("createApp() ignores VIEW_FIXTURE_DIR: the view still reads through the GitHub App", async () => {
    process.env.VIEW_FIXTURE_DIR = fixtureDir();
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_INSTALLATION_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    const res = await createApp().request("/view", {
      headers: { Cookie: liveCookie() },
    });
    // The default reader is the GitHub App's, unconfigured here: the
    // error page, not the fixture's tree.
    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).toContain("The page could not be read");
    expect(html).not.toContain("P2-N021");
  });

  it("only the local server reads VIEW_FIXTURE_DIR or imports the fixture reader", () => {
    for (const file of [
      "src/lambda.ts",
      "src/httpApp.ts",
      "src/view/routes.ts",
    ]) {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf-8");
      expect(source, file).not.toContain("VIEW_FIXTURE");
      expect(source, file).not.toContain("fixtureReader");
    }
    const local = readFileSync(
      path.join(REPO_ROOT, "src/localServer.ts"),
      "utf-8",
    );
    expect(local).toContain("previewViewOptions()");
  });
});
