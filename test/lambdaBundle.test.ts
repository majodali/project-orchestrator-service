import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression test for the post-PR-#5 outage (node P2-N010 rework):
 * every route, including the unauthenticated `GET /health`, returned
 * API Gateway's own `{"message":"Internal Server Error"}` — meaning
 * the Lambda function never initialized. Root cause:
 * `@aws-sdk/client-dynamodb` (introduced by the write path) reaches
 * `@smithy/node-http-handler`, which is CommonJS and `require()`s
 * Node builtins (`node:https`, etc.). `package.json`'s `bundle:lambda`
 * — and `template.yaml`'s `BuildProperties`, what `sam build` actually
 * uses — build with `--format=esm`, and under ESM there is no ambient
 * `require`; esbuild's own dynamic-require shim then throws
 * `Dynamic require of "node:https" is not supported` the moment the
 * bundle is loaded, which is every cold start.
 *
 * The check that should have caught this before it shipped, and had
 * been used on every prior task, was `node -e "import('...')"`.
 * `node -e` evaluates in **CommonJS** mode, and Node attaches
 * `require` to `globalThis` for that mode (confirmed:
 * `node -e 'console.log(typeof globalThis.require)'` prints
 * `"function"`); esbuild's shim finds that ambient `require` and the
 * bundle loads without error — a false negative, since the *deployed*
 * Lambda loads this exact `.mjs` file through Node's real ESM loader,
 * which has no such global (confirmed:
 * `node --input-type=module -e 'console.log(typeof globalThis.require)'`
 * prints `"undefined"`). So this test spawns a real `node` subprocess
 * in genuine ESM mode (`--input-type=module`) to import the built
 * bundle — not a plain `await import(...)` from inside this test file.
 *
 * That distinction is load-bearing, not pedantic: a plain
 * `await import(bundlePath)` from *inside a Vitest test* was tried
 * while building this regression test, against the unfixed bundle,
 * and it did **not** throw either — Vitest/Vite's own module runner is
 * a second instance of the exact same trap this node's rework closes
 * for the npm script and `sam build`. See this repository's Backlog
 * ("The false-negative artifact-validation trap, generalized") for
 * that finding recorded as a Backlog item, since it was discovered
 * incidentally while writing this test rather than fixed here (fixing
 * it would mean changing how every other test in this suite that
 * touches a build artifact runs, which is out of this node's scope).
 *
 * `bundle:lambda` is run fresh here (not assumed already built) so
 * this test fails the same way whether it is the only thing run or
 * part of a full `npm test`, and so it always exercises the exact
 * command `package.json` defines — one source of truth, not a second,
 * copied esbuild invocation that could silently drift from it.
 */

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const BUNDLE_PATH = path.join(REPO_ROOT, "dist-lambda", "lambda.mjs");

describe("the built Lambda bundle, loaded from a real ESM context", () => {
  it("exports a callable `handler` when imported the way Lambda's Node 22 runtime actually imports an .mjs file", () => {
    execFileSync("npm", ["run", "bundle:lambda"], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });

    // A real Node subprocess in genuine ESM mode — no ambient
    // `require`, unlike `node -e` (CommonJS) and unlike a plain
    // dynamic import from inside this Vitest test (see doc comment
    // above). This is what actually distinguishes a bundle that loads
    // in Lambda from one that only appears to.
    const checkScript = `
      const mod = await import(${JSON.stringify(pathToFileURL(BUNDLE_PATH).href)});
      if (typeof mod.handler !== "function") {
        console.error("handler export is " + typeof mod.handler + ", not a function");
        process.exit(1);
      }
      process.stdout.write("handler is callable");
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", checkScript],
      { encoding: "utf-8" },
    );

    expect(
      result.status,
      `bundle failed to load under real ESM (this is the outage's exact failure mode):\n${result.stderr}`,
    ).toBe(0);
    expect(result.stdout).toBe("handler is callable");
  });
});
