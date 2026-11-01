import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * How the web view is served and deployed (node P2-N021, task E1;
 * criteria V18 and V20 of the specification of P2-N003, child 1).
 * Read from the files themselves; nothing here deploys. `sam validate
 * --lint` runs in the pull-request checks (.github/workflows/checks.yml).
 */

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const TEMPLATE = readFileSync(path.join(REPO_ROOT, "template.yaml"), "utf-8");
const DEPLOY_WORKFLOW = readFileSync(
  path.join(REPO_ROOT, ".github", "workflows", "deploy.yml"),
  "utf-8",
);

/** Each resource of the template: its logical ID and its YAML block. */
function resources(): Map<string, string> {
  const section = TEMPLATE.slice(
    TEMPLATE.indexOf("\nResources:\n"),
    TEMPLATE.indexOf("\nOutputs:\n"),
  );
  const out = new Map<string, string>();
  const blocks = section.split(/\n(?= {2}[A-Za-z0-9]+:\n)/);
  for (const block of blocks) {
    const m = /^ {2}([A-Za-z0-9]+):\n/.exec(block);
    if (m) out.set(m[1]!, block);
  }
  return out;
}

function ofType(type: string): string[] {
  return [...resources()]
    .filter(([, block]) => block.includes(`    Type: ${type}\n`))
    .map(([id]) => id);
}

describe("V18 — the template", () => {
  it("routes the three E1 paths to the existing McpIntegration", () => {
    const routes = new Map(
      ofType("AWS::ApiGatewayV2::Route").map((id) => {
        const block = resources().get(id)!;
        return [/RouteKey: "([^"]+)"/.exec(block)![1]!, block];
      }),
    );
    for (const key of [
      "GET /view",
      "GET /view/sign-in",
      "POST /view/sign-in",
    ]) {
      expect(routes.has(key), key).toBe(true);
      expect(routes.get(key)).toContain(
        'Target: !Sub "integrations/${McpIntegration}"',
      );
    }
    for (const [key] of routes) {
      if (key.includes("/view")) {
        expect(key).toMatch(
          /^(GET \/view|GET \/view\/sign-in|POST \/view\/sign-in|GET \/view\/node\/\{nodeId\}|GET \/view\/task\/\{taskId\})$/,
        );
      }
    }
  });

  it("declares no new integration, alias or Function URL", () => {
    expect(ofType("AWS::ApiGatewayV2::Integration")).toEqual([
      "McpIntegration",
    ]);
    expect(ofType("AWS::Lambda::Alias")).toEqual(["LiveAlias", "PreprodAlias"]);
    expect(ofType("AWS::Lambda::Url")).toEqual(["PreprodFunctionUrl"]);
  });

  it("brings the view token to the function only by a dynamic reference", () => {
    const lines = TEMPLATE.split("\n").filter((line) =>
      /^\s+VIEW_TOKEN:/.test(line),
    );
    expect(lines).toEqual([
      '          VIEW_TOKEN: !Sub "{{resolve:secretsmanager:${ViewTokenSecretName}:SecretString}}"',
    ]);
    const parameter = /\n {2}ViewTokenSecretName:\n([\s\S]*?)\n\n/.exec(
      TEMPLATE,
    );
    expect(parameter).not.toBeNull();
    expect(parameter![1]).toContain("Type: String");
    expect(parameter![1]).not.toMatch(/^\s+Default:/m);
  });
});

describe("V20 — one deploy path", () => {
  it("maps the new variable from a repository variable in the deploy workflow, and adds no secret", () => {
    expect(DEPLOY_WORKFLOW).toContain(
      "VIEW_TOKEN_SECRET_NAME: ${{ vars.VIEW_TOKEN_SECRET_NAME }}",
    );
    expect(DEPLOY_WORKFLOW).not.toMatch(/\$\{\{\s*secrets\./);
  });

  const FAKE_AWS = `#!/usr/bin/env bash
set -euo pipefail
echo "aws $*" >> "$FAKE_CALLS_LOG"
case "$1 $2" in
  "cloudformation describe-stacks")
    if [[ "$*" == *"Endpoint"* ]]; then
      echo "https://fake.execute-api.us-east-1.amazonaws.com"
      exit 0
    fi
    exit 254
    ;;
  *) echo "fake aws: unhandled invocation: $*" >&2; exit 1 ;;
esac
`;
  const FAKE_SAM = `#!/usr/bin/env bash
set -euo pipefail
echo "sam $*" >> "$FAKE_CALLS_LOG"
`;

  function runDeploy(extra: Record<string, string>) {
    const binDir = mkdtempSync(path.join(tmpdir(), "deploy-view-token-bin-"));
    const log = path.join(binDir, "calls.log");
    writeFileSync(path.join(binDir, "aws"), FAKE_AWS, { mode: 0o755 });
    writeFileSync(path.join(binDir, "sam"), FAKE_SAM, { mode: 0o755 });
    chmodSync(path.join(binDir, "aws"), 0o755);
    chmodSync(path.join(binDir, "sam"), 0o755);
    const result = spawnSync(
      "bash",
      [path.join(REPO_ROOT, "scripts", "deploy.sh")],
      {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        env: {
          PATH: `${binDir}:/usr/bin:/bin`,
          AWS_REGION: "us-east-1",
          AUTH_TOKEN_SECRET_NAME: "fake/auth-token",
          GITHUB_APP_ID: "1",
          GITHUB_APP_INSTALLATION_ID: "1",
          GITHUB_APP_PRIVATE_KEY_SECRET_NAME: "fake/github-app-key",
          FAKE_CALLS_LOG: log,
          ...extra,
        },
      },
    );
    const calls = readFileSync(log, "utf-8").split("\n").filter(Boolean);
    rmSync(binDir, { recursive: true, force: true });
    return { ...result, calls };
  }

  it("passes ViewTokenSecretName to sam deploy from VIEW_TOKEN_SECRET_NAME", () => {
    const result = runDeploy({ VIEW_TOKEN_SECRET_NAME: "fake/view-token" });
    expect(result.status).toBe(0);
    const deploy = result.calls.find((c) => c.startsWith("sam deploy"))!;
    expect(deploy).toContain("ViewTokenSecretName=fake/view-token");
    expect(result.stderr).not.toContain("VIEW_TOKEN_SECRET_NAME is not set");
  });

  it("warns and passes no ViewTokenSecretName when the variable is unset, leaving sam deploy to refuse the missing parameter", () => {
    const result = runDeploy({});
    const deploy = result.calls.find((c) => c.startsWith("sam deploy"))!;
    expect(deploy).not.toContain("ViewTokenSecretName");
    expect(result.stderr).toContain("VIEW_TOKEN_SECRET_NAME is not set");
  });
});
