/**
 * The preview's default fixture directory: the coordinating
 * repository's state file at commit d4cbb7e, the fixture the view's
 * tests hold under `test/fixtures/`. It is copied to its repository
 * path under `.preview/d4cbb7e/`, which is gitignored, so
 * `VIEW_FIXTURE_DIR` can point at it. The SHA is the commit's own, so
 * document links on the preview open the real files on GitHub.
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

export const FIXTURE_SET_SHA = "d4cbb7e8d06b87279000bbcb62a9cab661e86995";

/** Fixture file under `test/fixtures/` → its repository path. */
const FIXTURE_SET: ReadonlyArray<readonly [string, string]> = [
  ["state.d4cbb7e.json", "orchestration/state.json"],
];

/** Writes the fixture set to `.preview/d4cbb7e/` and answers its path. */
export function assembleFixtureSet(): { dir: string; sha: string } {
  const dir = path.join(REPO_ROOT, ".preview", "d4cbb7e");
  for (const [fixture, repoPath] of FIXTURE_SET) {
    const target = path.join(dir, repoPath);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(REPO_ROOT, "test", "fixtures", fixture), target);
  }
  return { dir, sha: FIXTURE_SET_SHA };
}
