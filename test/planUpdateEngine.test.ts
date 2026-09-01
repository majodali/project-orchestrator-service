import { describe, expect, it } from "vitest";

import {
  checkConfirmed,
  computeEditLine,
  planTransitionEdit,
} from "../src/planRegister/updateEngine.js";

/**
 * `plan_update`'s edit computation and `plan_confirm`'s divergence
 * check (chunk 1 child D, node P2-N010) — pure, register-text-in
 * tests, no git or lease involved. `planUpdateGitExercise.test.ts`
 * exercises I1/I3 operationally, against real git commits; these
 * tests are the fast, exhaustive unit layer underneath that.
 */

const REGISTER = [
  "- P1-N001 [broken-down] Root — plan: plans/root.md",
  "  - P1-N002 [identified] A leaf due for planning",
  "  - P1-N003 [specified] [gated: owner] A gated leaf",
  "  - P1-N004 [broken-down] An interior node",
  "    - P1-N005 [done] Its only child",
].join("\n");

describe("computeEditLine", () => {
  it("replaces only the stage bracket, leaving indentation, id, and title untouched", () => {
    const line = "  - P1-N002 [identified] A leaf due for planning";
    const computed = computeEditLine(line, "P1-N002", "identified");
    expect(computed.ok).toBe(true);
    if (computed.ok) {
      expect(computed.newLine("planned")).toBe(
        "  - P1-N002 [planned] A leaf due for planning",
      );
    }
  });

  it("leaves a hold marker bracket untouched", () => {
    const line = "  - P1-N003 [specified] [gated: owner] A gated leaf";
    const computed = computeEditLine(line, "P1-N003", "specified");
    expect(computed.ok).toBe(true);
    if (computed.ok) {
      expect(computed.newLine("executing")).toBe(
        "  - P1-N003 [executing] [gated: owner] A gated leaf",
      );
    }
  });

  it("is not confused by a title that repeats the stage word", () => {
    // The bracket is located via the "<id> [" marker, not by
    // searching for the stage text, so a title containing "planned"
    // must not be touched.
    const line = "  - P1-N002 [identified] A carefully planned leaf";
    const computed = computeEditLine(line, "P1-N002", "identified");
    expect(computed.ok).toBe(true);
    if (computed.ok) {
      expect(computed.newLine("planned")).toBe(
        "  - P1-N002 [planned] A carefully planned leaf",
      );
    }
  });
});

describe("planTransitionEdit", () => {
  it("computes the exact edit for a legal transition", () => {
    const plan = planTransitionEdit(REGISTER, "P1-N002", "planned");
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.fromStage).toBe("identified");
      expect(plan.toStage).toBe("planned");
      expect(plan.edit).toEqual({
        file: "docs/plan-register.md",
        line: 2,
        oldLine: "  - P1-N002 [identified] A leaf due for planning",
        newLine: "  - P1-N002 [planned] A leaf due for planning",
      });
    }
  });

  it("refuses an unknown node", () => {
    const plan = planTransitionEdit(REGISTER, "P9-N999", "planned");
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toContain("P9-N999");
    }
  });

  it("refuses an illegal transition, citing the lifecycle table", () => {
    const plan = planTransitionEdit(REGISTER, "P1-N002", "done");
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toContain("[identified] -> [done]");
    }
  });

  it("refuses moving an interior node with children to a leaf-only stage (illegal in the lifecycle table too, checked first)", () => {
    const plan = planTransitionEdit(REGISTER, "P1-N004", "executing");
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toContain("[broken-down] -> [executing]");
    }
  });

  it("refuses a table-legal backward move that would violate register-structure", () => {
    // broken-down -> planned is a legal *backward* move by the
    // lifecycle table alone, but P1-N004 has a child, and "planned"
    // is not in the register-structure INTERIOR_OK set — the
    // structural check catches what the table check alone would not.
    const plan = planTransitionEdit(REGISTER, "P1-N004", "planned");
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toContain("child");
    }
  });

  it("allows the same interior node forward within its own branch", () => {
    const plan = planTransitionEdit(REGISTER, "P1-N004", "verifying");
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.edit.newLine).toBe(
        "  - P1-N004 [verifying] An interior node",
      );
    }
  });
});

describe("checkConfirmed — the I3/R10 divergence check", () => {
  it("succeeds when the confirmed content shows the node at the expected stage", () => {
    const AFTER = REGISTER.replace(
      "- P1-N002 [identified] A leaf due for planning",
      "- P1-N002 [planned] A leaf due for planning",
    );
    const result = checkConfirmed(AFTER, "P1-N002", "planned");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.line).toBe(2);
      expect(result.actualLine).toContain("[planned]");
    }
  });

  it("reports a divergence naming the file and the line when the edit never landed", () => {
    // AFTER == REGISTER: the confirmed commit never actually carries
    // the edit — exactly the deliberately induced mismatch I3 asks for.
    const result = checkConfirmed(REGISTER, "P1-N002", "planned");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("docs/plan-register.md");
      expect(result.reason).toContain("line 2");
      expect(result.reason).toContain("[identified]");
      expect(result.reason).toContain("[planned]");
      expect(result.line).toBe(2);
      expect(result.actualLine).toContain("[identified]");
    }
  });

  it("reports a divergence when the node has disappeared from the confirmed content entirely", () => {
    const WITHOUT_NODE = REGISTER.split("\n")
      .filter((l) => !l.includes("P1-N002"))
      .join("\n");
    const result = checkConfirmed(WITHOUT_NODE, "P1-N002", "planned");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("docs/plan-register.md");
      expect(result.reason).toContain("P1-N002");
    }
  });
});
