/**
 * The GitHub fetch boundary for `plan_read` (chunk 1 child C, node
 * P2-N009). `RegisterFetcher` is the injectable seam I5 requires: the
 * parser and the tool contract are tested against fixture content and
 * a stubbed implementation of this interface, never against real
 * GitHub credentials. `GithubAppRegisterFetcher` is the only
 * production implementation — there is no local-disk or
 * unauthenticated-URL fallback anywhere in `src/` (see this node's
 * task result for why).
 *
 * Every read resolves the requested (or default) ref to a commit SHA
 * first, then fetches file content pinned to that exact SHA — so the
 * SHA reported alongside an answer is always the commit the content
 * came from, never a separately-fetched, possibly-racing value.
 */

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "project-orchestrator-service";
const DEFAULT_PATH = "docs/plan-register.md";

export interface FetchedRegister {
  content: string;
  /** The ref as requested, or the resolved default-branch name if none was given. */
  ref: string;
  /** The commit SHA `content` was read at (I5). */
  sha: string;
  /** ISO-8601 timestamp of when this fetch completed. */
  fetchedAt: string;
}

export interface RegisterFetcher {
  fetchPlanRegister(ref?: string): Promise<FetchedRegister>;
}

/** A ref resolved once to the commit every later read is pinned to. */
export interface ResolvedCommit {
  /** The ref as requested, or the default branch's name if none was given. */
  ref: string;
  /** The full 40-character commit SHA the ref resolved to. */
  sha: string;
}

/**
 * The read seam the web view uses (node P2-N021, task E1). It splits
 * what `fetchPlanRegister` does in one call into its two halves, so a
 * page can resolve its ref once and then read every file at that one
 * SHA (the specification of P2-N003, "How a page resolves its
 * commit"). `readFileAtSha` takes a full SHA only and refuses anything
 * else, so no caller can read a file by branch name through it.
 */
export interface CommitReader {
  /** The repository read, for links to GitHub's file and commit views. */
  readonly owner: string;
  readonly repo: string;
  resolveRef(ref?: string): Promise<ResolvedCommit>;
  readFileAtSha(sha: string, path: string): Promise<string>;
}

/** A full, lower-case, 40-character commit SHA. */
export const FULL_SHA = /^[0-9a-f]{40}$/;

export class GithubFetchError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "GithubFetchError";
    this.status = status;
    this.body = body;
  }
}

export class GithubAppRegisterFetcher implements RegisterFetcher, CommitReader {
  readonly owner: string;
  readonly repo: string;
  private readonly getInstallationToken: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly path: string;

  constructor(
    owner: string,
    repo: string,
    getInstallationToken: () => Promise<string>,
    fetchImpl: typeof fetch = fetch,
    path: string = DEFAULT_PATH,
  ) {
    this.owner = owner;
    this.repo = repo;
    this.getInstallationToken = getInstallationToken;
    this.fetchImpl = fetchImpl;
    this.path = path;
  }

  async fetchPlanRegister(ref?: string): Promise<FetchedRegister> {
    const headers = await this.requestHeaders();

    const requestedRef = ref ?? (await this.fetchDefaultBranch(headers));
    const sha = await this.resolveCommitSha(requestedRef, headers);
    const content = await this.fetchFileAtSha(sha, headers);

    return {
      content,
      ref: requestedRef,
      sha,
      fetchedAt: new Date().toISOString(),
    };
  }

  async resolveRef(ref?: string): Promise<ResolvedCommit> {
    const headers = await this.requestHeaders();
    const requestedRef = ref ?? (await this.fetchDefaultBranch(headers));
    const sha = await this.resolveCommitSha(requestedRef, headers);
    if (!FULL_SHA.test(sha)) {
      throw new GithubFetchError(
        `ref ${JSON.stringify(requestedRef)} resolved to ${JSON.stringify(sha)}, not a full commit SHA`,
        502,
        "",
      );
    }
    return { ref: requestedRef, sha };
  }

  async readFileAtSha(sha: string, path: string): Promise<string> {
    if (!FULL_SHA.test(sha)) {
      // A branch or tag name here would let a page mix two commits.
      throw new Error(
        `readFileAtSha needs a full 40-character commit SHA, got ${JSON.stringify(sha)}`,
      );
    }
    const headers = await this.requestHeaders();
    return this.fetchPathAtSha(path, sha, headers);
  }

  private async requestHeaders(): Promise<Record<string, string>> {
    const token = await this.getInstallationToken();
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
    };
  }

  private async fetchDefaultBranch(
    headers: Record<string, string>,
  ): Promise<string> {
    const res = await this.fetchImpl(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}`,
      { headers },
    );
    if (!res.ok) {
      throw new GithubFetchError(
        `could not resolve ${this.owner}/${this.repo}'s default branch`,
        res.status,
        await safeText(res),
      );
    }
    const body = (await res.json()) as { default_branch: string };
    return body.default_branch;
  }

  private async resolveCommitSha(
    ref: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const res = await this.fetchImpl(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(ref)}`,
      { headers },
    );
    if (!res.ok) {
      throw new GithubFetchError(
        `could not resolve ref ${JSON.stringify(ref)} to a commit on ${this.owner}/${this.repo}`,
        res.status,
        await safeText(res),
      );
    }
    const body = (await res.json()) as { sha: string };
    return body.sha;
  }

  private async fetchFileAtSha(
    sha: string,
    headers: Record<string, string>,
  ): Promise<string> {
    return this.fetchPathAtSha(this.path, sha, headers);
  }

  private async fetchPathAtSha(
    path: string,
    sha: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const res = await this.fetchImpl(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/contents/${path}?ref=${encodeURIComponent(sha)}`,
      { headers },
    );
    if (!res.ok) {
      throw new GithubFetchError(
        `could not fetch ${path} at ${sha} from ${this.owner}/${this.repo}`,
        res.status,
        await safeText(res),
      );
    }
    const body = (await res.json()) as { content: string; encoding: string };
    if (body.encoding !== "base64") {
      throw new GithubFetchError(
        `unexpected content encoding ${JSON.stringify(body.encoding)} for ${path} at ${sha}`,
        res.status,
        "",
      );
    }
    return Buffer.from(body.content, "base64").toString("utf-8");
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
