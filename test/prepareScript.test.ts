import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The `prepare` script (scripts/prepare.mjs) builds `dist/` only when
 * TypeScript is installed. `sam build`'s esbuild builder runs
 * `npm install` with production dependencies only, where a build
 * would fail the deploy, as the Deploy workflow's runs 19 and 20 did
 * on 2026-11-10.
 */

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("scripts/prepare.mjs", () => {
  it("is the package's prepare script", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
    ) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.prepare).toBe("node scripts/prepare.mjs");
  });

  it("skips the build, exit 0, where node_modules/.bin/tsc is absent", () => {
    // A copy of the script under a package root with no node_modules.
    const dir = mkdtempSync(path.join(tmpdir(), "prepare-"));
    dirs.push(dir);
    mkdirSync(path.join(dir, "scripts"));
    cpSync(
      path.join(REPO_ROOT, "scripts", "prepare.mjs"),
      path.join(dir, "scripts", "prepare.mjs"),
    );
    const result = spawnSync(
      process.execPath,
      [path.join(dir, "scripts", "prepare.mjs")],
      {
        cwd: dir,
        encoding: "utf-8",
        env: { ...process.env, NODE_PATH: "" },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tsc is not installed");
  });
});
