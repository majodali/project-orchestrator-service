import { describe, expect, it } from "vitest";

import {
  checkStructural,
  checkTransition,
  isKnownStage,
} from "../src/planRegister/transitions.js";
import type { PlanNode } from "../src/planRegister/types.js";

/**
 * The node-lifecycle transition table (chunk 1 child D, node P2-N010,
 * I2 — "legality is not a second truth"): every documented forward
 * exit from docs/process/plan-model.md's lifecycle table, backward
 * moves, and the two illegal shapes (unknown stage, no-op).
 */

function node(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    id: "P9-N001",
    stage: "identified",
    hold: null,
    title: "Test node",
    annotation: null,
    links: [],
    parentId: null,
    childIds: [],
    line: 1,
    ...overrides,
  };
}

describe("checkTransition — the documented forward exits", () => {
  const FORWARD_CASES: Array<[string, string]> = [
    ["identified", "planned"],
    ["planned", "specified"],
    ["specified", "broken-down"],
    ["specified", "executing"],
    ["broken-down", "verifying"],
    ["executing", "verifying"],
    ["verifying", "done"],
  ];

  for (const [from, to] of FORWARD_CASES) {
    it(`[${from}] -> [${to}] is legal (forward)`, () => {
      expect(checkTransition(from, to)).toEqual({
        legal: true,
        direction: "forward",
      });
    });
  }
});

describe("checkTransition — backward moves", () => {
  it("done -> identified is legal (backward, MUST record a reason at the call site)", () => {
    expect(checkTransition("done", "identified")).toEqual({
      legal: true,
      direction: "backward",
    });
  });

  it("verifying -> specified is legal (backward)", () => {
    expect(checkTransition("verifying", "specified")).toEqual({
      legal: true,
      direction: "backward",
    });
  });

  it("executing -> planned is legal (backward)", () => {
    expect(checkTransition("executing", "planned")).toEqual({
      legal: true,
      direction: "backward",
    });
  });
});

describe("checkTransition — illegal shapes", () => {
  it("refuses a lateral hop between the two specified-exit branches", () => {
    const result = checkTransition("broken-down", "executing");
    expect(result.legal).toBe(false);
    if (!result.legal) {
      expect(result.reason).toContain("[broken-down] -> [executing]");
    }
  });

  it("refuses the reverse lateral hop too", () => {
    const result = checkTransition("executing", "broken-down");
    expect(result.legal).toBe(false);
  });

  it("refuses a same-stage no-op", () => {
    const result = checkTransition("planned", "planned");
    expect(result.legal).toBe(false);
    if (!result.legal) {
      expect(result.reason).toContain("already there");
    }
  });

  it("refuses a skip-ahead that is not the documented forward exit", () => {
    const result = checkTransition("identified", "specified");
    expect(result.legal).toBe(false);
  });

  it("refuses an unknown current stage, naming plan-model.md", () => {
    const result = checkTransition("verifiying", "planned");
    expect(result.legal).toBe(false);
    if (!result.legal) {
      expect(result.reason).toContain("[verifiying]");
      expect(result.reason).toContain("plan-model.md");
    }
  });

  it("refuses an unknown target stage", () => {
    const result = checkTransition("identified", "not-a-stage");
    expect(result.legal).toBe(false);
    if (!result.legal) {
      expect(result.reason).toContain("[not-a-stage]");
    }
  });
});

describe("isKnownStage", () => {
  it("accepts every published lifecycle stage", () => {
    for (const s of [
      "identified",
      "planned",
      "specified",
      "broken-down",
      "executing",
      "verifying",
      "done",
    ]) {
      expect(isKnownStage(s)).toBe(true);
    }
  });

  it("rejects the P2-N009 finding's misspelling", () => {
    expect(isKnownStage("verifiying")).toBe(false);
  });
});

describe("checkStructural — the register-structure invariant", () => {
  it("refuses moving a node with children to a leaf-only stage", () => {
    const n = node({ childIds: ["P9-N002"] });
    const result = checkStructural(n, "executing");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("child");
    }
  });

  it("allows a node with children to move to broken-down/verifying/done", () => {
    const n = node({ childIds: ["P9-N002"] });
    expect(checkStructural(n, "broken-down").ok).toBe(true);
    expect(checkStructural(n, "verifying").ok).toBe(true);
    expect(checkStructural(n, "done").ok).toBe(true);
  });

  it("refuses broken-down for a node with no children", () => {
    const n = node({ childIds: [] });
    const result = checkStructural(n, "broken-down");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("no children");
    }
  });

  it("allows a childless node to move to any non-broken-down stage", () => {
    const n = node({ childIds: [] });
    expect(checkStructural(n, "executing").ok).toBe(true);
    expect(checkStructural(n, "verifying").ok).toBe(true);
  });
});
