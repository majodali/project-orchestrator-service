import { describe, expect, it } from "vitest";

import { parseRegister } from "../src/planRegister/parser.js";
import {
  renderBacklog,
  renderPlan,
  renderRegister,
  treeOrder,
} from "../src/model/render.js";
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

  it("names a decision on a hidden check node, instead of throwing (P4-N050)", () => {
    const state: State = {
      ...sample,
      nodes: [
        ...sample.nodes,
        {
          id: "P1-N900",
          title: "Verification of the second part gated",
          outcome: null,
          stage: "specified",
          kind: "check",
          parent: "P1-N003",
          after: [],
          hold: null,
          docs: { plan: null, spec: null },
          done: null,
          note: null,
        },
      ],
      decisions: [
        ...sample.decisions,
        {
          id: "D900",
          node: "P1-N900",
          question: "Does the fix meet the criteria?",
          options: [],
          default: "yes",
          chosen: null,
          decided: null,
          rationale: null,
          standing: false,
          source: null,
        },
      ],
    };
    expect(() => renderPlan(state)).not.toThrow();
    expect(renderPlan(state)).toContain(
      "- D900 on Verification of the second part gated (P1-N900): Does the fix meet the criteria? Default: yes",
    );
  });

  it("names the identifier when a decision's node is not found at all, instead of throwing", () => {
    const state: State = {
      ...sample,
      decisions: [
        ...sample.decisions,
        {
          id: "D901",
          node: "P9-N999",
          question: "Orphaned?",
          options: [],
          default: "yes",
          chosen: null,
          decided: null,
          rationale: null,
          standing: false,
          source: null,
        },
      ],
    };
    expect(() => renderPlan(state)).not.toThrow();
    expect(renderPlan(state)).toContain(
      "- D901 on P9-N999: Orphaned? Default: yes",
    );
  });
});

describe("a node's repository (P2-N055)", () => {
  const withRepo: State = {
    ...sample,
    nodes: sample.nodes.map((n) =>
      n.id === "P1-N004"
        ? { ...n, repository: "majodali/project-orchestrator-service" }
        : n,
    ),
  };

  it("prints a node's repository in the plan when it differs from the project, and nothing when it does not", () => {
    const text = renderPlan(withRepo);
    expect(text).toContain(
      "The third part waits (P1-N004) [majodali/project-orchestrator-service] [identified] — after The second part gated (P1-N003)",
    );
    expect(text).toContain(
      "- **The third part waits** (P1-N004, identified) [majodali/project-orchestrator-service]",
    );
    // The node with no repository of its own carries no suffix.
    expect(text).toContain(
      "- **The second part gated** (P1-N003, planned, gated: owner review of the plan)",
    );
  });

  it("prints a node's repository in the Backlog when it differs from the project, and nothing when it does not", () => {
    const text = renderBacklog(withRepo);
    expect(text).toContain(
      "- [ ] **The third part waits** (P1-N004) [majodali/project-orchestrator-service] — When: after P1-N003.",
    );
    expect(text).toContain(
      "- [x] **The first part done** (P1-N002) — When: 2026-11-01.",
    );
  });
});

describe("renderBacklog", () => {
  it("writes one row per work node: done rows checked under Completed, the rest under Upcoming", () => {
    const text = renderBacklog(sample);
    expect(text).toContain("Generated from `orchestration/state.json`");
    expect(text.indexOf("## Completed")).toBeLessThan(
      text.indexOf("## Upcoming"),
    );
    const completed = text.slice(
      text.indexOf("## Completed"),
      text.indexOf("## Upcoming"),
    );
    expect(completed).toContain(
      "- [x] **The first part done** (P1-N002) — When: 2026-11-01. Status: done. Pointer: [spec](specs/first.md).",
    );
    expect(completed).not.toContain("- [ ]");
    const upcoming = text.slice(text.indexOf("## Upcoming"));
    expect(upcoming).toContain(
      "- [ ] **The root of the plan** (P1-N001) — When: not dated. Status: broken-down, in progress, its children carry the work. Pointer: [plan](plans/root.md).",
    );
    expect(upcoming).toContain(
      "- [ ] **The second part gated** (P1-N003) — When: not dated. Status: planned, waiting on the owner. Pointer: `orchestration/state.json`.",
    );
    expect(upcoming).toContain(
      "- [ ] **The third part waits** (P1-N004) — When: after P1-N003. Status: identified, waiting on a dependency. Pointer: `orchestration/state.json`.",
    );
    expect(text.match(/^- \[[ x]\] /gm)).toHaveLength(4);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("leaves check nodes out and states an empty section", () => {
    const text = renderBacklog({
      ...sample,
      nodes: [
        { ...sample.nodes[1]!, parent: null },
        {
          ...sample.nodes[1]!,
          id: "P1-N005",
          kind: "check",
          title: "Verification of the first part done",
          parent: "P1-N002",
        },
      ],
      decisions: [],
    });
    expect(text).not.toContain("P1-N005");
    expect(text).toContain("## Upcoming\n\nNone.\n");
  });
});
