/**
 * `npm run view:preview` (node P2-N023, iteration 1): the local server
 * with the web view reading a fixture directory instead of GitHub.
 * Sign-in is the production flow: the token is `VIEW_TOKEN` from the
 * environment, and nothing bypasses it.
 *
 *   VIEW_TOKEN=<any local value> npm run view:preview
 *
 * `VIEW_FIXTURE_DIR` set: that directory is read (a checkout of the
 * coordinating repository works). Unset: the 2da1843 fixture set is
 * assembled and read (./fixtureSet.ts).
 */

import { spawn } from "node:child_process";
import path from "node:path";

import { REPO_ROOT, assembleFixtureSet } from "./fixtureSet.js";

if (!process.env.VIEW_TOKEN) {
  console.error(
    "VIEW_TOKEN is not set. Set it to any local value and sign in with it:\n  VIEW_TOKEN=local-preview npm run view:preview",
  );
  process.exit(1);
}

const env = { ...process.env };
if (!env.VIEW_FIXTURE_DIR) {
  const set = assembleFixtureSet();
  env.VIEW_FIXTURE_DIR = set.dir;
  env.VIEW_FIXTURE_SHA ??= set.sha;
}

const child = spawn(
  process.execPath,
  [
    path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(REPO_ROOT, "src", "localServer.ts"),
  ],
  { env, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
