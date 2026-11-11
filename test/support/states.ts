/**
 * Small state files for the view's tests. Every model identifier is a
 * fake. The shapes follow src/model/schema.ts, schema version 0.
 */

import type { Decision, Node, State, Task } from "../../src/model/schema.js";

export function node(
  partial: Partial<Node> & Pick<Node, "id" | "title" | "stage">,
): Node {
  return {
    kind: "work",
    outcome: `${partial.title} exists and works.`,
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

export function task(partial: Partial<Task> & Pick<Task, "id" | "node">): Task {
  return {
    step: "execute",
    status: "closed",
    role: "implementer",
    model: "recorded-model",
    tokens: { in: null, out: null },
    opened: "2026-10-30T10:00:00Z",
    closed: "2026-10-30T12:00:00Z",
    base: null,
    ref: "abc1234",
    pr: null,
    summary: "Did the thing.",
    notes: null,
    ...partial,
  };
}

export function decision(
  partial: Partial<Decision> & Pick<Decision, "id" | "question">,
): Decision {
  return {
    node: null,
    options: [],
    default: null,
    chosen: null,
    decided: null,
    rationale: null,
    standing: false,
    source: null,
    ...partial,
  };
}

/** A state with every class of node, two decisions and three tasks. */
export function sampleState(): State {
  return {
    schema: 0,
    project: "majodali/project-orchestrator",
    nodes: [
      node({
        id: "P1-N001",
        title: "The first line of work",
        stage: "broken-down",
        docs: { plan: "docs/plans/first.md", spec: null },
        note: "Chunk 1 of the founding plan",
      }),
      node({
        id: "P1-N002",
        title: "The part that is done",
        stage: "done",
        parent: "P1-N001",
        done: "2026-10-01",
      }),
      node({
        id: "P1-N003",
        title: "The part the owner reviews",
        stage: "planned",
        parent: "P1-N001",
        hold: { kind: "gated", reason: "owner review of the plan" },
        docs: { plan: "docs/plans/third.md", spec: "docs/specs/third.md" },
      }),
      node({
        id: "P1-N004",
        title: "The part in flight",
        stage: "executing",
        parent: "P1-N001",
      }),
      node({
        id: "P1-N005",
        title: "The part that waits",
        stage: "identified",
        parent: "P1-N001",
        after: ["P1-N004"],
        outcome: null,
      }),
      node({
        id: "P1-N006",
        title: "The part that is ready",
        stage: "specified",
        parent: "P1-N001",
        after: ["P1-N002"],
      }),
      node({
        id: "P1-N007",
        title: "The part that is blocked",
        stage: "specified",
        parent: "P1-N001",
        hold: { kind: "blocked", reason: "no credential" },
      }),
      node({
        id: "P1-N008",
        title: "The part that needs a go-ahead",
        stage: "specified",
        parent: "P1-N001",
        start: "approve",
      }),
      node({
        id: "P2-N001",
        title: "The second line of work",
        stage: "parked",
        outcome: null,
      }),
    ],
    tasks: [
      task({
        id: "T001",
        node: "P1-N002",
        pr: "majodali/project-orchestrator-service#18",
        summary: "Landed the first part.",
      }),
      task({
        id: "T002",
        node: "P1-N004",
        status: "open",
        closed: null,
        ref: null,
        summary: null,
      }),
      task({
        id: "T003",
        node: "P1-N002",
        step: "verify",
        role: "reviewer",
        notes: "A long\nnote with <tags> & ampersands.",
      }),
    ],
    decisions: [
      decision({
        id: "D001",
        node: "P1-N003",
        question: "Which store holds the answers?",
        default: "git",
        source: "docs/plans/third.md, decision 1",
      }),
      decision({
        id: "RU-001",
        node: "P1-N002",
        question: "Sketch or full implementation?",
        chosen: "sketch",
        decided: "2026-08-26",
        standing: true,
        rationale: "the contract is under discussion",
        source: "docs/rulings.md, RU-001",
      }),
      decision({
        id: "D002",
        node: null,
        question: "A project decision with no node?",
        default: "yes",
      }),
    ],
  };
}

export function stateJson(state: State): string {
  return JSON.stringify(state, null, 2) + "\n";
}

/** The smallest state a page renders. */
export const MINIMAL_STATE = stateJson({
  schema: 0,
  project: "majodali/project-orchestrator",
  nodes: [
    node({
      id: "P1-N001",
      title: "The root of the plan",
      stage: "done",
      done: "2026-10-01",
    }),
  ],
  tasks: [],
  decisions: [],
});
