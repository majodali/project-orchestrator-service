import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import {
  FIXTURE_COMMIT,
  FIXTURE_FILES,
  fixtureRepository,
} from "./support/fixtures1b9e207.js";
import {
  FakeRepository,
  NOW,
  OWNER,
  REPO,
  SHA_A,
  SHA_B,
  attributeText,
  expectLinksPinned,
  expectPhoneWidth,
  expectViewHeaders,
  hrefs,
  textOf,
  unescapeHtml,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The task page, `GET /view/task/<task ID>` (node P2-N021, task E2;
 * criteria V9 and, for this page, V1, V2 and V10 to V13 of the
 * specification of P2-N003, child 1), and V23 (no copied parsing) on
 * the service's side. The fixture is the coordinating repository's
 * Cost log and journal at commit 1b9e207, byte for byte. The expected
 * events are read from the fixture with `JSON.parse` here, not by the
 * code under test.
 */

const BLOB = `https://github.com/${OWNER}/${REPO}/blob/${FIXTURE_COMMIT}`;
const EVENT_FIELDS = [
  "ts",
  "event",
  "node",
  "stage",
  "role",
  "model",
  "ref",
  "note",
];

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  viewEnv();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function appFor(repo: FakeRepository) {
  return createApp({ view: { reader: repo, now: () => NOW } });
}

async function getPage(
  repo: FakeRepository,
  path: string,
): Promise<{ res: Response; html: string }> {
  const res = await appFor(repo).request(path, {
    headers: { Cookie: validCookie() },
  });
  expectViewHeaders(res);
  return { res, html: await res.text() };
}

function section(html: string, name: string): string {
  const start = html.indexOf(`<section data-field="${name}">`);
  expect(start, name).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</section>", start));
}

/** The fixture journal's events for a task, in file order, as plain
 * JSON objects. */
function fixtureEvents(task: string): Array<Record<string, unknown>> {
  return FIXTURE_FILES.get("orchestration/journal.jsonl")!
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.task === task);
}

function verbatim(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The page's events: one record of field name to text per event. */
function pageEvents(html: string): Array<Record<string, string>> {
  return [
    ...section(html, "events").matchAll(
      /<li data-event-line="\d+">([\s\S]*?)<\/li>/g,
    ),
  ].map((m) => {
    const record: Record<string, string> = {};
    for (const f of m[1]!.matchAll(
      /<dd data-event-field="([^"]+)">([\s\S]*?)<\/dd>/g,
    )) {
      record[f[1]!] = unescapeHtml(f[2]!);
    }
    return record;
  });
}

function rowCells(html: string): Array<[string, string]> {
  return [
    ...section(html, "cost-log-row").matchAll(
      /<dt>([\s\S]*?)<\/dt><dd data-cell="\d+">([\s\S]*?)<\/dd>/g,
    ),
  ].map((m) => [unescapeHtml(m[1]!), unescapeHtml(m[2]!)]);
}

describe("V9 — the task page", () => {
  it("T030, a task with a Cost log row and events: all nine fields, the events in file order, and its node", async () => {
    const { res, html } = await getPage(fixtureRepository(), "/view/task/T030");
    expect(res.status).toBe(200);
    expect(attributeText(html, "data-task-id")).toBe("T030");
    expect(rowCells(html)).toEqual([
      ["date", "2026-09-01"],
      ["task", "T030"],
      ["node", "P2-N013"],
      ["stage", "execute"],
      ["role", "implementer"],
      ["model", "recorded-model"],
      ["input tok", "n/a"],
      ["output tok", "n/a"],
      [
        "notes",
        "~127k subagent tokens over 74 tool calls, 8m48s dispatch→result (unattended); no input/output split reported. Model recorded from the role definition's pin, not from the role's self-report, which named a different model and is not evidence. One packet widening, and a good one: the installed `hono` adapter source under `node_modules/`, to answer assumptions 2 and 6 against the code this service actually runs rather than against the adapter's documentation — not a packet defect, since the execute row grants the code paths the specification names and this one it had to find",
      ],
    ]);

    const expected = fixtureEvents("T030");
    expect(expected.map((e) => e.event)).toEqual([
      "dispatched",
      "accepted",
      "packet-widened",
    ]);
    expect(pageEvents(html)).toEqual(
      expected.map((event) =>
        Object.fromEntries(
          EVENT_FIELDS.map((name) => [name, verbatim(event[name])]),
        ),
      ),
    );
    expect(
      [...html.matchAll(/<dd data-event-field="([^"]+)">/g)]
        .slice(0, 8)
        .map((m) => m[1]),
    ).toEqual(EVENT_FIELDS);
    expect(hrefs(section(html, "node"))).toEqual(["/view/node/P2-N013"]);
  });

  it("T017, a task with events and no Cost log row: says so, and lists the events", async () => {
    const { res, html } = await getPage(fixtureRepository(), "/view/task/T017");
    expect(res.status).toBe(200);
    expect(attributeText(section(html, "cost-log-row"), "data-no-row")).toBe(
      "no Cost log row at this commit",
    );
    const expected = fixtureEvents("T017");
    expect(expected.length).toBeGreaterThan(2);
    expect(pageEvents(html).map((e) => e.event)).toEqual(
      expected.map((e) => e.event),
    );
    expect(pageEvents(html).map((e) => e.ts)).toEqual(
      expected.map((e) => e.ts),
    );
    expect(hrefs(section(html, "node"))).toEqual(["/view/node/P1-N013"]);
  });

  it("an unknown task ID answers 404 naming the ID and the SHA", async () => {
    const { res, html } = await getPage(fixtureRepository(), "/view/task/T999");
    expect(res.status).toBe(404);
    expect(attributeText(html, "data-not-found")).toBe(
      `No task T999 in docs/cost-log.md or orchestration/journal.jsonl at ${FIXTURE_COMMIT}.`,
    );
    expect(attributeText(html, "data-sha")).toBe(FIXTURE_COMMIT);
    expect(html).not.toContain("data-field");
  });

  it("a task with a Cost log row and no events says there are none, and a null field shows as null", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    repo.setFile(
      SHA_A,
      "docs/cost-log.md",
      [
        "| date | task | node | stage | role | model | input tok | output tok | notes |",
        "|---|---|---|---|---|---|---|---|---|",
        "| 2026-10-30 | T500 | P1-N001 | plan | planner | m | n/a | n/a | fake row |",
      ].join("\n"),
    );
    repo.setFile(
      SHA_A,
      "orchestration/journal.jsonl",
      [
        JSON.stringify({
          ts: "2026-10-30T00:00:00Z",
          event: "dispatched",
          task: "T501",
          node: "P1-N001",
          stage: "plan",
          role: null,
          model: null,
          ref: null,
          note: "fake",
        }),
        "not json",
      ].join("\n"),
    );
    const row = await getPage(repo, "/view/task/T500");
    expect(row.res.status).toBe(200);
    expect(attributeText(section(row.html, "events"), "data-no-events")).toBe(
      "no journal event names this task at this commit",
    );
    expect(textOf(row.html)).toContain(
      "orchestration/journal.jsonl: line 2 did not parse at this commit and is not read here.",
    );
    const events = await getPage(repo, "/view/task/T501");
    expect(pageEvents(events.html)).toEqual([
      {
        ts: "2026-10-30T00:00:00Z",
        event: "dispatched",
        node: "P1-N001",
        stage: "plan",
        role: "null",
        model: "null",
        ref: "null",
        note: "fake",
      },
    ]);
  });
});

describe("V1 — the task page reads one commit", () => {
  it("reads the Cost log and the journal at the SHA it resolved, while the branch head moves", async () => {
    const repo = fixtureRepository();
    repo.afterResolve = () => repo.heads.set("main", SHA_B);
    const { html } = await getPage(repo, "/view/task/T030");
    expect(attributeText(html, "data-sha")).toBe(FIXTURE_COMMIT);
    expect(repo.readCalls).toEqual([
      { sha: FIXTURE_COMMIT, path: "docs/cost-log.md" },
      { sha: FIXTURE_COMMIT, path: "orchestration/journal.jsonl" },
    ]);
  });
});

describe("V2 and V10 to V13 — what the task page carries", () => {
  const REFS: Array<string | undefined> = [
    undefined,
    "main",
    "release/1",
    FIXTURE_COMMIT,
  ];
  const TASKS = ["T030", "T017", "T093", "T999"];

  it("V2 — names the requested ref, the full SHA and the fetch time", async () => {
    const { html } = await getPage(
      fixtureRepository(),
      "/view/task/T030?ref=release%2F1",
    );
    expect(attributeText(html, "data-ref")).toBe("release/1");
    expect(attributeText(html, "data-sha")).toBe(FIXTURE_COMMIT);
    expect(attributeText(html, "data-fetched")).toBe(NOW.toISOString());
  });

  it("V10 — pins every document link to a full SHA, names no branch, and carries the received ref unchanged on every link between pages", async () => {
    for (const ref of REFS) {
      for (const task of TASKS) {
        const query =
          ref === undefined ? "" : `?ref=${encodeURIComponent(ref)}`;
        const { html } = await getPage(
          fixtureRepository(),
          `/view/task/${task}${query}`,
        );
        const counts = expectLinksPinned(html, ref);
        expect(counts.documentLinks, `${task} ${ref}`).toBeGreaterThan(0);
        expect(counts.pageLinks, `${task} ${ref}`).toBeGreaterThan(1);
      }
    }
  });

  it("V10 — the walk from a node page to its task pages and back keeps the ref", async () => {
    const ref = "release/1";
    const repo = fixtureRepository();
    const node = await getPage(repo, `/view/node/P1-N013?ref=release%2F1`);
    const taskLinks = hrefs(node.html).filter((h) =>
      h.startsWith("/view/task/"),
    );
    expect(taskLinks).toEqual([
      "/view/task/T017?ref=release%2F1",
      "/view/task/T018?ref=release%2F1",
    ]);
    for (const link of taskLinks) {
      const task = await getPage(repo, link);
      expect(task.res.status).toBe(200);
      expectLinksPinned(task.html, ref);
      expect(hrefs(task.html)).toContain("/view/node/P1-N013?ref=release%2F1");
    }
  });

  it("V11 — renders Cost log and journal values holding markup as text", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    repo.setFile(
      SHA_A,
      "docs/cost-log.md",
      [
        "| date | task | node | stage | role | model | input tok | output tok | notes |",
        "|---|---|---|---|---|---|---|---|---|",
        '| 2026-10-30 | T500 | P1-N001 | plan | planner | <b>m</b> | n/a | n/a | <script>alert("fake")</script> |',
      ].join("\n"),
    );
    repo.setFile(
      SHA_A,
      "orchestration/journal.jsonl",
      JSON.stringify({
        ts: "2026-10-30T00:00:00Z",
        event: "accepted",
        task: "T500",
        node: '"><img src=x onerror=alert(1)>',
        note: "<script>alert('fake')</script>",
      }),
    );
    const { html } = await getPage(repo, "/view/task/T500");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<b>/);
    expect(textOf(html)).toContain('<script>alert("fake")</script>');
    expect(pageEvents(html)[0]!.note).toBe("<script>alert('fake')</script>");
  });

  it("V11 — every task page response, the 404 and the read failure included, carries the three headers", async () => {
    const repo = fixtureRepository();
    await getPage(repo, "/view/task/T030");
    await getPage(repo, "/view/task/T999");
    repo.failRead = { path: "orchestration/journal.jsonl", status: 500 };
    const failed = await getPage(repo, "/view/task/T030");
    expect(failed.res.status).toBe(502);
    expect(attributeText(failed.html, "data-failing-file")).toBe(
      "orchestration/journal.jsonl",
    );
  });

  it("V12 — carries a viewport meta tag, runs no script, and no style sets a width above 360 CSS pixels", async () => {
    for (const task of TASKS) {
      const { html } = await getPage(fixtureRepository(), `/view/task/${task}`);
      expectPhoneWidth(html);
    }
  });

  it("V13 — carries the no-progress-authority line, linking the Backlog at the page's SHA", async () => {
    for (const task of TASKS) {
      const { html } = await getPage(
        fixtureRepository(),
        `/view/task/${task}?ref=main`,
      );
      const limit = /<p class="limit" data-limit>([\s\S]*?)<\/p>/.exec(html);
      expect(textOf(limit![1]!)).toContain(
        "This page carries no progress authority",
      );
      expect(limit![1]).toContain(`href="${BLOB}/docs/backlog.md"`);
    }
  });
});

describe("V23 — the view's Cost log and journal parsing is the vendored unit", () => {
  const VIEW_DIR = path.resolve(
    fileURLToPath(import.meta.url),
    "..",
    "..",
    "src",
    "view",
  );

  it("reads both files through the vendored cost-log-and-journal unit and carries no copy of its logic", () => {
    const records = readFileSync(path.join(VIEW_DIR, "runRecords.ts"), "utf-8");
    expect(records).toContain(
      'from "../planRegister/vendored/cost-log-and-journal.js"',
    );
    for (const name of readdirSync(VIEW_DIR).filter((n) => n.endsWith(".ts"))) {
      const source = readFileSync(path.join(VIEW_DIR, name), "utf-8");
      expect(source, name).not.toMatch(/\.split\("\|"\)/);
      expect(source, name).not.toContain("JSON.parse");
      expect(source, name).not.toContain('"result-received"');
      expect(source, name).not.toMatch(/\/\^T\\d/);
    }
  });
});
