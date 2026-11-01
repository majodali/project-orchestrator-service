import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { outcomeParagraph } from "../src/view/nodePage.js";
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
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The node page, `GET /view/node/<node ID>` (node P2-N021, task E2;
 * criteria V8 and, for this page, V1, V2 and V10 to V13 of the
 * specification of P2-N003, child 1). The fixture is the coordinating
 * repository at commit 1b9e207: its register, Cost log, journal and
 * the plans the cases link, byte for byte. Expected values below were
 * read off those files by hand, not computed by the code under test.
 */

const BLOB = `https://github.com/${OWNER}/${REPO}/blob/${FIXTURE_COMMIT}`;
const FIELD_ORDER = [
  "stage",
  "outcome",
  "depends-on",
  "needed-by",
  "documents",
  "resources",
  "tasks",
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

/** The HTML of one field's section. */
function section(html: string, name: string): string {
  const start = html.indexOf(`<section data-field="${name}">`);
  expect(start, name).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</section>", start));
}

function fieldOrder(html: string): string[] {
  return [...html.matchAll(/<section data-field="([^"]+)">/g)].map(
    (m) => m[1]!,
  );
}

function headingOf(fieldHtml: string): string {
  return textOf(/<h2>([\s\S]*?)<\/h2>/.exec(fieldHtml)![1]!);
}

function taskItems(html: string): Array<[string, boolean]> {
  return [
    ...section(html, "tasks").matchAll(/<li data-task="([^"]+)">(.*?)<\/li>/g),
  ].map((m) => [m[1]!, m[2]!.includes("data-no-row")]);
}

describe("V8 — the node page, seven fields in order", () => {
  it("P1-N008, whose plan has an Outcome section: every field, in order", async () => {
    const { res, html } = await getPage(
      fixtureRepository(),
      "/view/node/P1-N008",
    );
    expect(res.status).toBe(200);
    expect(fieldOrder(html)).toEqual(FIELD_ORDER);
    expect(FIELD_ORDER.map((name) => headingOf(section(html, name)))).toEqual([
      "Stage",
      "Outcome",
      "Depends on",
      "Needed by",
      "Documents",
      "Resources",
      "Tasks",
    ]);
    expect(attributeText(html, "data-node-id")).toBe("P1-N008");
    expect(attributeText(html, "data-title")).toBe(
      "mtool checker extension-point proposal",
    );

    // 1. Stage, and the latest gate-crossed or accepted event's date.
    const stage = section(html, "stage");
    expect(attributeText(stage, "data-stage")).toBe("[done]");
    expect(attributeText(stage, "data-hold")).toBeNull();
    expect(textOf(stage)).toContain(
      "2026-08-26: last journal event, telemetry (gate-crossed)",
    );

    // 2. Outcome: the first paragraph of the plan's Outcome section.
    const outcome = section(html, "outcome");
    expect(attributeText(outcome, "data-outcome")).toBe(
      "A transportable, decision-ready proposal to " +
        "[methodology-tools](https://github.com/majodali/methodology-tools) " +
        "for **one generic upstream capability**: a custom type defined by " +
        "citation (Article 7) may declare a checker with its defining " +
        "project, and `mtool audit form` discovers that checker through the " +
        "citation, runs it, and merges its findings into the standard audit " +
        "and delivery pipeline.",
    );
    expect(hrefs(outcome)).toEqual([
      `${BLOB}/docs/plans/p1-n008-mtool-checker-extension-point.md`,
    ]);

    // 3. Depends on: the register's note, verbatim.
    const dependsOn = section(html, "depends-on");
    expect(textOf(dependsOn)).toContain("From the register's note:");
    expect(attributeText(dependsOn, "data-note")).toBe(
      "plan: plans/p1-n008-mtool-checker-extension-point.md · spec: specs/p1-n008-mtool-checker-extension-point.md",
    );

    // 4. Needed by: no other note names P1-N008.
    expect(textOf(section(html, "needed-by"))).toContain(
      "No register note names P1-N008.",
    );

    // 5. Documents: the line's own links.
    const documents = section(html, "documents");
    expect(documents).not.toContain("data-documents-from");
    expect(hrefs(documents)).toEqual([
      `${BLOB}/docs/plans/p1-n008-mtool-checker-extension-point.md`,
      `${BLOB}/docs/specs/p1-n008-mtool-checker-extension-point.md`,
    ]);

    // 6. Resources: task E3's, absent here.
    expect(textOf(section(html, "resources"))).toContain("Task E3 adds");

    // 7. Tasks: in task-number order, each with a Cost log row.
    expect(taskItems(html)).toEqual([
      ["T002", false],
      ["T003", false],
      ["T004", false],
    ]);
    expect(hrefs(section(html, "tasks"))).toEqual([
      "/view/task/T002",
      "/view/task/T003",
      "/view/task/T004",
    ]);
  });

  it("P2-N002, whose plan has no Outcome section: says so and links the plan", async () => {
    const { res, html } = await getPage(
      fixtureRepository(),
      "/view/node/P2-N002",
    );
    expect(res.status).toBe(200);
    expect(fieldOrder(html)).toEqual(FIELD_ORDER);
    const outcome = section(html, "outcome");
    expect(outcome).toContain('data-outcome-state="no-section"');
    expect(textOf(outcome)).toContain(
      "the plan has no Outcome section: docs/plans/p2-n002-service-skeleton.md",
    );
    expect(hrefs(outcome)).toEqual([
      `${BLOB}/docs/plans/p2-n002-service-skeleton.md`,
    ]);
    // Its "Gate outcome" heading is not an Outcome section.
    expect(FIXTURE_FILES.get("docs/plans/p2-n002-service-skeleton.md")).toMatch(
      /^## Gate outcome, 2026-08-26$/m,
    );
    expect(attributeText(section(html, "stage"), "data-stage")).toBe("[done]");
    expect(textOf(section(html, "stage"))).toContain(
      "2026-09-16: last journal event, telemetry (gate-crossed)",
    );
    expect(taskItems(html)).toEqual([
      ["T005", false],
      ["T006", false],
    ]);
  });

  it("P2-N013, whose line links no plan: 'no plan linked', and the nearest ancestor's documents labelled with its ID (decision 14)", async () => {
    const repo = fixtureRepository();
    const { res, html } = await getPage(repo, "/view/node/P2-N013");
    expect(res.status).toBe(200);
    expect(fieldOrder(html)).toEqual(FIELD_ORDER);
    expect(attributeText(html, "data-title")).toBe(
      "Alias assumptions verified against AWS documentation",
    );
    expect(textOf(section(html, "outcome")).trim()).toBe(
      "Outcome\nno plan linked",
    );
    expect(textOf(section(html, "depends-on"))).toContain(
      "The register's line carries no note.",
    );
    const documents = section(html, "documents");
    expect(attributeText(documents, "data-documents-from")).toBe(
      "This line links no document. The nearest ancestor's links, from P2-N012:",
    );
    expect(hrefs(documents)).toEqual([
      "/view/node/P2-N012",
      `${BLOB}/docs/plans/p2-n012-deploy-from-ci-on-merge.md`,
      `${BLOB}/docs/specs/p2-n012-deploy-from-ci-on-merge.md`,
    ]);
    expect(textOf(section(html, "stage"))).toContain(
      "2026-09-01: last journal event, telemetry (accepted)",
    );
    expect(taskItems(html)).toEqual([["T030", false]]);
    // No plan is read for a line that links none.
    expect(repo.readCalls.map((call) => call.path)).toEqual([
      "docs/plan-register.md",
      "docs/cost-log.md",
      "orchestration/journal.jsonl",
    ]);
  });

  it("P1-N013: a task with journal events and no Cost log row is labelled 'no Cost log row'", async () => {
    const { html } = await getPage(fixtureRepository(), "/view/node/P1-N013");
    expect(taskItems(html)).toEqual([
      ["T017", true],
      ["T018", false],
    ]);
    expect(textOf(section(html, "tasks"))).toContain("T017 no Cost log row");
  });

  it("P2-N021: the note's node IDs linked, the nodes whose notes name it, and a line that links a specification but no plan", async () => {
    const { html } = await getPage(fixtureRepository(), "/view/node/P2-N021");
    const dependsOn = section(html, "depends-on");
    expect(attributeText(dependsOn, "data-note")).toBe(
      "independent of P2-N005 and P2-N004 (RU-018; owner, 2026-10-29); its task E3 waits on P3-N007 done, its tasks E1 and E2 do not (plan decision 8) — spec: specs/p2-n003-owner-questions-and-plan-view.md",
    );
    expect(hrefs(dependsOn)).toEqual([
      "/view/node/P2-N005",
      "/view/node/P2-N004",
      "/view/node/P3-N007",
      `${BLOB}/docs/specs/p2-n003-owner-questions-and-plan-view.md`,
    ]);
    const neededBy = section(html, "needed-by");
    expect(textOf(neededBy)).toContain("Named in the register notes of:");
    expect(
      [...neededBy.matchAll(/data-needed-by="([^"]+)"/g)].map((m) => m[1]),
    ).toEqual(["P2-N022", "P2-N006"]);
    expect(textOf(section(html, "outcome"))).toContain("no plan linked");
    const documents = section(html, "documents");
    expect(documents).not.toContain("data-documents-from");
    expect(hrefs(documents)).toEqual([
      `${BLOB}/docs/specs/p2-n003-owner-questions-and-plan-view.md`,
    ]);
    // The line writes its link after an em dash, so the vendored
    // grammar's best-effort link read takes the note's prose as the
    // label. The page shows the label as the grammar returns it.
    expect(textOf(documents)).toContain(
      "plan decision 8) — spec: specs/p2-n003-owner-questions-and-plan-view.md",
    );
    expect(textOf(section(html, "tasks"))).toContain(
      "No Cost log row and no journal event names a task with P2-N021.",
    );
  });

  it("P3-N011: the stage carries the hold marker", async () => {
    const { html } = await getPage(fixtureRepository(), "/view/node/P3-N011");
    const stage = section(html, "stage");
    expect(attributeText(stage, "data-stage")).toBe("[verifying]");
    expect(attributeText(stage, "data-hold")).toBe(
      "[gated: owner rulings on the omission list, the three weaker Class lines, scope arguments and closed entries]",
    );
  });

  it("an unknown node ID answers 404 naming the ID and the SHA", async () => {
    const { res, html } = await getPage(
      fixtureRepository(),
      "/view/node/P9-N999",
    );
    expect(res.status).toBe(404);
    expect(attributeText(html, "data-not-found")).toBe(
      `No node P9-N999 in docs/plan-register.md at ${FIXTURE_COMMIT}.`,
    );
    expect(attributeText(html, "data-sha")).toBe(FIXTURE_COMMIT);
    expect(html).not.toContain("data-field");
  });

  it("orders tasks by task number, not as text", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    repo.setFile(SHA_A, "docs/plan-register.md", "- P1-N001 [executing] Root");
    repo.setFile(
      SHA_A,
      "docs/cost-log.md",
      [
        "| date | task | node | stage | role | model | input tok | output tok | notes |",
        "|---|---|---|---|---|---|---|---|---|",
        "| 2026-10-30 | T1000 | P1-N001 | execute | implementer | m | n/a | n/a | fake |",
        "| 2026-10-30 | T999 | P1-N001 | execute | implementer | m | n/a | n/a | fake |",
      ].join("\n"),
    );
    repo.setFile(
      SHA_A,
      "orchestration/journal.jsonl",
      JSON.stringify({
        ts: "2026-10-30T00:00:00Z",
        event: "dispatched",
        task: "T0998",
        node: "P1-N001",
      }) + "\n",
    );
    const { html } = await getPage(repo, "/view/node/P1-N001");
    expect(taskItems(html)).toEqual([
      ["T0998", true],
      ["T999", false],
      ["T1000", false],
    ]);
  });
});

describe("outcomeParagraph", () => {
  it("takes the first paragraph under a heading reading exactly Outcome", () => {
    expect(
      outcomeParagraph(
        "# T\n\n## Outcome\n\nFirst line\nsecond line.\n\nSecond paragraph.\n",
      ),
    ).toBe("First line second line.");
    expect(
      outcomeParagraph("## Gate outcome, 2026-08-26\n\ntext\n"),
    ).toBeNull();
    expect(outcomeParagraph("### Outcome\n## Next\n")).toBe("");
  });
});

describe("V1 — the node page reads one commit", () => {
  it("reads the register, the Cost log, the journal and the plan at the SHA it resolved, while the branch head moves", async () => {
    const repo = fixtureRepository();
    repo.afterResolve = () => repo.heads.set("main", SHA_B);
    const { html } = await getPage(repo, "/view/node/P1-N008");
    expect(attributeText(html, "data-sha")).toBe(FIXTURE_COMMIT);
    expect(html).not.toContain(SHA_B);
    expect(repo.resolveCalls).toEqual([undefined]);
    expect(repo.readCalls).toEqual([
      { sha: FIXTURE_COMMIT, path: "docs/plan-register.md" },
      { sha: FIXTURE_COMMIT, path: "docs/cost-log.md" },
      { sha: FIXTURE_COMMIT, path: "orchestration/journal.jsonl" },
      {
        sha: FIXTURE_COMMIT,
        path: "docs/plans/p1-n008-mtool-checker-extension-point.md",
      },
    ]);
  });

  it("names the failing file and GitHub's status when the linked plan cannot be read, and shows no plan content", async () => {
    const repo = fixtureRepository();
    repo.failRead = {
      path: "docs/plans/p1-n008-mtool-checker-extension-point.md",
      status: 404,
    };
    const { res, html } = await getPage(repo, "/view/node/P1-N008?ref=main");
    expect(res.status).toBe(404);
    expect(attributeText(html, "data-failing-file")).toBe(
      "docs/plans/p1-n008-mtool-checker-extension-point.md",
    );
    expect(attributeText(html, "data-github-status")).toBe("404");
    expect(attributeText(html, "data-ref")).toBe("main");
    expect(attributeText(html, "data-sha")).toBe(FIXTURE_COMMIT);
    expect(html).not.toContain("data-field");
    expectLinksPinned(html, "main");
    expect(hrefs(html)).toContain("/view/node/P1-N008?ref=main");
  });
});

describe("V2 and V10 to V13 — what the node page carries", () => {
  const REFS: Array<string | undefined> = [
    undefined,
    "main",
    "release/1",
    FIXTURE_COMMIT,
  ];
  const NODES = ["P1-N008", "P2-N002", "P2-N013", "P2-N021", "P9-N999"];

  it("V2 — names the requested ref, the full SHA and the fetch time", async () => {
    const { html } = await getPage(
      fixtureRepository(),
      "/view/node/P1-N008?ref=release%2F1",
    );
    expect(attributeText(html, "data-ref")).toBe("release/1");
    expect(attributeText(html, "data-sha")).toBe(FIXTURE_COMMIT);
    expect(attributeText(html, "data-fetched")).toBe(NOW.toISOString());
  });

  it("V10 — pins every document link to a full SHA, names no branch, and carries the received ref unchanged on every link between pages", async () => {
    for (const ref of REFS) {
      for (const node of NODES) {
        const query =
          ref === undefined ? "" : `?ref=${encodeURIComponent(ref)}`;
        const { html } = await getPage(
          fixtureRepository(),
          `/view/node/${node}${query}`,
        );
        const counts = expectLinksPinned(html, ref);
        // At least the Backlog link and the tree and reload links.
        expect(counts.documentLinks, `${node} ${ref}`).toBeGreaterThan(0);
        expect(counts.pageLinks, `${node} ${ref}`).toBeGreaterThan(1);
      }
    }
  });

  it("V11 — renders a register title and note holding markup as text", async () => {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    repo.setFile(
      SHA_A,
      "docs/plan-register.md",
      [
        '- P1-N001 [identified] <script>alert("fake")</script> title — note <img src=x onerror=alert(1)> names P1-N002 · plan: plans/x.md',
        "  - P1-N002 [done] [gated: <b>bold</b> reason] Child",
      ].join("\n"),
    );
    repo.setFile(SHA_A, "docs/cost-log.md", "| date |\n|---|\n");
    repo.setFile(SHA_A, "orchestration/journal.jsonl", "");
    repo.setFile(
      SHA_A,
      "docs/plans/x.md",
      "## Outcome\n\n<script>alert('fake')</script> outcome\n",
    );
    const first = await getPage(repo, "/view/node/P1-N001");
    const second = await getPage(repo, "/view/node/P1-N002");
    for (const { html } of [first, second]) {
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toMatch(/<b>/);
    }
    expect(textOf(first.html)).toContain(
      '<script>alert("fake")</script> title',
    );
    expect(attributeText(first.html, "data-outcome")).toBe(
      "<script>alert('fake')</script> outcome",
    );
    expect(textOf(second.html)).toContain("[gated: <b>bold</b> reason]");
    expect(
      [...second.html.matchAll(/data-needed-by="([^"]+)"/g)].map((m) => m[1]),
    ).toEqual(["P1-N001"]);
  });

  it("V11 — every node page response, the 404 and the read failure included, carries the three headers", async () => {
    const repo = fixtureRepository();
    for (const path of ["/view/node/P1-N008", "/view/node/P9-N999"]) {
      await getPage(repo, path);
    }
    repo.failRead = { path: "docs/cost-log.md", status: 500 };
    const failed = await getPage(repo, "/view/node/P1-N008");
    expect(failed.res.status).toBe(502);
  });

  it("V12 — carries a viewport meta tag, runs no script, and no style sets a width above 360 CSS pixels", async () => {
    for (const node of NODES) {
      const { html } = await getPage(fixtureRepository(), `/view/node/${node}`);
      expectPhoneWidth(html);
    }
  });

  it("V13 — carries the no-progress-authority line, linking the Backlog at the page's SHA", async () => {
    for (const node of NODES) {
      const { html } = await getPage(
        fixtureRepository(),
        `/view/node/${node}?ref=main`,
      );
      const limit = /<p class="limit" data-limit>([\s\S]*?)<\/p>/.exec(html);
      expect(textOf(limit![1]!)).toContain(
        "This page carries no progress authority",
      );
      expect(limit![1]).toContain(`href="${BLOB}/docs/backlog.md"`);
    }
  });
});
