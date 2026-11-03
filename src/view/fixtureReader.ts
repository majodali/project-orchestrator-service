/**
 * The web view's preview mode (node P2-N023, iteration 1). When
 * `VIEW_FIXTURE_DIR` is set, the local server (`npm run dev`) reads
 * the pages' files from that directory instead of GitHub. The
 * directory is laid out as the coordinating repository is: the
 * register at `docs/plan-register.md`, the Cost log at
 * `docs/cost-log.md`, and so on. A local checkout of that repository
 * therefore works as a fixture directory too.
 *
 * Every ref resolves to one fixed pretend SHA, so each page header
 * still carries a 40-character SHA and every document link is still
 * pinned to it. `VIEW_FIXTURE_SHA` overrides the SHA, for a directory
 * copied from a known commit.
 *
 * Only `src/localServer.ts` calls `previewViewOptions`. The view's
 * routes and the Lambda entry point never read `VIEW_FIXTURE_DIR`, so
 * the production path is unchanged whether the variable is set or not
 * (test/viewFixtureReader.test.ts).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  CommitReader,
  ResolvedCommit,
} from "../planRegister/registerFetcher.js";
import { FULL_SHA, GithubFetchError } from "../planRegister/registerFetcher.js";
import type { ViewOptions } from "./routes.js";

/** The SHA a fixture directory answers at when none is named. */
export const PREVIEW_SHA = "f1c7" + "0".repeat(36);
export const PREVIEW_OWNER = "majodali";
export const PREVIEW_REPO = "project-orchestrator";
const PREVIEW_BRANCH = "main";

/**
 * A `CommitReader` over a directory. It holds one commit: the default
 * branch, the pretend SHA and any prefix of it of 7 or more characters
 * resolve to it. Any other ref answers as GitHub does for an unknown
 * ref, `422`; a missing file answers `404`.
 */
export class FixtureDirReader implements CommitReader {
  readonly owner: string;
  readonly repo: string;
  readonly sha: string;
  private readonly root: string;

  constructor(
    root: string,
    options: { sha?: string; owner?: string; repo?: string } = {},
  ) {
    const sha = options.sha ?? PREVIEW_SHA;
    if (!FULL_SHA.test(sha)) {
      throw new Error(
        `VIEW_FIXTURE_SHA must be a full, lower-case 40-character SHA, got ${JSON.stringify(sha)}`,
      );
    }
    this.root = path.resolve(root);
    this.sha = sha;
    this.owner = options.owner ?? PREVIEW_OWNER;
    this.repo = options.repo ?? PREVIEW_REPO;
  }

  async resolveRef(ref?: string): Promise<ResolvedCommit> {
    const name = ref ?? PREVIEW_BRANCH;
    const isSha = /^[0-9a-f]{7,40}$/.test(name) && this.sha.startsWith(name);
    if (name !== PREVIEW_BRANCH && !isSha) {
      throw new GithubFetchError(
        `the fixture directory holds only ${PREVIEW_BRANCH} at ${this.sha}, not ${JSON.stringify(name)}`,
        422,
        "No commit found",
      );
    }
    return { ref: name, sha: this.sha };
  }

  async readFileAtSha(sha: string, repoPath: string): Promise<string> {
    if (sha !== this.sha) {
      throw new GithubFetchError(
        `the fixture directory holds no commit ${sha}`,
        404,
        "Not Found",
      );
    }
    const file = path.resolve(this.root, repoPath);
    if (file !== this.root && !file.startsWith(this.root + path.sep)) {
      throw new GithubFetchError(
        `${repoPath} is outside the fixture directory`,
        404,
        "Not Found",
      );
    }
    try {
      return await readFile(file, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
        throw new GithubFetchError(
          `no ${repoPath} in the fixture directory`,
          404,
          "Not Found",
        );
      }
      throw err;
    }
  }
}

/**
 * The view options the local server passes to `createApp`: a fixture
 * reader when `VIEW_FIXTURE_DIR` is set, and `undefined` otherwise, so
 * the view keeps its default GitHub App reader.
 */
export function previewViewOptions(
  env: NodeJS.ProcessEnv = process.env,
): ViewOptions | undefined {
  const dir = env.VIEW_FIXTURE_DIR?.trim();
  if (!dir) return undefined;
  const sha = env.VIEW_FIXTURE_SHA?.trim() || undefined;
  return { reader: new FixtureDirReader(dir, { sha }) };
}
