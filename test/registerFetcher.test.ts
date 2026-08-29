import { describe, expect, it, vi } from "vitest";

import {
  GithubAppRegisterFetcher,
  GithubFetchError,
} from "../src/planRegister/registerFetcher.js";

/**
 * `GithubAppRegisterFetcher` orchestration tests (chunk 1 child C,
 * node P2-N009) — the GitHub-side half of I5 ("no tool derives plan
 * state from anything but repository content fetched through the
 * GitHub App"). No real network access or credentials: `fetchImpl` and
 * the installation-token provider are both injected fakes, per this
 * node's charge ("make it testable without the credential").
 */

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errorResponse(status: number, text: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ message: text }),
    text: async () => text,
  } as unknown as Response;
}

const FAKE_TOKEN = async () => "installation-token-abc";

describe("GithubAppRegisterFetcher", () => {
  it("resolves an explicit ref to a commit SHA and fetches content pinned to that SHA", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => jsonResponse({ sha: "deadbeef123" }))
      .mockImplementationOnce(async () =>
        jsonResponse({
          encoding: "base64",
          content: Buffer.from("- P1-N001 [done] hi").toString("base64"),
        }),
      );

    const fetcher = new GithubAppRegisterFetcher(
      "majodali",
      "project-orchestrator",
      FAKE_TOKEN,
      fetchImpl,
    );

    const result = await fetcher.fetchPlanRegister("some-branch");

    expect(result).toEqual({
      content: "- P1-N001 [done] hi",
      ref: "some-branch",
      sha: "deadbeef123",
      fetchedAt: expect.any(String),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [commitsUrl] = fetchImpl.mock.calls[0]!;
    expect(String(commitsUrl)).toContain(
      "/repos/majodali/project-orchestrator/commits/some-branch",
    );
    const [contentsUrl] = fetchImpl.mock.calls[1]!;
    expect(String(contentsUrl)).toContain(
      "/repos/majodali/project-orchestrator/contents/docs/plan-register.md?ref=deadbeef123",
    );
  });

  it("resolves the default branch first when no ref is given", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () =>
        jsonResponse({ default_branch: "main" }),
      )
      .mockImplementationOnce(async () => jsonResponse({ sha: "cafef00d" }))
      .mockImplementationOnce(async () =>
        jsonResponse({
          encoding: "base64",
          content: Buffer.from("- P1-N001 [done] hi").toString("base64"),
        }),
      );

    const fetcher = new GithubAppRegisterFetcher(
      "majodali",
      "project-orchestrator",
      FAKE_TOKEN,
      fetchImpl,
    );

    const result = await fetcher.fetchPlanRegister();

    expect(result.ref).toBe("main");
    expect(result.sha).toBe("cafef00d");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.github.com/repos/majodali/project-orchestrator",
    );
  });

  it("sends the installation token as a Bearer header on every call", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => jsonResponse({ sha: "abc" }))
      .mockImplementationOnce(async () =>
        jsonResponse({
          encoding: "base64",
          content: Buffer.from("x").toString("base64"),
        }),
      );

    const fetcher = new GithubAppRegisterFetcher(
      "majodali",
      "project-orchestrator",
      FAKE_TOKEN,
      fetchImpl,
    );
    await fetcher.fetchPlanRegister("main");

    for (const call of fetchImpl.mock.calls) {
      const init = call[1] as { headers: Record<string, string> };
      expect(init.headers.Authorization).toBe("Bearer installation-token-abc");
    }
  });

  it("throws GithubFetchError, naming status and body, when ref resolution fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => errorResponse(404, "Not Found"));

    const fetcher = new GithubAppRegisterFetcher(
      "majodali",
      "project-orchestrator",
      FAKE_TOKEN,
      fetchImpl,
    );

    await expect(
      fetcher.fetchPlanRegister("no-such-ref"),
    ).rejects.toMatchObject({
      name: "GithubFetchError",
      status: 404,
    });
  });

  it("throws GithubFetchError when content fetch fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => jsonResponse({ sha: "abc" }))
      .mockImplementationOnce(async () => errorResponse(404, "no such file"));

    const fetcher = new GithubAppRegisterFetcher(
      "majodali",
      "project-orchestrator",
      FAKE_TOKEN,
      fetchImpl,
    );

    await expect(fetcher.fetchPlanRegister("main")).rejects.toBeInstanceOf(
      GithubFetchError,
    );
  });

  it("throws GithubFetchError on an unexpected content encoding", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => jsonResponse({ sha: "abc" }))
      .mockImplementationOnce(async () =>
        jsonResponse({ encoding: "utf-8", content: "not base64" }),
      );

    const fetcher = new GithubAppRegisterFetcher(
      "majodali",
      "project-orchestrator",
      FAKE_TOKEN,
      fetchImpl,
    );

    await expect(fetcher.fetchPlanRegister("main")).rejects.toBeInstanceOf(
      GithubFetchError,
    );
  });
});
