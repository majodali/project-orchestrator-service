/**
 * GitHub App environment configuration for `plan_read` (chunk 1
 * child C, node P2-N009). Owner action O3 creates and installs the
 * App and stores its private key (decision 6 of the p2-n002 plan); a
 * deployment made before that action completes has none of this set,
 * which `loadGithubAppConfig` reports as "missing", not a crash (see
 * src/planRegister/defaultFetcher.ts).
 *
 * `MCP_PROJECT` (already wired for `service_identity`, see
 * src/serviceInfo.ts) is reused for which repository to read, rather
 * than adding a second "which repo" variable that could disagree with
 * it.
 */

export interface GithubAppEnvConfig {
  appId: string;
  installationId: string;
  privateKey: string;
  owner: string;
  repo: string;
}

export type GithubAppConfigResult =
  { ok: true; config: GithubAppEnvConfig } | { ok: false; missing: string[] };

const DEFAULT_PROJECT = "majodali/project-orchestrator";

export function loadGithubAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): GithubAppConfigResult {
  const appId = env.GITHUB_APP_ID?.trim();
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim();

  const missing: string[] = [];
  if (!appId) missing.push("GITHUB_APP_ID");
  if (!installationId) missing.push("GITHUB_APP_INSTALLATION_ID");
  if (!privateKey) missing.push("GITHUB_APP_PRIVATE_KEY");
  if (missing.length > 0) {
    return { ok: false, missing };
  }

  const project = env.MCP_PROJECT?.trim() || DEFAULT_PROJECT;
  const [owner, repo] = project.split("/");
  if (!owner || !repo) {
    return {
      ok: false,
      missing: [
        `MCP_PROJECT (got ${JSON.stringify(project)}; expected "<owner>/<repo>")`,
      ],
    };
  }

  return {
    ok: true,
    config: {
      appId: appId!,
      installationId: installationId!,
      privateKey: privateKey!,
      owner,
      repo,
    },
  };
}
