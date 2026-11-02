/**
 * The coordinating repository's files at commit 2da1843 (2da18430, the
 * head of `main` when the web view's task E3 started), as E3's
 * fixtures (node P2-N021, task E3): the Project model instance, the
 * Plan register, the Cost log and the run journal. Copied with
 * `git show 2da1843:<path>` from majodali/project-orchestrator. The
 * instance and the register are byte for byte. In the Cost log and the
 * journal, each model identifier (`claude-` and what follows) is
 * replaced by `recorded-model`, as E2's fixtures at 1b9e207 were, so no
 * model identifier is held in this repository's authored files; every
 * other byte is as copied.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FakeRepository } from "./view.js";

export const COMMIT_2DA1843 = "2da18430a43e46588d65cbb4354f77bfb1419f84";

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

export const FILES_2DA1843: ReadonlyMap<string, string> = new Map([
  ["docs/project-model.md", fixture("project-model.2da1843.txt")],
  ["docs/plan-register.md", fixture("plan-register.2da1843.txt")],
  ["docs/cost-log.md", fixture("cost-log.2da1843.txt")],
  ["orchestration/journal.jsonl", fixture("journal.2da1843.txt")],
]);

/** A fake repository whose `main` head sits at 2da1843, holding every
 * fixture file there. Plans are not held: a node page whose line links
 * a plan fails its read, so E3's node-page cases pick nodes whose lines
 * link none, or add the plan they need. */
export function repository2da1843(): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", COMMIT_2DA1843);
  for (const [path, content] of FILES_2DA1843) {
    repo.setFile(COMMIT_2DA1843, path, content);
  }
  return repo;
}
