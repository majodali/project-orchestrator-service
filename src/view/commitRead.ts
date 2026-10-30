/**
 * One commit per page (node P2-N021; the specification of P2-N003,
 * "How a page resolves its commit", criteria V1 and V4). A page
 * resolves its ref to a SHA once, per request, and reads every file at
 * that SHA. The only cache is file content keyed by SHA and path:
 * content at a SHA never changes, and no entry is keyed by a ref, so
 * the cache never answers what the current state is.
 */

import type { CommitReader } from "../planRegister/registerFetcher.js";
import { FULL_SHA } from "../planRegister/registerFetcher.js";

/** File content at a commit, keyed by SHA and path only (V4). */
export class ShaPathCache {
  private readonly entries = new Map<string, string>();
  private readonly maxEntries: number;

  constructor(maxEntries = 32) {
    this.maxEntries = maxEntries;
  }

  private static key(sha: string, path: string): string {
    if (!FULL_SHA.test(sha)) {
      throw new Error(`cache key needs a full SHA, got ${JSON.stringify(sha)}`);
    }
    return `${sha}\u0000${path}`;
  }

  get(sha: string, path: string): string | undefined {
    return this.entries.get(ShaPathCache.key(sha, path));
  }

  set(sha: string, path: string, content: string): void {
    const key = ShaPathCache.key(sha, path);
    this.entries.delete(key);
    this.entries.set(key, content);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/** The stage a page read failed at, for the error page (V3). */
export class PageReadError extends Error {
  readonly underlying: unknown;
  /** The file that failed, or undefined when the ref did not resolve. */
  readonly path: string | undefined;
  readonly resolvedRef: string | undefined;
  readonly sha: string | undefined;

  constructor(
    cause: unknown,
    path: string | undefined,
    resolvedRef: string | undefined,
    sha: string | undefined,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "PageReadError";
    this.underlying = cause;
    this.path = path;
    this.resolvedRef = resolvedRef;
    this.sha = sha;
  }
}

export interface PageFiles {
  resolvedRef: string;
  sha: string;
  fetchedAt: string;
  /** Content by path, every one read at `sha`. */
  files: Map<string, string>;
}

/**
 * Resolves `requestedRef` once, then reads each path at the SHA it
 * resolved to, through the cache. Every read names the SHA; none
 * names the ref (V1).
 */
export async function readPageFiles(
  reader: CommitReader,
  cache: ShaPathCache,
  requestedRef: string | undefined,
  paths: readonly string[],
  now: () => Date,
): Promise<PageFiles> {
  let resolved;
  try {
    resolved = await reader.resolveRef(requestedRef);
  } catch (err) {
    throw new PageReadError(err, undefined, undefined, undefined);
  }
  const files = new Map<string, string>();
  for (const path of paths) {
    let content = cache.get(resolved.sha, path);
    if (content === undefined) {
      try {
        content = await reader.readFileAtSha(resolved.sha, path);
      } catch (err) {
        throw new PageReadError(err, path, resolved.ref, resolved.sha);
      }
      cache.set(resolved.sha, path, content);
    }
    files.set(path, content);
  }
  return {
    resolvedRef: resolved.ref,
    sha: resolved.sha,
    fetchedAt: now().toISOString(),
    files,
  };
}
