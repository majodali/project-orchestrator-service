/**
 * The coordinating repository's state file at commit d4cbb7e (the
 * owner's first review pass of 2026-11-10, on the rebuild branch), as the view's
 * fixture: `orchestration/state.json`, copied byte for byte except that
 * each model identifier (`claude-` and what follows) is replaced by
 * `recorded-model`, so no model identifier is held in this repository's
 * authored files.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FakeRepository } from "./view.js";

export const COMMIT_D4CBB7E = "d4cbb7e9b7479524a239f6f3e858263533dd6d2a";

function fixture(name: string): string {
  return readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "fixtures",
      name,
    ),
    "utf-8",
  );
}

export const FILES_D4CBB7E: ReadonlyMap<string, string> = new Map([
  ["orchestration/state.json", fixture("state.d4cbb7e.json")],
]);

/** A fake repository whose `main` head sits at d4cbb7e, holding the
 * state file there. */
export function repositoryd4cbb7e(): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", COMMIT_D4CBB7E);
  for (const [p, content] of FILES_D4CBB7E) {
    repo.setFile(COMMIT_D4CBB7E, p, content);
  }
  return repo;
}
