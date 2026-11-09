import { describe, expect, it } from "vitest";

import { checkState } from "../src/model/check.js";
import {
  dependenciesFromAnnotation,
  firstSentence,
  importState,
  outcomeFromPlan,
  parseRulings,
  splitAnnotation,
  type ImportInput,
} from "../src/model/importState.js";

const REGISTER = `# Plan register

- P1-N001 [broken-down] Orchestrator v1 — plan: plans/orchestrator-v1.md
  - P1-N002 [done] Bootstrap and founding plan (chunk 1)
  - P1-N003 [specified] [gated: owner review] Parser error recovery — depends on P1-N002, done 2026-11-01; independent of P1-N004 (RU-018) — plan: plans/p1-n003-parser.md · spec: specs/p1-n003-parser.md
  - P1-N004 [identified] Recovery for bad operators
`;

const COST_LOG = `# Cost log

| date | task | node | stage | role | model | input tok | output tok | notes |
|---|---|---|---|---|---|---|---|---|
| 2026-11-01 | T001 | P1-N002 | execute | implementer | claude-sonnet-5 | n/a | n/a | Landed the bootstrap in pull request #3. Second sentence with detail. |
`;

const JOURNAL = [
  '{"ts":"2026-11-01T10:00:00Z","event":"dispatched","task":"T001","node":"P1-N002","stage":"execute","role":"implementer","model":"claude-sonnet-5","session":"s1","ref":null,"note":null}',
  '{"ts":"2026-11-01T12:00:00Z","event":"accepted","task":"T001","node":"P1-N002","stage":"execute","role":"orchestrator","model":null,"session":"s1","ref":"abc1234","note":"ok"}',
  '{"ts":"2026-11-02T10:00:00Z","event":"dispatched","task":"T002","node":"P1-N003","stage":"plan","role":"planner","model":null,"session":"s2","ref":null,"note":null}',
  '{"ts":"2026-11-02T11:00:00Z","event":"result-received","task":"T002","node":"P1-N003","stage":"plan","role":"planner","model":null,"session":"s2","ref":"def5678","note":"status done. Plan delivered, open as pull request #7."}',
  '{"ts":"2026-11-03T10:00:00Z","event":"dispatched","task":"T003","node":"P1-N004","stage":"plan","role":"planner","model":null,"session":"s3","ref":null,"note":null}',
  '{"ts":"2026-11-03T11:00:00Z","event":"needs-judgment","task":"T003","node":"P1-N004","stage":"plan","role":"planner","model":null,"session":"s3","ref":null,"note":"which grammar?"}',
].join("\n");

const RULINGS = `# Ruling register

- RU-001 [active] completion/node — Execute a proposal draft before
  its evidencing node closes? Ruling: yes. Rationale: the evidence
  already exists. Source: P1-N001 gate (decision 1, default adopted),
  2026-08-26. Applied: T004.

- RU-002 [superseded] handoff/process — Which branch? Options seen: (A) the
  design branch; (B) main. Ruling: option A. Rationale: one shape.
  Source: owner request, 2026-08-28. Applied: —
`;

const PLAN_P1_N003 = `# Parser error recovery

Status: draft

## Outcome

The parser **recovers** from an unclosed block and reports it once, as [the spec](../specs/x.md) states. A second sentence.

## Decisions for the gate

1. **Where recovery lives.** **Default**: in the parser, not the lexer.
   **Rationale**: the lexer has no block state. **Affected locations**: none.
2. **Leaf or interior.** Default: a leaf. Rationale: one outcome.
`;

const PLAN_ACCEPTED = `# The rebuild

## Decisions

The owner accepted every default.

1. Pause the P3 line and park its open nodes. Default: yes.
2. The view targets a desktop browser. Owner, 2026-11-09.
`;

function input(partial: Partial<ImportInput> = {}): ImportInput {
  return {
    project: "majodali/example",
    register: REGISTER,
    costLog: COST_LOG,
    journal: JOURNAL,
    rulings: RULINGS,
    plans: new Map([
      ["docs/plans/p1-n003-parser.md", PLAN_P1_N003],
      ["docs/plans/rebuild.md", PLAN_ACCEPTED],
    ]),
    acceptedPlans: { "docs/plans/rebuild.md": "2026-11-09" },
    exists: () => true,
    overrides: null,
    ...partial,
  };
}

describe("the pieces", () => {
  it("takes the first sentence without markdown", () => {
    expect(
      firstSentence("The **bold** [link](x.md) ends here. Not this."),
    ).toBe("The bold link ends here.");
  });

  it("reads a plan's Outcome section", () => {
    expect(outcomeFromPlan(PLAN_P1_N003)).toBe(
      "The parser recovers from an unclosed block and reports it once, as the spec states.",
    );
    expect(outcomeFromPlan("# No outcome\n\n## Approach\n\nText.")).toBeNull();
  });

  it("reads dependencies from the register's prose and ignores independence", () => {
    expect(
      dependenciesFromAnnotation(
        "depends on P1-N002, done 2026-11-01; independent of P1-N004 (RU-018) — plan: x",
      ),
    ).toEqual(["P1-N002"]);
    expect(
      dependenciesFromAnnotation("after P2-N006, built only on a shown need"),
    ).toEqual(["P2-N006"]);
    expect(
      dependenciesFromAnnotation("depends on P2-N018 and P2-N019"),
    ).toEqual(["P2-N018", "P2-N019"]);
  });

  it("splits links from prose in an annotation", () => {
    expect(
      splitAnnotation(
        "split in two (owner) — plan: plans/a.md · spec: specs/b.md",
      ),
    ).toEqual({
      plan: "docs/plans/a.md",
      spec: "docs/specs/b.md",
      note: "split in two (owner)",
    });
    expect(splitAnnotation(null)).toEqual({
      plan: null,
      spec: null,
      note: null,
    });
  });

  it("parses rulings into standing decisions", () => {
    const { decisions, unparsed } = parseRulings(RULINGS);
    expect(unparsed).toEqual([]);
    expect(decisions[0]).toMatchObject({
      id: "RU-001",
      node: "P1-N001",
      question: "Execute a proposal draft before its evidencing node closes?",
      chosen: "yes.",
      decided: "2026-08-26",
      standing: true,
    });
    expect(decisions[1]).toMatchObject({
      question: "Which branch?",
      options: ["(A) the design branch", "(B) main"],
      chosen: "option A. (superseded)",
    });
  });
});

describe("importState", () => {
  it("builds a state the checker accepts, with the record of what it could not take", () => {
    const { state, record } = importState(
      input({
        overrides: {
          nodes: {
            "P1-N001": {
              title: "Orchestrator v1: the specification and the plugin",
              outcome: "The specification and the plugin exist.",
            },
            "P1-N002": {
              outcome: "The repository exists with its founding plan.",
            },
          },
        },
      }),
    );
    expect(
      checkState(state).findings.filter((f) => f.severity === "violation"),
    ).toEqual([]);

    const n3 = state.nodes.find((n) => n.id === "P1-N003")!;
    expect(n3.after).toEqual(["P1-N002"]);
    expect(n3.hold).toEqual({ kind: "gated", reason: "owner review" });
    expect(n3.docs).toEqual({
      plan: "docs/plans/p1-n003-parser.md",
      spec: "docs/specs/p1-n003-parser.md",
    });
    expect(n3.outcome).toBe(
      "The parser recovers from an unclosed block and reports it once, as the spec states.",
    );
    expect(n3.note).toContain("independent of P1-N004");

    const n2 = state.nodes.find((n) => n.id === "P1-N002")!;
    expect(n2.title).toBe("Bootstrap and founding plan");
    expect(n2.note).toBe("Chunk 1 of the parent plan");
    expect(n2.done).toBe("2026-11-01");

    expect(state.tasks.map((t) => [t.id, t.status, t.pr, t.closed])).toEqual([
      ["T001", "closed", "majodali/example#3", "2026-11-01T12:00:00Z"],
      ["T002", "closed", "majodali/example#7", "2026-11-02T10:00:00Z"],
      ["T003", "needs-judgment", null, "2026-11-03T10:00:00Z"],
    ]);
    expect(state.tasks[0]!.summary).toBe(
      "Landed the bootstrap in pull request #3.",
    );
    expect(state.tasks[0]!.ref).toBe("abc1234");

    const ids = state.decisions.map((d) => d.id);
    expect(ids).toEqual(["RU-001", "RU-002", "D001", "D002", "D003", "D004"]);
    expect(state.decisions.find((d) => d.id === "D001")).toMatchObject({
      node: null,
      question: "Pause the P3 line and park its open nodes",
      default: "yes",
      chosen: "yes",
      decided: "2026-11-09",
    });
    expect(state.decisions.find((d) => d.id === "D002")).toMatchObject({
      chosen: "as stated",
      decided: "2026-11-09",
    });
    expect(state.decisions.find((d) => d.id === "D003")).toMatchObject({
      node: "P1-N003",
      question: "Where recovery lives",
      default: "in the parser, not the lexer.",
      rationale: "the lexer has no block state.",
      chosen: null,
      source: "docs/plans/p1-n003-parser.md, decision 1",
    });
    expect(state.decisions.find((d) => d.id === "D004")).toMatchObject({
      default: "a leaf",
      rationale: "one outcome.",
    });

    expect(record.noOutcome).toEqual([]);
    expect(record.neverAccepted).toEqual(["T002"]);
    expect(record.noCostRow).toEqual(["T002", "T003"]);
    expect(record.noDependency.map((d) => d.id)).toEqual([
      "P1-N001",
      "P1-N004",
    ]);
    expect(record.overridesApplied).toEqual([
      "P1-N001: title, outcome",
      "P1-N002: outcome",
    ]);
    expect(record.decisionsRead).toEqual([
      { plan: "docs/plans/rebuild.md", count: 2, unparsed: 0 },
      { plan: "docs/plans/p1-n003-parser.md", count: 2, unparsed: 0 },
    ]);
  });

  it("lists nodes whose outcome no record gives, and refuses an override for an unknown node", () => {
    const { state, record } = importState(input());
    expect(record.noOutcome).toEqual(["P1-N001", "P1-N002"]);
    expect(checkState(state).findings.some((f) => f.invariant === 4)).toBe(
      true,
    );
    expect(() =>
      importState(
        input({ overrides: { nodes: { "P9-N999": { outcome: "x" } } } }),
      ),
    ).toThrow(/unknown node P9-N999/);
  });

  it("refuses a register that does not parse", () => {
    expect(() =>
      importState(
        input({ register: "- P1-N001 [done] fine\n- broken [stage] line\n" }),
      ),
    ).toThrow(/does not parse/);
  });
});
