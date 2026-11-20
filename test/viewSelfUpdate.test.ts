import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { VIEW_APP_SCRIPT } from "../src/view/appScript.js";
import { sampleState, stateJson } from "./support/states.js";
import {
  FakeRepository,
  NOW,
  SHA_A,
  SHA_B,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The view's self-updating script (node P2-N037; the specification of
 * P2-N028, section 3): the version route, its 10-second memory, the
 * script route, and the CSP that lets the script run.
 */

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => viewEnv());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function sampleRepo(): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", SHA_A);
  repo.setFile(SHA_A, "orchestration/state.json", stateJson(sampleState()));
  return repo;
}

describe("GET /view/app.js", () => {
  it("serves the view's one script, first-party, with a script content type", async () => {
    const app = createApp({ view: { reader: sampleRepo(), now: () => NOW } });
    const res = await app.request("/view/app.js", {
      headers: { Cookie: validCookie() },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("javascript");
    expect(await res.text()).toBe(VIEW_APP_SCRIPT);
  });

  it("is refused without the view cookie, like every other /view route", async () => {
    const app = createApp({ view: { reader: sampleRepo(), now: () => NOW } });
    const res = await app.request("/view/app.js");
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/view/sign-in");
  });
});

describe("GET /view/version", () => {
  it("answers the default branch's SHA, and is refused without the view cookie", async () => {
    const repo = sampleRepo();
    const app = createApp({ view: { reader: repo, now: () => NOW } });
    const signedIn = await app.request("/view/version", {
      headers: { Cookie: validCookie() },
    });
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toEqual({ sha: SHA_A });

    const anonymous = await app.request("/view/version");
    expect(anonymous.status).toBe(303);
    expect(anonymous.headers.get("Location")).toBe("/view/sign-in");
  });

  it("answers from a 10-second memory, so two calls make one read of the repository", async () => {
    const repo = sampleRepo();
    let clock = NOW;
    const app = createApp({
      view: { reader: repo, now: () => clock },
    });
    const cookie = { headers: { Cookie: validCookie() } };

    await app.request("/view/version", cookie);
    await app.request("/view/version", cookie);
    expect(repo.resolveCalls).toHaveLength(1);

    // Still within the 10-second memory: one read so far.
    clock = new Date(NOW.getTime() + 9_000);
    const stillCached = await app.request("/view/version", cookie);
    expect(await stillCached.json()).toEqual({ sha: SHA_A });
    expect(repo.resolveCalls).toHaveLength(1);

    // Past 10 seconds, and the head moved: a fresh read answers it.
    repo.heads.set("main", SHA_B);
    clock = new Date(NOW.getTime() + 11_000);
    const fresh = await app.request("/view/version", cookie);
    expect(await fresh.json()).toEqual({ sha: SHA_B });
    expect(repo.resolveCalls).toHaveLength(2);
  });

  it("answers 502 when the repository cannot be read, without caching the failure", async () => {
    const repo = sampleRepo();
    repo.heads.delete("main");
    const app = createApp({ view: { reader: repo, now: () => NOW } });
    const res = await app.request("/view/version", {
      headers: { Cookie: validCookie() },
    });
    expect(res.status).toBe(502);
  });
});

describe("the view's content-security policy (D085)", () => {
  it("allows script and connections only from the view's own origin, on every /view response", async () => {
    const app = createApp({ view: { reader: sampleRepo(), now: () => NOW } });
    for (const path of ["/view", "/view/app.js", "/view/version"]) {
      const res = await app.request(path, {
        headers: { Cookie: validCookie() },
      });
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).not.toContain("'unsafe-inline'");
      expect(csp).not.toContain("'unsafe-eval'");
    }
  });
});

describe("the tree, node and task pages", () => {
  it("load the view's script from its own path, with no inline script", async () => {
    const app = createApp({ view: { reader: sampleRepo(), now: () => NOW } });
    const res = await app.request("/view", {
      headers: { Cookie: validCookie() },
    });
    const html = await res.text();
    expect(html).toContain('<script src="/view/app.js" defer></script>');
    expect(html.match(/<script\b/g)).toHaveLength(1);
  });

  it("marks the header live at the default branch, and not live at a named ref", async () => {
    const app = createApp({ view: { reader: sampleRepo(), now: () => NOW } });
    const live = await app.request("/view", {
      headers: { Cookie: validCookie() },
    });
    expect(await live.text()).toContain('<header data-live="true">');

    const pinned = await app.request(`/view?ref=${SHA_A}`, {
      headers: { Cookie: validCookie() },
    });
    expect(await pinned.text()).toContain('<header data-live="false">');
  });
});
