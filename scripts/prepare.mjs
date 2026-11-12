// `npm` runs this as the package's `prepare` script, on every
// `npm install` here and when another repository installs this
// package as a git dependency. The git-dependency install has the dev
// dependencies and must build `dist/`, which carries the `plan-state`
// binary. `sam build`'s esbuild builder also runs `npm install`, in a
// sandbox with production dependencies only, and bundles from `src/`
// itself; there TypeScript is absent and a build would fail the deploy
// (runs 19 and 20 of the Deploy workflow, 2026-11-10). So: build when
// TypeScript is installed, skip with a message when it is not.
//
// Portable on purpose: it starts the TypeScript compiler with this
// same Node, by path, and never through `npm` or a shell. On Windows
// `npm` is `npm.cmd`, which a process cannot start without a shell, so
// the earlier `spawnSync("npm", ["run", "build"])` failed there and
// took the whole `npm ci` of the installing repository with it
// (2026-11-12).

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The build needs this package's own TypeScript: the compiler under
// `node_modules/typescript`, and the `tsc` entry npm links in
// `node_modules/.bin` when it installs the dev dependencies. That
// entry is the thing to check, not whether a `typescript` package
// resolves from somewhere (a transitive copy can resolve while the bin
// is absent, as in `sam build`). On Windows the entry is `tsc.cmd`.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "node_modules", ".bin");
const compiler = path.join(root, "node_modules", "typescript", "bin", "tsc");

if (
  !(
    existsSync(path.join(bin, "tsc")) || existsSync(path.join(bin, "tsc.cmd"))
  ) ||
  !existsSync(compiler)
) {
  console.log(
    `prepare: ${path.join("node_modules", ".bin", "tsc")} is not installed (a production install), so dist/ is not built here.`,
  );
  process.exit(0);
}

// The same two steps as `npm run build`: compile, then mark the
// `plan-state` binary executable (a no-op where the file system has no
// such bit).
const result = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit",
});
if (result.status !== 0) {
  if (result.error) console.error(`prepare: ${result.error.message}`);
  process.exit(result.status ?? 1);
}
try {
  chmodSync(path.join(root, "dist", "model", "cli.js"), 0o755);
} catch (err) {
  console.error(
    `prepare: could not mark dist/model/cli.js executable: ${err instanceof Error ? err.message : String(err)}`,
  );
}
