import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression test for node P2-N016 (T036) defect 2: `scripts/deploy.sh`
 * read `live`'s FunctionVersion back and passed it through unchanged —
 * correct in isolation, but the invariant it protects ("an ordinary
 * deploy declares no change to `live`") does not hold while `live`
 * itself is pinned to the mutable `$LATEST` qualifier. The first real
 * CI run hit exactly this: `live` was still bootstrapped to `$LATEST`,
 * the read-back passed `$LATEST` straight through, CloudFormation
 * correctly declared no *template* change to `LiveAlias` — and `live`
 * began serving the newly deployed code the instant `sam deploy`
 * updated the function, before the smoke test (or the promote step)
 * ever ran.
 *
 * This test does not deploy anything real (no session dispatched to
 * build this holds AWS credentials — see this task's own report for
 * the proved/unproven split). It stands up fake `aws` and `sam`
 * executables on `PATH` that log every invocation and answer exactly
 * the queries `scripts/deploy.sh` makes, then runs the real script
 * against them, to check the *decision* the script makes in each of
 * the states `live` can actually be in — not AWS's own behavior.
 *
 * Four states:
 *  - No stack yet (the genuine first-ever deploy of a brand-new
 *    stack) — must still proceed, using `$LATEST` (there is nothing
 *    else to pin to before `LiveAlias` itself exists).
 *  - Stack exists, `live` already pinned to a real version number —
 *    must proceed, passing that version through unchanged, and must
 *    never re-publish or otherwise move it itself.
 *  - Stack exists, `live` is at `$LATEST` — must refuse to deploy
 *    (exit non-zero) *before* invoking `sam` at all, per the "fail
 *    closed" requirement; a deploy that proceeds here is the defect.
 *  - Stack exists, but reading `live` back fails outright — treated
 *    as an anomaly (once a stack exists, `LiveAlias` was created in
 *    that same stack and should always be readable), so this also
 *    refuses rather than guessing.
 */

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const DEPLOY_SCRIPT = path.join(REPO_ROOT, "scripts", "deploy.sh");

const FAKE_AWS = `#!/usr/bin/env bash
# Fake "aws" for deployScriptLivePinning.test.ts — answers only the
# two calls scripts/deploy.sh's read-back logic makes before it either
# refuses or proceeds to (fake) "sam build"/"sam deploy". Anything else
# is a test-writing error, not a case scripts/deploy.sh should hit at
# this point in its own run — fail loudly rather than guess.
set -euo pipefail
echo "aws $*" >> "$FAKE_CALLS_LOG"
case "$1 $2" in
  "cloudformation describe-stacks")
    if [[ "$*" == *"Endpoint"* ]]; then
      # The trailing describe-stacks call, after (fake) "sam deploy"
      # has already run — a stack exists by construction at this
      # point in every case this script reaches it, whatever
      # FAKE_STACK_EXISTS said about the state *before* the deploy.
      echo "https://fake.execute-api.us-east-1.amazonaws.com"
      exit 0
    fi
    if [ "\${FAKE_STACK_EXISTS:-false}" = "true" ]; then
      echo "fake-function-name"
      exit 0
    fi
    exit 254
    ;;
  "lambda get-alias")
    if [ "\${FAKE_GET_ALIAS_FAILS:-false}" = "true" ]; then
      echo "fake: An error occurred (ResourceNotFoundException)" >&2
      exit 1
    fi
    echo "\${FAKE_LIVE_VERSION:-}"
    ;;
  *)
    echo "fake aws: unhandled invocation in this test: $*" >&2
    exit 1
    ;;
esac
`;

const FAKE_SAM = `#!/usr/bin/env bash
# Fake "sam" — records that it ran and exits 0. The refusing-to-deploy
# cases below assert this is never called at all.
set -euo pipefail
echo "sam $*" >> "$FAKE_CALLS_LOG"
exit 0
`;

function runDeployScript(env: Record<string, string>) {
  const binDir = mkdtempSync(path.join(tmpdir(), "deploy-script-test-bin-"));
  const callsLog = path.join(binDir, "calls.log");
  writeFileSync(path.join(binDir, "aws"), FAKE_AWS, { mode: 0o755 });
  writeFileSync(path.join(binDir, "sam"), FAKE_SAM, { mode: 0o755 });
  chmodSync(path.join(binDir, "aws"), 0o755);
  chmodSync(path.join(binDir, "sam"), 0o755);

  const result = spawnSync("bash", [DEPLOY_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env: {
      // A deliberately minimal environment — deploy.sh must not
      // depend on anything from this test runner's own ambient
      // environment, only on what it documents as required.
      PATH: `${binDir}:/usr/bin:/bin`,
      AWS_REGION: "us-east-1",
      AUTH_TOKEN_SECRET_NAME: "fake/auth-token",
      GITHUB_APP_ID: "1",
      GITHUB_APP_INSTALLATION_ID: "1",
      GITHUB_APP_PRIVATE_KEY_SECRET_NAME: "fake/github-app-key",
      FAKE_CALLS_LOG: callsLog,
      ...env,
    },
  });

  let calls: string[];
  try {
    calls = readFileSync(callsLog, "utf-8")
      .split("\n")
      .filter((line: string) => line.length > 0);
  } catch {
    calls = [];
  }
  rmSync(binDir, { recursive: true, force: true });
  return { ...result, calls };
}

describe("scripts/deploy.sh — pinning `live` away from $LATEST (node P2-N016, I4)", () => {
  it("a brand-new stack (no stack yet) still deploys, using $LATEST — there is nothing else to pin to", () => {
    const { status, stdout, calls } = runDeployScript({
      FAKE_STACK_EXISTS: "false",
    });
    expect(stdout).toContain("live is currently at FunctionVersion=$LATEST");
    expect(calls.some((c) => c.startsWith("sam build"))).toBe(true);
    expect(
      calls.some(
        (c) => c.startsWith("sam deploy") && c.includes("LiveVersion=$LATEST"),
      ),
    ).toBe(true);
    expect(status).toBe(0);
  });

  it("an existing stack with `live` already pinned to a real version passes that version through unchanged, and never republishes it", () => {
    const { status, stdout, calls } = runDeployScript({
      FAKE_STACK_EXISTS: "true",
      FAKE_LIVE_VERSION: "7",
    });
    expect(stdout).toContain("live is currently at FunctionVersion=7");
    expect(
      calls.some(
        (c) => c.startsWith("sam deploy") && c.includes("LiveVersion=7"),
      ),
    ).toBe(true);
    expect(calls.some((c) => c.includes("publish-version"))).toBe(false);
    expect(calls.some((c) => c.includes("update-alias"))).toBe(false);
    expect(status).toBe(0);
  });

  it("refuses to deploy — before ever invoking sam — when an existing stack's `live` is pinned to $LATEST", () => {
    const { status, stderr, calls } = runDeployScript({
      FAKE_STACK_EXISTS: "true",
      FAKE_LIVE_VERSION: "$LATEST",
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("REFUSING TO DEPLOY");
    expect(stderr).toContain("$LATEST");
    // The whole point: a deploy that proceeds here is the defect this
    // test guards against, so `sam` must never have been invoked.
    expect(calls.some((c) => c.startsWith("sam "))).toBe(false);
  });

  it("refuses to deploy when an existing stack's `live` cannot be read back at all, rather than guessing", () => {
    const { status, stderr, calls } = runDeployScript({
      FAKE_STACK_EXISTS: "true",
      FAKE_GET_ALIAS_FAILS: "true",
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("REFUSING TO DEPLOY");
    expect(calls.some((c) => c.startsWith("sam "))).toBe(false);
  });
});
