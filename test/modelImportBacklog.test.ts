import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { checkState } from "../src/model/check.js";
import {
  backlogShape,
  importState,
  parseBacklogRows,
  type ImportInput,
} from "../src/model/importState.js";

/**
 * Tests for the Backlog reader (P4-N044): `plan-state import` builds
 * a state file from a project's K-004 Backlog when it has no Plan
 * register.
 *
 * `test/fixtures/methodology-tools.backlog.sample.md` is a byte-for-
 * byte copy of majodali/methodology-tools' real `docs/backlog.md`, at
 * commit 296ba46665ccf7b36e78556e8c5281ce90a45b64 (2026-11-02). It is
 * copied in for the reason test/fixtures/plan-register.sample.md is
 * (see that file's header): this suite must not depend on that
 * repository being checked out next to this one. It can drift from
 * the live Backlog over time; that is a known limitation, not a
 * defect of this test.
 */

const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/methodology-tools.backlog.sample.md", import.meta.url),
);
const REAL_BACKLOG = readFileSync(FIXTURE_PATH, "utf-8");

function input(partial: Partial<ImportInput> = {}): ImportInput {
  return {
    project: "majodali/example",
    register: null,
    backlog: null,
    costLog: null,
    journal: null,
    rulings: null,
    plans: new Map(),
    acceptedPlans: {},
    exists: () => false,
    overrides: null,
    ...partial,
  };
}

describe("backlogShape", () => {
  it("reads a title and an outcome when the em dash sits directly against the lead", () => {
    expect(backlogShape("**A** — one two three.")).toEqual({
      ok: true,
      title: "A",
      outcome: "one two three.",
    });
  });

  it("reads through an annotation between the lead and the em dash, as this service's own renderBacklog writes (render.ts: `**Title** (P1-N001) — When: ...`)", () => {
    expect(backlogShape("**A** (P1-N001) — When: x. Status: done.")).toEqual({
      ok: true,
      title: "A",
      outcome: "When: x.",
    });
    expect(
      backlogShape(
        "**Custom-type checker extension point** (inbound proposal, awaiting adjudication) — nothing written pending the maintainer's answer.",
      ),
    ).toMatchObject({ ok: true, title: "Custom-type checker extension point" });
  });

  it("is not mapped when there is no bolded lead", () => {
    expect(backlogShape("no bold at all — body.")).toEqual({
      ok: false,
      reason: "no bolded lead",
    });
  });

  it("is not mapped when there is no em dash anywhere after the lead", () => {
    expect(backlogShape("**A** nothing here to split a body from.")).toEqual({
      ok: false,
      reason: "the bolded lead has no em dash introducing a body",
    });
  });
});

describe("parseBacklogRows", () => {
  it("reads the checkbox, the heading and continuation lines, one row per item", () => {
    const rows = parseBacklogRows(
      [
        "## Completed",
        "",
        "- [x] **A** — one.",
        "",
        "## Upcoming",
        "",
        "- [ ] **B**",
        "  continues — two.",
        "",
      ].join("\n"),
    );
    expect(rows).toEqual([
      { heading: "Completed", checked: true, text: "**A** — one." },
      { heading: "Upcoming", checked: false, text: "**B** continues — two." },
    ]);
  });
});

describe("importState over a Backlog", () => {
  const CLEAN_BACKLOG = [
    "# Backlog",
    "",
    "## Completed",
    "",
    "- [x] **First chunk shipped** — the tool now does the first thing, closing the gap the founding plan named.",
    "",
    "## Upcoming",
    "",
    "- [ ] **Second chunk planned** — the tool will do the second thing once the design is settled.",
    "",
  ].join("\n");

  it("builds a state a well-formed Backlog's rows produce with no check violations", () => {
    const { state, record } = importState(input({ backlog: CLEAN_BACKLOG }));
    expect(record.source).toBe("backlog");
    expect(checkState(state).findings).toEqual([]);
    expect(state.tasks).toEqual([]);
    expect(state.decisions).toEqual([]);
    expect(state.nodes.map((n) => [n.id, n.title, n.stage, n.note])).toEqual([
      ["P1-N001", "First chunk shipped", "done", "Completed"],
      ["P1-N002", "Second chunk planned", "identified", "Upcoming"],
    ]);
    expect(state.nodes[0]!.outcome).toBe(
      "the tool now does the first thing, closing the gap the founding plan named.",
    );
  });

  it("links a plan document only when the row names one that exists", () => {
    const backlog = [
      "## Completed",
      "",
      "- [x] **Founding plan** — adopted as [plans/x.md](plans/x.md), the plan the project follows.",
      "- [x] **No plan here** — nothing to link, since this names no file.",
      "",
    ].join("\n");
    const { state } = importState(
      input({ backlog, exists: (p) => p === "docs/plans/x.md" }),
    );
    expect(state.nodes[0]!.docs.plan).toBe("docs/plans/x.md");
    expect(state.nodes[1]!.docs.plan).toBeNull();
  });

  it("still reads the register when one is present, ignoring a Backlog alongside it", () => {
    const { record, state } = importState(
      input({
        register: "- P1-N001 [done] Fine\n",
        backlog: "- [x] **Ignored** — not read.",
      }),
    );
    expect(record.source).toBe("register");
    expect(state.nodes.map((n) => n.title)).toEqual(["Fine"]);
  });

  it("refuses when neither a register nor a Backlog is given", () => {
    expect(() => importState(input())).toThrow(/neither/);
  });

  it("excludes a row that truly has no em-dash body, naming the reason, the heading and the counts", () => {
    const backlog = [
      "## Completed",
      "",
      "- [x] **Fine row** — this one is well-formed.",
      "- [ ] **Stray note** with nothing to separate a body from it.",
      "",
    ].join("\n");
    const { state, record } = importState(input({ backlog }));
    expect(state.nodes.map((n) => n.title)).toEqual(["Fine row"]);
    expect(record.backlogRows).toEqual({ read: 2, mapped: 1 });
    expect(record.backlogNotMapped).toEqual([
      {
        heading: "Completed",
        excerpt: "Stray note",
        reason: "the bolded lead has no em dash introducing a body",
      },
    ]);
  });

  it("maps every row to the identifier it received, in the record", () => {
    const backlog = [
      "## Completed",
      "",
      "- [x] **First** — one.",
      "- [x] **Second** — two.",
      "",
    ].join("\n");
    const { record } = importState(input({ backlog }));
    expect(record.backlogMapped).toEqual([
      { id: "P1-N001", title: "First" },
      { id: "P1-N002", title: "Second" },
    ]);
  });

  describe("over methodology-tools' real Backlog (fixture)", () => {
    const rows = parseBacklogRows(REAL_BACKLOG);
    const { state, record } = importState(
      input({
        project: "majodali/methodology-tools",
        backlog: REAL_BACKLOG,
        exists: (p) => p === "docs/plans/methodology-tools-v1.md",
      }),
    );

    it("reads all 21 rows, 4 of them open", () => {
      expect(rows.length).toBe(21);
      expect(rows.filter((r) => !r.checked).length).toBe(4);
    });

    it("maps every row, including the two whose lead is followed by an annotation before the em dash", () => {
      expect(state.nodes).toHaveLength(21);
      expect(record.backlogRows).toEqual({ read: 21, mapped: 21 });
      expect(record.backlogNotMapped).toEqual([]);
      expect(
        state.nodes.find(
          (n) => n.title === "Custom-type checker extension point",
        ),
      ).toMatchObject({
        stage: "identified",
        outcome:
          "proposals/custom-type-checker-extension.md: project-orchestrator asks that mtool audit form discover, run, and fold in a checker a defining project declares alongside its Article-7 custom type, so citation-defined types get the same mechanical checking as standard ones.",
      });
      expect(
        state.nodes.find(
          (n) => n.title === "W-008 bootstrap-cache drift check",
        ),
      ).toMatchObject({ stage: "done" });
    });

    it("keeps the heading a row stood under in the node's note", () => {
      const bootstrap = state.nodes.find((n) => n.title === "Bootstrap")!;
      expect(bootstrap.note).toBe("Completed");
      const stale = state.nodes.find(
        (n) =>
          n.title ===
          "Stale Workflow-format claims in tool output and comments",
      )!;
      expect(stale.note).toBe("Upcoming");
    });

    it("links the one row naming a plan document that exists", () => {
      const bootstrap = state.nodes.find((n) => n.title === "Bootstrap")!;
      expect(bootstrap.docs.plan).toBe("docs/plans/methodology-tools-v1.md");
      expect(state.nodes.filter((n) => n.docs.plan !== null)).toHaveLength(1);
    });

    it("mints identifiers in one plan line in Backlog order, one per row, and records the mapping", () => {
      expect(state.nodes[0]).toMatchObject({
        id: "P1-N001",
        title: "Bootstrap",
      });
      const ids = state.nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(
        ids
          .slice()
          .sort(
            (a, b) =>
              Number(a.slice(a.indexOf("N") + 1)) -
              Number(b.slice(b.indexOf("N") + 1)),
          ),
      );
      expect(record.backlogMapped).toEqual(
        state.nodes.map((n) => ({ id: n.id, title: n.title })),
      );
    });
  });
});
