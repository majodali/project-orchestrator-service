import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseRegister, subtreeIds } from "../src/planRegister/parser.js";

/**
 * Parser tests for `plan_read` (chunk 1 child C, node P2-N009).
 *
 * `test/fixtures/plan-register.sample.md` is a byte-for-byte copy of
 * the coordinating repository's (majodali/project-orchestrator) real
 * `docs/plan-register.md`, taken at the time this node was
 * implemented (confirmed identical with `diff` at commit time — see
 * this node's task result). It is copied in rather than read across
 * the repository boundary at test time so this suite is self-
 * contained: `npm test` in a fresh clone of *this* repository alone
 * must not depend on the coordinating repository being checked out
 * next to it. It can drift from the live register over time; that is
 * a known limitation (see the task result's Backlog additions), not a
 * defect of this test.
 *
 * The round-trip claim itself was cross-checked against
 * majodali/project-orchestrator's plugin/scripts/form_check.py
 * (`NODE_RE`/`NODEISH_RE`, the existing working parser of the same
 * grammar) on the real register: `python3 plugin/scripts/form_check.py`
 * reports "19 nodes, 0 violation(s)" there, matching this parser's
 * node count and error count on the identical text below.
 */

const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/plan-register.sample.md", import.meta.url),
);
const REAL_REGISTER = readFileSync(FIXTURE_PATH, "utf-8");

describe("parseRegister — the real register (round-trip)", () => {
  const result = parseRegister(REAL_REGISTER);

  it("parses every node in the fixture, with no parse errors", () => {
    // 8 P1 nodes + 11 P2 nodes, matching form_check.py's independent
    // count on the identical text (see file-header note above).
    expect(result.order).toHaveLength(19);
    expect(result.errors).toEqual([]);
  });

  it("preserves every node ID with its stage", () => {
    const stageById = Object.fromEntries(
      result.order.map((id) => [id, result.nodes.get(id)!.stage]),
    );
    expect(stageById).toEqual({
      "P1-N001": "broken-down",
      "P1-N002": "done",
      "P1-N003": "done",
      "P1-N004": "done",
      "P1-N005": "done",
      "P1-N008": "done",
      "P1-N006": "identified",
      "P1-N007": "identified",
      "P2-N001": "broken-down",
      "P2-N002": "broken-down",
      "P2-N007": "done",
      "P2-N008": "done",
      "P2-N009": "identified",
      "P2-N010": "identified",
      "P2-N011": "identified",
      "P2-N003": "identified",
      "P2-N004": "identified",
      "P2-N005": "identified",
      "P2-N006": "identified",
    });
  });

  it("carries no hold markers in the current real register", () => {
    for (const id of result.order) {
      expect(result.nodes.get(id)!.hold).toBeNull();
    }
  });

  it("has exactly the two top-level roots, in document order", () => {
    expect(result.rootIds).toEqual(["P1-N001", "P2-N001"]);
  });

  it("builds the three-level P2 hierarchy from list nesting", () => {
    const p2n001 = result.nodes.get("P2-N001")!;
    expect(p2n001.parentId).toBeNull();
    expect(p2n001.childIds).toEqual([
      "P2-N002",
      "P2-N003",
      "P2-N004",
      "P2-N005",
      "P2-N006",
    ]);

    const p2n002 = result.nodes.get("P2-N002")!;
    expect(p2n002.parentId).toBe("P2-N001");
    expect(p2n002.childIds).toEqual([
      "P2-N007",
      "P2-N008",
      "P2-N009",
      "P2-N010",
      "P2-N011",
    ]);

    const p2n009 = result.nodes.get("P2-N009")!;
    expect(p2n009.parentId).toBe("P2-N002");
    expect(p2n009.childIds).toEqual([]);
    expect(p2n009.title).toBe("Plan-state read");
  });

  it("parses plan/spec links (label: target, · separated)", () => {
    expect(result.nodes.get("P1-N001")!.links).toEqual([
      { label: "plan", target: "plans/orchestrator-v1.md" },
    ]);
    expect(result.nodes.get("P1-N008")!.links).toEqual([
      {
        label: "plan",
        target: "plans/p1-n008-mtool-checker-extension-point.md",
      },
      {
        label: "spec",
        target: "specs/p1-n008-mtool-checker-extension-point.md",
      },
    ]);
    expect(result.nodes.get("P2-N002")!.links).toEqual([
      { label: "plan", target: "plans/p2-n002-service-skeleton.md" },
      { label: "spec", target: "specs/p2-n002-service-skeleton.md" },
    ]);
  });

  it("preserves a non-link annotation verbatim without inventing a link for it", () => {
    const p1n006 = result.nodes.get("P1-N006")!;
    expect(p1n006.title).toBe("Pilot on a real project (chunk 5)");
    expect(p1n006.annotation).toBe(
      "superseded in place by P2-N001 chunk 5; kept until the founding plan closes out",
    );
    expect(p1n006.links).toEqual([]);
  });

  it("has no annotation for a node with no em dash at all", () => {
    const p1n002 = result.nodes.get("P1-N002")!;
    expect(p1n002.title).toBe("Bootstrap and founding plan (chunk 1)");
    expect(p1n002.annotation).toBeNull();
    expect(p1n002.links).toEqual([]);
  });
});

describe("parseRegister — malformed input is reported, never dropped silently", () => {
  it("reports a node-like line that fails to parse, naming the line number and text", () => {
    const text = [
      "- P1-N001 [broken-down] Fine node",
      "  - P1-N002 [executing missing-close-bracket bad line",
      "  - P1-N003 [done] Also fine",
    ].join("\n");

    const result = parseRegister(text);

    expect(result.order).toEqual(["P1-N001", "P1-N003"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      line: 2,
      raw: "  - P1-N002 [executing missing-close-bracket bad line",
    });
    expect(result.errors[0]!.reason).toContain("does not match");
  });

  it("reports a bracketed-but-not-a-node-ID line as malformed rather than ignoring it", () => {
    const text = "- Something odd [identified] that is not a real node ID";
    const result = parseRegister(text);

    expect(result.order).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(1);
  });

  it("does not report ordinary prose bullets that never claimed to be a node", () => {
    const text = [
      "# Plan register",
      "",
      "Some prose about the register.",
      "- a plain bullet with no brackets at all",
      "- P1-N001 [identified] A real node",
    ].join("\n");

    const result = parseRegister(text);

    expect(result.order).toEqual(["P1-N001"]);
    expect(result.errors).toEqual([]);
  });

  it("reports a duplicate node ID and keeps the first occurrence", () => {
    const text = [
      "- P1-N001 [identified] First",
      "- P1-N001 [done] Second, same ID",
    ].join("\n");

    const result = parseRegister(text);

    expect(result.order).toEqual(["P1-N001"]);
    expect(result.nodes.get("P1-N001")!.stage).toBe("identified");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.reason).toContain("duplicate node ID P1-N001");
    expect(result.errors[0]!.line).toBe(2);
  });

  it("parses a gated hold marker", () => {
    const result = parseRegister(
      "- P1-N001 [executing] [gated: owner review] Held node",
    );
    expect(result.nodes.get("P1-N001")!.hold).toEqual({
      kind: "gated",
      reason: "owner review",
    });
  });

  it("parses a blocked hold marker", () => {
    const result = parseRegister(
      "- P1-N001 [executing] [blocked: waiting on O3] Held node",
    );
    expect(result.nodes.get("P1-N001")!.hold).toEqual({
      kind: "blocked",
      reason: "waiting on O3",
    });
  });
});

describe("subtreeIds", () => {
  const result = parseRegister(REAL_REGISTER);

  it("returns exactly that node and its descendants for an interior node", () => {
    expect(subtreeIds(result, "P2-N002")).toEqual([
      "P2-N002",
      "P2-N007",
      "P2-N008",
      "P2-N009",
      "P2-N010",
      "P2-N011",
    ]);
  });

  it("returns just the node itself for a leaf", () => {
    expect(subtreeIds(result, "P2-N009")).toEqual(["P2-N009"]);
  });

  it("returns null, not an empty array, for an unknown ID", () => {
    expect(subtreeIds(result, "P9-N999")).toBeNull();
  });

  it("never includes ancestors or siblings", () => {
    const ids = subtreeIds(result, "P2-N002")!;
    expect(ids).not.toContain("P2-N001"); // ancestor
    expect(ids).not.toContain("P2-N003"); // sibling
  });
});
