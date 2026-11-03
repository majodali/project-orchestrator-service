import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { parseRegister } from "../src/planRegister/parser.js";
import {
  implementationMap,
  listOfWhatIsNext,
} from "../src/view/modelRenderings.js";
import { headingAnchor, modelAtPage } from "../src/view/projectModel.js";
import {
  COMMIT_2DA1843,
  FILES_2DA1843,
  repository2da1843,
} from "./support/fixtures2da1843.js";
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
  textOf,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The Project model on the web view (node P2-N021, task E3; criteria
 * V25 and V26 of the specification of P2-N003, child 1, and the node
 * page's fields 3, 4 and 6). Every expected row and item below was
 * written by hand from the type's procedures
 * (docs/process/project-model.md in the coordinating repository, "The
 * implementation map", steps 1 to 7, "The list of what is next", steps
 * 1 to 6, "State derivation" and "Node-to-node dependency"), not
 * computed by the code under test.
 */

const MODEL = "docs/project-model.md";
const REGISTER = "docs/plan-register.md";
const COST_LOG = "docs/cost-log.md";
const JOURNAL = "orchestration/journal.jsonl";
const EMPTY_COST_LOG =
  "# Cost log\n\n| date | task | node | stage | role | model | input tok | output tok | notes |\n|---|---|---|---|---|---|---|---|---|\n";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  viewEnv();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function repositoryAt(files: Record<string, string>): FakeRepository {
  const repo = new FakeRepository();
  repo.heads.set("main", SHA_A);
  for (const [path, content] of Object.entries({
    [COST_LOG]: EMPTY_COST_LOG,
    [JOURNAL]: "",
    ...files,
  })) {
    repo.setFile(SHA_A, path, content);
  }
  return repo;
}

async function getPage(
  repo: FakeRepository,
  path: string,
): Promise<{ res: Response; html: string }> {
  const app = createApp({ view: { reader: repo, now: () => NOW } });
  const res = await app.request(path, { headers: { Cookie: validCookie() } });
  expectViewHeaders(res);
  return { res, html: await res.text() };
}

function sectionOf(html: string, open: string): string {
  const start = html.indexOf(open);
  expect(start, open).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</section>", start));
}

/** The tree and what follows it: since node P2-N023's iteration 2,
 * the map's rows sit in the tree, under the nodes that place them, and
 * the rows no rule places follow it. */
function mapSection(html: string): string {
  const start = html.indexOf(`<ul class="tree">`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</main>", start));
}

function field(html: string, name: string): string {
  return sectionOf(html, `<section data-field="${name}">`);
}

/** Each `<li>` carrying `attribute`, as [value, text]. */
function items(html: string, attribute: string): Array<[string, string]> {
  return [
    ...html.matchAll(
      new RegExp(
        `<li[^>]*?\\b${attribute}="([^"]+)"[^>]*>([\\s\\S]*?)</li>`,
        "g",
      ),
    ),
  ].map((m) => [m[1]!, textOf(m[2]!).trim()]);
}

/** A row in the type's shape, as the page shows it: without the list
 * marker and the bold markers. */
function shown(row: string): string {
  return row.replace(/^- /, "").replace(/\*\*/g, "");
}

/** A row as the tree shows it (node P2-N023, iterations 2 and 3): the
 * mark is the resource icon and the row's `data-mark`, not text, and a
 * row with no date says nothing of a date. */
function shownInTree(row: string): string {
  return shown(row)
    .replace(/^\[[x ]\] /, "")
    .replace(" — When: the model holds no date.", "")
    .replace(" — When:", " When:");
}

// ---- V25: the implementation map ------------------------------------

const MAP_REGISTER = [
  "# Plan register",
  "",
  "- P1-N001 [broken-down] Root",
  "  - P1-N002 [done] Built first",
  "  - P1-N003 [done] Built second",
  "  - P1-N004 [executing] Being built",
  "  - P1-N005 [planned] Not started",
  "  - P1-N006 [verifying] Being verified",
  "",
].join("\n");

const MAP_INSTANCE = `# Project model

Preamble prose.

## What this document does not claim

- No progress authority.

## RU-030 (a ruling made at a gate)

- **is:** The ruling that every part has an entry. It binds every node
  (from [Ruling register](rulings.md))
- **state:** built (derived; from [Plan register](plan-register.md)) ·
  own status active (from [Ruling register](rulings.md))
- **spec:** [Ruling register type](process/rulings.md) (process
  specification; from [Classification](classification.md))
- **risks:** none (no entry names it; from [Risk register](open-risks.md))
- **created-by:** P1-N002 gate (Built first; done 2026-09-01; from [Ruling
  register](rulings.md), the Source field of RU-030; [plan of
  P1-N002](plans/p1-n002.md), Gate record)
- **modified-by:** none (a ruling is superseded, never edited; from
  [Ruling register type](process/rulings.md))
- **used-by:** P1-N004 (Being built; from [Backlog](backlog.md))

## checker

- **is:** The checker of the register. It reads every line (from
  [Backlog](backlog.md))
- **state:** built, changing (derived; from [Plan
  register](plan-register.md))
- **spec:** [Auditing](process/auditing.md) (process specification; from
  [README](../README.md))
- **risks:** [R13](open-risks.md) (the runtime moves; from [Risk
  register](open-risks.md))
- **created-by:** P1-N002 (Built first; done 2026-08-20; from
  [Backlog](backlog.md), entry for P1-N002; [Cost log](cost-log.md), the
  row of T010) · P1-N003 (Built second; done 2026-08-28; from [Cost
  log](cost-log.md), the row of T020)
- **modified-by:** P1-N004 (Being built; from [plan of
  P1-N004](plans/p1-n004.md), Dependencies) · P1-N005 (Not started; from
  [plan of P1-N005](plans/p1-n005.md), Dependencies)
- **used-by:** P1-N006 (Being verified; from [Backlog](backlog.md))
- **formerly:** the Python checker (from [Backlog](backlog.md))

## repo

- **is:** This repository (from [README](../README.md))
- **state:** built (derived; from [Plan register](plan-register.md)) ·
  standing (a repository; from [Project model
  type](process/project-model.md), Standing resources)
- **spec:** none (no specification; from [Classification](classification.md))
- **risks:** none (no entry; from [Risk register](open-risks.md))
- **created-by:** P1-N002 (Built first; from [Backlog](backlog.md))
- **modified-by:** P1-N004 (Being built; from [Backlog](backlog.md)) · no
  record names the earlier writers (from [Ruling register](rulings.md))
- **used-by:** none (nothing reads it; from [Backlog](backlog.md))

## new-tool

- **is:** A tool under construction (from [Backlog](backlog.md))
- **state:** building (derived; from [Plan register](plan-register.md))
- **spec:** not yet derived (from [Backlog](backlog.md))
- **risks:** not yet derived (from [Backlog](backlog.md))
- **created-by:** P1-N004 (Being built; from [Backlog](backlog.md))
- **modified-by:** not yet derived (from [Backlog](backlog.md))
- **used-by:** not yet derived (from [Backlog](backlog.md))

## future-part

- **is:** A part not started (from [Backlog](backlog.md))
- **state:** planned (derived; from [Plan register](plan-register.md))
- **spec:** not yet derived (from [Backlog](backlog.md))
- **risks:** not yet derived (from [Backlog](backlog.md))
- **created-by:** P1-N005 (Not started; from [Backlog](backlog.md))
- **modified-by:** none (nothing; from [Backlog](backlog.md))
- **used-by:** none (nothing; from [Backlog](backlog.md))

## old-doc

- **is:** A document from a pruned tree (from [Backlog](backlog.md))
- **state:** built (derived; from [Plan register](plan-register.md))
- **spec:** none (no specification; from [Backlog](backlog.md))
- **risks:** none (no entry; from [Risk register](open-risks.md))
- **created-by:** P1-N099 (A pruned node; from [Backlog](backlog.md))
- **modified-by:** none (nothing; from [Backlog](backlog.md))
- **used-by:** none (nothing; from [Backlog](backlog.md))

## undated-register

- **is:** A register no record says who created (from [Backlog](backlog.md))
- **state:** built, changing (derived; from [Plan register](plan-register.md))
- **spec:** not yet derived (from [Backlog](backlog.md))
- **risks:** not yet derived (from [Backlog](backlog.md))
- **created-by:** not yet derived (from [Backlog](backlog.md))
- **modified-by:** P1-N006 (Being verified; from [Backlog](backlog.md))
- **used-by:** not yet derived (from [Backlog](backlog.md))

## stale-state

- **is:** A part whose state line lags its creator (from [Backlog](backlog.md))
- **state:** built (written before P1-N004 started; from [Plan
  register](plan-register.md))
- **spec:** none (no specification; from [Backlog](backlog.md))
- **risks:** none (no entry; from [Risk register](open-risks.md))
- **created-by:** P1-N004 (Being built; from [Backlog](backlog.md))
- **modified-by:** none (nothing; from [Backlog](backlog.md))
- **used-by:** none (nothing; from [Backlog](backlog.md))

## broken-edges

- **is:** A part whose creating line departs from the grammar (from
  [Backlog](backlog.md))
- **state:** built (derived; from [Plan register](plan-register.md))
- **spec:** none (no specification; from [Backlog](backlog.md))
- **risks:** none (no entry; from [Risk register](open-risks.md))
- **created-by:** the owner, by hand (from [Backlog](backlog.md))
- **modified-by:** none (nothing; from [Backlog](backlog.md))
- **used-by:** none (nothing; from [Backlog](backlog.md))
`;

/** The rows, written by hand from the procedure, steps 1 to 7. */
const MAP_ROWS: Record<string, string> = {
  // Step 5: the date note's source is the gate record in the node's
  // plan, not the Ruling register. Step 6: a gate item counts as done;
  // the own status follows.
  "RU-030":
    "- [x] **The ruling that every part has an entry. (RU-030)** — When: 2026-09-01, [plan of P1-N002](plans/p1-n002.md), Gate record. Status: built; P1-N002 gate done; own status active. Pointer: docs/project-model.md#ru-030-a-ruling-made-at-a-gate.",
  // Step 5: the latest of two date notes, with the Cost log row as its
  // source. Step 6: a modifying node in flight; a modifying node not
  // started does not change the value.
  checker:
    "- [x] **The checker of the register. (checker)** — When: 2026-08-28, [Cost log](cost-log.md), the row of T020. Status: built, changing; P1-N002 done, P1-N003 done, P1-N004 executing, P1-N005 planned. Pointer: docs/project-model.md#checker.",
  // A standing resource: its modifying nodes are not counted, so the
  // modified-by line's departure from the grammar stops nothing.
  repo: "- [x] **This repository (repo)** — When: the model holds no date. Status: built; P1-N002 done; standing. Pointer: docs/project-model.md#repo.",
  "new-tool":
    "- [ ] **A tool under construction (new-tool)** — When: the model holds no date. Status: building; P1-N004 executing; the modified-by line reads not yet derived. Pointer: docs/project-model.md#new-tool.",
  "future-part":
    "- [ ] **A part not started (future-part)** — When: the model holds no date. Status: planned; P1-N005 planned. Pointer: docs/project-model.md#future-part.",
  // A node the register no longer lists counts as done.
  "old-doc":
    "- [x] **A document from a pruned tree (old-doc)** — When: the model holds no date. Status: built; P1-N099 done (not in the register). Pointer: docs/project-model.md#old-doc.",
  "undated-register":
    "- [x] **A register no record says who created (undated-register)** — When: the model holds no date. Status: built, changing; P1-N006 verifying; the created-by line reads not yet derived. Pointer: docs/project-model.md#undated-register.",
};

/** The two rows the procedure cannot finish, by decision 11. */
const MAP_NOT_COMPUTABLE: Record<string, string> = {
  // Case (c): step 6 finds the stages give another value.
  "stale-state":
    'Not computable: docs/project-model.md, line 101. Missing input: the state line of stale-state. It reads "built", and the stages give "building".',
  // Case (b): the entry fails the entry grammar on a line the map reads.
  "broken-edges":
    "Not computable: docs/project-model.md, line 116. Missing input: the created-by line of broken-edges. It fails the type's entry grammar: the created-by line's item body \"the owner, by hand\" is not one this line holds (node items, gate items and outside items, or `none`).",
};

describe("V25 — the implementation map", () => {
  const register = parseRegister(MAP_REGISTER);
  const model = modelAtPage(SHA_A, MAP_INSTANCE);

  it("renders one row per entry, in file order, each equal to the row written by hand from steps 1 to 7", () => {
    const rendering = implementationMap(model, register);
    expect(rendering.kind).toBe("rows");
    if (rendering.kind !== "rows") return;
    expect(rendering.rows.map((row) => row.entry.slug)).toEqual([
      "RU-030",
      "checker",
      "repo",
      "new-tool",
      "future-part",
      "old-doc",
      "undated-register",
      "stale-state",
      "broken-edges",
    ]);
    for (const row of rendering.rows) {
      const hand = MAP_ROWS[row.entry.slug];
      if (hand !== undefined) {
        expect(row.notComputable, row.entry.slug).toBeNull();
        expect(row.text, row.entry.slug).toBe(hand);
      }
    }
  });

  it("renders a step-6 disagreement, and an entry that fails the grammar on a line the map reads, as not computable, naming the file, the line and the input", () => {
    const rendering = implementationMap(model, register);
    if (rendering.kind !== "rows") throw new Error("rows expected");
    for (const [slug, text] of Object.entries(MAP_NOT_COMPUTABLE)) {
      const row = rendering.rows.find((r) => r.entry.slug === slug)!;
      expect(row.text).toBeNull();
      expect(
        `Not computable: ${row.notComputable!.file}, line ${row.notComputable!.line}. Missing input: ${row.notComputable!.input}. ${row.notComputable!.reason}.`,
      ).toBe(text);
    }
  });

  it("shows the same rows on the tree page, inside the tree (node P2-N023, iteration 2), with each pointer linking the entry at the page's SHA", async () => {
    const repo = repositoryAt({
      [REGISTER]: MAP_REGISTER,
      [MODEL]: MAP_INSTANCE,
    });
    const { res, html } = await getPage(repo, "/view");
    expect(res.status).toBe(200);
    // The separate sections are gone: the rows sit in the tree.
    expect(html).not.toContain(`data-rendering="implementation-map"`);
    expect(html).not.toContain(`data-rendering="what-is-next"`);
    // Each entry once in the tree, or, unplaced, once in the problems
    // section; a row that is not computable is also named there
    // (node P2-N023, iteration 3).
    const problemsAt = html.indexOf(`<section class="problems"`);
    expect(problemsAt).toBeGreaterThan(-1);
    const inTree = items(mapSection(html.slice(0, problemsAt)), "data-map-row");
    const inProblems = items(html.slice(problemsAt), "data-map-row");
    // Every entry is shown; none twice in the tree.
    expect(new Set(inTree.map(([slug]) => slug)).size).toBe(inTree.length);
    const seen = new Set(inTree.map(([slug]) => slug));
    const rows = [
      ...inTree,
      ...inProblems.filter(([slug]) => {
        if (seen.has(slug)) return false;
        seen.add(slug);
        return true;
      }),
    ];
    expect(rows.map(([slug]) => slug).sort()).toEqual(
      Object.keys(MAP_ROWS).concat(Object.keys(MAP_NOT_COMPUTABLE)).sort(),
    );
    // Each row that is not computable is named in the problems section.
    for (const slug of Object.keys(MAP_NOT_COMPUTABLE)) {
      expect(
        inProblems.some(([s]) => s === slug),
        slug,
      ).toBe(true);
    }
    for (const [slug, text] of rows) {
      if (MAP_ROWS[slug] !== undefined) {
        // A row no rule places also says why, after the row.
        const [row, reason] = text.split(" No node in the register");
        expect(row, slug).toBe(shownInTree(MAP_ROWS[slug]));
        if (reason !== undefined) {
          expect(slug).toBe("old-doc");
          expect(reason).toBe(
            " creates, modifies or uses it (created-by: P1-N099 (not in the register); modified-by: none; used-by: none).",
          );
        }
        expect(html, slug).toContain(
          `data-map-row="${slug}" data-mark="${MAP_ROWS[slug].slice(3, 4)}"`,
        );
      } else {
        expect(text, slug).toContain(MAP_NOT_COMPUTABLE[slug]!);
        expect(text, slug).toContain(`Pointer: docs/project-model.md#${slug}.`);
      }
    }
    const pointer =
      /<li[^>]*data-map-row="checker"[\s\S]*?data-pointer href="([^"]+)"/.exec(
        html,
      )!;
    expect(pointer[1]).toBe(
      `https://github.com/${OWNER}/${REPO}/blob/${SHA_A}/docs/project-model.md#checker`,
    );
    expectLinksPinned(html, undefined);
    expectPhoneWidth(html);
  });

  it("carries exactly the facets the procedure carries: no spec, risks, used-by, formerly or alias line, and no note but names and dates", async () => {
    const repo = repositoryAt({
      [REGISTER]: MAP_REGISTER,
      [MODEL]: MAP_INSTANCE,
    });
    const map = items(
      mapSection((await getPage(repo, "/view")).html),
      "data-map-row",
    )
      .map(([, text]) => text)
      .join("\n");
    for (const omitted of [
      "Auditing",
      "R13",
      "the runtime moves",
      "the Python checker",
      "Being verified; from",
      "It reads every line",
      "It binds every node",
      "Ruling register type",
      "Dependencies",
    ]) {
      expect(map, omitted).not.toContain(omitted);
    }
  });

  it("renders the whole map as not computable when the instance is absent at the page's SHA (decision 11, case (a))", async () => {
    const repo = repositoryAt({ [REGISTER]: MAP_REGISTER });
    const { res, html } = await getPage(repo, "/view");
    expect(res.status).toBe(200);
    expect(attributeText(mapSection(html), "data-not-computable")).toBe(
      `Not computable: docs/project-model.md, no line. Missing input: the Project model instance. docs/project-model.md is absent at ${SHA_A}.`,
    );
    expect(items(mapSection(html), "data-map-row")).toEqual([]);
  });

  it("still fails the page, naming the file and GitHub's status, when the instance's read fails for another reason than its absence", async () => {
    const repo = repositoryAt({
      [REGISTER]: MAP_REGISTER,
      [MODEL]: MAP_INSTANCE,
    });
    repo.failRead = { path: MODEL, status: 500 };
    const { res, html } = await getPage(repo, "/view");
    expect(res.status).toBe(502);
    expect(attributeText(html, "data-failing-file")).toBe(MODEL);
    expect(attributeText(html, "data-github-status")).toBe("500");
    expect(html).not.toContain("data-rendering");
  });

  it("reads the instance at the SHA the register was read at, while the branch head moves", async () => {
    const repo = repositoryAt({
      [REGISTER]: MAP_REGISTER,
      [MODEL]: MAP_INSTANCE,
    });
    repo.setFile(SHA_B, REGISTER, MAP_REGISTER);
    repo.setFile(
      SHA_B,
      MODEL,
      MAP_INSTANCE.replace("built, changing (derived", "built (derived"),
    );
    repo.afterResolve = () => repo.heads.set("main", SHA_B);
    const { html } = await getPage(repo, "/view");
    expect(attributeText(html, "data-sha")).toBe(SHA_A);
    expect(html).not.toContain(SHA_B);
    expect(repo.readCalls).toEqual([
      { sha: SHA_A, path: REGISTER },
      { sha: SHA_A, path: MODEL },
    ]);
    expect(
      new Map(items(mapSection(html), "data-map-row")).get("checker"),
    ).toBe(shownInTree(MAP_ROWS.checker!));
  });
});

// ---- V26: the list of what is next ----------------------------------

/** The edges of P3-N002's breakdown, as the type's table reads them
 * (docs/process/project-model.md, "The rule applied to the edges of
 * P3-N002's breakdown"): children A to D are P3-N006 to P3-N009. */
const BREAKDOWN_REGISTER = [
  "# Plan register",
  "",
  "- P1-N002 [done] Bootstrap and founding plan",
  "- P2-N012 [done] Deploy the service from CI on merge",
  "- P3-N001 [broken-down] Project comprehension",
  "  - P3-N002 [broken-down] The comprehension model",
  "    - P3-N006 [identified] A, the thin end-to-end slice",
  "    - P3-N007 [identified] B, the type declared",
  "    - P3-N008 [identified] C, the instance over this repository",
  "    - P3-N009 [identified] D, sibling ordering retired",
  "",
].join("\n");

function breakdownEntry(
  heading: string,
  created: string,
  modified: string,
  used: string,
  state = "built",
): string {
  const from =
    "from [specification of P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this breakdown";
  return `## ${heading}

- **is:** A part of the breakdown (${from})
- **state:** ${state} (derived; from [Plan register](plan-register.md))
- **spec:** not yet derived (${from})
- **risks:** not yet derived (${from})
- **created-by:** ${created}
- **modified-by:** ${modified}
- **used-by:** ${used}
`;
}

const S =
  "from [specification of P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this breakdown";
const NYD = `not yet derived (${S})`;

const BREAKDOWN_INSTANCE = [
  "# Project model\n",
  breakdownEntry(
    "project-model",
    `P3-N006 (A; ${S})`,
    `P3-N008 (C; ${S})`,
    `P3-N007 (B; ${S}) · P3-N009 after P3-N008 (D; ${S})`,
    "planned",
  ),
  breakdownEntry(
    "project-model-type",
    `P3-N007 (B; ${S})`,
    NYD,
    `P3-N008 (C; ${S}) · P3-N009 (D; ${S})`,
    "planned",
  ),
  breakdownEntry(
    "plan-register",
    `P1-N002 (Bootstrap; ${S})`,
    `P3-N009 (D; ${S})`,
    `P3-N008 (C; ${S})`,
  ),
  breakdownEntry(
    "backlog",
    `P1-N002 (Bootstrap; ${S})`,
    `P3-N009 (D; ${S})`,
    `P3-N008 (C; ${S})`,
  ),
  breakdownEntry(
    "RU-015 (upstream delivery form)",
    `P2-N012 gate (Deploy; ${S})`,
    `none (a ruling; ${S})`,
    `P3-N007 (B; ${S})`,
  ),
  breakdownEntry(
    "RU-016 (repository reach)",
    `P2-N012 gate (Deploy; ${S})`,
    `none (a ruling; ${S})`,
    `P3-N006 (A; ${S})`,
  ),
  breakdownEntry(
    "RU-018 (no queue behind an independent sibling)",
    `P2-N012 gate (Deploy; ${S})`,
    `none (a ruling; ${S})`,
    `P3-N009 (D; ${S})`,
  ),
  breakdownEntry(
    "RU-021 (the source of progress truth)",
    `P3-N001 gate (Comprehension; ${S})`,
    `none (a ruling; ${S})`,
    `P3-N006 (A; ${S}) · P3-N007 (B; ${S})`,
  ),
  breakdownEntry("k-003-amendment", `P3-N007 (B; ${S})`, NYD, NYD, "planned"),
].join("\n");

/** The items, written by hand from the procedure, steps 1 to 6. */
const BREAKDOWN_ITEMS: Array<[string, string]> = [
  [
    "P3-N001",
    "P3-N001 Project comprehension [broken-down] — actionable, no recorded uses edge. Next: its children's work.",
  ],
  [
    "P3-N002",
    "P3-N002 The comprehension model [broken-down] — actionable, no recorded uses edge. Next: its children's work.",
  ],
  [
    "P3-N006",
    "P3-N006 A, the thin end-to-end slice [identified] — actionable. Uses: RU-016, created by P2-N012 gate; RU-021, created by P3-N001 gate. Next: planned.",
  ],
  [
    "P3-N007",
    "P3-N007 B, the type declared [identified] — waiting on: P3-N006 (project-model). Uses: project-model, created by P3-N006 identified; RU-015, created by P2-N012 gate; RU-021, created by P3-N001 gate. Next: planned.",
  ],
  [
    "P3-N008",
    "P3-N008 C, the instance over this repository [identified] — waiting on: P3-N007 (project-model-type). Uses: project-model-type, created by P3-N007 identified; plan-register, created by P1-N002 done; backlog, created by P1-N002 done. Next: planned.",
  ],
  [
    "P3-N009",
    "P3-N009 D, sibling ordering retired [identified] — waiting on: P3-N006 (project-model), P3-N008 (project-model), P3-N007 (project-model-type). Uses: project-model after P3-N008, created by P3-N006 identified; project-model-type, created by P3-N007 identified; RU-018, created by P2-N012 gate. Next: planned.",
  ],
];

describe("V26 — the list of what is next", () => {
  it("the edges of P3-N002's breakdown: each item equals the item written by hand from steps 1 to 6", () => {
    const rendering = listOfWhatIsNext(
      modelAtPage(SHA_A, BREAKDOWN_INSTANCE),
      parseRegister(BREAKDOWN_REGISTER),
    );
    if (rendering.kind !== "items") throw new Error("items expected");
    expect(rendering.items.map((item) => [item.node.id, item.text])).toEqual(
      BREAKDOWN_ITEMS,
    );
    expect(rendering.usedByNotYetDerived.map((e) => e.slug)).toEqual([
      "k-003-amendment",
    ]);
  });

  it("the edges of P3-N002's breakdown give the chain A, B, C, D on the node pages, with no cycle", async () => {
    const repo = repositoryAt({
      [REGISTER]: BREAKDOWN_REGISTER,
      [MODEL]: BREAKDOWN_INSTANCE,
    });
    const dependsOn = async (id: string): Promise<string[]> => {
      const { html } = await getPage(repo, `/view/node/${id}`);
      return items(field(html, "depends-on"), "data-edge-dependency").map(
        ([on]) => on,
      );
    };
    // The type's table, column "Depends on".
    expect(await dependsOn("P3-N006")).toEqual([]);
    expect(await dependsOn("P3-N007")).toEqual(["P3-N006"]);
    // C also depends on P1-N002, which created plan-register and
    // backlog and is done: the table names siblings only.
    expect(await dependsOn("P3-N008")).toEqual([
      "P3-N007",
      "P1-N002",
      "P1-N002",
    ]);
    expect(await dependsOn("P3-N009")).toEqual([
      "P3-N006",
      "P3-N008",
      "P3-N007",
    ]);
    // Each points to an earlier child: under the rule this replaces, C
    // would depend on D, which modifies plan-register and backlog.
    const order = ["P3-N006", "P3-N007", "P3-N008", "P3-N009"];
    for (const [i, id] of order.entries()) {
      for (const on of (await dependsOn(id)).filter((on) =>
        order.includes(on),
      )) {
        expect(order.indexOf(on), `${id} on ${on}`).toBeLessThan(i);
      }
    }
    const { html } = await getPage(repo, "/view/node/P3-N007");
    expect(items(field(html, "needed-by"), "data-edge-dependent")).toEqual([
      ["P3-N008", "P3-N008: uses project-model-type, which P3-N007 creates"],
      ["P3-N009", "P3-N009: uses project-model-type, which P3-N007 creates"],
    ]);
    expect(items(field(html, "depends-on"), "data-edge-dependency")).toEqual([
      ["P3-N006", "P3-N006: creates project-model, which P3-N007 uses"],
    ]);
  });

  it("shows the list's classes on the tree page as each node's aggregate status (node P2-N023, iteration 2)", async () => {
    const repo = repositoryAt({
      [REGISTER]: BREAKDOWN_REGISTER,
      [MODEL]: BREAKDOWN_INSTANCE,
    });
    const { html } = await getPage(repo, "/view?ref=main");
    const statuses = Object.fromEntries(
      [
        ...html.matchAll(/<li data-node="([^"]+)"[^>]*data-status="([^"]+)"/g),
      ].map((m) => [m[1]!, m[2]!]),
    );
    // Written by hand from the rules: done subtrees are done; a node
    // the list classes "waiting on" is pending; an actionable node not
    // started is ready; a broken-down node is in progress.
    expect(statuses).toEqual({
      "P1-N002": "done",
      "P2-N012": "done",
      "P3-N001": "progress",
      "P3-N002": "progress",
      "P3-N006": "ready",
      "P3-N007": "pending",
      "P3-N008": "pending",
      "P3-N009": "pending",
    });
    expectLinksPinned(html, "main");
  });

  const CLASSES_REGISTER = [
    "# Plan register",
    "",
    "- P4-N001 [executing] Running",
    "- P4-N002 [planned] [gated: owner review of the plan] Gated",
    "- P4-N003 [verifying] Verifying",
    "- P4-N004 [specified] Ready",
    "- P4-N005 [identified] Behind a planned creator",
    "- P4-N006 [done] Finished",
    "- P4-N007 [identified] Nothing recorded",
    "- P4-N008 [identified] Named by an item that fails the grammar",
    "- P4-N009 [identified] Uses a part whose creators cannot be read",
    "",
  ].join("\n");

  const F = "from [Backlog](backlog.md)";
  const CLASSES_INSTANCE = [
    "# Project model\n",
    breakdownEntry(
      "alpha",
      `P4-N006 (Finished; ${F})`,
      `none (nothing; ${F})`,
      `P4-N004 (Ready; ${F}) · P4-N001 (Running; ${F}) · P4-N002 (Gated; ${F})`,
    ),
    breakdownEntry(
      "beta",
      `P4-N002 (Gated; ${F})`,
      `none (nothing; ${F})`,
      `P4-N005 (Behind; ${F}) · P4-N003 (Verifying; ${F})`,
      "planned",
    ),
    breakdownEntry(
      "gamma",
      `not yet derived (${F})`,
      `none (nothing; ${F})`,
      `P4-N004 (Ready; ${F})`,
    ),
    breakdownEntry(
      "delta",
      `P4-N006 (Finished; ${F})`,
      `none (nothing; ${F})`,
      `the node P4-N008, written without the grammar (${F})`,
    ),
    breakdownEntry(
      "epsilon",
      `someone outside (${F})`,
      `none (nothing; ${F})`,
      `P4-N009 (Uses; ${F})`,
    ),
    breakdownEntry(
      "zeta",
      `P4-N006 (Finished; ${F})`,
      `none (nothing; ${F})`,
      `not yet derived (${F})`,
    ),
  ].join("\n");

  it("classifies each node by the first rule that holds: in flight, held, waiting on, actionable; and adds 'no recorded uses edge' only to an actionable node no item names", () => {
    const rendering = listOfWhatIsNext(
      modelAtPage(SHA_A, CLASSES_INSTANCE),
      parseRegister(CLASSES_REGISTER),
    );
    if (rendering.kind !== "items") throw new Error("items expected");
    expect(
      rendering.items
        .filter((item) => item.notComputable.length === 0)
        .map((item) => [item.node.id, item.text]),
    ).toEqual([
      [
        "P4-N001",
        "P4-N001 Running [executing] — in flight. Uses: alpha, created by P4-N006 done. Next: verifying.",
      ],
      [
        "P4-N002",
        "P4-N002 Gated [planned] [gated: owner review of the plan] — held. Uses: alpha, created by P4-N006 done. Next: specified.",
      ],
      [
        "P4-N003",
        "P4-N003 Verifying [verifying] — in flight. Uses: beta, created by P4-N002 planned. Next: done.",
      ],
      [
        "P4-N004",
        "P4-N004 Ready [specified] — actionable. Uses: alpha, created by P4-N006 done; gamma, its created-by line reads not yet derived. Next: broken-down (interior) or executing (leaf).",
      ],
      [
        "P4-N005",
        "P4-N005 Behind a planned creator [identified] — waiting on: P4-N002 (beta). Uses: beta, created by P4-N002 planned. Next: planned.",
      ],
      [
        "P4-N007",
        "P4-N007 Nothing recorded [identified] — actionable, no recorded uses edge. Next: planned.",
      ],
    ]);
  });

  it("renders decision 11's three cases as not computable, naming the input: the instance absent, an entry that fails the grammar, and a step-6 disagreement", async () => {
    // (b): an item the parser could not give a form writes the node's
    // ID, so whether a used-by item names it cannot be settled; and a
    // resource the node uses has a created-by line that fails the
    // grammar, so its creating nodes cannot be listed.
    const rendering = listOfWhatIsNext(
      modelAtPage(SHA_A, CLASSES_INSTANCE),
      parseRegister(CLASSES_REGISTER),
    );
    if (rendering.kind !== "items") throw new Error("items expected");
    const stopped = rendering.items
      .filter((item) => item.notComputable.length > 0)
      .map((item) => [
        item.node.id,
        item.classification,
        item.notComputable.map((nc) => [nc.file, nc.line, nc.input]),
      ]);
    expect(stopped).toEqual([
      [
        "P4-N008",
        null,
        [["docs/project-model.md", 41, "the used-by line of delta"]],
      ],
      [
        "P4-N009",
        null,
        [["docs/project-model.md", 49, "the created-by line of epsilon"]],
      ],
    ]);

    // (a): the instance absent at the page's SHA. The tree still
    // shows every node, and says the resources cannot be placed.
    const absent = repositoryAt({ [REGISTER]: CLASSES_REGISTER });
    const absentPage = (await getPage(absent, "/view")).html;
    expect(attributeText(mapSection(absentPage), "data-not-computable")).toBe(
      `Not computable: docs/project-model.md, no line. Missing input: the Project model instance. docs/project-model.md is absent at ${SHA_A}.`,
    );
    expect(items(mapSection(absentPage), "data-map-row")).toEqual([]);

    // (c): a step-6 disagreement belongs to the map, which re-derives
    // the state line; the list reads stages from the register and
    // never the state line, so its items still finish. Here `beta`'s
    // state line reads planned while its creator, P4-N002, is planned:
    // they agree. Make it disagree.
    const disagreeing = repositoryAt({
      [REGISTER]: CLASSES_REGISTER,
      [MODEL]: CLASSES_INSTANCE.replace(
        "- **state:** planned (derived",
        "- **state:** built (derived",
      ),
    });
    const page = (await getPage(disagreeing, "/view")).html;
    expect(textOf(mapSection(page))).toContain(
      'Not computable: docs/project-model.md, line 16. Missing input: the state line of beta. It reads "built", and the stages give "planned".',
    );
    expect(page).toMatch(/<li data-node="P4-N005"[^>]*data-status="pending"/);
  });
});

// ---- The instance at 2da1843 ----------------------------------------

describe("the instance and register at 2da1843, the head of main when task E3 started", () => {
  const register = parseRegister(FILES_2DA1843.get(REGISTER)!);
  const model = modelAtPage(COMMIT_2DA1843, FILES_2DA1843.get(MODEL)!);

  it("V25: every row finishes, every state line agrees with its derivation, and the sampled rows equal the rows written by hand", () => {
    const rendering = implementationMap(model, register);
    if (rendering.kind !== "rows") throw new Error("rows expected");
    expect(rendering.rows).toHaveLength(42);
    // The parser's four departures lie on lines the map does not read:
    // spec lines, a used-by line, and the modified-by line of a
    // standing resource.
    expect(rendering.rows.filter((row) => row.notComputable !== null)).toEqual(
      [],
    );
    const bySlug = new Map(
      rendering.rows.map((row) => [row.entry.slug, row.text]),
    );
    expect(bySlug.get("form-checker")).toBe(
      "- [x] **The tool that enforces the Plan register grammar and the cross-register invariants. (form-checker)** — When: the model holds no date. Status: built, changing; P1-N005 done, P1-N012 done, P1-N013 done, P3-N007 done, P3-N009 identified, P2-N021 executing. Pointer: docs/project-model.md#form-checker.",
    );
    expect(bySlug.get("RU-016")).toBe(
      "- [x] **The ruling (RU-016, who decides which repositories a node's work may write to) that the Planner declares the repository access a node needs, in the node's plan. (RU-016)** — When: the model holds no date. Status: built; P2-N012 done; own status active. Pointer: docs/project-model.md#ru-016-repository-reach.",
    );
    expect(bySlug.get("project-orchestrator-repo")).toBe(
      "- [x] **This repository, majodali/project-orchestrator, the coordinating repository of the orchestration project. (project-orchestrator-repo)** — When: the model holds no date. Status: built; P1-N002 done; standing. Pointer: docs/project-model.md#project-orchestrator-repo.",
    );
    expect(bySlug.get("backlog")).toBe(
      "- [x] **The Backlog, `docs/backlog.md` (backlog)** — When: the model holds no date. Status: built; the created-by line reads not yet derived; standing. Pointer: docs/project-model.md#backlog.",
    );
    expect(bySlug.get("web-view")).toBe(
      "- [ ] **The service's `/view` routes, their pages and sign-in, in majodali/project-orchestrator-service (web-view)** — When: the model holds no date. Status: building; P2-N021 executing, P2-N022 identified. Pointer: docs/project-model.md#web-view.",
    );
    expect(bySlug.get("owner-question-queue")).toBe(
      "- [ ] **The queue of owner questions and answers in the service, and its answering action in the web view (owner-question-queue)** — When: the model holds no date. Status: planned; P2-N022 identified; the modified-by line reads not yet derived. Pointer: docs/project-model.md#owner-question-queue.",
    );
    expect(bySlug.get("dispatch-rules")).toBe(
      "- [x] **The dispatch process document, `docs/process/dispatch.md` (dispatch-rules)** — When: the model holds no date. Status: built; P3-N007 done, P3-N009 identified, P2-N018 identified; the created-by line reads not yet derived. Pointer: docs/project-model.md#dispatch-rules.",
    );
    // The title `# Project model` takes GitHub's anchor
    // `project-model`, so the entry's heading is `project-model-1`.
    expect(bySlug.get("project-model")).toContain(
      "Pointer: docs/project-model.md#project-model-1.",
    );
    expect(bySlug.get("RU-002")).toBe(
      "- [x] **not yet derived (RU-002)** — When: the model holds no date. Status: built; the created-by line reads not yet derived; the modified-by line reads not yet derived. Pointer: docs/project-model.md#ru-002-upstream-output-is-hand-carried.",
    );
  });

  it("V26: each node not done, in register order, classed as written by hand from the procedure", () => {
    const rendering = listOfWhatIsNext(model, register);
    if (rendering.kind !== "items") throw new Error("items expected");
    expect(
      rendering.items.map((item) => [
        item.node.id,
        item.classification,
        item.waitingOn.map((w) => `${w.node} (${w.slug})`),
        item.noRecordedUses,
      ]),
    ).toEqual([
      ["P1-N001", "actionable", [], true],
      ["P1-N016", "held", [], false],
      ["P1-N006", "actionable", [], true],
      ["P1-N007", "actionable", [], true],
      ["P2-N001", "actionable", [], true],
      ["P2-N003", "actionable", [], true],
      ["P2-N021", "in flight", [], false],
      [
        "P2-N022",
        "waiting on",
        ["P2-N021 (web-view)", "P2-N020 (task-tools)"],
        false,
      ],
      ["P2-N004", "actionable", [], true],
      ["P2-N005", "actionable", [], true],
      ["P2-N017", "actionable", [], true],
      ["P2-N018", "waiting on", ["P2-N017 (p2-n005-platform-facts)"], false],
      ["P2-N019", "waiting on", ["P2-N017 (p2-n005-platform-facts)"], false],
      [
        "P2-N020",
        "waiting on",
        [
          "P2-N017 (p2-n005-platform-facts)",
          "P2-N018 (pull-run-protocol)",
          "P2-N019 (session-handle)",
        ],
        false,
      ],
      ["P2-N006", "actionable", [], true],
      ["P3-N001", "actionable", [], false],
      ["P3-N002", "actionable", [], false],
      ["P3-N008", "held", [], false],
      ["P3-N009", "waiting on", ["P3-N008 (project-model)"], false],
      ["P3-N003", "actionable", [], true],
      ["P3-N011", "in flight", [], false],
      ["P3-N012", "actionable", [], true],
      ["P3-N004", "actionable", [], true],
      ["P3-N005", "actionable", [], true],
      ["P3-N015", "held", [], false],
      ["P3-N016", "actionable", [], true],
    ]);
    expect(
      rendering.items.find((item) => item.node.id === "P3-N009")!.text,
    ).toBe(
      "P3-N009 Sibling ordering retired, and the checks that replace it [identified] — waiting on: P3-N008 (project-model). Uses: project-model after P3-N008, created by P3-N006 done; project-model-type, created by P3-N007 done; RU-018, its created-by line reads not yet derived. Next: planned.",
    );
  });

  it("the node page of P2-N021: its dependencies and dependents by recorded edges, and its resources grouped by label", async () => {
    const { res, html } = await getPage(
      repository2da1843(),
      "/view/node/P2-N021",
    );
    expect(res.status).toBe(200);
    expect(items(field(html, "depends-on"), "data-edge-dependency")).toEqual([
      ["P1-N010", "P1-N010: creates plan-register-grammar, which P2-N021 uses"],
      ["P1-N005", "P1-N005: creates run-journal, which P2-N021 uses"],
      ["P2-N012", "P2-N012: creates RU-016, which P2-N021 uses"],
      ["P3-N006", "P3-N006: creates project-model, which P2-N021 uses"],
      ["P3-N007", "P3-N007: creates project-model-type, which P2-N021 uses"],
    ]);
    expect(textOf(field(html, "depends-on"))).toContain("By recorded edges:");
    expect(items(field(html, "needed-by"), "data-edge-dependent")).toEqual([
      ["P2-N022", "P2-N022: uses web-view, which P2-N021 creates"],
    ]);
    const resources = field(html, "resources");
    const group = (label: string): string[] =>
      items(
        sectionOf(resources, `<div data-resource-group="${label}">`).replace(
          /<\/div>[\s\S]*$/,
          "",
        ),
        "data-resource",
      ).map(([slug]) => slug);
    expect(group("created-by")).toEqual([
      "web-view",
      "project-model-parser",
      "cost-log-and-journal-grammar",
    ]);
    expect(group("modified-by")).toEqual([
      "form-checker",
      "project-orchestrator-repo",
      "backlog",
      "project-orchestrator-service-repo",
      "vendoring-generator",
    ]);
    expect(group("used-by")).toEqual([
      "plan-register-grammar",
      "run-journal",
      "RU-016",
      "project-model",
      "project-model-type",
      "plan-register",
      "RU-021",
      "cost-log",
      "RU-012",
    ]);
    expect(resources).not.toContain("data-not-computable");
    const href = /<li data-resource="RU-016"><a href="([^"]+)"/.exec(
      resources,
    )![1]!;
    expect(href).toBe(
      `https://github.com/${OWNER}/${REPO}/blob/${COMMIT_2DA1843}/docs/project-model.md#ru-016-repository-reach`,
    );
    expectLinksPinned(html, undefined);
    expectPhoneWidth(html);
  });

  it("the node page of P3-N008: an after qualifier names it, so P3-N009 depends on it, and the Resources field says how the line names it", async () => {
    const repo = repository2da1843();
    repo.setFile(
      COMMIT_2DA1843,
      "docs/plans/p3-n008-instance-over-this-repository.md",
      "# Plan\n\n## Outcome\n\nThe instance, populated.\n",
    );
    const { html } = await getPage(repo, "/view/node/P3-N008");
    expect(items(field(html, "needed-by"), "data-edge-dependent")).toEqual([
      [
        "P3-N009",
        "P3-N009: names P3-N008 in the after qualifier of its use of project-model",
      ],
    ]);
    expect(
      items(field(html, "resources"), "data-resource").filter(
        ([slug]) => slug === "project-model",
      ),
    ).toEqual([
      ["project-model", "project-model"],
      [
        "project-model",
        "project-model (named in the after qualifier of P3-N009's item)",
      ],
    ]);
  });

  it("the node page reads the instance at the page's SHA, and says so when it is absent there (decision 11, case (a))", async () => {
    const repo = repository2da1843();
    repo.files.get(COMMIT_2DA1843)!.delete(MODEL);
    const { res, html } = await getPage(repo, "/view/node/P2-N021");
    expect(res.status).toBe(200);
    const absent = `Not computable: docs/project-model.md, no line. Missing input: the Project model instance. docs/project-model.md is absent at ${COMMIT_2DA1843}.`;
    expect(attributeText(field(html, "resources"), "data-not-computable")).toBe(
      absent,
    );
    expect(
      attributeText(field(html, "depends-on"), "data-not-computable"),
    ).toBe(absent);
    expect(attributeText(field(html, "needed-by"), "data-not-computable")).toBe(
      absent,
    );
    expect(repo.readCalls.map((call) => call.path)).toEqual([
      REGISTER,
      COST_LOG,
      JOURNAL,
      MODEL,
    ]);
  });

  it("names GitHub's heading anchors as GitHub renders them", () => {
    expect(headingAnchor("RU-016 (repository reach)")).toBe(
      "ru-016-repository-reach",
    );
    expect(
      headingAnchor(
        "RU-018 (a child is not queued behind a sibling it does not depend on)",
      ),
    ).toBe(
      "ru-018-a-child-is-not-queued-behind-a-sibling-it-does-not-depend-on",
    );
    expect(headingAnchor("cost-log-and-journal-grammar")).toBe(
      "cost-log-and-journal-grammar",
    );
  });
});
