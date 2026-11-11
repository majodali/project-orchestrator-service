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
import { GithubAppGitWriter } from "./gitWriter.js";
import type { GitWriter } from "./gitWriter.js";
import { GithubAppCommitChecks } from "./commitChecks.js";
import type { CommitChecks } from "./commitChecks.js";
import { GithubAppPullRequests } from "./pullRequests.js";
import type { PullRequests } from "./pullRequests.js";
import { GithubAppRegisterFetcher } from "./registerFetcher.js";
import type { CommitReader, RegisterFetcher } from "./registerFetcher.js";

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
let cached: GithubAppRegisterFetcher | null = null;
let cachedWriter: GithubAppGitWriter | null = null;
let cachedPullRequests: GithubAppPullRequests | null = null;
let cachedTokenProvider: (() => Promise<string>) | null = null;

/** One installation-token provider, and so one cached token, for the
 * reader, the writer and the pull request client. */
function sharedTokenProvider(config: {
  appId: string;
  installationId: string;
  privateKey: string;
}): () => Promise<string> {
  cachedTokenProvider ??= createInstallationTokenProvider(config);
  return cachedTokenProvider;
}

let cachedChecks: GithubAppCommitChecks | null = null;

/** The commit check reader: the same App and the same token. */
export function getDefaultCommitChecks(
  env: NodeJS.ProcessEnv = process.env,
): CommitChecks {
  if (cachedChecks) return cachedChecks;
  const result = loadGithubAppConfig(env);
  if (!result.ok) {
    throw new GithubAppNotConfiguredError(result.missing);
  }
  cachedChecks = new GithubAppCommitChecks(sharedTokenProvider(result.config));
  return cachedChecks;
}

/** The pull request client: the same App and the same token. */
export function getDefaultPullRequests(
  env: NodeJS.ProcessEnv = process.env,
): PullRequests {
  if (cachedPullRequests) return cachedPullRequests;
  const result = loadGithubAppConfig(env);
  if (!result.ok) {
    throw new GithubAppNotConfiguredError(result.missing);
  }
  cachedPullRequests = new GithubAppPullRequests(
    sharedTokenProvider(result.config),
  );
  return cachedPullRequests;
}

/** The writer the state store commits through: the same App and the
 * same token as the reads (the rebuild, milestone 3). */
export function getDefaultGitWriter(
  env: NodeJS.ProcessEnv = process.env,
): GitWriter {
  if (cachedWriter) return cachedWriter;
  const result = loadGithubAppConfig(env);
  if (!result.ok) {
    throw new GithubAppNotConfiguredError(result.missing);
  }
  const tokenProvider = sharedTokenProvider(result.config);
  cachedWriter = new GithubAppGitWriter(
    result.config.owner,
    result.config.repo,
    tokenProvider,
  );
  return cachedWriter;
}

export function getDefaultRegisterFetcher(
  env: NodeJS.ProcessEnv = process.env,
): RegisterFetcher {
  return getDefaultGithubFetcher(env);
}

/** The same cached, GitHub-App-backed instance, through the seam the
 * web view reads by (node P2-N021): resolve a ref once, then read each
 * file at that SHA. Throws `GithubAppNotConfiguredError` when called
 * before owner action O3, as `getDefaultRegisterFetcher` does. */
export function getDefaultCommitReader(
  env: NodeJS.ProcessEnv = process.env,
): CommitReader {
  return getDefaultGithubFetcher(env);
}

function getDefaultGithubFetcher(
  env: NodeJS.ProcessEnv,
): GithubAppRegisterFetcher {
  if (cached) {
    return cached;
  }
  const result = loadGithubAppConfig(env);
  if (!result.ok) {
    throw new GithubAppNotConfiguredError(result.missing);
  }
  const tokenProvider = sharedTokenProvider(result.config);
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
  cachedWriter = null;
  cachedPullRequests = null;
  cachedChecks = null;
  cachedTokenProvider = null;
}
