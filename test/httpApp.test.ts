import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";

/**
 * Integration test for the reachability slice (chunk 1 child B,
 * node P2-N008): exercises the same Hono app the local dev server and
 * the Lambda handler both wrap, in-process over its Web Standard
 * `fetch` handler — the same request/response contract a real HTTP
 * client sees. Manual, real-process HTTP verification (actually
 * listening on a port, actually calling it with curl) is reported
 * separately in the task's verification notes; this test is the
 * regression net that runs with `npm test`.
 */

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

function mcpRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: { ...MCP_HEADERS, ...headers },
    body: JSON.stringify(body),
  });
}

const TOOLS_CALL_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "service_identity", arguments: {} },
};

const TOOLS_LIST_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {},
};

const ORIGINAL_ENV = { ...process.env };

describe("GET /health", () => {
  it("answers unauthenticated", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("project-orchestrator-service");
  });
});

describe("POST /mcp — auth", () => {
  beforeEach(() => {
    process.env.MCP_AUTH_TOKEN = "test-token-123";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects a call with no Authorization header", async () => {
    const app = createApp();
    const res = await app.request(mcpRequest(TOOLS_CALL_BODY));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects a call with the wrong token", async () => {
    const app = createApp();
    const res = await app.request(
      mcpRequest(TOOLS_CALL_BODY, { Authorization: "Bearer wrong-token" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a call with a non-Bearer Authorization header", async () => {
    const app = createApp();
    const res = await app.request(
      mcpRequest(TOOLS_CALL_BODY, { Authorization: "Basic dGVzdDp0ZXN0" }),
    );
    expect(res.status).toBe(401);
  });

  it("refuses every call when the server has no token configured (fails closed)", async () => {
    delete process.env.MCP_AUTH_TOKEN;
    const app = createApp();
    const res = await app.request(
      mcpRequest(TOOLS_CALL_BODY, { Authorization: "Bearer anything" }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("server_misconfigured");
  });

  it("accepts a call with the correct token", async () => {
    const app = createApp();
    const res = await app.request(
      mcpRequest(TOOLS_CALL_BODY, { Authorization: "Bearer test-token-123" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /mcp — service_identity", () => {
  beforeEach(() => {
    process.env.MCP_AUTH_TOKEN = "test-token-123";
    process.env.SERVICE_COMMIT = "deadbeef";
    process.env.MCP_PROJECT = "majodali/project-orchestrator";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("lists service_identity in tools/list", async () => {
    const app = createApp();
    const res = await app.request(
      mcpRequest(TOOLS_LIST_BODY, { Authorization: "Bearer test-token-123" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(body.result.tools.map((t) => t.name)).toContain("service_identity");
  });

  it("answers tools/call with the service's identity", async () => {
    const app = createApp();
    const res = await app.request(
      mcpRequest(TOOLS_CALL_BODY, { Authorization: "Bearer test-token-123" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        structuredContent: {
          service: string;
          version: string;
          commit: string;
          project: string;
        };
      };
    };
    expect(body.result.structuredContent).toEqual({
      service: "project-orchestrator-service",
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      commit: "deadbeef",
      project: "majodali/project-orchestrator",
    });
  });
});
