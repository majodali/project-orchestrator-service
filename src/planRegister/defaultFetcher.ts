/**
 * Production wiring for the clients `plan_read` and the state tools
 * use when no override is supplied (chunk 1 child C, node P2-N009;
 * reworked for several repositories at P2-N054, design 2). Kept
 * separate from src/planReadTool.ts so tool registration never has to
 * touch environment configuration at all: a server registers and
 * lists `plan_read` fine even before owner action O3 is done, and the
 * `GithubAppNotConfiguredError` below only surfaces when the tool is
 * actually called — never a startup crash.
 *
 * Each getter now takes the repository it is for and keys its cache
 * by `owner/repo`: a call for a repository not seen before builds
 * that repository's client, resolving which installation backs it
 * through the App itself (src/planRegister/githubAppAuth.ts) rather
 * than a configured `GITHUB_APP_INSTALLATION_ID` — so a repository
 * new to a project needs no deploy. A repository the App is not
 * installed on fails only its own calls (`GithubAppInstallationNotFoundError`);
 * every cache here is a plain `Map`, naturally bounded by the small
 * number of repositories a deployment actually serves.
 */

import { loadGithubAppConfig } from "../githubAppConfig.js";
import {
  createRepoInstallationTokenProvider,
  GithubAppInstallationNotFoundError,
} from "./githubAppAuth.js";
import type { InstallationTokenProvider } from "./githubAppAuth.js";
import { GithubAppGitWriter } from "./gitWriter.js";
import type { GitWriter } from "./gitWriter.js";
import { GithubAppCommitChecks } from "./commitChecks.js";
import type { CommitChecks } from "./commitChecks.js";
import { GithubAppPullRequests } from "./pullRequests.js";
import type { PullRequests } from "./pullRequests.js";
import { GithubAppRegisterFetcher } from "./registerFetcher.js";
import type { CommitReader, RegisterFetcher } from "./registerFetcher.js";

export { GithubAppInstallationNotFoundError };

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

function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

// One token provider per repository, each resolving its own
// installation lazily on first use (githubAppAuth.ts). Repositories a
// deployment actually serves number in the single digits, so a plain
// Map needs no eviction policy.
const tokenProviders = new Map<string, InstallationTokenProvider>();

function sharedTokenProvider(
  owner: string,
  repo: string,
  config: { appId: string; privateKey: string },
): InstallationTokenProvider {
  const key = repoKey(owner, repo);
  let provider = tokenProviders.get(key);
  if (!provider) {
    provider = createRepoInstallationTokenProvider(config, owner, repo);
    tokenProviders.set(key, provider);
  }
  return provider;
}

const checksCache = new Map<string, GithubAppCommitChecks>();

/** The commit check reader for one repository: its own App token. */
export function getDefaultCommitChecks(
  owner: string,
  repo: string,
  env: NodeJS.ProcessEnv = process.env,
): CommitChecks {
  const key = repoKey(owner, repo);
  const cachedChecks = checksCache.get(key);
  if (cachedChecks) return cachedChecks;
  const result = loadGithubAppConfig(env);
  if (!result.ok) {
    throw new GithubAppNotConfiguredError(result.missing);
  }
  const checks = new GithubAppCommitChecks(
    sharedTokenProvider(owner, repo, result.config),
  );
  checksCache.set(key, checks);
  return checks;
}

const pullRequestsCache = new Map<string, GithubAppPullRequests>();

/** The pull request client for one repository: its own App token. */
export function getDefaultPullRequests(
  owner: string,
  repo: string,
  env: NodeJS.ProcessEnv = process.env,
): PullRequests {
  const key = repoKey(owner, repo);
  const cachedPullRequests = pullRequestsCache.get(key);
  if (cachedPullRequests) return cachedPullRequests;
  const result = loadGithubAppConfig(env);
  if (!result.ok) {
    throw new GithubAppNotConfiguredError(result.missing);
  }
  const pullRequests = new GithubAppPullRequests(
    sharedTokenProvider(owner, repo, result.config),
  );
  pullRequestsCache.set(key, pullRequests);
  return pullRequests;
}

const writerCache = new Map<string, GithubAppGitWriter>();

/** The writer the state store commits through, for one repository:
 * the same App and the same per-repository token as the reads. */
export function getDefaultGitWriter(
  owner: string,
  repo: string,
  env: NodeJS.ProcessEnv = process.env,
): GitWriter {
  const key = repoKey(owner, repo);
  const cachedWriter = writerCache.get(key);
  if (cachedWriter) return cachedWriter;
  const result = loadGithubAppConfig(env);
  if (!result.ok) {
    throw new GithubAppNotConfiguredError(result.missing);
  }
  const tokenProvider = sharedTokenProvider(owner, repo, result.config);
  const writer = new GithubAppGitWriter(owner, repo, tokenProvider);
  writerCache.set(key, writer);
  return writer;
}

export function getDefaultRegisterFetcher(
  owner: string,
  repo: string,
  env: NodeJS.ProcessEnv = process.env,
): RegisterFetcher {
  return getDefaultGithubFetcher(owner, repo, env);
}

/** The same cached, GitHub-App-backed instance, through the seam the
 * web view reads by (node P2-N021): resolve a ref once, then read each
 * file at that SHA. Throws `GithubAppNotConfiguredError` when called
 * before owner action O3, as `getDefaultRegisterFetcher` does. */
export function getDefaultCommitReader(
  owner: string,
  repo: string,
  env: NodeJS.ProcessEnv = process.env,
): CommitReader {
  return getDefaultGithubFetcher(owner, repo, env);
}

const fetcherCache = new Map<string, GithubAppRegisterFetcher>();

function getDefaultGithubFetcher(
  owner: string,
  repo: string,
  env: NodeJS.ProcessEnv,
): GithubAppRegisterFetcher {
  const key = repoKey(owner, repo);
  const cached = fetcherCache.get(key);
  if (cached) {
    return cached;
  }
  const result = loadGithubAppConfig(env);
  if (!result.ok) {
    throw new GithubAppNotConfiguredError(result.missing);
  }
  const tokenProvider = sharedTokenProvider(owner, repo, result.config);
  const fetcher = new GithubAppRegisterFetcher(owner, repo, tokenProvider);
  fetcherCache.set(key, fetcher);
  return fetcher;
}

/** Test-only escape hatch: clears every module-level cache so a test
 * can re-exercise configuration loading (e.g. "not configured" after
 * a previous test configured it). Not used, and not needed, by any
 * production code path. */
export function resetDefaultRegisterFetcherForTests(): void {
  fetcherCache.clear();
  writerCache.clear();
  pullRequestsCache.clear();
  checksCache.clear();
  tokenProviders.clear();
}
