import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { InMemoryLeaseBackend } from "../src/planRegister/inMemoryLeaseBackend.js";
import type {
  FetchedRegister,
  RegisterFetcher,
} from "../src/planRegister/registerFetcher.js";

/**
 * The operational I1/I3 exercise (chunk 1 child D, node P2-N010),
 * against a **real, throwaway local git repository** — never the
 * coordinating repository itself (read-only for this node) — created
 * fresh in a temp directory for each test and removed afterward.
 *
 * I1 (docs/specs/p2-n002-service-skeleton.md — "Checked operationally:
 * do it both ways on a scratch branch and diff docs/plan-register.md
 * — the diff is empty"): one branch gets the transition applied by
 * hand (the v1 process — a session opening the file and editing the
 * stage bracket itself); a second, independent branch gets it applied
 * by taking `plan_update`'s returned edit and committing exactly
 * that. The two branches' `docs/plan-register.md` are diffed —
 * literally, with `git diff` — and the assertion is that the diff is
 * empty.
 *
 * I3 (the R10 detection): a third branch deliberately never lands the
 * edit, and `plan_confirm` is called against that commit's SHA anyway
 * — the divergence this induces is asserted to be reported, naming
 * the file and the line, exactly as it would be for a genuine
 * mismatch.
 *
 * `GitCliRegisterFetcher` below is test-only plumbing (reads register
 * content via `git show <sha>:docs/plan-register.md`, resolves refs
 * via `git rev-parse`) — not a second production `RegisterFetcher`
 * (I5's "the only production implementation is
 * GithubAppRegisterFetcher" is about src/, not this file).
 */

class GitCliRegisterFetcher implements RegisterFetcher {
  constructor(private readonly repoDir: string) {}

  async fetchPlanRegister(ref?: string): Promise<FetchedRegister> {
    const requestedRef = ref ?? "main";
    const sha = execFileSync("git", ["rev-parse", requestedRef], {
      cwd: this.repoDir,
      encoding: "utf-8",
    }).trim();
    const content = execFileSync(
      "git",
      ["show", `${sha}:docs/plan-register.md`],
      { cwd: this.repoDir, encoding: "utf-8" },
    );
    return {
      content,
      ref: requestedRef,
      sha,
      fetchedAt: new Date().toISOString(),
    };
  }
}

function git(repoDir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf-8" }).trim();
}

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

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: Array<{ type: string; text: string }>;
};

async function call(
  app: ReturnType<typeof createApp>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const res = await app.request(mcpRequest(toolCall(name, args)));
  const body = (await res.json()) as { result: ToolResult };
  return body.result;
}

const REGISTER_CONTENT = [
  "- P9-N001 [broken-down] Root",
  "  - P9-N002 [identified] A leaf due for planning — plan: plans/p9-n002.md",
  "  - P9-N003 [done] Already finished",
].join("\n");

const ORIGINAL_ENV = { ...process.env };
let repoDir: string;
let baseSha: string;

beforeEach(() => {
  process.env.MCP_AUTH_TOKEN = "test-token-123";

  repoDir = mkdtempSync(path.join(tmpdir(), "p2-n010-i1-i3-"));
  git(repoDir, "init", "--initial-branch=main", "-q");
  git(repoDir, "config", "user.email", "test@example.invalid");
  git(repoDir, "config", "user.name", "P2-N010 exercise");
  execFileSync("mkdir", ["-p", path.join(repoDir, "docs")]);
  writeFileSync(
    path.join(repoDir, "docs", "plan-register.md"),
    REGISTER_CONTENT + "\n",
  );
  git(repoDir, "add", "docs/plan-register.md");
  git(repoDir, "commit", "-q", "-m", "v0: baseline register");
  baseSha = git(repoDir, "rev-parse", "HEAD");
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  rmSync(repoDir, { recursive: true, force: true });
});

describe("I1 — equivalence with the v1 process (operational)", () => {
  it("hand-editing the register and applying plan_update's edit produce byte-identical results", async () => {
    // --- Branch 1: the v1 process, a session editing the file by hand.
    git(repoDir, "checkout", "-q", "-b", "v1-manual", baseSha);
    const manualPath = path.join(repoDir, "docs", "plan-register.md");
    const manualBefore = readFileSync(manualPath, "utf-8");
    const manualAfter = manualBefore.replace(
      "- P9-N002 [identified] A leaf due for planning",
      "- P9-N002 [planned] A leaf due for planning",
    );
    expect(manualAfter).not.toBe(manualBefore);
    writeFileSync(manualPath, manualAfter);
    git(repoDir, "add", "docs/plan-register.md");
    git(
      repoDir,
      "commit",
      "-q",
      "-m",
      "P9-N002: identified -> planned (v1 process, by hand)",
    );
    const v1Result = readFileSync(manualPath, "utf-8");

    // --- Branch 2: the service flow — plan_lease_acquire, plan_update,
    // apply exactly the returned edit, commit, plan_confirm.
    git(repoDir, "checkout", "-q", "-b", "service-flow", baseSha);
    const fetcher = new GitCliRegisterFetcher(repoDir);
    const app = createApp({
      planRegisterFetcher: fetcher,
      planLeaseBackend: new InMemoryLeaseBackend(),
    });

    const acquired = await call(app, "plan_lease_acquire", {
      holder: "T024-exercise",
    });
    expect(acquired.isError).toBeFalsy();
    const leaseToken = acquired.structuredContent!.token as string;

    const updated = await call(app, "plan_update", {
      nodeId: "P9-N002",
      toStage: "planned",
      reason: "planning was dispatched",
      ref: "service-flow",
      sha: baseSha,
      leaseToken,
    });
    expect(updated.isError).toBeFalsy();
    const edit = updated.structuredContent!.edit as {
      file: string;
      line: number;
      oldLine: string;
      newLine: string;
    };
    expect(edit.file).toBe("docs/plan-register.md");
    expect(edit.oldLine).toContain("[identified]");
    expect(edit.newLine).toContain("[planned]");

    // Apply *exactly* the returned edit — the session's only job.
    const servicePath = path.join(repoDir, "docs", "plan-register.md");
    const lines = readFileSync(servicePath, "utf-8").split("\n");
    expect(lines[edit.line - 1]).toBe(edit.oldLine);
    lines[edit.line - 1] = edit.newLine;
    writeFileSync(servicePath, lines.join("\n"));
    git(repoDir, "add", "docs/plan-register.md");
    git(
      repoDir,
      "commit",
      "-q",
      "-m",
      "P9-N002: identified -> planned (plan_update's edit, applied verbatim)",
    );
    const newSha = git(repoDir, "rev-parse", "HEAD");

    const confirmed = await call(app, "plan_confirm", {
      nodeId: "P9-N002",
      toStage: "planned",
      sha: newSha,
      leaseToken,
    });
    expect(confirmed.isError).toBeFalsy();
    expect(confirmed.structuredContent).toMatchObject({
      nodeId: "P9-N002",
      toStage: "planned",
      sha: newSha,
      line: edit.line,
    });

    const serviceResult = readFileSync(servicePath, "utf-8");

    // --- The I1 check itself, run literally: git diff between the
    // two branches' docs/plan-register.md is empty.
    const diffOutput = execFileSync(
      "git",
      ["diff", "v1-manual", "service-flow", "--", "docs/plan-register.md"],
      { cwd: repoDir, encoding: "utf-8" },
    );
    expect(diffOutput).toBe("");
    expect(serviceResult).toBe(v1Result);
  });
});

describe("I3 — divergence is loud (operational, R10)", () => {
  it("plan_confirm refuses a SHA whose register never carries the edit, naming the file and the line", async () => {
    git(repoDir, "checkout", "-q", "-b", "service-flow-divergent", baseSha);
    const fetcher = new GitCliRegisterFetcher(repoDir);
    const app = createApp({
      planRegisterFetcher: fetcher,
      planLeaseBackend: new InMemoryLeaseBackend(),
    });

    const acquired = await call(app, "plan_lease_acquire", {
      holder: "T024-exercise-divergent",
    });
    const leaseToken = acquired.structuredContent!.token as string;

    const updated = await call(app, "plan_update", {
      nodeId: "P9-N002",
      toStage: "planned",
      reason: "planning was dispatched",
      ref: "service-flow-divergent",
      sha: baseSha,
      leaseToken,
    });
    expect(updated.isError).toBeFalsy();
    const edit = updated.structuredContent!.edit as { line: number };

    // Deliberately induced mismatch: commit an *unrelated* change —
    // the session claims to have applied the edit and pushed, but the
    // register content at this SHA never actually changed.
    const readmePath = path.join(repoDir, "README.md");
    writeFileSync(readmePath, "unrelated change\n");
    git(repoDir, "add", "README.md");
    git(
      repoDir,
      "commit",
      "-q",
      "-m",
      "an unrelated commit — the register edit never landed",
    );
    const divergentSha = git(repoDir, "rev-parse", "HEAD");

    const confirmed = await call(app, "plan_confirm", {
      nodeId: "P9-N002",
      toStage: "planned",
      sha: divergentSha,
      leaseToken,
    });

    expect(confirmed.isError).toBe(true);
    const message = confirmed.content[0]!.text;
    expect(message).toContain("docs/plan-register.md");
    expect(message).toContain(`line ${edit.line}`);
    expect(message).toContain("[identified]");
    expect(message).toContain("[planned]");

    // The lease is deliberately left held on a divergence (see
    // src/planWriteTools.ts's plan_confirm doc comment) — a second
    // acquirer is still refused, so the session can investigate.
    const secondAcquire = await call(app, "plan_lease_acquire", {
      holder: "someone-else",
    });
    expect(secondAcquire.isError).toBe(true);
  });
});
