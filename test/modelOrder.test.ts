import { describe, expect, it } from "vitest";

import { checkState } from "../src/model/check.js";
import { isOrdered, orderSiblingsByDependency } from "../src/model/order.js";
import type { Node, State } from "../src/model/schema.js";

function node(
  partial: Partial<Node> & Pick<Node, "id" | "title" | "stage">,
): Node {
  return {
    outcome: "It exists.",
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

function state(nodes: Node[]): State {
  return {
    schema: 0,
    project: "majodali/example",
    nodes,
    tasks: [],
    decisions: [],
  };
}

describe("orderSiblingsByDependency", () => {
  it("moves a sibling after the siblings it waits for, and leaves the rest in place", () => {
    const s = state([
      node({
        id: "P1-N001",
        title: "The root of the plan",
        stage: "broken-down",
      }),
      node({
        id: "P1-N002",
        title: "The queue that waits",
        stage: "identified",
        parent: "P1-N001",
        after: ["P1-N004"],
        outcome: null,
      }),
      node({
        id: "P1-N003",
        title: "The quiet middle one",
        stage: "identified",
        parent: "P1-N001",
        outcome: null,
      }),
      node({
        id: "P1-N004",
        title: "The loop it waits for",
        stage: "identified",
        parent: "P1-N001",
        outcome: null,
      }),
      node({
        id: "P1-N005",
        title: "A child of the loop",
        stage: "identified",
        parent: "P1-N004",
        outcome: null,
      }),
    ]);
    expect(isOrdered(s)).toBe(false);
    const ids = orderSiblingsByDependency(s).map((n) => n.id);
    expect(ids).toEqual([
      "P1-N001",
      "P1-N003",
      "P1-N004",
      "P1-N005",
      "P1-N002",
    ]);
    expect(isOrdered(state(orderSiblingsByDependency(s)))).toBe(true);
  });

  it("lifts a child's dependency on an uncle to the parents' order", () => {
    const s = state([
      node({ id: "P2-N001", title: "The service line", stage: "broken-down" }),
      node({
        id: "P2-N003",
        title: "Owner questions and the plan view",
        stage: "broken-down",
        parent: "P2-N001",
      }),
      node({
        id: "P2-N022",
        title: "Owner question queue",
        stage: "identified",
        parent: "P2-N003",
        after: ["P2-N005"],
        outcome: null,
      }),
      node({
        id: "P2-N005",
        title: "Task pull loop",
        stage: "broken-down",
        parent: "P2-N001",
      }),
      node({
        id: "P2-N017",
        title: "Platform capability checks",
        stage: "identified",
        parent: "P2-N005",
        outcome: null,
      }),
    ]);
    expect(orderSiblingsByDependency(s).map((n) => n.id)).toEqual([
      "P2-N001",
      "P2-N005",
      "P2-N017",
      "P2-N003",
      "P2-N022",
    ]);
  });

  it("lifts a dependency on another line to the roots and keeps a cyclic group in file order", () => {
    const s = state([
      node({ id: "P1-N001", title: "The first root", stage: "broken-down" }),
      node({
        id: "P1-N002",
        title: "Waits on another line",
        stage: "identified",
        parent: "P1-N001",
        after: ["P2-N001"],
        outcome: null,
      }),
      node({
        id: "P1-N003",
        title: "Cycle one",
        stage: "identified",
        parent: "P1-N001",
        after: ["P1-N004"],
        outcome: null,
      }),
      node({
        id: "P1-N004",
        title: "Cycle two",
        stage: "identified",
        parent: "P1-N001",
        after: ["P1-N003"],
        outcome: null,
      }),
      node({
        id: "P2-N001",
        title: "The second root",
        stage: "identified",
        outcome: null,
      }),
    ]);
    // The dependency on the other line lifts to the roots: P2-N001
    // comes first. The cyclic pair keeps its order.
    expect(orderSiblingsByDependency(s).map((n) => n.id)).toEqual([
      "P2-N001",
      "P1-N001",
      "P1-N002",
      "P1-N003",
      "P1-N004",
    ]);
  });

  it("is invariant 10 of check", () => {
    const s = state([
      node({
        id: "P1-N001",
        title: "The root of the plan",
        stage: "broken-down",
      }),
      node({
        id: "P1-N002",
        title: "The queue that waits",
        stage: "identified",
        parent: "P1-N001",
        after: ["P1-N003"],
        outcome: null,
      }),
      node({
        id: "P1-N003",
        title: "The loop it waits for",
        stage: "identified",
        parent: "P1-N001",
        outcome: null,
      }),
    ]);
    const { findings } = checkState(s);
    expect(findings).toEqual([
      expect.objectContaining({
        invariant: 10,
        severity: "violation",
        subject: "P1-N003",
      }),
    ]);
    expect(checkState(state(orderSiblingsByDependency(s))).findings).toEqual(
      [],
    );
  });
});

describe("the title idiom warning", () => {
  it("warns on '<noun phrase>, <past participle>' and not on a plain noun phrase", () => {
    const bad = state([
      node({
        id: "P1-N001",
        title: "The platform facts, verified",
        stage: "done",
        done: "2026-11-01",
      }),
      node({
        id: "P1-N002",
        title:
          "The type declared, the arguments written, the amendment drafted",
        stage: "done",
        done: "2026-11-01",
      }),
      node({
        id: "P1-N003",
        title: "Platform capability checks",
        stage: "done",
        done: "2026-11-01",
      }),
      node({
        id: "P1-N004",
        title: "Deploy, smoke test and promote pipeline",
        stage: "done",
        done: "2026-11-01",
      }),
    ]);
    const warned = checkState(bad)
      .findings.filter((f) => f.severity === "warning")
      .map((f) => f.subject);
    expect(warned).toEqual(["P1-N001", "P1-N002"]);
  });
});
