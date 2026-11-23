/**
 * GitHub App environment configuration for `plan_read` (chunk 1
 * child C, node P2-N009). Owner action O3 creates and installs the
 * App and stores its private key (decision 6 of the p2-n002 plan); a
 * deployment made before that action completes has none of this set,
 * which `loadGithubAppConfig` reports as "missing", not a crash (see
 * src/planRegister/defaultFetcher.ts).
 *
 * Carries App credentials only (P2-N054, design 2): which repository
 * a call is for arrives separately, as the project the endpoint path
 * resolved to (src/projects.ts), and which installation backs that
 * repository is resolved per repository through the App itself
 * (src/planRegister/githubAppAuth.ts's `resolveInstallationId`), not
 * configured here.
 */

export interface GithubAppEnvConfig {
  appId: string;
  privateKey: string;
}

export type GithubAppConfigResult =
  { ok: true; config: GithubAppEnvConfig } | { ok: false; missing: string[] };

export function loadGithubAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): GithubAppConfigResult {
  const appId = env.GITHUB_APP_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim();

  const missing: string[] = [];
  if (!appId) missing.push("GITHUB_APP_ID");
  if (!privateKey) missing.push("GITHUB_APP_PRIVATE_KEY");
  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    config: {
      appId: appId!,
      privateKey: privateKey!,
    },
  };
}
