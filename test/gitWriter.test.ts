import { describe, expect, it, vi } from "vitest";

import {
  GitConflictError,
  GitWriteError,
  GithubAppGitWriter,
} from "../src/planRegister/gitWriter.js";

/**
 * The GitHub writer (the rebuild plan, milestone 3) makes one commit
 * through the Git Data API: blobs, a tree on the head's tree, a commit
 * with the head as parent, and a fast-forward ref update, which is
 * the concurrency check.
 */

const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);

function fakeGithub(
  options: { headNow?: string; refUpdateStatus?: number } = {},
) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  let blobs = 0;
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(
      "/repos/majodali/project-orchestrator/",
      "",
    );
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    if (path === "git/ref/heads/main") {
      return Response.json({ object: { sha: options.headNow ?? HEAD } });
    }
    if (path === `git/commits/${HEAD}` && method === "GET") {
      return Response.json({ tree: { sha: TREE } });
    }
    if (path === "git/blobs") {
      blobs += 1;
      return Response.json(
        { sha: `blob${blobs}`.padEnd(40, "0") },
        { status: 201 },
      );
    }
    if (path === "git/trees")
      return Response.json({ sha: "c".repeat(40) }, { status: 201 });
    if (path === "git/commits" && method === "POST")
      return Response.json({ sha: "d".repeat(40) }, { status: 201 });
    if (path === "git/refs/heads/main" && method === "PATCH") {
      const status = options.refUpdateStatus ?? 200;
      return status === 200
        ? Response.json({ object: { sha: "d".repeat(40) } })
        : new Response(
            JSON.stringify({ message: "Update is not a fast forward" }),
            { status },
          );
    }
    return new Response("unexpected", { status: 500 });
  });
  const writer = new GithubAppGitWriter(
    "majodali",
    "project-orchestrator",
    async () => "fake-token",
    fetchImpl,
  );
  return { writer, calls, fetchImpl };
}

const request = {
  branch: "main",
  expectedHeadSha: HEAD,
  message: "a commit",
  files: new Map([
    ["orchestration/state.json", "{}\n"],
    ["docs/plan.md", "# plan\n"],
  ]),
};

describe("GithubAppGitWriter", () => {
  it("creates blobs, a tree on the head's tree, a commit with the head as parent, and fast-forwards the ref", async () => {
    const { writer, calls, fetchImpl } = fakeGithub();
    const result = await writer.commitFiles(request);
    expect(result.sha).toBe("d".repeat(40));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET git/ref/heads/main",
      `GET git/commits/${HEAD}`,
      "POST git/blobs",
      "POST git/blobs",
      "POST git/trees",
      "POST git/commits",
      "PATCH git/refs/heads/main",
    ]);
    const tree = calls[4]!.body as {
      base_tree: string;
      tree: Array<{ path: string; mode: string }>;
    };
    expect(tree.base_tree).toBe(TREE);
    expect(tree.tree.map((t) => `${t.mode} ${t.path}`)).toEqual([
      "100644 orchestration/state.json",
      "100644 docs/plan.md",
    ]);
    const commit = calls[5]!.body as { parents: string[]; message: string };
    expect(commit.parents).toEqual([HEAD]);
    expect(commit.message).toBe("a commit");
    const update = calls[6]!.body as { force: boolean };
    expect(update.force).toBe(false);
    const headers = new Headers(fetchImpl.mock.calls[0]![1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer fake-token");
  });

  it("reports a conflict before creating anything when the head already moved", async () => {
    const { writer, calls } = fakeGithub({ headNow: "e".repeat(40) });
    await expect(writer.commitFiles(request)).rejects.toBeInstanceOf(
      GitConflictError,
    );
    expect(calls.map((c) => c.path)).toEqual(["git/ref/heads/main"]);
  });

  it("reports a conflict when the ref update is refused as not a fast forward", async () => {
    const { writer } = fakeGithub({ refUpdateStatus: 422 });
    await expect(writer.commitFiles(request)).rejects.toBeInstanceOf(
      GitConflictError,
    );
  });

  it("reports any other GitHub failure with its status", async () => {
    const { writer } = fakeGithub({ refUpdateStatus: 403 });
    await expect(writer.commitFiles(request)).rejects.toMatchObject({
      name: "GitWriteError",
      status: 403,
    });
    expect(new GitWriteError("x", 500, "y").status).toBe(500);
  });
});
