import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { checkState } from "../src/model/check.js";
import {
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

    it("maps a row only under the K-004 shape, excluding one whose lead is not followed directly by an em dash", () => {
      expect(
        state.nodes.some(
          (n) => n.title === "Custom-type checker extension point",
        ),
      ).toBe(false);
      expect(record.backlogNotMapped).toContainEqual({
        heading: "Completed",
        excerpt: "Custom-type checker extension point",
        reason: "the bolded lead is not followed directly by an em dash",
      });
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

    it("mints identifiers in one plan line in Backlog order, one per mapped row", () => {
      expect(state.nodes).toHaveLength(19);
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
    });
  });
});
