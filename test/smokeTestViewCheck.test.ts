import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FAKE_MCP_TOKEN, FAKE_VIEW_TOKEN, SHA_A } from "./support/view.js";

/**
 * `scripts/smoke-test.sh`'s fourth check (node P2-N021, task E1;
 * criterion V19 of the specification of P2-N003, child 1), run for real
 * against a local server built from `createApp()`. A fake `aws` on
 * `PATH` answers the two Secrets Manager reads with fake tokens; `curl`
 * and `node` are the real ones. This checks the script's own logic.
 * The run log of the first deploy is what shows the check passing
 * against the preprod Function URL.
 */

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const SMOKE_SCRIPT = path.join(REPO_ROOT, "scripts", "smoke-test.sh");
const TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SERVER = path.join(REPO_ROOT, "test", "support", "smokeServer.ts");

const FAKE_AWS = `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *"--secret-id fake/mcp-auth-token"*) printf '%s\\n' "$FAKE_MCP_TOKEN" ;;
  *"--secret-id fake/view-token"*) printf '%s\\n' "$FAKE_VIEW_TOKEN_VALUE" ;;
  *) echo "fake aws: unhandled invocation: $*" >&2; exit 1 ;;
esac
`;

let server: ChildProcess;
let baseUrl: string;
let binDir: string;

beforeAll(async () => {
  binDir = mkdtempSync(path.join(tmpdir(), "smoke-view-check-bin-"));
  writeFileSync(path.join(binDir, "aws"), FAKE_AWS, { mode: 0o755 });
  chmodSync(path.join(binDir, "aws"), 0o755);

  server = spawn(TSX, [SERVER], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      MCP_AUTH_TOKEN: FAKE_MCP_TOKEN,
      VIEW_TOKEN: FAKE_VIEW_TOKEN,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const port = await new Promise<string>((resolve, reject) => {
    let out = "";
    server.stdout!.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const m = /PORT (\d+)/.exec(out);
      if (m) resolve(m[1]!);
    });
    server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  baseUrl = `http://127.0.0.1:${port}/`;
}, 30_000);

afterAll(() => {
  server?.kill();
  rmSync(binDir, { recursive: true, force: true });
});

function runSmoke(viewToken: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn("bash", [SMOKE_SCRIPT], {
        cwd: REPO_ROOT,
        env: {
          PATH: `${binDir}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
          SERVICE_URL: baseUrl,
          AWS_REGION: "us-east-1",
          AUTH_TOKEN_SECRET_NAME: "fake/mcp-auth-token",
          VIEW_TOKEN_SECRET_NAME: "fake/view-token",
          FAKE_MCP_TOKEN,
          FAKE_VIEW_TOKEN_VALUE: viewToken,
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
      child.on("exit", (status) => resolve({ status, stdout, stderr }));
    },
  );
}

describe("scripts/smoke-test.sh — check 4, the web view (node P2-N021, V19)", () => {
  it("signs in with the view token from Secrets Manager, reads /view, and requires 200 and a 40-character SHA", async () => {
    const result = await runSmoke(FAKE_VIEW_TOKEN);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Check 4/4");
    expect(result.stdout).toContain(
      `OK — /view returned 200 at commit ${SHA_A}.`,
    );
    expect(result.stdout).toContain("all four checks OK");
    expect(result.stdout).not.toContain(FAKE_VIEW_TOKEN);
  });

  it("prints SMOKE FAILURE naming check 4 and exits non-zero when sign-in is refused", async () => {
    const result = await runSmoke("fake-wrong-view-token");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SMOKE FAILURE (check 4/4, /view sign-in)");
    expect(result.stderr).toContain("returned 401, expected 303");
  });

  it("refuses to start without VIEW_TOKEN_SECRET_NAME", () => {
    const result = spawnSync("bash", [SMOKE_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: {
        PATH: `${binDir}:/usr/bin:/bin`,
        SERVICE_URL: baseUrl,
        AWS_REGION: "us-east-1",
        AUTH_TOKEN_SECRET_NAME: "fake/mcp-auth-token",
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("VIEW_TOKEN_SECRET_NAME");
  });
});
