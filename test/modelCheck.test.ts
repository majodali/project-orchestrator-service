import { describe, expect, it } from "vitest";

import {
  attentionReason,
  checkRepository,
  checkState,
  classifyAll,
  type Finding,
} from "../src/model/check.js";
import { renderPlan, renderRegister } from "../src/model/render.js";
import { formatState, type Node, type State } from "../src/model/schema.js";

function node(
  partial: Partial<Node> & Pick<Node, "id" | "title" | "stage">,
): Node {
  return {
    outcome: "The thing exists and works.",
    parent: null,
    after: [],
    hold: null,
    start: "auto",
    docs: { plan: null, spec: null },
    done: null,
    note: null,
    ...partial,
  };
}

function state(partial: Partial<State> = {}): State {
  return {
    schema: 0,
    project: "majodali/example",
    nodes: [
      node({
        id: "P1-N001",
        title: "The root of the plan",
        stage: "broken-down",
      }),
      node({
        id: "P1-N002",
        title: "The first part done",
        stage: "done",
        parent: "P1-N001",
        done: "2026-11-01",
      }),
      node({
        id: "P1-N003",
        title: "The second part ready",
        stage: "specified",
        parent: "P1-N001",
      }),
      node({
        id: "P1-N004",
        title: "The third part waits",
        stage: "identified",
        parent: "P1-N001",
        after: ["P1-N003"],
        outcome: null,
      }),
    ],
    tasks: [],
    decisions: [],
    ...partial,
  };
}

function messages(
  findings: Finding[],
  severity?: Finding["severity"],
): string[] {
  return findings
    .filter((f) => !severity || f.severity === severity)
    .map((f) => `${f.invariant} ${f.subject ?? "-"} ${f.message}`);
}

describe("checkState", () => {
  it("accepts a well-formed state", () => {
    const { findings } = checkState(state());
    expect(findings).toEqual([]);
  });

  it("reports schema failures as invariant 1 with the path", () => {
    const bad = { ...state(), nodes: [{ id: "nope" }] };
    const { state: parsed, findings } = checkState(bad);
    expect(parsed).toBeNull();
    expect(findings.every((f) => f.invariant === 1)).toBe(true);
    expect(messages(findings).some((m) => m.includes("nodes.0.id"))).toBe(true);
  });

  it("rejects an unknown stage", () => {
    const bad = JSON.parse(JSON.stringify(state())) as {
      nodes: Array<{ stage: string }>;
    };
    bad.nodes[0]!.stage = "executing-ish";
    expect(checkState(bad).state).toBeNull();
  });

  it("finds duplicate identifiers, missing parents and cycles", () => {
    const s = state();
    s.nodes.push(
      node({
        id: "P1-N002",
        title: "A duplicate of the first",
        stage: "identified",
        outcome: null,
      }),
    );
    s.nodes[2]!.after = ["P1-N004"]; // 3 -> 4 -> 3
    s.nodes[1]!.parent = "P9-N999";
    const found = messages(checkState(s).findings, "violation");
    expect(found).toContainEqual(
      expect.stringContaining("duplicate node identifier P1-N002"),
    );
    expect(found).toContainEqual(
      expect.stringContaining("parent P9-N999 is not a node"),
    );
    expect(found).toContainEqual(expect.stringContaining("dependency cycle"));
  });

  it("requires an interior stage on a node with children, and a specified parent for a child past identified", () => {
    const s = state();
    s.nodes[0]!.stage = "planned";
    const found = messages(checkState(s).findings, "violation");
    expect(found).toContainEqual(
      expect.stringContaining(
        "3 P1-N001 has 3 child node(s) but stage is planned",
      ),
    );
    expect(found).toContainEqual(
      expect.stringContaining(
        "3 P1-N002 is done under parent P1-N001, which is planned",
      ),
    );
  });

  it("requires a title of three words and an outcome from planned on, within the bound", () => {
    const s = state();
    s.nodes[2]!.title = "Child C";
    s.nodes[2]!.outcome = null;
    s.nodes[1]!.outcome = Array.from({ length: 41 }, () => "word").join(" ");
    const found = messages(checkState(s).findings, "violation");
    expect(found).toContainEqual(
      expect.stringContaining("4 P1-N003 title has 2 word(s)"),
    );
    expect(found).toContainEqual(
      expect.stringContaining('4 P1-N003 title "Child C" is an identifier'),
    );
    expect(found).toContainEqual(
      expect.stringContaining(
        "4 P1-N003 is specified and has no outcome sentence",
      ),
    );
    expect(found).toContainEqual(
      expect.stringContaining("4 P1-N002 outcome has 41 words"),
    );
  });

  it("does not require an outcome of an identified or parked node", () => {
    const s = state();
    s.nodes.push(
      node({
        id: "P1-N005",
        title: "A parked idea for later",
        stage: "parked",
        parent: "P1-N001",
        outcome: null,
      }),
    );
    expect(messages(checkState(s).findings, "violation")).toEqual([]);
  });

  it("classifies every node once, by precedence", () => {
    const s = state();
    s.nodes.push(
      node({
        id: "P1-N005",
        title: "A gated part waiting",
        stage: "planned",
        parent: "P1-N001",
        hold: { kind: "gated", reason: "owner review" },
      }),
      node({
        id: "P1-N006",
        title: "A blocked part waiting",
        stage: "planned",
        parent: "P1-N001",
        hold: { kind: "blocked", reason: "no credential" },
      }),
    );
    s.tasks.push({
      id: "T001",
      node: "P1-N003",
      step: "execute",
      status: "open",
      role: null,
      model: null,
      tokens: { in: null, out: null },
      opened: "2026-11-09T10:00:00Z",
      closed: null,
      ref: null,
      pr: null,
      summary: null,
      notes: null,
    });
    const classes = classifyAll(s);
    expect(classes.get("P1-N001")).toBe("in-progress");
    expect(classes.get("P1-N002")).toBe("done");
    expect(classes.get("P1-N003")).toBe("in-flight");
    expect(classes.get("P1-N004")).toBe("waiting");
    expect(classes.get("P1-N005")).toBe("gated");
    expect(classes.get("P1-N006")).toBe("blocked");
    expect(messages(checkState(s).findings, "violation")).toEqual([]);
  });

  it("classifies a ready node whose start needs approval as waiting on the owner", () => {
    const s = state();
    s.nodes[2]!.start = "approve";
    expect(classifyAll(s).get("P1-N003")).toBe("gated");
    expect(attentionReason(s.nodes[2]!)).toBe(
      "start needs the owner's approval",
    );
    s.nodes[2]!.hold = { kind: "gated", reason: "the plan gate" };
    expect(attentionReason(s.nodes[2]!)).toBe("the plan gate");
  });

  it("warns when a hold and an open task compete for a node's class", () => {
    const s = state();
    s.nodes[2]!.hold = { kind: "gated", reason: "review" };
    s.tasks.push({
      id: "T001",
      node: "P1-N003",
      step: "execute",
      status: "open",
      role: null,
      model: null,
      tokens: { in: null, out: null },
      opened: null,
      closed: null,
      ref: null,
      pr: null,
      summary: null,
      notes: null,
    });
    const warnings = messages(checkState(s).findings, "warning");
    expect(warnings).toContainEqual(
      expect.stringContaining("5 P1-N003 is gated and has an open task (T001)"),
    );
  });

  it("checks tasks: node exists, one open per node, closing times, summary bound", () => {
    const s = state();
    const base = {
      step: "execute" as const,
      role: null,
      model: null,
      tokens: { in: null, out: null },
      opened: "2026-11-09T10:00:00Z",
      ref: null,
      pr: null,
      summary: null,
      notes: null,
    };
    s.tasks.push(
      { ...base, id: "T001", node: "P1-N003", status: "open", closed: null },
      { ...base, id: "T002", node: "P1-N003", status: "open", closed: null },
      { ...base, id: "T003", node: "P9-N001", status: "closed", closed: null },
      {
        ...base,
        id: "T004",
        node: "P1-N002",
        status: "closed",
        closed: "2026-11-09T09:00:00Z",
        summary: Array.from({ length: 61 }, () => "w").join(" "),
      },
    );
    const found = messages(checkState(s).findings, "violation");
    expect(found).toContainEqual(
      expect.stringContaining("6 P1-N003 has 2 open tasks (T001, T002)"),
    );
    expect(found).toContainEqual(
      expect.stringContaining("6 T003 node P9-N001 is not a node"),
    );
    expect(found).toContainEqual(
      expect.stringContaining("6 T003 is closed and has no closing time"),
    );
    expect(found).toContainEqual(
      expect.stringContaining(
        "6 T004 closed (2026-11-09T09:00:00Z) before opened",
      ),
    );
    expect(found).toContainEqual(
      expect.stringContaining("6 T004 summary has 61 words"),
    );
  });

  it("checks decisions: a default when open, a date when closed, a real node", () => {
    const s = state();
    const base = {
      options: [],
      rationale: null,
      standing: false,
      source: null,
    };
    s.decisions.push(
      {
        ...base,
        id: "D001",
        node: null,
        question: "Open with no default?",
        default: null,
        chosen: null,
        decided: null,
      },
      {
        ...base,
        id: "D002",
        node: "P9-N001",
        question: "Closed with no date?",
        default: "yes",
        chosen: "yes",
        decided: null,
      },
      {
        ...base,
        id: "D003",
        node: "P1-N003",
        question: "Open with a date?",
        default: "yes",
        chosen: null,
        decided: "2026-11-09",
      },
    );
    const found = messages(checkState(s).findings, "violation");
    expect(found).toContainEqual(
      expect.stringContaining("7 D001 is open and has no default"),
    );
    expect(found).toContainEqual(
      expect.stringContaining("7 D002 node P9-N001 is not a node"),
    );
    expect(found).toContainEqual(
      expect.stringContaining("7 D002 is closed and has no decision date"),
    );
    expect(found).toContainEqual(
      expect.stringContaining("7 D003 is open and carries a decision date"),
    );
  });
});

describe("checkRepository", () => {
  it("reports a missing document and a stale rendering", () => {
    const s = state();
    s.nodes[0]!.docs.plan = "docs/plans/missing.md";
    const files = new Map<string, string>([
      ["docs/plan-register.md", "stale"],
      ["docs/plan.md", renderPlan(s)],
    ]);
    const findings = checkRepository(
      s,
      "/nonexistent",
      (p) => files.get(p) ?? null,
    );
    const found = messages(findings);
    expect(found).toContainEqual(
      expect.stringContaining(
        "8 P1-N001 plan document docs/plans/missing.md does not exist",
      ),
    );
    expect(found).toContainEqual(
      expect.stringContaining(
        "9 - docs/plan-register.md differs from the rendering",
      ),
    );
    expect(found.some((m) => m.includes("docs/plan.md"))).toBe(false);
  });

  it("is clean when both renderings are current", () => {
    const s = state();
    const files = new Map<string, string>([
      ["docs/plan-register.md", renderRegister(s)],
      ["docs/plan.md", renderPlan(s)],
    ]);
    expect(
      checkRepository(s, "/nonexistent", (p) => files.get(p) ?? null),
    ).toEqual([]);
  });
});

describe("formatState", () => {
  it("round-trips through JSON in the canonical format", () => {
    const s = state();
    expect(JSON.parse(formatState(s))).toEqual(s);
    expect(formatState(s).endsWith("\n")).toBe(true);
  });
});
