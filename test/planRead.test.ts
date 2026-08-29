import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { GithubFetchError } from "../src/planRegister/registerFetcher.js";
import type {
  FetchedRegister,
  RegisterFetcher,
} from "../src/planRegister/registerFetcher.js";

/**
 * `plan_read` tool-contract tests (chunk 1 child C, node P2-N009),
 * exercised the same way test/httpApp.test.ts exercises
 * `service_identity`: real MCP JSON-RPC over the in-process Hono app.
 * A stubbed `RegisterFetcher` is threaded in via `createApp`'s
 * `planRegisterFetcher` option (src/httpApp.ts → src/mcpServer.ts →
 * src/planReadTool.ts) — the injectable seam I5 requires — so these
 * tests need no real GitHub credentials or network access.
 */

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

function mcpRequest(body: unknown): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: { ...MCP_HEADERS, Authorization: "Bearer test-token-123" },
    body: JSON.stringify(body),
  });
}

function planReadCall(args: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "plan_read", arguments: args },
  };
}

const SAMPLE_REGISTER = [
  "- P1-N001 [broken-down] Root — plan: plans/root.md",
  "  - P1-N002 [done] Child one",
  "  - P1-N003 [identified] Child two",
].join("\n");

class StubRegisterFetcher implements RegisterFetcher {
  constructor(
    private readonly response: FetchedRegister,
    public calls: Array<string | undefined> = [],
  ) {}

  async fetchPlanRegister(ref?: string): Promise<FetchedRegister> {
    this.calls.push(ref);
    return this.response;
  }
}

class ThrowingRegisterFetcher implements RegisterFetcher {
  constructor(private readonly error: unknown) {}

  async fetchPlanRegister(): Promise<FetchedRegister> {
    throw this.error;
  }
}

type ToolCallResponseBody = {
  result: {
    isError?: boolean;
    structuredContent?: {
      ref: string;
      sha: string;
      fetchedAt: string;
      rootIds: string[];
      nodes: Array<{ id: string; stage: string; parentId: string | null }>;
      errors: unknown[];
    };
    content: Array<{ type: string; text: string }>;
  };
};

const ORIGINAL_ENV = { ...process.env };

describe("POST /mcp — plan_read", () => {
  beforeEach(() => {
    process.env.MCP_AUTH_TOKEN = "test-token-123";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("lists plan_read in tools/list", async () => {
    const app = createApp();
    const res = await app.request(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(body.result.tools.map((t) => t.name)).toContain("plan_read");
  });

  it("returns the whole tree with its source SHA, ref, and fetch time", async () => {
    const fetcher = new StubRegisterFetcher({
      content: SAMPLE_REGISTER,
      ref: "main",
      sha: "abc123def456",
      fetchedAt: "2026-08-29T00:00:00.000Z",
    });
    const app = createApp({ planRegisterFetcher: fetcher });

    const res = await app.request(mcpRequest(planReadCall()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ToolCallResponseBody;

    expect(body.result.isError).toBeFalsy();
    const sc = body.result.structuredContent!;
    expect(sc.ref).toBe("main");
    expect(sc.sha).toBe("abc123def456");
    expect(sc.fetchedAt).toBe("2026-08-29T00:00:00.000Z");
    expect(sc.rootIds).toEqual(["P1-N001"]);
    expect(sc.nodes.map((n) => n.id)).toEqual([
      "P1-N001",
      "P1-N002",
      "P1-N003",
    ]);
    expect(sc.errors).toEqual([]);
    expect(fetcher.calls).toEqual([undefined]);
  });

  it("passes an explicit ref through to the fetcher", async () => {
    const fetcher = new StubRegisterFetcher({
      content: SAMPLE_REGISTER,
      ref: "some-branch",
      sha: "sha-for-some-branch",
      fetchedAt: "2026-08-29T00:00:00.000Z",
    });
    const app = createApp({ planRegisterFetcher: fetcher });

    const res = await app.request(
      mcpRequest(planReadCall({ ref: "some-branch" })),
    );
    expect(res.status).toBe(200);
    expect(fetcher.calls).toEqual(["some-branch"]);
    const body = (await res.json()) as ToolCallResponseBody;
    expect(body.result.structuredContent!.ref).toBe("some-branch");
  });

  it("returns exactly the requested subtree for nodeId", async () => {
    const fetcher = new StubRegisterFetcher({
      content: SAMPLE_REGISTER,
      ref: "main",
      sha: "abc123def456",
      fetchedAt: "2026-08-29T00:00:00.000Z",
    });
    const app = createApp({ planRegisterFetcher: fetcher });

    const res = await app.request(
      mcpRequest(planReadCall({ nodeId: "P1-N002" })),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ToolCallResponseBody;
    const sc = body.result.structuredContent!;
    expect(sc.rootIds).toEqual(["P1-N002"]);
    expect(sc.nodes.map((n) => n.id)).toEqual(["P1-N002"]);
  });

  it("reports an unknown nodeId as a tool error, not an empty result", async () => {
    const fetcher = new StubRegisterFetcher({
      content: SAMPLE_REGISTER,
      ref: "main",
      sha: "abc123def456",
      fetchedAt: "2026-08-29T00:00:00.000Z",
    });
    const app = createApp({ planRegisterFetcher: fetcher });

    const res = await app.request(
      mcpRequest(planReadCall({ nodeId: "P9-N999" })),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ToolCallResponseBody;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toContain("P9-N999");
  });

  it("surfaces a malformed register line as a structured error, not a dropped node", async () => {
    const withBadLine = [
      "- P1-N001 [broken-down] Root",
      "  - P1-N002 [executing missing-bracket bad line",
      "  - P1-N003 [done] Fine",
    ].join("\n");
    const fetcher = new StubRegisterFetcher({
      content: withBadLine,
      ref: "main",
      sha: "abc123def456",
      fetchedAt: "2026-08-29T00:00:00.000Z",
    });
    const app = createApp({ planRegisterFetcher: fetcher });

    const res = await app.request(mcpRequest(planReadCall()));
    const body = (await res.json()) as ToolCallResponseBody;
    const sc = body.result.structuredContent!;
    expect(sc.nodes.map((n) => n.id)).toEqual(["P1-N001", "P1-N003"]);
    expect(sc.errors).toHaveLength(1);
  });

  it("returns a tool error, not a 500, when the fetcher fails", async () => {
    const fetcher = new ThrowingRegisterFetcher(
      new GithubFetchError("could not resolve ref", 404, "Not Found"),
    );
    const app = createApp({ planRegisterFetcher: fetcher });

    const res = await app.request(mcpRequest(planReadCall()));
    expect(res.status).toBe(200); // JSON-RPC/MCP-level error, not an HTTP failure
    const body = (await res.json()) as ToolCallResponseBody;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toContain("404");
  });

  it("reports GitHub App misconfiguration as a tool error naming the missing variables, not a crash", async () => {
    // No planRegisterFetcher override and no GITHUB_APP_* env vars set —
    // exercises the real default-fetcher wiring's config-missing path.
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_INSTALLATION_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    const app = createApp();

    const res = await app.request(mcpRequest(planReadCall()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ToolCallResponseBody;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toContain("GITHUB_APP_ID");
    expect(body.result.content[0]!.text).toContain("O3");
  });
});
