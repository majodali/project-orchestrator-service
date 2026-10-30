import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/httpApp.js";
import {
  CONTENTS_BASE64_LIMIT_BYTES,
  CONTENTS_ENDPOINT_LIMIT_BYTES,
  FileTooLargeError,
  GithubAppRegisterFetcher,
} from "../src/planRegister/registerFetcher.js";
import {
  NOW,
  OWNER,
  REPO,
  SHA_A,
  attributeText,
  expectViewHeaders,
  textOf,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * Large files (node P2-N021, task E2; criterion V5 of the
 * specification of P2-N003, child 1). GitHub's contents endpoint
 * returns base64 content for files of 1 MB or less. For a file between
 * 1 and 100 MB it returns `encoding: "none"` and empty content, and
 * only the raw media type returns the bytes; above 100 MB the endpoint
 * is not supported (https://docs.github.com/en/rest/repos/contents,
 * "Get repository content", read 2026-10-30). A fake GitHub serves
 * that behaviour here: the file is read in full, or the page refuses
 * it naming the file and its size. It is never read as empty.
 */

const COST_LOG = [
  "| date | task | node | stage | role | model | input tok | output tok | notes |",
  "|---|---|---|---|---|---|---|---|---|",
  "| 2026-10-30 | T500 | P1-N001 | execute | implementer | m | n/a | n/a | fake |",
].join("\n");

/** A journal above the base64 limit, whose last line names T500. */
function largeJournal(): string {
  const filler = JSON.stringify({
    ts: "2026-10-30T00:00:00Z",
    event: "edge-recorded",
    task: null,
    node: "P1-N001",
    note: "x".repeat(900),
  });
  const lines: string[] = [];
  let size = 0;
  while (size <= CONTENTS_BASE64_LIMIT_BYTES + 4096) {
    lines.push(filler);
    size += filler.length + 1;
  }
  lines.push(
    JSON.stringify({
      ts: "2026-10-30T01:00:00Z",
      event: "accepted",
      task: "T500",
      node: "P1-N001",
      note: "the last line of a large journal ✓",
    }),
  );
  return lines.join("\n") + "\n";
}

interface FakeGithubOptions {
  /** The size the object answer reports, if not the file's own. */
  reportedSize?: number;
  /** Bytes the raw answer drops from the end. */
  truncateRawBy?: number;
  /** Serve the large file as base64 with empty content instead of
   * `encoding: "none"`. */
  emptyBase64?: boolean;
}

function fakeGithub(
  files: Map<string, string>,
  options: FakeGithubOptions = {},
) {
  const contentsRequests: Array<{ path: string; accept: string }> = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/repos/${OWNER}/${REPO}`) {
      return Response.json({ default_branch: "main" });
    }
    if (url.pathname.startsWith(`/repos/${OWNER}/${REPO}/commits/`)) {
      return Response.json({ sha: SHA_A });
    }
    const prefix = `/repos/${OWNER}/${REPO}/contents/`;
    if (url.pathname.startsWith(prefix)) {
      const path = url.pathname.slice(prefix.length);
      const headers = new Headers(init?.headers);
      const accept = headers.get("Accept") ?? "";
      contentsRequests.push({ path, accept });
      expect(url.searchParams.get("ref")).toBe(SHA_A);
      const text = files.get(path);
      if (text === undefined) {
        return Response.json({ message: "Not Found" }, { status: 404 });
      }
      const bytes = Buffer.from(text, "utf-8");
      if (accept === "application/vnd.github.raw+json") {
        return new Response(
          bytes.subarray(0, bytes.length - (options.truncateRawBy ?? 0)),
        );
      }
      if (bytes.length > CONTENTS_BASE64_LIMIT_BYTES) {
        return Response.json({
          encoding: options.emptyBase64 ? "base64" : "none",
          content: "",
          size: options.reportedSize ?? bytes.length,
        });
      }
      return Response.json({
        encoding: "base64",
        content: bytes.toString("base64"),
        size: bytes.length,
      });
    }
    return new Response("unexpected", { status: 500 });
  });
  const reader = new GithubAppRegisterFetcher(
    OWNER,
    REPO,
    async () => "fake-installation-token",
    fetchImpl,
  );
  return { reader, contentsRequests };
}

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  viewEnv();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function taskPage(reader: GithubAppRegisterFetcher) {
  const app = createApp({ view: { reader, now: () => NOW } });
  const res = await app.request("/view/task/T500", {
    headers: { Cookie: validCookie() },
  });
  expectViewHeaders(res);
  return { res, html: await res.text() };
}

describe("V5 — a file above the contents endpoint's base64 limit", () => {
  it("is read in full with the raw media type, at the same SHA, and the page shows its last line", async () => {
    const journal = largeJournal();
    expect(Buffer.byteLength(journal)).toBeGreaterThan(
      CONTENTS_BASE64_LIMIT_BYTES,
    );
    const { reader, contentsRequests } = fakeGithub(
      new Map([
        ["docs/cost-log.md", COST_LOG],
        ["orchestration/journal.jsonl", journal],
      ]),
    );
    const { res, html } = await taskPage(reader);
    expect(res.status).toBe(200);
    expect(textOf(html)).toContain("the last line of a large journal ✓");
    expect(contentsRequests).toEqual([
      { path: "docs/cost-log.md", accept: "application/vnd.github+json" },
      {
        path: "orchestration/journal.jsonl",
        accept: "application/vnd.github+json",
      },
      {
        path: "orchestration/journal.jsonl",
        accept: "application/vnd.github.raw+json",
      },
    ]);
    // The reader returns every byte.
    await expect(
      reader.readFileAtSha(SHA_A, "orchestration/journal.jsonl"),
    ).resolves.toBe(journal);
  });

  it("is read in full when GitHub answers base64 with empty content, never as empty", async () => {
    const journal = largeJournal();
    const { reader } = fakeGithub(
      new Map([["orchestration/journal.jsonl", journal]]),
      { emptyBase64: true },
    );
    await expect(
      reader.readFileAtSha(SHA_A, "orchestration/journal.jsonl"),
    ).resolves.toBe(journal);
  });

  it("is refused, naming the file and its size, when the raw read comes back short", async () => {
    const journal = largeJournal();
    const size = Buffer.byteLength(journal);
    const { reader } = fakeGithub(
      new Map([
        ["docs/cost-log.md", COST_LOG],
        ["orchestration/journal.jsonl", journal],
      ]),
      { truncateRawBy: 10 },
    );
    const { res, html } = await taskPage(reader);
    expect(res.status).toBe(502);
    expect(attributeText(html, "data-failing-file")).toBe(
      "orchestration/journal.jsonl",
    );
    expect(attributeText(html, "data-file-size")).toBe(String(size));
    expect(textOf(html)).toContain(
      `The file orchestration/journal.jsonl is ${size} bytes at ${SHA_A}, and this page refuses it`,
    );
    expect(textOf(html)).not.toContain("the last line of a large journal");
    expect(html).not.toContain("data-field");
  });

  it("is refused, naming the file and its size, above the endpoint's 100 MB limit, without a raw read", async () => {
    const reportedSize = CONTENTS_ENDPOINT_LIMIT_BYTES + 1;
    const { reader, contentsRequests } = fakeGithub(
      new Map([
        ["docs/cost-log.md", COST_LOG],
        ["orchestration/journal.jsonl", largeJournal()],
      ]),
      { reportedSize },
    );
    const { res, html } = await taskPage(reader);
    expect(res.status).toBe(502);
    expect(attributeText(html, "data-failing-file")).toBe(
      "orchestration/journal.jsonl",
    );
    expect(attributeText(html, "data-file-size")).toBe(String(reportedSize));
    expect(
      contentsRequests.filter(
        (r) => r.accept === "application/vnd.github.raw+json",
      ),
    ).toEqual([]);
    await expect(
      reader.readFileAtSha(SHA_A, "orchestration/journal.jsonl"),
    ).rejects.toBeInstanceOf(FileTooLargeError);
  });
});
