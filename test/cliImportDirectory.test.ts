import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * P4-N049: `plan-state import --write` threw ENOENT at `writeFileSync`
 * over a repository with no `orchestration/` directory — legitimate,
 * since import needs only `docs/plan-register.md` or `docs/backlog.md`
 * (methodology-tools is one such repository). Drives the real CLI as a
 * subprocess, in the `mkdtempSync`/`spawnSync` pattern of
 * `test/prepareScript.test.ts` and `test/smokeTestViewCheck.test.ts`.
 */

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const CLI = path.join(REPO_ROOT, "src", "model", "cli.ts");
const TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

const CLEAN_BACKLOG = [
  "# Backlog",
  "",
  "## Completed",
  "",
  "- [x] **First chunk shipped** — the tool now does the first thing, closing the gap the founding plan named.",
  "",
].join("\n");

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plan-state-import-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "backlog.md"), CLEAN_BACKLOG);
  return dir;
}

function run(args: string[], cwd: string) {
  return spawnSync(TSX, [CLI, ...args], {
    cwd,
    encoding: "utf-8",
  });
}

describe("plan-state import --write, over a repository with no orchestration/", () => {
  it("creates the directory, writes both files, and exits on the import's own result", () => {
    const dir = makeRepo();
    const result = run(
      ["import", "--repo", dir, "--project", "majodali/example", "--write"],
      dir,
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "wrote orchestration/state.json and orchestration/import-record.md",
    );
    expect(result.stdout).toContain("0 violation(s), 0 warning(s).");
    expect(existsSync(path.join(dir, "orchestration", "state.json"))).toBe(
      true,
    );
    expect(
      existsSync(path.join(dir, "orchestration", "import-record.md")),
    ).toBe(true);
  });

  it("creates nothing without --write", () => {
    const dir = makeRepo();
    const result = run(
      ["import", "--repo", dir, "--project", "majodali/example"],
      dir,
    );
    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, "orchestration"))).toBe(false);
  });

  it("still writes both files when orchestration/ is already there", () => {
    const dir = makeRepo();
    mkdirSync(path.join(dir, "orchestration"));
    const result = run(
      ["import", "--repo", dir, "--project", "majodali/example", "--write"],
      dir,
    );
    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, "orchestration", "state.json"))).toBe(
      true,
    );
    expect(
      existsSync(path.join(dir, "orchestration", "import-record.md")),
    ).toBe(true);
  });
});

describe("plan-state render --write, over a repository with no docs/", () => {
  it("recreates docs/ through the same shared helper as import", () => {
    const dir = makeRepo();
    expect(
      run(
        ["import", "--repo", dir, "--project", "majodali/example", "--write"],
        dir,
      ).status,
    ).toBe(0);
    rmSync(path.join(dir, "docs"), { recursive: true, force: true });

    const result = run(["render", "--repo", dir, "--write"], dir);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, "docs", "plan-register.md"))).toBe(true);
    expect(existsSync(path.join(dir, "docs", "plan.md"))).toBe(true);
    expect(existsSync(path.join(dir, "docs", "backlog.md"))).toBe(true);
  });
});
