/**
 * The preview's default fixture directory (node P2-N023, iteration 1):
 * the coordinating repository at commit 2da1843, from the files the
 * view's tests already hold under `test/fixtures/`. They are copied to
 * their repository paths under `.preview/2da1843/`, which is
 * gitignored, so `VIEW_FIXTURE_DIR` can point at it. The SHA is the
 * commit's own, so document links on the preview open the real files
 * on GitHub.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

export const FIXTURE_SET_SHA = "2da18430a43e46588d65cbb4354f77bfb1419f84";

/** Fixture file under `test/fixtures/` → its repository path. */
const FIXTURE_SET: ReadonlyArray<readonly [string, string]> = [
  ["plan-register.2da1843.txt", "docs/plan-register.md"],
  ["cost-log.2da1843.txt", "docs/cost-log.md"],
  ["journal.2da1843.txt", "orchestration/journal.jsonl"],
  ["project-model.2da1843.txt", "docs/project-model.md"],
];

/** Writes the fixture set to `.preview/2da1843/` and answers its path. */
export function assembleFixtureSet(): { dir: string; sha: string } {
  const dir = path.join(REPO_ROOT, ".preview", "2da1843");
  for (const [fixture, repoPath] of FIXTURE_SET) {
    const target = path.join(dir, repoPath);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(REPO_ROOT, "test", "fixtures", fixture), target);
  }
  return { dir, sha: FIXTURE_SET_SHA };
}
