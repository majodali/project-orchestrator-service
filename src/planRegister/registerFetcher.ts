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

export class GithubAppRegisterFetcher implements RegisterFetcher {
  private readonly owner: string;
  private readonly repo: string;
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
    const token = await this.getInstallationToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
    };

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
    const res = await this.fetchImpl(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/contents/${this.path}?ref=${encodeURIComponent(sha)}`,
      { headers },
    );
    if (!res.ok) {
      throw new GithubFetchError(
        `could not fetch ${this.path} at ${sha} from ${this.owner}/${this.repo}`,
        res.status,
        await safeText(res),
      );
    }
    const body = (await res.json()) as { content: string; encoding: string };
    if (body.encoding !== "base64") {
      throw new GithubFetchError(
        `unexpected content encoding ${JSON.stringify(body.encoding)} for ${this.path} at ${sha}`,
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
