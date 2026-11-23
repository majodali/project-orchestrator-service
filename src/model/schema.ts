/**
 * The planning/execution model, schema version 0 (the rebuild plan,
 * majodali/project-orchestrator docs/plans/rebuild.md, "The data
 * model"). One file per managed project, `orchestration/state.json`,
 * holding nodes, tasks and decisions. This schema is the type's
 * definition; the Markdown registers are renderings of the file.
 *
 * Deliberately small: resources, verification evidence and
 * multi-project state are later schema versions, added when the view
 * or the loop needs them.
 */

import { z } from "zod";

export const SCHEMA_VERSION = 0;

/** The node lifecycle (docs/process/plan-model.md) plus `parked`: kept
 * in the plan and not planned further. */
export const STAGES = [
  "identified",
  "planned",
  "specified",
  "broken-down",
  "executing",
  "verifying",
  "done",
  "parked",
] as const;
export type Stage = (typeof STAGES)[number];

/** The step a task serves. */
export const STEPS = [
  "plan",
  "specify",
  "break down",
  "execute",
  "verify",
] as const;
export type Step = (typeof STEPS)[number];

export const COST_SOURCES = ["transcript", "headless", "reported"] as const;
export type CostSource = (typeof COST_SOURCES)[number];

export const TASK_STATUSES = [
  "open",
  "closed",
  "blocked",
  "stale",
  "needs-judgment",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Stages a node with children may hold (invariant 3). */
export const INTERIOR_STAGES: ReadonlySet<Stage> = new Set([
  "broken-down",
  "verifying",
  "done",
  "parked",
]);

/** Terminal stages: a node here is neither actionable nor waiting. */
export const TERMINAL_STAGES: ReadonlySet<Stage> = new Set(["done", "parked"]);

/** An outcome is one sentence of at most this many words (invariant 4). */
export const OUTCOME_MAX_WORDS = 40;
/** A task summary is at most this many words. Imported narrative goes
 * in `notes`, which is unbounded and null for tool-written tasks. */
export const SUMMARY_MAX_WORDS = 60;
/** A title has at least this many words (invariant 4). Titles are read
 * in their tree, so two words can be enough: "Sequence mode". */
export const TITLE_MIN_WORDS = 2;

export const NODE_ID = /^P\d+-N\d+$/;
export const TASK_ID = /^T\d{3,}$/;
export const DECISION_ID = /^(?:D\d{3,}|RU-\d{3,})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** `owner/repo#123`. */
const PULL_REQUEST = /^[\w.-]+\/[\w.-]+#\d+$/;

const date = z.string().regex(DATE, "a date, YYYY-MM-DD");
const timestamp = z
  .string()
  .regex(TIMESTAMP, "a UTC timestamp, YYYY-MM-DDThh:mm:ssZ");
const nodeId = z.string().regex(NODE_ID, "a node identifier, P<plan>-N<seq>");

export const holdSchema = z.object({
  kind: z.enum(["gated", "blocked"]),
  reason: z.string().min(1),
});
export type Hold = z.infer<typeof holdSchema>;

/** A work node is the plan's; a check node is the verification of its
 * parent, added by the loop when the parent enters `verifying` and
 * hidden unless it fails, is in flight or is selected (the rebuild
 * plan, milestone 5). */
export const NODE_KINDS = ["work", "check"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const nodeSchema = z.object({
  id: nodeId,
  kind: z.enum(NODE_KINDS).default("work"),
  /** Says what the node delivers. Shown beside the identifier everywhere. */
  title: z.string().min(1),
  /** One sentence. Required from `planned` on (invariant 4). */
  outcome: z.string().min(1).nullable(),
  stage: z.enum(STAGES),
  parent: nodeId.nullable(),
  /** The repository this node's work is claimed from and its pull
   * request opened in: `owner/name`, or null for the project's
   * coordinating repository (P2-N055, design 3, S3). Not necessarily
   * a project: a repository can hold no state file of its own. */
  repository: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/, "owner/name")
    .nullable()
    .default(null),
  /** Nodes this one waits for. Sibling order implies nothing. */
  after: z.array(nodeId),
  hold: holdSchema.nullable(),
  /** How the node starts once it is ready: `auto`, the loop takes it
   * (the default); `approve`, it waits for the owner's go-ahead and
   * counts as waiting on the owner (owner, 2026-11-10). */
  start: z.enum(["auto", "approve"]).default("auto"),
  docs: z.object({
    plan: z.string().min(1).nullable(),
    spec: z.string().min(1).nullable(),
  }),
  /** The date the node reached `done`, when known. */
  done: date.nullable(),
  /** Short free text: dates, gate facts, what the register line carried
   * beyond title and links. Rendered in the plan, never parsed. */
  note: z.string().nullable(),
});
export type Node = z.infer<typeof nodeSchema>;

export const taskSchema = z.object({
  id: z.string().regex(TASK_ID, "a task identifier, Tnnn"),
  node: nodeId,
  step: z.enum(STEPS),
  status: z.enum(TASK_STATUSES),
  role: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  tokens: z.object({
    in: z.number().int().nonnegative().nullable(),
    out: z.number().int().nonnegative().nullable(),
    /** Tokens read from and written to the prompt cache, when the
     * cost was measured (owner, 2026-11-11). Absent otherwise. */
    cacheRead: z.number().int().nonnegative().optional(),
    cacheWrite: z.number().int().nonnegative().optional(),
  }),
  /** Where the token counts came from: `transcript`, summed by the
   * repository's hook from the session transcript; `headless`, the
   * result of a headless run; `reported`, given by the session at
   * `task_close`. Absent for tasks with no measured cost. */
  costSource: z.enum(COST_SOURCES).optional(),
  opened: timestamp.nullable(),
  closed: timestamp.nullable(),
  /** The commit the task was opened on: `task_close` reads the node
   * there to tell a changed scope (milestone 5). Null for tasks
   * written before the loop. */
  base: z.string().min(1).nullable().default(null),
  /** The commit the result landed at, when known. For an `execute`
   * task closed `closed` with a pull request, the service sets it to
   * that pull request's head at the close (owner, 2026-11-16): a
   * merge refuses a head that has moved since, because the later
   * commits belong to no task. */
  ref: z.string().min(1).nullable(),
  pr: z.string().regex(PULL_REQUEST, "owner/repo#number").nullable(),
  /** What the task delivered, in at most SUMMARY_MAX_WORDS words. */
  summary: z.string().min(1).nullable(),
  /** Imported narrative (the Cost log's note). Null for tasks the tools
   * write. */
  notes: z.string().min(1).nullable(),
  /** Document paths to set when the pull requests of this task's node
   * merge (P4-N031, 2026-11-17): a task that moves a linked document
   * clears the node's path first, so that its pull request may move
   * the file, and names the new path here. Absent on other tasks. */
  docsOnMerge: z
    .array(
      z.object({
        node: nodeId,
        plan: z.string().min(1).optional(),
        spec: z.string().min(1).optional(),
      }),
    )
    .optional(),
});
export type Task = z.infer<typeof taskSchema>;

export const decisionSchema = z.object({
  id: z.string().regex(DECISION_ID, "a decision identifier, Dnnn or RU-nnn"),
  /** The node the decision belongs to, or null for a project decision. */
  node: nodeId.nullable(),
  question: z.string().min(1),
  options: z.array(z.string().min(1)),
  default: z.string().min(1).nullable(),
  chosen: z.string().min(1).nullable(),
  decided: date.nullable(),
  rationale: z.string().min(1).nullable(),
  /** A precedent: it decides the same question again without asking. */
  standing: z.boolean(),
  /** Where the full text is: a document and a location in it. */
  source: z.string().min(1).nullable(),
});
export type Decision = z.infer<typeof decisionSchema>;

export const stateSchema = z.object({
  schema: z.literal(SCHEMA_VERSION),
  /** The managed repository, `owner/name`. */
  project: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "owner/name"),
  nodes: z.array(nodeSchema),
  tasks: z.array(taskSchema),
  decisions: z.array(decisionSchema),
  /** The highest number ever used under each identifier prefix whose
   * holder was removed: `P2` for nodes of a plan line, `T` for tasks,
   * `D` for decisions. An identifier is never reused (invariant 1), so
   * the next one is above both this and every identifier in use.
   * Absent until something is removed. */
  highWater: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
export type State = z.infer<typeof stateSchema>;

export function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/** What a zod type says about itself (zod 4's `def`), to the extent
 * field order needs: the kind, and the types it holds. */
interface SchemaDef {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  valueType?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
}

function defOf(schema: z.ZodType): SchemaDef {
  return schema.def as SchemaDef;
}

/** The definition under the wrappers that hold their subject in
 * `innerType` — `optional`, `nullable`, `default` and the rest — so
 * that ordering reaches the object, array or record beneath. */
function innermost(schema: z.ZodType): SchemaDef {
  let def = defOf(schema);
  while (def.innerType !== undefined) def = defOf(def.innerType);
  return def;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A copy of `value` whose every object holds its fields in the order
 * `schema` declares them, at every level (P4-N057). This is the one
 * place field order is decided, so no part of the service keeps a list
 * of the schema's field names by hand: a field added to a schema here
 * takes its place in the file by that alone.
 *
 * The schema is read, never applied. A value that does not satisfy it
 * is ordered as far as the shapes reach and copied through otherwise,
 * so serialising never throws on what the importer builds or a broken
 * file carries; a field the schema does not declare keeps its own
 * place after the declared ones, so nothing is dropped. Validation is
 * `checkState`'s job, and the store refuses a write that fails it.
 */
function orderBySchema(schema: z.ZodType, value: unknown): unknown {
  const def = innermost(schema);
  if (def.type === "union") {
    const option = def.options?.find((o) => o.safeParse(value).success);
    return option === undefined ? value : orderBySchema(option, value);
  }
  if (def.type === "array" && Array.isArray(value)) {
    const element = def.element;
    return element === undefined
      ? value
      : value.map((item) => orderBySchema(element, item));
  }
  if (!isObject(value)) return value;
  if (def.type === "record") {
    const valueType = def.valueType;
    if (valueType === undefined) return value;
    // A record's own keys are data, not fields: they keep their order.
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        orderBySchema(valueType, v),
      ]),
    );
  }
  const shape = def.type === "object" ? def.shape : undefined;
  if (shape === undefined) return value;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape))
    if (Object.hasOwn(value, key)) out[key] = orderBySchema(field, value[key]);
  for (const [key, v] of Object.entries(value))
    if (!Object.hasOwn(shape, key)) out[key] = v;
  return out;
}

/** Serialises a state the one way `check` and `render` expect: every
 * object's fields in the order its schema declares them. */
export function formatState(state: State): string {
  return JSON.stringify(orderBySchema(stateSchema, state), null, 2) + "\n";
}
