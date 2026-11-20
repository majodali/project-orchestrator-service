/**
 * P4-N057: field order is set once, where the state file is
 * serialised. `formatState` takes every object's field order from its
 * schema, at every level, so no write can drop or misorder a field the
 * schema carries.
 *
 * The hazard the reviewer of P4-N054 raised (D113): `setCostSource`
 * rebuilt a task from a list of the sixteen field names `taskSchema`
 * then had, so a task carrying a field the list did not name lost it
 * at a cost write, and a seventeenth field added to the schema alone
 * would have been dropped. That function is gone; its callers assign
 * the field like any other.
 *
 * Both sides of every order assertion here read the schema, so none of
 * them can be satisfied by a list kept by hand.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { recordCost } from "../src/model/loop.js";
import {
  formatState,
  stateSchema,
  taskSchema,
  type State,
  type Task,
} from "../src/model/schema.js";
import { sampleState, task } from "./support/states.js";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "state.d4cbb7e.json",
);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The schema under the wrappers that carry an inner type. */
function unwrap(schema: z.ZodType): z.ZodType {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodReadonly
  )
    return unwrap(schema.unwrap() as z.ZodType);
  return schema;
}

/**
 * Every object in `value` whose keys stand in another order than
 * `schema` declares its fields, as `path: the keys found, not the keys
 * expected`. A key the schema does not declare must come after every
 * key it does; the declared keys are compared in their own order.
 */
function orderFaults(schema: z.ZodType, value: unknown, at = "$"): string[] {
  const s = unwrap(schema);
  if (s instanceof z.ZodArray && Array.isArray(value))
    return value.flatMap((item, i) =>
      orderFaults(s.element as z.ZodType, item, `${at}[${i}]`),
    );
  if (!isObject(value)) return [];
  if (s instanceof z.ZodRecord)
    // A record's keys are data, not fields: any order is right.
    return Object.entries(value).flatMap(([key, v]) =>
      orderFaults(s.valueType as z.ZodType, v, `${at}.${key}`),
    );
  if (!(s instanceof z.ZodObject)) return [];
  const shape = s.shape as Record<string, z.ZodType>;
  const found = Object.keys(value);
  const expected = [
    ...Object.keys(shape).filter((key) => Object.hasOwn(value, key)),
    ...found.filter((key) => !Object.hasOwn(shape, key)),
  ];
  return [
    ...(found.join(" ") === expected.join(" ")
      ? []
      : [`${at}: ${found.join(" ")}, not ${expected.join(" ")}`]),
    ...Object.entries(shape).flatMap(([key, field]) =>
      Object.hasOwn(value, key)
        ? orderFaults(field, value[key], `${at}.${key}`)
        : [],
    ),
  ];
}

/** The same value with every object's keys reversed, at every level:
 * the worst input the serialiser can be handed. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, v]) => [key, reverseKeys(v)]),
  );
}

describe("formatState takes every object's field order from the schema", () => {
  it("orders the whole of the real state file, at every level, whatever order it is handed", () => {
    const data = JSON.parse(readFileSync(FIXTURE, "utf-8")) as unknown;
    // The fixture is the committed state file at d4cbb7e, so its
    // 3,000-odd objects already stand in schema order.
    expect(orderFaults(stateSchema, data)).toEqual([]);

    const reversed = reverseKeys(data);
    expect(orderFaults(stateSchema, reversed).length).toBeGreaterThan(0);
    const serialised = formatState(reversed as State);
    expect(orderFaults(stateSchema, JSON.parse(serialised))).toEqual([]);
    // The order it was handed changed nothing: same bytes, same data.
    expect(serialised).toBe(formatState(data as State));
    expect(JSON.parse(serialised)).toEqual(data);
  });

  it("keeps a record's own keys in their own order, since they are data", () => {
    const state: State = { ...sampleState(), highWater: { T: 9, P2: 4, D: 7 } };
    const written = JSON.parse(formatState(state)) as {
      highWater: Record<string, number>;
    };
    expect(Object.keys(written.highWater)).toEqual(["T", "P2", "D"]);
    expect(orderFaults(stateSchema, written)).toEqual([]);
  });

  it("serialises a state that does not satisfy the schema rather than throwing on it", () => {
    // Criterion 5: `plan-state import --write` serialises what the
    // importer built and reports its findings; validation is
    // `checkState`'s job, and the store refuses a failing write
    // (src/model/store.ts).
    const broken = reverseKeys({
      ...sampleState(),
      nodes: [{ id: "nonsense", stage: "no-such-stage", extra: 1 }],
      tasks: "not an array",
    }) as State;
    const written = JSON.parse(formatState(broken)) as Record<string, unknown>;
    expect(written.tasks).toBe("not an array");
    expect(Object.keys(written).slice(0, 2)).toEqual(["schema", "project"]);
    const node = (written.nodes as Record<string, unknown>[])[0]!;
    // Declared fields first, in schema order; what the schema does not
    // declare is kept, after them.
    expect(Object.keys(node)).toEqual(["id", "stage", "extra"]);
  });
});

describe("a cost write drops no field the schema declares", () => {
  /** A task carrying every field `taskSchema` declares but
   * `costSource`, the field the cost write adds, plus a key the schema
   * does not declare. The names are a value's, not an order: the order
   * comes from the schema on both sides. */
  function fullTask(): Task {
    const t = {
      ...task({ id: "T001", node: "P1-N001" }),
      tokens: { in: 10, out: 5, cacheRead: 90, cacheWrite: 15 },
      base: "aaa1111",
      pr: "majodali/project-orchestrator-service#1",
      notes: "Imported narrative.",
      docsOnMerge: [{ node: "P1-N001", plan: "docs/plans/first.md" }],
      undeclared: "kept, after the declared fields",
    } as Task;
    const declared = Object.keys(taskSchema.shape).filter(
      (key) => key !== "costSource",
    );
    expect(
      declared.filter((key) => !Object.hasOwn(t, key)),
      "a field was added to taskSchema: carry it here, so that the drop this test guards against stays covered",
    ).toEqual([]);
    return t;
  }

  it("keeps every declared field, and the schema's order, through task_cost", () => {
    const t = fullTask();
    const before = Object.keys(t);
    const state: State = { ...sampleState(), tasks: [t] };
    recordCost(state, {
      taskId: "T001",
      tokensIn: 1200,
      tokensOut: 300,
      source: "transcript",
      model: "recorded-model",
    });
    const written = JSON.parse(formatState(state)) as {
      tasks: Record<string, unknown>[];
    };
    const after = Object.keys(written.tasks[0]!);
    for (const key of before) expect(after).toContain(key);
    expect(after).toContain("costSource");
    expect(orderFaults(stateSchema, written)).toEqual([]);
    expect(after).toEqual([...Object.keys(taskSchema.shape), "undeclared"]);
  });
});
