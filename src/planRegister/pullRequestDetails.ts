/**
 * A pull request's description and check runs, read through the
 * installed App (P2-N087): a reviewer's scheduled task has only
 * majodali/project-orchestrator attached, so it cannot read a pull
 * request's body or its checks directly in another repository (D130,
 * D171, D176). The service already reads both kinds of thing — a
 * pull request's state (pullRequests.ts) and a commit's check summary
 * (commitChecks.ts) — for its own merging and the view's header; this
 * reads the detail a reviewer's claim needs instead of a summary.
 */

import { fitWords } from "../model/loop.js";
import { parsePullRequestRef } from "./pullRequests.js";

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "project-orchestrator-service";

/**
 * Bounds one pull request's description. P2-N081 (identified, not yet
 * planned) will set a bound on the service's answers generally; until
 * it does, this field alone can run to several thousand characters of
 * markdown, and a verify claim's answer carries one per pull request,
 * so it is bounded here on its own, with the cut marked by `fitWords`
 * the way a task's summary already is.
 */
export const DESCRIPTION_MAX_WORDS = 600;

export interface PullRequestCheckRun {
  name: string;
  conclusion: string | null;
}

export interface PullRequestDetail {
  ref: string;
  repository: string;
  number: number;
  title: string;
  description: string;
  headSha: string;
  open: boolean;
  /** GitHub's `mergeable`: null while GitHub is still computing it. */
  mergeable: boolean | null;
  checks: PullRequestCheckRun[];
}

export interface UnreadablePullRequest {
  ref: string;
  reason: string;
}

export interface PullRequestDetailsAnswer {
  readable: PullRequestDetail[];
  unreadable: UnreadablePullRequest[];
}

export interface PullRequestDetails {
  /** One entry per `ref` that could be read, in `readable`; every
   * other `ref` in `unreadable`, with why. Never throws: a `ref` this
   * cannot read is named, not a failure of the whole call. */
  describe(refs: readonly string[]): Promise<PullRequestDetailsAnswer>;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

export class GithubAppPullRequestDetails implements PullRequestDetails {
  private readonly getInstallationToken: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(
    getInstallationToken: () => Promise<string>,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.getInstallationToken = getInstallationToken;
    this.fetchImpl = fetchImpl;
  }

  private async call(path: string): Promise<Response> {
    const token = await this.getInstallationToken();
    return this.fetchImpl(`${GITHUB_API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
      },
    });
  }

  private async describeOne(ref: string): Promise<PullRequestDetail> {
    const p = parsePullRequestRef(ref);
    if (!p) throw new Error(`${ref} is not owner/repo#number`);
    const prRes = await this.call(
      `/repos/${p.owner}/${p.repo}/pulls/${p.number}`,
    );
    if (!prRes.ok) {
      const hint =
        prRes.status === 403 || prRes.status === 404
          ? "; the GitHub App needs `Pull requests: Read-only` (or `Read and write`) " +
            "and `Checks: Read-only`, and to be installed on that repository"
          : "";
      throw new Error(
        `could not read ${ref} (HTTP ${prRes.status})${hint}: ${await safeText(prRes)}`,
      );
    }
    const pr = (await prRes.json()) as {
      title: string;
      body: string | null;
      state: string;
      mergeable: boolean | null;
      head: { sha: string };
    };
    const checksRes = await this.call(
      `/repos/${p.owner}/${p.repo}/commits/${pr.head.sha}/check-runs?per_page=100`,
    );
    if (!checksRes.ok) {
      throw new Error(
        `could not read the checks of ${ref} at ${pr.head.sha.slice(0, 7)} ` +
          `(HTTP ${checksRes.status}): ${await safeText(checksRes)}`,
      );
    }
    const checksBody = (await checksRes.json()) as {
      check_runs: Array<{ name: string; conclusion: string | null }>;
    };
    return {
      ref,
      repository: `${p.owner}/${p.repo}`,
      number: p.number,
      title: pr.title,
      description: fitWords(pr.body ?? "", DESCRIPTION_MAX_WORDS),
      headSha: pr.head.sha,
      open: pr.state === "open",
      mergeable: pr.mergeable ?? null,
      checks: checksBody.check_runs.map((r) => ({
        name: r.name,
        conclusion: r.conclusion,
      })),
    };
  }

  async describe(refs: readonly string[]): Promise<PullRequestDetailsAnswer> {
    const readable: PullRequestDetail[] = [];
    const unreadable: UnreadablePullRequest[] = [];
    for (const ref of refs) {
      try {
        readable.push(await this.describeOne(ref));
      } catch (err) {
        unreadable.push({
          ref,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { readable, unreadable };
  }
}
