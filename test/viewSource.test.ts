import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What the view's source may reach (node P2-N021, task E1; criteria V6
 * and V17 of the specification of P2-N003, child 1). Walks every
 * relative import from `src/view/`, transitively, and checks that no
 * module reached is the lease backend, a write tool or an AWS SDK
 * client, and that no module reached imports one. The view reads git
 * through the GitHub App and nothing else.
 */

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const VIEW_DIR = path.join(REPO_ROOT, "src", "view");

const FORBIDDEN_MODULE =
  /(leaseBackend|LeaseBackend|aliasLeaseTable|dynamo|planWriteTools|updateEngine|transitions|mcpServer)\.ts$/;
const FORBIDDEN_PACKAGE = /^@aws-sdk\//;

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf-8");
  return [
    ...source.matchAll(
      /^\s*(?:import|export)[^"';]*?from\s+["']([^"']+)["']/gm,
    ),
  ].map((m) => m[1]!);
}

function closure(): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = readdirSync(VIEW_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => path.join(VIEW_DIR, name));
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const specifiers = importsOf(file);
    seen.set(file, specifiers);
    for (const spec of specifiers) {
      if (spec.startsWith(".")) {
        queue.push(
          path.resolve(path.dirname(file), spec.replace(/\.js$/, ".ts")),
        );
      }
    }
  }
  return seen;
}

describe("V6 and V17 — the view reaches no store but git, and no write path", () => {
  it("imports, directly or transitively, no lease backend, write tool or AWS SDK client", () => {
    const reached = closure();
    expect(reached.size).toBeGreaterThan(5);
    for (const [file, specifiers] of reached) {
      const relative = path.relative(REPO_ROOT, file);
      expect(relative, relative).not.toMatch(FORBIDDEN_MODULE);
      for (const spec of specifiers) {
        expect(spec, `${relative} imports ${spec}`).not.toMatch(
          FORBIDDEN_PACKAGE,
        );
      }
    }
  });
});
