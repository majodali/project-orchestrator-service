/**
 * The coordinating repository's state file at commit 325c502 (the head
 * of `main` after the rebuild's milestone 1 merged), as the view's
 * fixture: `orchestration/state.json`, copied byte for byte except that
 * each model identifier (`claude-` and what follows) is replaced by
 * `recorded-model`, so no model identifier is held in this repository's
 * authored files.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FakeRepository } from "./view.js";

export const COMMIT_325C502 = "325c5029b7479524a239f6f3e858263533dd6d2a";

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

export const FILES_325C502: ReadonlyMap<string, string> = new Map([
  ["orchestration/state.json", fixture("state.325c502.json")],
]);

/** A fake repository whose `main` head sits at 325c502, holding the
 * state file there. */
export function repository325c502(): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", COMMIT_325C502);
  for (const [p, content] of FILES_325C502) {
    repo.setFile(COMMIT_325C502, p, content);
  }
  return repo;
}
