/**
 * Pull requests, through the installed App (owner, 2026-11-11): a
 * node is done only when its pull requests are merged, and the
 * service merges them itself when the done decision is taken, so no
 * merge waits on a person. It also opens a pull request for a branch
 * that has none. A merge goes through GitHub's own merge endpoint, so
 * branch protection and required checks still decide; the service
 * also refuses a pull request whose checks are failing or still
 * running where no check is required.
 *
 * The App needs `Pull requests: Read and write` and to be installed
 * on each repository whose pull requests it merges.
 */

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "project-orchestrator-service";
const PULL_REQUEST_REF = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

export interface PullRequestState {
  /** `owner/repo#number`. */
  ref: string;
  open: boolean;
  merged: boolean;
  draft: boolean;
  /** GitHub's `mergeable_state`: clean, unstable, blocked, dirty,
   * behind, draft, has_hooks or unknown. */
  mergeableState: string;
  headSha: string;
}

export interface PullRequests {
  get(ref: string): Promise<PullRequestState>;
  /** Merges with a merge commit, only if the head is still `headSha`. */
  merge(ref: string, headSha: string): Promise<{ sha: string }>;
  /** Opens a pull request from `branch` into the repository's default
   * branch; answers its `owner/repo#number`. */
  create(request: {
    repo: string;
    branch: string;
    title: string;
    body: string;
  }): Promise<string>;
}

export class PullRequestError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "PullRequestError";
    this.status = status;
    this.body = body;
  }
}

/** A pull request that cannot be merged now, and why. Nothing is
 * committed when this is thrown. */
export class NotMergeableError extends Error {
  readonly ref: string;
  constructor(ref: string, why: string) {
    super(`${ref} cannot be merged: ${why}`);
    this.name = "NotMergeableError";
    this.ref = ref;
  }
}

export function parsePullRequestRef(
  ref: string,
): { owner: string; repo: string; number: number } | null {
  const m = PULL_REQUEST_REF.exec(ref);
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : null;
}

const WHY_NOT: Readonly<Record<string, string>> = {
  unstable: "its checks are failing or still running",
  blocked:
    "branch protection is not satisfied: a required check or review is missing",
  dirty: "it conflicts with its base branch",
  behind:
    "its branch is behind its base and the repository requires it up to date",
  draft: "it is a draft",
  unknown:
    "GitHub has not computed whether it can merge; call again in a moment",
};

export interface EnsureMergedResult {
  /** Merged by this call. */
  merged: string[];
  /** Already merged before it. */
  already: string[];
}

/**
 * Merges each pull request that is not merged yet. Throws
 * `NotMergeableError` at the first that cannot be merged; those before
 * it stay merged, and calling again continues from there.
 */
export async function ensureMerged(
  client: () => PullRequests,
  refs: readonly string[],
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<EnsureMergedResult> {
  const result: EnsureMergedResult = { merged: [], already: [] };
  if (refs.length === 0) return result;
  const prs = client();
  for (const ref of [...new Set(refs)]) {
    let pr = await prs.get(ref);
    if (pr.merged) {
      result.already.push(ref);
      continue;
    }
    if (!pr.open)
      throw new NotMergeableError(ref, "it was closed without merging");
    if (pr.draft) throw new NotMergeableError(ref, WHY_NOT.draft!);
    // GitHub computes mergeability lazily: ask again, briefly.
    for (let i = 0; i < 3 && pr.mergeableState === "unknown"; i += 1) {
      await wait(1000);
      pr = await prs.get(ref);
    }
    if (pr.mergeableState !== "clean" && pr.mergeableState !== "has_hooks") {
      throw new NotMergeableError(
        ref,
        WHY_NOT[pr.mergeableState] ?? `GitHub reports ${pr.mergeableState}`,
      );
    }
    await prs.merge(ref, pr.headSha);
    result.merged.push(ref);
  }
  return result;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 2000);
  } catch {
    return "";
  }
}

export class GithubAppPullRequests implements PullRequests {
  private readonly getInstallationToken: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(
    getInstallationToken: () => Promise<string>,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.getInstallationToken = getInstallationToken;
    this.fetchImpl = fetchImpl;
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const token = await this.getInstallationToken();
    return this.fetchImpl(`${GITHUB_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  private async fail(what: string, res: Response): Promise<never> {
    const hint =
      res.status === 403 || res.status === 404
        ? "; the GitHub App needs `Pull requests: Read and write` and to be installed on that repository"
        : "";
    throw new PullRequestError(
      `${what}${hint}`,
      res.status,
      await safeText(res),
    );
  }

  async get(ref: string): Promise<PullRequestState> {
    const p = parsePullRequestRef(ref);
    if (!p)
      throw new PullRequestError(`${ref} is not owner/repo#number`, 400, "");
    const res = await this.call(
      "GET",
      `/repos/${p.owner}/${p.repo}/pulls/${p.number}`,
    );
    if (!res.ok) return this.fail(`could not read ${ref}`, res);
    const body = (await res.json()) as {
      state: string;
      merged: boolean;
      draft?: boolean;
      mergeable_state?: string;
      head: { sha: string };
    };
    return {
      ref,
      open: body.state === "open",
      merged: body.merged === true,
      draft: body.draft === true,
      mergeableState: body.mergeable_state ?? "unknown",
      headSha: body.head.sha,
    };
  }

  async merge(ref: string, headSha: string): Promise<{ sha: string }> {
    const p = parsePullRequestRef(ref);
    if (!p)
      throw new PullRequestError(`${ref} is not owner/repo#number`, 400, "");
    const res = await this.call(
      "PUT",
      `/repos/${p.owner}/${p.repo}/pulls/${p.number}/merge`,
      { sha: headSha, merge_method: "merge" },
    );
    // 405: not mergeable; 409: the head moved since it was read.
    if (res.status === 405 || res.status === 409) {
      throw new NotMergeableError(
        ref,
        `GitHub refused the merge (HTTP ${res.status}): ${await safeText(res)}`,
      );
    }
    if (!res.ok) return this.fail(`could not merge ${ref}`, res);
    const body = (await res.json()) as { sha: string };
    return { sha: body.sha };
  }

  async create(request: {
    repo: string;
    branch: string;
    title: string;
    body: string;
  }): Promise<string> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(request.repo)) {
      throw new PullRequestError(`${request.repo} is not owner/repo`, 400, "");
    }
    const repoRes = await this.call("GET", `/repos/${request.repo}`);
    if (!repoRes.ok)
      return this.fail(`could not read ${request.repo}`, repoRes);
    const base = ((await repoRes.json()) as { default_branch: string })
      .default_branch;
    const res = await this.call("POST", `/repos/${request.repo}/pulls`, {
      head: request.branch,
      base,
      title: request.title,
      body: request.body,
    });
    if (!res.ok) {
      return this.fail(
        `could not open a pull request for ${request.branch} on ${request.repo}`,
        res,
      );
    }
    const body = (await res.json()) as { number: number };
    return `${request.repo}#${body.number}`;
  }
}
