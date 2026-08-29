/**
 * Production wiring for the `RegisterFetcher` `plan_read` uses when no
 * override is supplied (chunk 1 child C, node P2-N009). Kept separate
 * from src/planReadTool.ts so tool registration never has to touch
 * environment configuration at all: a server registers and lists
 * `plan_read` fine even before owner action O3 is done, and the
 * `GithubAppNotConfiguredError` below only surfaces when the tool is
 * actually called — never a startup crash.
 */

import { loadGithubAppConfig } from "../githubAppConfig.js";
import { createInstallationTokenProvider } from "./githubAppAuth.js";
import { GithubAppRegisterFetcher } from "./registerFetcher.js";
import type { RegisterFetcher } from "./registerFetcher.js";

export class GithubAppNotConfiguredError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `GitHub App is not configured (missing environment variable(s): ${missing.join(", ")}). ` +
        "Owner action O3 (create and install the GitHub App, store its private key) " +
        "has not been completed for this deployment yet.",
    );
    this.name = "GithubAppNotConfiguredError";
    this.missing = missing;
  }
}

// Cached for the lifetime of this module instance (a warm Lambda
// container, or the local dev process) so a repeated `plan_read` call
// reuses the same installation-token provider — and therefore its
// cached token — instead of re-reading configuration and starting a
// fresh cache on every call.
let cached: RegisterFetcher | null = null;

export function getDefaultRegisterFetcher(
  env: NodeJS.ProcessEnv = process.env,
): RegisterFetcher {
  if (cached) {
    return cached;
  }
  const result = loadGithubAppConfig(env);
  if (!result.ok) {
    throw new GithubAppNotConfiguredError(result.missing);
  }
  const tokenProvider = createInstallationTokenProvider({
    appId: result.config.appId,
    installationId: result.config.installationId,
    privateKey: result.config.privateKey,
  });
  cached = new GithubAppRegisterFetcher(
    result.config.owner,
    result.config.repo,
    tokenProvider,
  );
  return cached;
}

/** Test-only escape hatch: clears the module-level cache so a test can
 * re-exercise configuration loading (e.g. "not configured" after a
 * previous test configured it). Not used, and not needed, by any
 * production code path. */
export function resetDefaultRegisterFetcherForTests(): void {
  cached = null;
}
