/**
 * The write boundary of the service (the rebuild plan, milestone 3).
 * One commit with several files, made through GitHub's Git Data API
 * as the installed App: blobs, a tree on the current head's tree, a
 * commit with that head as its parent, and a fast-forward update of
 * the branch ref. The ref update is the concurrency check: GitHub
 * refuses it when the branch has moved, and `GitConflictError` tells
 * the caller to read again and retry. Nothing here knows what the
 * files mean; the store (src/model/store.ts) decides what may be
 * written and where.
 */

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "project-orchestrator-service";

export interface CommitRequest {
  branch: string;
  /** The head the caller read the files at. The commit's parent. */
  expectedHeadSha: string;
  message: string;
  /** Repository path to the file's full new content. */
  files: ReadonlyMap<string, string>;
}

export interface CommitResult {
  sha: string;
}

export interface GitWriter {
  commitFiles(request: CommitRequest): Promise<CommitResult>;
}

/** The branch moved since the caller read it. Read again and retry. */
export class GitConflictError extends Error {
  readonly branch: string;
  readonly expectedHeadSha: string;
  readonly actualHeadSha: string | null;

  constructor(
    branch: string,
    expectedHeadSha: string,
    actualHeadSha: string | null,
  ) {
    super(
      `${branch} moved from ${expectedHeadSha}${actualHeadSha ? ` to ${actualHeadSha}` : ""} since it was read`,
    );
    this.name = "GitConflictError";
    this.branch = branch;
    this.expectedHeadSha = expectedHeadSha;
    this.actualHeadSha = actualHeadSha;
  }
}

export class GitWriteError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "GitWriteError";
    this.status = status;
    this.body = body;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 2000);
  } catch {
    return "";
  }
}

export class GithubAppGitWriter implements GitWriter {
  readonly owner: string;
  readonly repo: string;
  private readonly getInstallationToken: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(
    owner: string,
    repo: string,
    getInstallationToken: () => Promise<string>,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.owner = owner;
    this.repo = repo;
    this.getInstallationToken = getInstallationToken;
    this.fetchImpl = fetchImpl;
  }

  async commitFiles(request: CommitRequest): Promise<CommitResult> {
    const headers = await this.requestHeaders();
    const refPath = `refs/heads/${request.branch}`;

    // The head as it stands. A branch that already moved fails here,
    // before any object is created.
    const ref = (await this.get(
      `git/ref/heads/${request.branch}`,
      headers,
    )) as {
      object: { sha: string };
    };
    if (ref.object.sha !== request.expectedHeadSha) {
      throw new GitConflictError(
        request.branch,
        request.expectedHeadSha,
        ref.object.sha,
      );
    }
    const head = (await this.get(
      `git/commits/${request.expectedHeadSha}`,
      headers,
    )) as { tree: { sha: string } };

    const tree: Array<{
      path: string;
      mode: string;
      type: string;
      sha: string;
    }> = [];
    for (const [path, content] of request.files) {
      const blob = (await this.post("git/blobs", headers, {
        content,
        encoding: "utf-8",
      })) as { sha: string };
      tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const newTree = (await this.post("git/trees", headers, {
      base_tree: head.tree.sha,
      tree,
    })) as { sha: string };
    const commit = (await this.post("git/commits", headers, {
      message: request.message,
      tree: newTree.sha,
      parents: [request.expectedHeadSha],
    })) as { sha: string };

    // The fast-forward update is the concurrency check.
    const res = await this.fetchImpl(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/git/${refPath}`,
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit.sha, force: false }),
      },
    );
    if (res.status === 422 || res.status === 409) {
      throw new GitConflictError(request.branch, request.expectedHeadSha, null);
    }
    if (!res.ok) {
      throw new GitWriteError(
        `could not update ${refPath} on ${this.owner}/${this.repo}`,
        res.status,
        await safeText(res),
      );
    }
    return { sha: commit.sha };
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

  private async get(
    path: string,
    headers: Record<string, string>,
  ): Promise<unknown> {
    const res = await this.fetchImpl(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/${path}`,
      { headers },
    );
    if (!res.ok) {
      throw new GitWriteError(
        `could not read ${path} on ${this.owner}/${this.repo}`,
        res.status,
        await safeText(res),
      );
    }
    return res.json();
  }

  private async post(
    path: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<unknown> {
    const res = await this.fetchImpl(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/${path}`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new GitWriteError(
        `could not create ${path} on ${this.owner}/${this.repo}`,
        res.status,
        await safeText(res),
      );
    }
    return res.json();
  }
}
