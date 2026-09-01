import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/httpApp.js";
import { InMemoryLeaseBackend } from "../src/planRegister/inMemoryLeaseBackend.js";
import type {
  FetchedRegister,
  RegisterFetcher,
} from "../src/planRegister/registerFetcher.js";

/**
 * `plan_lease_acquire` / `plan_update` / `plan_confirm` /
 * `plan_lease_release` tool-contract tests (chunk 1 child D, node
 * P2-N010), exercised the same way test/planRead.test.ts exercises
 * `plan_read`: real MCP JSON-RPC over the in-process Hono app, with a
 * stubbed `RegisterFetcher` and an `InMemoryLeaseBackend` threaded in
 * via `createApp`'s options — the injectable seams src/mcpServer.ts
 * establishes. No real GitHub credentials, AWS credentials, or
 * network access.
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

function toolCall(name: string, args: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  };
}

class StubRegisterFetcher implements RegisterFetcher {
  content: string;
  sha: string;
  ref: string;
  calls: Array<string | undefined> = [];

  constructor(content: string, sha: string, ref = "main") {
    this.content = content;
    this.sha = sha;
    this.ref = ref;
  }

  async fetchPlanRegister(ref?: string): Promise<FetchedRegister> {
    this.calls.push(ref);
    // A caller pinning to a specific SHA (plan_confirm) gets that SHA
    // echoed back as both `ref` and `sha`, matching
    // GithubAppRegisterFetcher's real behavior when `ref` is already
    // a commit SHA.
    const pinned = ref === this.sha;
    return {
      content: this.content,
      ref: pinned ? ref! : this.ref,
      sha: this.sha,
      fetchedAt: "2026-09-01T00:00:00.000Z",
    };
  }
}

type ToolCallResponseBody = {
  result: {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content: Array<{ type: string; text: string }>;
  };
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MCP_AUTH_TOKEN = "test-token-123";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const REGISTER_V1 = [
  "- P9-N001 [broken-down] Root",
  "  - P9-N002 [identified] A leaf due for planning",
].join("\n");

async function call(
  app: ReturnType<typeof createApp>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResponseBody["result"]> {
  const res = await app.request(mcpRequest(toolCall(name, args)));
  expect(res.status).toBe(200);
  const body = (await res.json()) as ToolCallResponseBody;
  return body.result;
}

describe("write-path tools — tools/list", () => {
  it("lists all four write tools alongside plan_read and service_identity", async () => {
    const app = createApp();
    const res = await app.request(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    );
    const body = (await res.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "service_identity",
        "plan_read",
        "plan_lease_acquire",
        "plan_update",
        "plan_confirm",
        "plan_lease_release",
      ]),
    );
  });
});

describe("plan_lease_acquire / plan_lease_release", () => {
  it("grants an acquire when nothing is held", async () => {
    const app = createApp({ planLeaseBackend: new InMemoryLeaseBackend() });
    const result = await call(app, "plan_lease_acquire", {
      holder: "task-T024",
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ holder: "task-T024" });
    expect(typeof result.structuredContent!.token).toBe("string");
  });

  it("refuses a second acquirer while the lease is live", async () => {
    const app = createApp({ planLeaseBackend: new InMemoryLeaseBackend() });
    await call(app, "plan_lease_acquire", { holder: "first-session" });
    const result = await call(app, "plan_lease_acquire", {
      holder: "second-session",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("first-session");
  });

  it("expires by TTL — a new acquirer succeeds once ttlSeconds has elapsed", async () => {
    const app = createApp({ planLeaseBackend: new InMemoryLeaseBackend() });
    vi.useFakeTimers();
    try {
      const start = new Date("2026-09-01T00:00:00.000Z");
      vi.setSystemTime(start);

      const first = await call(app, "plan_lease_acquire", {
        holder: "first-session",
        ttlSeconds: 30,
      });
      expect(first.isError).toBeFalsy();

      vi.setSystemTime(new Date(start.getTime() + 31_000));
      const second = await call(app, "plan_lease_acquire", {
        holder: "second-session",
      });
      expect(second.isError).toBeFalsy();
      expect(second.structuredContent).toMatchObject({
        holder: "second-session",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("plan_lease_release releases a held lease, and a second acquirer can then take it", async () => {
    const app = createApp({ planLeaseBackend: new InMemoryLeaseBackend() });
    const acquired = await call(app, "plan_lease_acquire", {
      holder: "first-session",
    });
    const token = acquired.structuredContent!.token as string;

    const released = await call(app, "plan_lease_release", {
      leaseToken: token,
    });
    expect(released.isError).toBeFalsy();
    expect(released.structuredContent).toEqual({ released: true });

    const second = await call(app, "plan_lease_acquire", {
      holder: "second-session",
    });
    expect(second.isError).toBeFalsy();
  });

  it("plan_lease_release refuses a token that does not match the held lease", async () => {
    const app = createApp({ planLeaseBackend: new InMemoryLeaseBackend() });
    await call(app, "plan_lease_acquire", { holder: "first-session" });
    const result = await call(app, "plan_lease_release", {
      leaseToken: "wrong-token",
    });
    expect(result.isError).toBe(true);
  });
});

describe("plan_update", () => {
  async function acquiredApp() {
    const fetcher = new StubRegisterFetcher(REGISTER_V1, "sha-v1");
    const app = createApp({
      planRegisterFetcher: fetcher,
      planLeaseBackend: new InMemoryLeaseBackend(),
    });
    const acquired = await call(app, "plan_lease_acquire", {
      holder: "task-T024",
    });
    const token = acquired.structuredContent!.token as string;
    return { app, fetcher, token };
  }

  it("returns the exact edit for a legal transition against a fresh baseline", async () => {
    const { app, token } = await acquiredApp();
    const result = await call(app, "plan_update", {
      nodeId: "P9-N002",
      toStage: "planned",
      reason: "planning was dispatched",
      sha: "sha-v1",
      leaseToken: token,
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      nodeId: "P9-N002",
      fromStage: "identified",
      toStage: "planned",
      sha: "sha-v1",
      edit: {
        file: "docs/plan-register.md",
        line: 2,
        oldLine: "  - P9-N002 [identified] A leaf due for planning",
        newLine: "  - P9-N002 [planned] A leaf due for planning",
      },
    });
  });

  it("refuses without a held lease", async () => {
    const fetcher = new StubRegisterFetcher(REGISTER_V1, "sha-v1");
    const app = createApp({
      planRegisterFetcher: fetcher,
      planLeaseBackend: new InMemoryLeaseBackend(),
    });
    const result = await call(app, "plan_update", {
      nodeId: "P9-N002",
      toStage: "planned",
      reason: "no lease held",
      sha: "sha-v1",
      leaseToken: "never-acquired",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("plan_lease_acquire");
  });

  it("refuses a leaseToken that does not match the current holder", async () => {
    const { app, token } = await acquiredApp();
    void token;
    const result = await call(app, "plan_update", {
      nodeId: "P9-N002",
      toStage: "planned",
      reason: "wrong token",
      sha: "sha-v1",
      leaseToken: "not-the-real-token",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("leaseToken");
  });

  it("refuses an edit computed against a stale baseline SHA, rather than applying it", async () => {
    const { app, fetcher, token } = await acquiredApp();
    // Someone else moved the branch on between the caller's last read
    // and this call.
    fetcher.content = REGISTER_V1.replace("[identified]", "[planned]");
    fetcher.sha = "sha-v2";

    const result = await call(app, "plan_update", {
      nodeId: "P9-N002",
      toStage: "specified",
      reason: "stale baseline",
      sha: "sha-v1",
      leaseToken: token,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("stale");
    expect(result.content[0]!.text).toContain("sha-v1");
    expect(result.content[0]!.text).toContain("sha-v2");
  });

  it("refuses an illegal transition, citing the lifecycle table", async () => {
    const { app, token } = await acquiredApp();
    const result = await call(app, "plan_update", {
      nodeId: "P9-N002",
      toStage: "done",
      reason: "skip everything",
      sha: "sha-v1",
      leaseToken: token,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("[identified] -> [done]");
  });

  it("refuses an unknown nodeId", async () => {
    const { app, token } = await acquiredApp();
    const result = await call(app, "plan_update", {
      nodeId: "P9-N999",
      toStage: "planned",
      reason: "no such node",
      sha: "sha-v1",
      leaseToken: token,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("P9-N999");
  });
});

describe("plan_confirm", () => {
  it("succeeds and releases the lease when the confirmed commit carries the edit", async () => {
    const fetcher = new StubRegisterFetcher(REGISTER_V1, "sha-v1");
    const app = createApp({
      planRegisterFetcher: fetcher,
      planLeaseBackend: new InMemoryLeaseBackend(),
    });
    const acquired = await call(app, "plan_lease_acquire", {
      holder: "task-T024",
    });
    const token = acquired.structuredContent!.token as string;

    // The session applies the edit and "pushes" — simulated by
    // pointing the stub fetcher at the post-edit content and a new SHA.
    fetcher.content = REGISTER_V1.replace("[identified]", "[planned]");
    fetcher.sha = "sha-v2";

    const confirmed = await call(app, "plan_confirm", {
      nodeId: "P9-N002",
      toStage: "planned",
      sha: "sha-v2",
      leaseToken: token,
    });
    expect(confirmed.isError).toBeFalsy();
    expect(confirmed.structuredContent).toMatchObject({
      nodeId: "P9-N002",
      toStage: "planned",
      sha: "sha-v2",
      file: "docs/plan-register.md",
      line: 2,
    });

    // The lease was released — a new acquirer succeeds.
    const nextAcquire = await call(app, "plan_lease_acquire", {
      holder: "next-session",
    });
    expect(nextAcquire.isError).toBeFalsy();
  });

  it("reports a divergence, naming the file and the line, when the confirmed commit never carries the edit (I3/R10)", async () => {
    const fetcher = new StubRegisterFetcher(REGISTER_V1, "sha-v1");
    const app = createApp({
      planRegisterFetcher: fetcher,
      planLeaseBackend: new InMemoryLeaseBackend(),
    });
    const acquired = await call(app, "plan_lease_acquire", {
      holder: "task-T024",
    });
    const token = acquired.structuredContent!.token as string;

    // Deliberately induced mismatch: the session claims to have
    // pushed sha-v2, but that commit's register content never
    // actually changed the node's stage.
    fetcher.content = REGISTER_V1; // unchanged
    fetcher.sha = "sha-v2";

    const confirmed = await call(app, "plan_confirm", {
      nodeId: "P9-N002",
      toStage: "planned",
      sha: "sha-v2",
      leaseToken: token,
    });
    expect(confirmed.isError).toBe(true);
    expect(confirmed.content[0]!.text).toContain("docs/plan-register.md");
    expect(confirmed.content[0]!.text).toContain("line 2");
    expect(confirmed.content[0]!.text).toContain("[identified]");
    expect(confirmed.content[0]!.text).toContain("[planned]");

    // The lease is deliberately NOT released on a divergence — a
    // second acquirer is still refused.
    const stillRefused = await call(app, "plan_lease_acquire", {
      holder: "someone-else",
    });
    expect(stillRefused.isError).toBe(true);
  });

  it("refuses without a held lease", async () => {
    const fetcher = new StubRegisterFetcher(REGISTER_V1, "sha-v1");
    const app = createApp({
      planRegisterFetcher: fetcher,
      planLeaseBackend: new InMemoryLeaseBackend(),
    });
    const result = await call(app, "plan_confirm", {
      nodeId: "P9-N002",
      toStage: "planned",
      sha: "sha-v1",
      leaseToken: "never-acquired",
    });
    expect(result.isError).toBe(true);
  });
});
