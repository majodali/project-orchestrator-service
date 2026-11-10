import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  APIGatewayProxyEventV2,
  ApiGatewayRequestContextV2,
  LambdaContext,
} from "hono/aws-lambda";

import { handler } from "../src/lambda.js";

/**
 * Regression test for the P2-N008 rework: the first deployment
 * returned 404 on every path. Root cause — `template.yaml`'s HttpApi
 * had `StageName: !Ref Stage` (`prod`), so API Gateway's invoke URL
 * carried a `/prod` segment and every request's `rawPath` was
 * `/prod/health` / `/prod/mcp`; `src/httpApp.ts` only ever registers
 * `/health` and `/mcp`, so Hono 404d before auth was ever reached
 * (confirmed live: the response body was Hono's plain-text
 * `404 Not Found`, not API Gateway's own JSON 404). The fix pins the
 * HTTP API's stage to the reserved name `$default`, which drops the
 * stage segment from both the invoke URL and `rawPath` — see
 * template.yaml's HttpApi resource and docs/runbook.md's "Why the
 * endpoint has no stage segment" note.
 *
 * test/httpApp.test.ts exercises the Hono app directly over its Web
 * Standard `fetch()` handler (`app.request(...)`) and never
 * constructs an API Gateway event at all, so it could not have caught
 * this — the bug lived entirely in the path `hono/aws-lambda`'s
 * `handle()` derives from the Lambda event, upstream of the Hono
 * app's own routing. This test goes through the actual exported
 * `handler` (the same `hono/aws-lambda` wrapper the deployed function
 * runs) with a synthetic API Gateway v2 event, so it exercises that
 * path-derivation step the other suite skips.
 */

const BASE_REQUEST_CONTEXT: Omit<ApiGatewayRequestContextV2, "http"> = {
  accountId: "123456789012",
  apiId: "025si0pve6",
  authentication: null,
  authorizer: {},
  domainName: "025si0pve6.execute-api.us-west-2.amazonaws.com",
  domainPrefix: "025si0pve6",
  requestId: "test-request-id",
  routeKey: "$default",
  stage: "$default",
  time: "28/Aug/2026:00:00:00 +0000",
  timeEpoch: 1756339200000,
};

function v2Event(
  rawPath: string,
  method: string,
  headers: Record<string, string> = {},
  body?: string,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath,
    rawQueryString: "",
    headers,
    requestContext: {
      ...BASE_REQUEST_CONTEXT,
      http: {
        method,
        path: rawPath,
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.1",
        userAgent: "vitest",
      },
    },
    isBase64Encoded: false,
    body: body ?? null,
  };
}

const LAMBDA_CONTEXT: LambdaContext = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: "McpFunction",
  functionVersion: "$LATEST",
  invokedFunctionArn:
    "arn:aws:lambda:us-west-2:123456789012:function:McpFunction",
  memoryLimitInMB: "256",
  awsRequestId: "test-request-id",
  logGroupName: "/aws/lambda/McpFunction",
  logStreamName: "test-stream",
  getRemainingTimeInMillis: () => 10000,
};

const ORIGINAL_ENV = { ...process.env };

describe("Lambda handler against an API Gateway v2 event", () => {
  beforeEach(() => {
    process.env.MCP_AUTH_TOKEN = "test-token-123";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("answers GET /health with 200 when rawPath has no stage segment — the shape the deployed $default-stage HTTP API actually sends", async () => {
    const result = await handler(v2Event("/health", "GET"), LAMBDA_CONTEXT);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("answers POST /mcp (bearer-authenticated) with 200 when rawPath has no stage segment", async () => {
    const result = await handler(
      v2Event(
        "/mcp",
        "POST",
        {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer test-token-123",
        },
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      ),
      LAMBDA_CONTEXT,
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(body.result.tools.map((t) => t.name)).toContain("service_identity");
  });

  it("documents the original defect: a rawPath carrying a stage segment 404s — why the HTTP API's stage must stay pinned to $default, not a named stage", async () => {
    const result = await handler(
      v2Event("/prod/health", "GET"),
      LAMBDA_CONTEXT,
    );
    expect(result.statusCode).toBe(404);
  });
});
