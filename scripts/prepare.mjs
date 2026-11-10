// `npm` runs this as the package's `prepare` script, on every
// `npm install` here and when another repository installs this
// package as a git dependency. The git-dependency install has the dev
// dependencies and must build `dist/`, which carries the `plan-state`
// binary. `sam build`'s esbuild builder also runs `npm install`, in a
// sandbox with production dependencies only, and bundles from `src/`
// itself; there TypeScript is absent and a build would fail the deploy
// (runs 19 and 20 of the Deploy workflow, 2026-11-10). So: build when
// TypeScript is installed, skip with a message when it is not.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `npm run build` needs `tsc` on the path npm builds from this
// package's own `node_modules/.bin`; that is the thing to check, not
// whether a `typescript` package resolves from somewhere (a transitive
// copy can resolve while the bin is absent, as in `sam build`).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(root, "node_modules", ".bin", "tsc");

if (!existsSync(tsc)) {
  console.log(
    `prepare: ${path.relative(root, tsc)} is not installed (a production install), so dist/ is not built here.`,
  );
  process.exit(0);
}

const result = spawnSync("npm", ["run", "build"], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
