import { describe, expect, it } from "vitest";

import { parseRegister } from "../src/planRegister/parser.js";
import { renderPlan, renderRegister, treeOrder } from "../src/model/render.js";
import type { State } from "../src/model/schema.js";

const sample: State = {
  schema: 0,
  project: "majodali/example",
  nodes: [
    {
      id: "P1-N001",
      title: "The root of the plan",
      outcome: "Everything below exists.",
      stage: "broken-down",
      parent: null,
      after: [],
      hold: null,
      docs: { plan: "docs/plans/root.md", spec: null },
      done: null,
      note: "Chunk 1 of the parent plan",
    },
    {
      id: "P1-N002",
      title: "The first part done",
      outcome: "The first part works.",
      stage: "done",
      parent: "P1-N001",
      after: [],
      hold: null,
      docs: { plan: null, spec: "docs/specs/first.md" },
      done: "2026-11-01",
      note: null,
    },
    {
      id: "P1-N003",
      title: "The second part gated",
      outcome: "The second part works.",
      stage: "planned",
      parent: "P1-N001",
      after: ["P1-N002"],
      hold: { kind: "gated", reason: "owner review of the plan" },
      docs: { plan: null, spec: null },
      done: null,
      note: null,
    },
    {
      id: "P1-N004",
      title: "The third part waits",
      outcome: null,
      stage: "identified",
      parent: "P1-N001",
      after: ["P1-N003"],
      hold: null,
      docs: { plan: null, spec: null },
      done: null,
      note: null,
    },
  ],
  tasks: [],
  decisions: [
    {
      id: "D001",
      node: "P1-N003",
      question: "Which colour?",
      options: ["red", "blue"],
      default: "red",
      chosen: null,
      decided: null,
      rationale: null,
      standing: false,
      source: "docs/plans/root.md, decision 1",
    },
    {
      id: "RU-001",
      node: null,
      question: "Does a sketch suffice?",
      options: [],
      default: null,
      chosen: "yes",
      decided: "2026-08-26",
      rationale: "the contract is under discussion",
      standing: true,
      source: "docs/rulings.md, RU-001",
    },
  ],
};

describe("renderRegister", () => {
  it("writes the Plan register grammar the vendored parser reads back", () => {
    const text = renderRegister(sample);
    const parsed = parseRegister(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.order).toEqual(["P1-N001", "P1-N002", "P1-N003", "P1-N004"]);
    expect(parsed.nodes.get("P1-N003")!.hold).toEqual({
      kind: "gated",
      reason: "owner review of the plan",
    });
    expect(parsed.nodes.get("P1-N001")!.links).toEqual([
      { label: "plan", target: "plans/root.md" },
    ]);
    expect(parsed.nodes.get("P1-N002")!.parentId).toBe("P1-N001");
    expect(text).toContain("Generated from `orchestration/state.json`");
  });

  it("orders children under their parents in array order", () => {
    expect(treeOrder(sample).map((t) => `${t.depth}:${t.node.id}`)).toEqual([
      "0:P1-N001",
      "1:P1-N002",
      "1:P1-N003",
      "1:P1-N004",
    ]);
  });
});

describe("renderPlan", () => {
  it("leads with what waits on the owner, then the ready, waiting and blocked nodes, then the plan", () => {
    const text = renderPlan(sample);
    const at = (s: string): number => {
      const i = text.indexOf(s);
      expect(i, s).toBeGreaterThanOrEqual(0);
      return i;
    };
    expect(at("## Waiting on the owner")).toBeLessThan(
      at("## Ready, starting automatically when the loop runs"),
    );
    expect(text).toContain(
      "- D001 on The second part gated (P1-N003): Which colour? Default: red",
    );
    expect(text).toContain(
      "- The second part gated (P1-N003): owner review of the plan",
    );
    expect(text).toContain(
      "- The third part waits (P1-N004) [identified] — after The second part gated (P1-N003)",
    );
    expect(text).toContain(
      "- **The second part gated** (P1-N003, planned, gated: owner review of the plan)",
    );
    expect(text).toContain("1 open decision");
    expect(text).toContain(
      "- RU-001 (2026-08-26, standing): Does a sketch suffice? Chosen: yes",
    );
    expect(text).toContain("Note: Chunk 1 of the parent plan");
  });

  it("states emptiness instead of dropping a section", () => {
    const empty: State = {
      ...sample,
      nodes: sample.nodes
        .filter((n) => n.stage === "done")
        .map((n) => ({ ...n, parent: null })),
      decisions: [],
    };
    const text = renderPlan(empty);
    expect(text).toContain("## Waiting on the owner\n\nNothing.");
    expect(text).toContain(
      "## Ready, starting automatically when the loop runs\n\nNone.",
    );
    expect(text).toContain("## Decisions taken\n\nNone.");
  });
});
