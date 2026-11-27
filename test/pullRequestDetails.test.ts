import { describe, expect, it, vi } from "vitest";

import {
  DESCRIPTION_MAX_WORDS,
  GithubAppPullRequestDetails,
} from "../src/planRegister/pullRequestDetails.js";

/**
 * The pull request detail reader (P2-N087): reads a pull request's
 * title, description, head commit, mergeability and check runs
 * through the installed App, never throwing for one it cannot read.
 */

const PR_A = "majodali/project-orchestrator#40";
const PR_B = "majodali/project-orchestrator-service#12";

describe("GithubAppPullRequestDetails", () => {
  it("reads a pull request's description, head commit, mergeability and checks", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/repos/majodali/project-orchestrator/pulls/40") {
        return Response.json({
          title: "P2-N087: carry pull request detail",
          body: "What it does.",
          state: "open",
          mergeable: true,
          head: { sha: "a".repeat(40) },
        });
      }
      if (
        path ===
        `/repos/majodali/project-orchestrator/commits/${"a".repeat(40)}/check-runs`
      ) {
        return Response.json({
          check_runs: [
            { name: "build", status: "completed", conclusion: "success" },
            { name: "lint", status: "completed", conclusion: "failure" },
          ],
        });
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new GithubAppPullRequestDetails(
      async () => "fake-token",
      fetchImpl,
    );
    const answer = await client.describe([PR_A]);
    expect(answer.unreadable).toEqual([]);
    expect(answer.readable).toEqual([
      {
        ref: PR_A,
        repository: "majodali/project-orchestrator",
        number: 40,
        title: "P2-N087: carry pull request detail",
        description: "What it does.",
        headSha: "a".repeat(40),
        open: true,
        mergeable: true,
        checks: [
          { name: "build", conclusion: "success" },
          { name: "lint", conclusion: "failure" },
        ],
      },
    ]);
  });

  it("reads each of several pull requests in whichever repository it is in", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/repos/majodali/project-orchestrator/pulls/40") {
        return Response.json({
          title: "A",
          body: "a",
          state: "open",
          mergeable: true,
          head: { sha: "a".repeat(40) },
        });
      }
      if (path === "/repos/majodali/project-orchestrator-service/pulls/12") {
        return Response.json({
          title: "B",
          body: "b",
          state: "open",
          mergeable: false,
          head: { sha: "b".repeat(40) },
        });
      }
      if (path.endsWith("/check-runs")) {
        return Response.json({ check_runs: [] });
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new GithubAppPullRequestDetails(
      async () => "fake-token",
      fetchImpl,
    );
    const answer = await client.describe([PR_A, PR_B]);
    expect(answer.unreadable).toEqual([]);
    expect(answer.readable.map((p) => p.ref)).toEqual([PR_A, PR_B]);
    expect(answer.readable.map((p) => p.repository)).toEqual([
      "majodali/project-orchestrator",
      "majodali/project-orchestrator-service",
    ]);
  });

  it("names a pull request it cannot read, with the reason, rather than throwing", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/repos/majodali/project-orchestrator/pulls/40") {
        return Response.json({
          title: "A",
          body: "a",
          state: "open",
          mergeable: true,
          head: { sha: "a".repeat(40) },
        });
      }
      if (path.endsWith("/check-runs"))
        return Response.json({ check_runs: [] });
      if (path === "/repos/majodali/project-orchestrator-service/pulls/12") {
        return new Response("not found", { status: 404 });
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new GithubAppPullRequestDetails(
      async () => "fake-token",
      fetchImpl,
    );
    const answer = await client.describe([PR_A, PR_B]);
    expect(answer.readable.map((p) => p.ref)).toEqual([PR_A]);
    expect(answer.unreadable).toHaveLength(1);
    expect(answer.unreadable[0]!.ref).toBe(PR_B);
    expect(answer.unreadable[0]!.reason).toContain("HTTP 404");
    expect(answer.unreadable[0]!.reason).toContain("GitHub App");
  });

  it("names a pull request whose checks it cannot read, without failing the others", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/repos/majodali/project-orchestrator/pulls/40") {
        return Response.json({
          title: "A",
          body: "a",
          state: "open",
          mergeable: true,
          head: { sha: "a".repeat(40) },
        });
      }
      if (path.endsWith("/check-runs")) {
        return new Response("rate limited", { status: 403 });
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new GithubAppPullRequestDetails(
      async () => "fake-token",
      fetchImpl,
    );
    const answer = await client.describe([PR_A]);
    expect(answer.readable).toEqual([]);
    expect(answer.unreadable).toEqual([expect.objectContaining({ ref: PR_A })]);
    expect(answer.unreadable[0]!.reason).toContain("checks");
  });

  it("cuts a description over the bound, with the cut marked", async () => {
    const long = Array.from(
      { length: DESCRIPTION_MAX_WORDS + 50 },
      (_, i) => `word${i}`,
    ).join(" ");
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/repos/majodali/project-orchestrator/pulls/40") {
        return Response.json({
          title: "A",
          body: long,
          state: "open",
          mergeable: true,
          head: { sha: "a".repeat(40) },
        });
      }
      return Response.json({ check_runs: [] });
    });
    const client = new GithubAppPullRequestDetails(
      async () => "fake-token",
      fetchImpl,
    );
    const answer = await client.describe([PR_A]);
    const description = answer.readable[0]!.description;
    expect(description.split(/\s+/).length).toBeLessThanOrEqual(
      DESCRIPTION_MAX_WORDS,
    );
    expect(description.endsWith("[cut]")).toBe(true);
  });

  it("answers an empty description as empty, uncut", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/repos/majodali/project-orchestrator/pulls/40") {
        return Response.json({
          title: "A",
          body: null,
          state: "closed",
          mergeable: null,
          head: { sha: "a".repeat(40) },
        });
      }
      return Response.json({ check_runs: [] });
    });
    const client = new GithubAppPullRequestDetails(
      async () => "fake-token",
      fetchImpl,
    );
    const answer = await client.describe([PR_A]);
    expect(answer.readable[0]).toMatchObject({
      description: "",
      open: false,
      mergeable: null,
    });
  });
});
