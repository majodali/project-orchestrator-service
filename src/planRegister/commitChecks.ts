/**
 * The check status of one commit, for the view's header (owner,
 * 2026-11-11: a red default branch went unseen for a day). Read
 * through the installed App, which needs `Checks: Read-only`; without
 * it the view says the status is unavailable and shows the page.
 */

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "project-orchestrator-service";

export interface CheckSummary {
  /** `none`: no check ran on the commit. */
  state: "passing" | "failing" | "running" | "none";
  /** The names of the checks that failed. */
  failing: string[];
}

export interface CommitChecks {
  summary(owner: string, repo: string, sha: string): Promise<CheckSummary>;
}

const FAILED = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
]);

export function summarizeCheckRuns(
  runs: Array<{ name: string; status: string; conclusion: string | null }>,
): CheckSummary {
  if (runs.length === 0) return { state: "none", failing: [] };
  const failing = runs
    .filter((r) => r.conclusion !== null && FAILED.has(r.conclusion))
    .map((r) => r.name);
  if (failing.length > 0) return { state: "failing", failing };
  if (runs.some((r) => r.status !== "completed")) {
    return { state: "running", failing: [] };
  }
  return { state: "passing", failing: [] };
}

export class GithubAppCommitChecks implements CommitChecks {
  private readonly getInstallationToken: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  /** Finished results by SHA: a commit's completed checks do not change. */
  private readonly finished = new Map<string, CheckSummary>();

  constructor(
    getInstallationToken: () => Promise<string>,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.getInstallationToken = getInstallationToken;
    this.fetchImpl = fetchImpl;
  }

  async summary(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<CheckSummary> {
    const key = `${owner}/${repo}@${sha}`;
    const known = this.finished.get(key);
    if (known) return known;
    const token = await this.getInstallationToken();
    const res = await this.fetchImpl(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": USER_AGENT,
        },
      },
    );
    if (!res.ok) {
      throw new Error(`check runs of ${sha.slice(0, 7)}: HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      check_runs: Array<{
        name: string;
        status: string;
        conclusion: string | null;
      }>;
    };
    const summary = summarizeCheckRuns(body.check_runs);
    if (summary.state === "passing" || summary.state === "failing") {
      if (this.finished.size > 200) this.finished.clear();
      this.finished.set(key, summary);
    }
    return summary;
  }
}
