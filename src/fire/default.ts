/**
 * Production wiring for `runFireCheck` (P2-N048), the same split
 * `src/planRegister/defaultFetcher.ts` uses: no tool registration ever
 * has to touch AWS or network configuration directly, and a test
 * supplies its own `FireRuntime` instead of this one.
 */

import { getDefaultCommitReader } from "../planRegister/defaultFetcher.js";
import { fireRoutine } from "./client.js";
import type { FireRuntime } from "./run.js";
import { getFireToken } from "./secrets.js";

export function defaultFireRuntime(
  project: { owner: string; repo: string },
  now: () => Date,
): FireRuntime {
  return {
    settingsReader: getDefaultCommitReader(project.owner, project.repo),
    getToken: (secretName) => getFireToken(secretName),
    fire: fireRoutine,
    now,
  };
}
