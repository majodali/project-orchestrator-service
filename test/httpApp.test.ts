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

/**
 * Alias-aware lease-table selection, failing closed (node P2-N015).
 * Drives the real Hono app's actual `/mcp` handler — the code path
 * src/httpApp.ts's `resolveLambdaAliasContext` runs on every request —
 * via `app.request(input, init, env)`, Hono's own documented seam for
 * supplying `c.env` in tests
 * (https://hono.dev/docs/api/hono#request). This is not a
 * reimplementation of the qualifier read: it is the same
 * `c.env.lambdaContext.invokedFunctionArn` path a real
 * `hono/aws-lambda`-wrapped Lambda invocation populates (confirmed
 * against src/lambda.ts's real exported `handler` in
 * test/lambda.test.ts's own new block).
 */
function envWithQualifier(qualifier: string) {
  return {
    lambdaContext: {
      invokedFunctionArn: `arn:aws:lambda:us-west-2:123456789012:function:McpFunction:${qualifier}`,
    },
  };
}

describe("POST /mcp — alias-aware lease-table selection (node P2-N015)", () => {
  beforeEach(() => {
    process.env.MCP_AUTH_TOKEN = "test-token-123";
    process.env.LEASE_TABLE_NAME = "prod-lease-table";
    process.env.PREPROD_LEASE_TABLE_NAME = "preprod-lease-table";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('reports invokedQualifier "live" and the production lease table', async () => {
    const app = createApp();
    const res = await app.request(
      mcpRequest(TOOLS_CALL_BODY, { Authorization: "Bearer test-token-123" }),
      undefined,
      envWithQualifier("live"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        structuredContent: { invokedQualifier: string; leaseTable: string };
      };
    };
    expect(body.result.structuredContent.invokedQualifier).toBe("live");
    expect(body.result.structuredContent.leaseTable).toBe("prod-lease-table");
  });

  it('reports invokedQualifier "preprod" and the preprod lease table', async () => {
    const app = createApp();
    const res = await app.request(
      mcpRequest(TOOLS_CALL_BODY, { Authorization: "Bearer test-token-123" }),
      undefined,
      envWithQualifier("preprod"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        structuredContent: { invokedQualifier: string; leaseTable: string };
      };
    };
    expect(body.result.structuredContent.invokedQualifier).toBe("preprod");
    expect(body.result.structuredContent.leaseTable).toBe(
      "preprod-lease-table",
    );
  });

  it("reports a refused qualifier ($LATEST) with leaseTable absent — fails closed", async () => {
    const app = createApp();
    const res = await app.request(
      mcpRequest(TOOLS_CALL_BODY, { Authorization: "Bearer test-token-123" }),
      undefined,
      envWithQualifier("$LATEST"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        structuredContent: { invokedQualifier: string; leaseTable?: string };
      };
    };
    expect(body.result.structuredContent.invokedQualifier).toBe("$LATEST");
    expect(body.result.structuredContent).not.toHaveProperty("leaseTable");
  });

  it("refuses plan_lease_acquire for an unrecognized qualifier, naming it, when invoked under Lambda", async () => {
    const app = createApp();
    const res = await app.request(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "plan_lease_acquire",
            arguments: { holder: "test" },
          },
        },
        { Authorization: "Bearer test-token-123" },
      ),
      undefined,
      envWithQualifier("staging"),
    );
    expect(res.status).toBe(200); // JSON-RPC 200; the error is in the payload
    const body = await res.text();
    expect(body).toContain("staging");
    expect(body).toContain("neither");
    expect(body).toContain("live");
    expect(body).toContain("preprod");
  });

  it("with no Lambda context at all, plan_lease_acquire still resolves LEASE_TABLE_NAME through the pre-existing path — never the new alias-aware one (I7)", async () => {
    // LEASE_TABLE_NAME deliberately left unset (unlike this describe
    // block's other tests) so this assertion never has to reach a
    // real DynamoDB table (no network access in this sandbox). The
    // two candidate error messages share the substring
    // "LEASE_TABLE_NAME", so the discriminating assertion is the
    // *old*, pre-existing LeaseBackendNotConfiguredError's own unique
    // text ("Owner action O2") — present only when this call went
    // through src/planRegister/defaultLeaseBackend.ts's
    // getDefaultLeaseBackend (node P2-N010, unchanged), never through
    // the new aliasLeaseTable.ts resolution this node adds (whose
    // AliasLeaseTableNotConfiguredError text never says "Owner action
    // O2" — see that class's own message).
    delete process.env.LEASE_TABLE_NAME;
    delete process.env.PREPROD_LEASE_TABLE_NAME;
    const app = createApp();
    const res = await app.request(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "plan_lease_acquire",
            arguments: { holder: "test" },
          },
        },
        { Authorization: "Bearer test-token-123" },
      ),
      // No third `env` argument — the shape the local dev server and
      // every other test in this suite already run with.
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("LEASE_TABLE_NAME");
    expect(body).toContain("Owner action O2");
  });
});
