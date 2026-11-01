import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import {
  VIEW_COOKIE_MAX_AGE_SECONDS,
  VIEW_COOKIE_NAME,
  signViewCookie,
  verifyViewCookie,
} from "../src/view/viewAuth.js";
import {
  FAKE_MCP_TOKEN,
  FAKE_VIEW_TOKEN,
  FakeRepository,
  NOW,
  NOW_SECONDS,
  SHA_A,
  expectViewHeaders,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * Sign-in and the separation of the two credentials (node P2-N021,
 * task E1; criteria V11 and V14 to V17 of the specification of
 * P2-N003, child 1). Every token here is a fake.
 */

const ORIGINAL_ENV = { ...process.env };

function app() {
  const repo = new FakeRepository();
  repo.heads.set("main", SHA_A);
  repo.setFile(SHA_A, "docs/plan-register.md", "- P1-N001 [done] Root");
  return createApp({ view: { reader: repo, now: () => NOW } });
}

function signIn(
  application: ReturnType<typeof createApp>,
  token: string | undefined,
) {
  const body = new URLSearchParams();
  if (token !== undefined) body.set("token", token);
  return application.request("/view/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

function mcpRequest(headers: Record<string, string>): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
}

/** Every route but sign-in, as E1 has them: the tree page, and a path
 * under `/view` that E2's node page will answer. */
const GUARDED_ROUTES = ["/view", "/view?ref=main", "/view/node/P1-N001"];

beforeEach(() => {
  viewEnv();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("V14 — sign-in", () => {
  it("shows a form with one password field", async () => {
    const res = await app().request("/view/sign-in");
    expect(res.status).toBe(200);
    expectViewHeaders(res);
    const html = await res.text();
    expect(html.match(/<input /g)).toHaveLength(1);
    expect(html).toContain('type="password"');
    expect(html).toContain('<form method="post" action="/view/sign-in">');
  });

  it("answers the right token with 303 to /view and a cookie carrying every attribute", async () => {
    const res = await signIn(app(), FAKE_VIEW_TOKEN);
    expect(res.status).toBe(303);
    expectViewHeaders(res);
    expect(res.headers.get("Location")).toBe("/view");
    const setCookie = res.headers.get("Set-Cookie")!;
    const [pair, ...attributes] = setCookie.split("; ");
    expect(attributes).toEqual(
      expect.arrayContaining([
        "HttpOnly",
        "Secure",
        "SameSite=Strict",
        "Path=/view",
        `Max-Age=${VIEW_COOKIE_MAX_AGE_SECONDS}`,
      ]),
    );
    expect(VIEW_COOKIE_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
    const value = pair!.slice(`${VIEW_COOKIE_NAME}=`.length);
    expect(pair!.startsWith(`${VIEW_COOKIE_NAME}=`)).toBe(true);
    // The value carries its expiry, 30 days ahead, and a signature.
    expect(value.split(".")[1]).toBe(
      String(NOW_SECONDS + VIEW_COOKIE_MAX_AGE_SECONDS),
    );
    expect(verifyViewCookie(FAKE_VIEW_TOKEN, value, NOW_SECONDS)).toBe(true);
    expect(value).not.toContain(FAKE_VIEW_TOKEN);

    // The cookie it set opens the tree page.
    const tree = await app().request("/view", { headers: { Cookie: pair! } });
    expect(tree.status).toBe(200);
  });

  it("answers a wrong token with 401 and sets no cookie", async () => {
    for (const token of ["fake-wrong-token", "", undefined, FAKE_MCP_TOKEN]) {
      const res = await signIn(app(), token);
      expect(res.status, String(token)).toBe(401);
      expectViewHeaders(res);
      expect(res.headers.get("Set-Cookie")).toBeNull();
    }
  });
});

describe("V15 — the cookie is checked on every route but sign-in", () => {
  const cases: Array<[string, Record<string, string>]> = [
    ["a missing cookie", {}],
    [
      "a tampered signature",
      { Cookie: validCookie().replace(/.$/, (c) => (c === "A" ? "B" : "A")) },
    ],
    [
      "a tampered expiry",
      {
        Cookie: validCookie().replace(
          `.${NOW_SECONDS + 3600}.`,
          `.${NOW_SECONDS + 7200}.`,
        ),
      },
    ],
    [
      "an expired cookie",
      { Cookie: validCookie(FAKE_VIEW_TOKEN, NOW_SECONDS - 1) },
    ],
    [
      "a cookie signed under a former view token",
      { Cookie: validCookie("fake-former-view-token", NOW_SECONDS + 3600) },
    ],
    ["a malformed cookie", { Cookie: `${VIEW_COOKIE_NAME}=fake` }],
  ];

  for (const [name, headers] of cases) {
    it(`refuses ${name} by a 303 to the sign-in page`, async () => {
      for (const route of GUARDED_ROUTES) {
        const res = await app().request(route, { headers });
        expect(res.status, route).toBe(303);
        expect(res.headers.get("Location"), route).toBe("/view/sign-in");
        expectViewHeaders(res);
        expect(await res.text()).not.toContain("P1-N001 [done]");
      }
    });
  }

  it("accepts a valid cookie on the same routes", async () => {
    const tree = await app().request("/view", {
      headers: { Cookie: validCookie() },
    });
    expect(tree.status).toBe(200);
    // E2 adds the node page; until then a signed-in request answers 404.
    const node = await app().request("/view/node/P1-N001", {
      headers: { Cookie: validCookie() },
    });
    expect(node.status).toBe(404);
    expectViewHeaders(node);
  });

  it("refuses a cookie whose expiry lies beyond one cookie lifetime", () => {
    const far = NOW_SECONDS + VIEW_COOKIE_MAX_AGE_SECONDS + 60;
    expect(
      verifyViewCookie(
        FAKE_VIEW_TOKEN,
        signViewCookie(FAKE_VIEW_TOKEN, far),
        NOW_SECONDS,
      ),
    ).toBe(false);
  });
});

describe("V16 — the two credentials are separate", () => {
  it("/mcp with the view token as its bearer gives 401", async () => {
    const res = await app().request(
      mcpRequest({ Authorization: `Bearer ${FAKE_VIEW_TOKEN}` }),
    );
    expect(res.status).toBe(401);
  });

  it("/mcp with only the view cookie gives 401", async () => {
    const res = await app().request(mcpRequest({ Cookie: validCookie() }));
    expect(res.status).toBe(401);
  });

  it("/view with the MCP bearer header and no cookie is refused", async () => {
    const res = await app().request("/view", {
      headers: { Authorization: `Bearer ${FAKE_MCP_TOKEN}` },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/view/sign-in");
    expectViewHeaders(res);
  });

  const misconfigurations: Array<[string, () => void]> = [
    ["an unset view token", () => delete process.env.VIEW_TOKEN],
    ["an empty view token", () => (process.env.VIEW_TOKEN = "")],
    [
      "a view token equal to the MCP token",
      () => (process.env.VIEW_TOKEN = FAKE_MCP_TOKEN),
    ],
  ];

  for (const [name, apply] of misconfigurations) {
    it(`${name} gives 500 on every /view route and leaves /mcp answering`, async () => {
      apply();
      const application = app();
      const requests: Array<[string, RequestInit]> = [
        ["/view", { headers: { Cookie: validCookie() } }],
        ["/view", {}],
        ["/view/sign-in", {}],
        ["/view/node/P1-N001", { headers: { Cookie: validCookie() } }],
      ];
      for (const [route, init] of requests) {
        const res = await application.request(route, init);
        expect(res.status, route).toBe(500);
        expectViewHeaders(res);
        expect(await res.text()).toMatch(/VIEW_TOKEN/);
      }
      const post = await signIn(application, FAKE_MCP_TOKEN);
      expect(post.status).toBe(500);
      expect(post.headers.get("Set-Cookie")).toBeNull();

      const mcp = await application.request(
        mcpRequest({ Authorization: `Bearer ${FAKE_MCP_TOKEN}` }),
      );
      expect(mcp.status).toBe(200);
    });
  }
});

describe("V17 — nothing changes", () => {
  const METHODS = ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

  it("accepts no method but GET on any /view route, and GET or POST on sign-in alone", async () => {
    for (const route of ["/view", "/view/node/P1-N001", "/view/sign-in"]) {
      for (const method of METHODS) {
        if (route === "/view/sign-in" && method === "POST") continue;
        const res = await app().request(route, {
          method,
          headers: { Cookie: validCookie() },
        });
        expect(res.status, `${method} ${route}`).toBe(405);
        expectViewHeaders(res);
        expect(res.headers.get("Allow")).toBe(
          route === "/view/sign-in" ? "GET, POST" : "GET",
        );
      }
    }
  });

  it("answers a cross-origin preflight on /view with no CORS grant", async () => {
    const res = await app().request("/view", {
      method: "OPTIONS",
      headers: {
        Origin: "https://elsewhere.example",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
