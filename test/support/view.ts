/**
 * Shared fakes and HTML readers for the web view's tests (node
 * P2-N021, task E1). No real credential appears here: every token is a
 * literal containing the word `fake` (criterion V28).
 */

import { expect } from "vitest";

import type {
  CommitReader,
  ResolvedCommit,
} from "../../src/planRegister/registerFetcher.js";
import { GithubFetchError } from "../../src/planRegister/registerFetcher.js";
import { signViewCookie } from "../../src/view/viewAuth.js";
import { VIEW_COOKIE_NAME } from "../../src/view/viewAuth.js";

export const FAKE_VIEW_TOKEN = "fake-view-token-for-tests";
export const FAKE_MCP_TOKEN = "fake-mcp-token-for-tests";
export const OWNER = "majodali";
export const REPO = "project-orchestrator";

export const SHA_A = "a".repeat(40);
export const SHA_B = "b".repeat(40);
export const SHA_C = "c0ffee".padEnd(40, "1");

/** The fixed clock the view tests run on. */
export const NOW = new Date("2026-10-30T12:00:00.000Z");
export const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

/**
 * A `CommitReader` over an in-memory repository: branch heads that a
 * test can move, and file content by SHA. It records every call.
 */
export class FakeRepository implements CommitReader {
  readonly owner = OWNER;
  readonly repo = REPO;
  readonly defaultBranch = "main";
  readonly heads = new Map<string, string>();
  readonly files = new Map<string, Map<string, string>>();
  readonly resolveCalls: Array<string | undefined> = [];
  readonly readCalls: Array<{ sha: string; path: string }> = [];
  /** Runs after each resolution: lets a test move a head mid-page. */
  afterResolve: (() => void) | undefined;
  failRead: { path: string; status: number } | undefined;

  setFile(sha: string, path: string, content: string): void {
    const atSha = this.files.get(sha) ?? new Map<string, string>();
    atSha.set(path, content);
    this.files.set(sha, atSha);
  }

  async resolveRef(ref?: string): Promise<ResolvedCommit> {
    this.resolveCalls.push(ref);
    const name = ref ?? this.defaultBranch;
    let sha = this.heads.get(name);
    if (sha === undefined && /^[0-9a-f]{7,40}$/.test(name)) {
      sha = [...this.files.keys()].find((candidate) =>
        candidate.startsWith(name),
      );
    }
    if (sha === undefined) {
      throw new GithubFetchError(
        `could not resolve ref ${JSON.stringify(name)}`,
        422,
        "No commit found",
      );
    }
    this.afterResolve?.();
    return { ref: name, sha };
  }

  async readFileAtSha(sha: string, path: string): Promise<string> {
    this.readCalls.push({ sha, path });
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error(`read by a non-SHA ref: ${sha}`);
    }
    if (this.failRead && this.failRead.path === path) {
      throw new GithubFetchError(
        `could not fetch ${path}`,
        this.failRead.status,
        "fake failure",
      );
    }
    const content = this.files.get(sha)?.get(path);
    if (content === undefined) {
      throw new GithubFetchError(`no ${path} at ${sha}`, 404, "Not Found");
    }
    return content;
  }
}

export function validCookie(
  token = FAKE_VIEW_TOKEN,
  expiresAt = NOW_SECONDS + 3600,
): string {
  return `${VIEW_COOKIE_NAME}=${signViewCookie(token, expiresAt)}`;
}

export function viewEnv(): void {
  process.env.VIEW_TOKEN = FAKE_VIEW_TOKEN;
  process.env.MCP_AUTH_TOKEN = FAKE_MCP_TOKEN;
}

/** The three headers every `/view` response carries (V11). */
export function expectViewHeaders(res: Response): void {
  const csp = res.headers.get("Content-Security-Policy") ?? "";
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-inline");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
}

export function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function textOf(html: string): string {
  return unescapeHtml(html.replace(/<[^>]*>/g, ""));
}

/** Every `href` on a page, unescaped. */
export function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => unescapeHtml(m[1]!));
}

/** The text inside the first element carrying `attribute`, or null. */
export function attributeText(html: string, attribute: string): string | null {
  const m = new RegExp(`<(\\w+)[^>]*\\b${attribute}\\b[^>]*>`).exec(html);
  if (!m) return null;
  const tag = m[1]!;
  const start = m.index + m[0].length;
  // Elements carrying these attributes nest no element of the same tag.
  const end = html.indexOf(`</${tag}>`, start);
  return textOf(html.slice(start, end));
}

const DOCUMENT_LINK = new RegExp(
  `^https://github\\.com/${OWNER}/${REPO}/blob/[0-9a-f]{40}/`,
);
const COMMIT_LINK = new RegExp(
  `^https://github\\.com/${OWNER}/${REPO}/commit/[0-9a-f]{40}$`,
);

/**
 * Walks a page's links (V10). A GitHub link is a document link pinned
 * to a full SHA, or the header's commit link. A link between pages
 * carries the received `ref` unchanged, or none when none was received.
 */
export function expectLinksPinned(
  html: string,
  receivedRef: string | undefined,
): { documentLinks: number; pageLinks: number } {
  let documentLinks = 0;
  let pageLinks = 0;
  for (const href of hrefs(html)) {
    if (href.startsWith("https://github.com/")) {
      if (href.includes("/commit/")) {
        expect(href).toMatch(COMMIT_LINK);
      } else {
        expect(href).toMatch(DOCUMENT_LINK);
        documentLinks += 1;
      }
      expect(href).not.toMatch(/\/(blob|tree)\/(main|master)\b/);
      continue;
    }
    expect(href.startsWith("/view")).toBe(true);
    const url = new URL(href, "https://view.example");
    expect(url.searchParams.get("ref") ?? undefined).toBe(receivedRef);
    pageLinks += 1;
  }
  return { documentLinks, pageLinks };
}

/** The page carries a viewport meta tag, no script, and no style sets a
 * width above 360 CSS pixels (V12). */
export function expectPhoneWidth(html: string): void {
  expect(html).toContain(
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
  );
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/\son[a-z]+=/i);
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(
    (m) => m[1]!,
  );
  const inline = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]!);
  for (const css of [...styles, ...inline]) {
    for (const m of css.matchAll(
      /(?:^|[;{\s])((?:min-|max-)?width)\s*:\s*([^;}]+)/g,
    )) {
      const value = m[2]!.trim();
      const px = /^([0-9.]+)px$/.exec(value);
      if (px) {
        expect(Number(px[1])).toBeLessThanOrEqual(360);
      } else {
        expect(value).toMatch(/^(100%|auto)$/);
      }
    }
  }
}
