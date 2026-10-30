/**
 * The coordinating repository's files at commit 1b9e207 (1b9e2074,
 * the register after the specification gates of 2026-10-30), as the
 * web view's E2 fixtures (node P2-N021, task E2): the Plan register
 * (E1's V7 fixture), the Cost log, the run journal, and the two plans
 * the V8 cases link. Copied with `git show 1b9e207:<path>` from
 * majodali/project-orchestrator. The register and the plans are byte
 * for byte. In the Cost log and the journal, each model identifier
 * (`claude-` and what follows, in the model fields and in notes) is
 * replaced by `recorded-model`, so no model identifier is held in
 * this repository's authored files; every other byte is as copied.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FakeRepository } from "./view.js";

export const FIXTURE_COMMIT = "1b9e2074ae87bda7dc4e0ad44060ec06b045a23d";

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

export const FIXTURE_FILES: ReadonlyMap<string, string> = new Map([
  ["docs/plan-register.md", fixture("plan-register.1b9e207.txt")],
  ["docs/cost-log.md", fixture("cost-log.1b9e207.txt")],
  ["orchestration/journal.jsonl", fixture("journal.1b9e207.txt")],
  [
    "docs/plans/p1-n008-mtool-checker-extension-point.md",
    fixture("plan-p1-n008.1b9e207.txt"),
  ],
  [
    "docs/plans/p2-n002-service-skeleton.md",
    fixture("plan-p2-n002.1b9e207.txt"),
  ],
]);

/** A fake repository whose `main` and `release/1` heads sit at the
 * fixture commit, holding every fixture file there. */
export function fixtureRepository(): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", FIXTURE_COMMIT);
  repo.heads.set("release/1", FIXTURE_COMMIT);
  for (const [path, content] of FIXTURE_FILES) {
    repo.setFile(FIXTURE_COMMIT, path, content);
  }
  return repo;
}
