import { describe, expect, it } from "vitest";

import { FireHttpError, fireRoutine } from "../src/fire/client.js";

/** The call to the scheduled-task `/fire` endpoint (P2-N048, design
 * 6): the exact URL, headers and body the documentation gives
 * (platform.claude.com/docs/en/api/claude-code/routines-fire, read
 * 2026-11-24), and the 429/Retry-After case the ledger relies on. */
describe("fireRoutine", () => {
  it("POSTs to the documented URL with the documented headers and body", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      captured = { url: String(url), init: init! };
      return new Response(
        JSON.stringify({
          type: "routine_fire",
          claude_code_session_id: "session_abc",
          claude_code_session_url: "https://claude.ai/code/session_abc",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await fireRoutine(
      "trig_01ABC",
      "sk-ant-oat01-fake",
      "Node P1-N001, step execute.",
      fetchImpl,
    );

    expect(captured?.url).toBe(
      "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire",
    );
    expect(captured?.init.method).toBe("POST");
    const headers = captured?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-ant-oat01-fake");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-beta"]).toBe(
      "experimental-cc-routine-2026-04-01",
    );
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(captured!.init.body as string)).toEqual({
      text: "Node P1-N001, step execute.",
    });

    expect(result).toEqual({
      type: "routine_fire",
      claudeCodeSessionId: "session_abc",
      claudeCodeSessionUrl: "https://claude.ai/code/session_abc",
    });
  });

  it("throws FireHttpError with the Retry-After seconds on a 429", async () => {
    const fetchImpl = (async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "120" },
      })) as typeof fetch;

    await expect(
      fireRoutine("trig_01ABC", "sk-ant-oat01-fake", "text", fetchImpl),
    ).rejects.toMatchObject({
      name: "FireHttpError",
      status: 429,
      retryAfterSeconds: 120,
    });
  });

  it("has a null retryAfterSeconds when the response carries no Retry-After", async () => {
    const fetchImpl = (async () =>
      new Response("server error", { status: 500 })) as typeof fetch;

    const err = await fireRoutine(
      "trig_01ABC",
      "sk-ant-oat01-fake",
      "text",
      fetchImpl,
    ).catch((e) => e as FireHttpError);
    expect(err).toBeInstanceOf(FireHttpError);
    expect(err.status).toBe(500);
    expect(err.retryAfterSeconds).toBeNull();
  });
});
