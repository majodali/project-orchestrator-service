/**
 * The MCP tools over the state file (the rebuild plan, milestone 3):
 * `plan_read`, `node_update`, `task_open`, `task_close`,
 * `decision_open` and `decision_close`. Each write goes through the
 * store (src/model/store.ts): checked, rendered, one commit on the
 * default branch, one journal event. A write the invariants refuse
 * comes back as a tool error naming them; nothing is committed.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { NODE_CLASS_LABELS, classifyAll, type Finding } from "./model/check.js";
import {
  STAGES,
  STEPS,
  TASK_STATUSES,
  holdSchema,
  type Decision,
  type Node,
  type State,
} from "./model/schema.js";
import {
  addNode,
  ancestorsOf,
  candidates,
  closeStale,
  closeTask,
  openTask,
  scopeOf,
  staleTasks,
  type CloseInput,
  type CloseResult,
  type OpenResult,
} from "./model/loop.js";
import {
  closeDecision,
  decisionsForTask,
  updateNode,
} from "./model/mutations.js";
import {
  NotFoundError,
  StateStore,
  StateUnreadableError,
  WriteRefusedError,
  type WriteResult,
} from "./model/store.js";
import { GithubAppAuthError } from "./planRegister/githubAppAuth.js";
import {
  GithubAppNotConfiguredError,
  getDefaultCommitReader,
  getDefaultGitWriter,
} from "./planRegister/defaultFetcher.js";
import { GitConflictError, GitWriteError } from "./planRegister/gitWriter.js";
import { GithubFetchError } from "./planRegister/registerFetcher.js";

export interface StateToolsOptions {
  /** Test-only: the store over a fake repository. Production builds
   * one over the GitHub App. */
  store?: StateStore;
  now?: () => Date;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(structuredContent: Record<string, unknown>): ToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(structuredContent, null, 2) },
    ],
    structuredContent,
  };
}

function toolError(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function findingsText(findings: Finding[]): string {
  return findings
    .map(
      (f) =>
        `${f.severity} ${f.invariant}${f.subject ? ` ${f.subject}` : ""}: ${f.message}`,
    )
    .join("\n");
}

export function describeError(err: unknown): string {
  if (err instanceof WriteRefusedError) {
    return `refused: the change would violate the state's invariants; nothing was committed.\n${findingsText(err.findings)}`;
  }
  if (err instanceof StateUnreadableError) {
    return `${err.message}; fix the file by hand before any tool can write.\n${findingsText(err.findings)}`;
  }
  if (err instanceof NotFoundError) return err.message;
  if (err instanceof GitConflictError) {
    return `${err.message}; the write was retried once and the branch moved again. Read and try again.`;
  }
  if (err instanceof GithubAppNotConfiguredError) return err.message;
  if (
    err instanceof GithubAppAuthError ||
    err instanceof GithubFetchError ||
    err instanceof GitWriteError
  ) {
    return `${err.message} (HTTP ${err.status}): ${err.body}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

const nodeId = z
  .string()
  .regex(/^P\d+-N\d+$/, "a node identifier, P<plan>-N<seq>");
const sessionField = z
  .string()
  .optional()
  .describe("Who is writing: the session's own name, recorded in the journal.");

function nodeSummary(n: Node, cls: string): Record<string, unknown> {
  return {
    id: n.id,
    title: n.title,
    stage: n.stage,
    class: cls,
    outcome: n.outcome,
    parent: n.parent,
    after: n.after,
    hold: n.hold,
    start: n.start,
    done: n.done,
  };
}

function today(now: () => Date): string {
  return now().toISOString().slice(0, 10);
}

function timestamp(now: () => Date): string {
  return now()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

function nextId(prefix: string, ids: string[], width: number): string {
  let max = 0;
  for (const id of ids) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

function writeResult(
  result: WriteResult,
  extra: Record<string, unknown>,
): ToolResult {
  return ok({
    committed: true,
    branch: result.branch,
    sha: result.sha,
    parentSha: result.parentSha,
    warnings: result.warnings.map((f) => `${f.subject ?? "-"}: ${f.message}`),
    ...extra,
  });
}

export function registerStateTools(
  server: McpServer,
  options: StateToolsOptions = {},
): void {
  const now = options.now ?? (() => new Date());
  const store = (): StateStore =>
    options.store ??
    new StateStore({
      reader: getDefaultCommitReader(),
      writer: getDefaultGitWriter(),
      now,
    });

  const run = async (fn: () => Promise<ToolResult>): Promise<ToolResult> => {
    try {
      return await fn();
    } catch (err) {
      return toolError(describeError(err));
    }
  };

  server.registerTool(
    "plan_read",
    {
      title: "Read the plan",
      description:
        "Reads orchestration/state.json of the coordinating repository at a ref " +
        "(default: the default branch) and answers every node with its class, " +
        "or one node in full with its tasks and decisions when `node` is given. " +
        "Carries the commit SHA the file was read at.",
      inputSchema: {
        ref: z
          .string()
          .optional()
          .describe("A branch, tag or SHA; default: the default branch."),
        node: nodeId.optional().describe("One node to answer in full."),
      },
    },
    async ({ ref, node }) =>
      run(async () => {
        const read = await store().read(ref);
        if (read.state === null) {
          return toolError(
            `orchestration/state.json at ${read.sha} does not validate:\n${findingsText(read.findings)}`,
          );
        }
        const state = read.state;
        const classes = classifyAll(state);
        const counts: Record<string, number> = {};
        for (const cls of classes.values())
          counts[cls] = (counts[cls] ?? 0) + 1;
        const base = {
          ref: read.ref,
          sha: read.sha,
          fetchedAt: read.fetchedAt,
          project: state.project,
          counts,
          problems: read.findings.map(
            (f) => `${f.severity} ${f.invariant}: ${f.message}`,
          ),
        };
        if (node !== undefined) {
          const n = state.nodes.find((x) => x.id === node);
          if (!n)
            return toolError(
              `no node ${node} in orchestration/state.json at ${read.sha}`,
            );
          return ok({
            ...base,
            node: {
              ...n,
              class: classes.get(n.id),
              classLabel: NODE_CLASS_LABELS[classes.get(n.id)!],
              children: state.nodes
                .filter((c) => c.parent === n.id)
                .map((c) => c.id),
              neededBy: state.nodes
                .filter((c) => c.after.includes(n.id))
                .map((c) => c.id),
              tasks: state.tasks.filter((t) => t.node === n.id),
              decisions: state.decisions.filter((d) => d.node === n.id),
            },
          });
        }
        return ok({
          ...base,
          nodes: state.nodes.map((n) => nodeSummary(n, classes.get(n.id)!)),
          openDecisions: state.decisions.filter((d) => d.chosen === null),
          openTasks: state.tasks.filter((t) => t.status === "open"),
        });
      }),
  );

  server.registerTool(
    "node_update",
    {
      title: "Update a node",
      description:
        "Changes one node's stage, hold, start, outcome, title, note or dependencies " +
        "and commits the state file. A node moved to `done` gains today's date. " +
        "Refused, with nothing committed, when the result would violate an invariant.",
      inputSchema: {
        nodeId,
        reason: z
          .string()
          .min(1)
          .describe(
            "Why, in one sentence; goes in the commit and the journal.",
          ),
        stage: z.enum(STAGES).optional(),
        hold: holdSchema
          .nullable()
          .optional()
          .describe("A hold to set, or null to lift it."),
        start: z.enum(["auto", "approve"]).optional(),
        outcome: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
        note: z.string().nullable().optional(),
        after: z
          .array(nodeId)
          .optional()
          .describe("The full list of nodes this one waits for."),
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        let changes: string[] = [];
        const result = await store().write(
          `${input.nodeId}: ${input.reason}`,
          (state) => {
            const applied = updateNode(state, input, today(now));
            changes = applied.changes;
            return applied.event;
          },
        );
        return writeResult(result, { nodeId: input.nodeId, changes });
      }),
  );

  /** What a session needs to start on a node: the node in full, its
   * step and role, its documents, its ancestors, the tasks that ran on
   * it, and the decisions it reads first. */
  function brief(
    state: State,
    node: Node,
    step: string,
    steps: string[],
    role: string,
    sha: string,
  ): Record<string, unknown> {
    const classes = classifyAll(state);
    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    return {
      node: {
        ...node,
        class: classes.get(node.id),
        classLabel: NODE_CLASS_LABELS[classes.get(node.id)!],
      },
      step,
      steps,
      role,
      ancestors: ancestorsOf(node, byId)
        .reverse()
        .map((a) => ({ id: a.id, title: a.title, stage: a.stage })),
      documents: {
        plan: node.docs.plan
          ? `https://github.com/${state.project}/blob/${sha}/${node.docs.plan}`
          : null,
        spec: node.docs.spec
          ? `https://github.com/${state.project}/blob/${sha}/${node.docs.spec}`
          : null,
      },
      tasks: state.tasks
        .filter((t) => t.node === node.id)
        .map((t) => ({
          id: t.id,
          step: t.step,
          status: t.status,
          closed: t.closed,
          pr: t.pr,
          summary: t.summary,
        })),
      decisions: decisionsForTask(state, node.id),
    };
  }

  server.registerTool(
    "task_next",
    {
      title: "The next task",
      description:
        "Answers the first node in tree order that offers a step, for a role when " +
        "given (planner, implementer, reviewer): the node in full, its step, its " +
        "documents at the commit, its ancestors, the tasks that ran on it and the " +
        "decisions to read first. Closes tasks open past the time limit as stale " +
        "first, in one commit. The claim is `task_open`.",
      inputSchema: {
        role: z.enum(["planner", "implementer", "reviewer"]).optional(),
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        let read = await store().read();
        if (read.state === null) {
          return toolError(
            `orchestration/state.json at ${read.sha} does not validate:\n${findingsText(read.findings)}`,
          );
        }
        let staleClosed: string[] = [];
        if (staleTasks(read.state, now()).length > 0) {
          await store().write("stale tasks closed by task_next", (state) => {
            staleClosed = closeStale(state, now(), timestamp(now));
            return {
              task: null,
              node: null,
              session: input.session ?? null,
              note: `task_next closed ${staleClosed.join(", ")} as stale`,
            };
          });
          read = await store().read();
          if (read.state === null) {
            return toolError(
              `orchestration/state.json at ${read.sha} does not validate:\n${findingsText(read.findings)}`,
            );
          }
        }
        const state = read.state;
        const found = candidates(state, input.role);
        const first = found[0];
        if (first === undefined) {
          return ok({
            ref: read.ref,
            sha: read.sha,
            fetchedAt: read.fetchedAt,
            staleClosed,
            next: null,
            candidates: [],
            message: `no node offers a step${input.role ? ` for ${input.role}` : ""}; what remains waits on the owner, on a dependency or on an open task`,
          });
        }
        return ok({
          ref: read.ref,
          sha: read.sha,
          fetchedAt: read.fetchedAt,
          staleClosed,
          next: brief(
            state,
            first.node,
            first.step,
            first.steps,
            first.role,
            read.sha,
          ),
          candidates: found.slice(0, 10).map((c) => ({
            id: c.node.id,
            title: c.node.title,
            step: c.step,
            role: c.role,
          })),
        });
      }),
  );

  server.registerTool(
    "task_open",
    {
      title: "Open a task: the claim",
      description:
        "Claims a node for a step, with the next task identifier, and commits: one " +
        "conditional commit, so two sessions cannot claim the same node. Refuses a " +
        "node that does not offer the step, naming why. An `execute` step moves the " +
        "node to `executing`. Answers what task_next answers for the node.",
      inputSchema: {
        nodeId,
        step: z.enum(STEPS),
        role: z.string().optional(),
        model: z.string().optional(),
        summary: z
          .string()
          .optional()
          .describe("What the task sets out to do, in at most sixty words."),
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        let opened: OpenResult | null = null;
        let after: State | null = null;
        const result = await store().write(
          `${input.nodeId}: task opened`,
          (state, { baseSha }) => {
            opened = openTask(
              state,
              input,
              nextId(
                "T",
                state.tasks.map((t) => t.id),
                3,
              ),
              timestamp(now),
              baseSha,
            );
            after = state;
            return opened.event;
          },
        );
        const done = opened!;
        const state = after!;
        const node = state.nodes.find((n) => n.id === input.nodeId)!;
        return writeResult(result, {
          taskId: done.task.id,
          moved: done.moved,
          ...brief(
            state,
            node,
            input.step,
            [input.step],
            done.task.role ?? "",
            result.sha,
          ),
        });
      }),
  );

  server.registerTool(
    "task_close",
    {
      title: "Close a task",
      description:
        "Records a task's result (status, summary, pull request, commit, token " +
        "counts) and runs the close-out: a `closed` step moves the node on (an " +
        "executed node enters verifying with a check node; a verified check node " +
        "completes its parent), `blocked` and `needs-judgment` hold the node for " +
        "the owner, and each ask becomes an open decision on the node. A scope that " +
        "changed since the task opened closes it as needs-judgment. A planning step " +
        "delivers the title, outcome and documents here, applied at close. Answers " +
        "`stop` when the session should return to the owner.",
      inputSchema: {
        taskId: z.string().regex(/^T\d{3,}$/),
        status: z.enum(
          TASK_STATUSES.filter((s) => s !== "open") as [string, ...string[]],
        ),
        summary: z
          .string()
          .min(1)
          .describe("What the task delivered, in at most sixty words."),
        pr: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+#\d+$/)
          .optional()
          .describe("owner/repo#number"),
        ref: z.string().optional().describe("The commit the result landed at."),
        tokensIn: z.number().int().nonnegative().optional(),
        tokensOut: z.number().int().nonnegative().optional(),
        asks: z
          .array(
            z.object({
              question: z.string().min(1),
              options: z.array(z.string().min(1)).optional(),
              default: z.string().min(1),
            }),
          )
          .optional()
          .describe(
            "Questions for the owner; each becomes an open decision on the node.",
          ),
        title: z.string().min(1).optional(),
        outcome: z
          .string()
          .min(1)
          .optional()
          .describe("What a plan step delivers: the node's outcome sentence."),
        docs: z
          .object({
            plan: z.string().min(1).nullable().optional(),
            spec: z.string().min(1).nullable().optional(),
          })
          .optional()
          .describe("The documents a plan or specify step delivers."),
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        // The node's scope at the task's base commit, for the stop
        // condition; a task from before the loop has no base.
        const head = await store().read();
        const task = head.state?.tasks.find((t) => t.id === input.taskId);
        let scopeAtBase: string | null = null;
        if (task?.base) {
          const base = await store().readStateAt(task.base);
          const there = base.state?.nodes.find((n) => n.id === task.node);
          if (there) scopeAtBase = scopeOf(there);
        }
        let closed: CloseResult | null = null;
        const result = await store().write(
          `${input.taskId}: ${input.status}`,
          (state) => {
            closed = closeTask(
              state,
              { ...input, status: input.status as CloseInput["status"] },
              scopeAtBase,
              today(now),
              timestamp(now),
              (s) =>
                nextId(
                  "D",
                  s.decisions.map((d) => d.id),
                  3,
                ),
            );
            return closed.event;
          },
        );
        const done = closed!;
        return writeResult(result, {
          taskId: done.task.id,
          status: done.task.status,
          nodeId: done.node.id,
          nodeStage: done.node.stage,
          moved: done.moved,
          decisionsOpened: done.decisions,
          stop: done.stop,
        });
      }),
  );

  server.registerTool(
    "node_add",
    {
      title: "Add a node",
      description:
        "Adds a node with the next identifier in its plan line, as a child of a " +
        "parent or as a root of a named line, and commits. Planning and breaking " +
        "down add nodes this way.",
      inputSchema: {
        parentId: nodeId.nullable(),
        line: z
          .string()
          .regex(/^P\d+$/)
          .optional()
          .describe("The plan line of a root node, such as P5."),
        title: z.string().min(1),
        outcome: z.string().min(1).nullable(),
        after: z.array(nodeId).optional(),
        docs: z
          .object({
            plan: z.string().min(1).nullable(),
            spec: z.string().min(1).nullable(),
          })
          .optional(),
        stage: z.enum(["identified", "planned", "specified"]).optional(),
        start: z.enum(["auto", "approve"]).optional(),
        note: z.string().optional(),
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        let id = "";
        const result = await store().write(
          `${input.parentId ?? input.line ?? "plan"}: node added`,
          (state) => {
            const added = addNode(state, input);
            id = added.node.id;
            return added.event;
          },
        );
        return writeResult(result, { nodeId: id });
      }),
  );

  server.registerTool(
    "decision_open",
    {
      title: "Open a decision",
      description:
        "Records a question for the owner on a node, or on the project, with its " +
        "options and default, and commits. The view shows it under its node.",
      inputSchema: {
        nodeId: nodeId
          .nullable()
          .describe("The node, or null for a project decision."),
        question: z.string().min(1),
        options: z.array(z.string().min(1)).optional(),
        default: z
          .string()
          .min(1)
          .describe("The recommended answer; required for an open decision."),
        rationale: z.string().optional(),
        source: z.string().optional().describe("Where the full text is."),
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        let id = "";
        const result = await store().write(
          `${input.nodeId ?? "project"}: decision opened`,
          (state) => {
            if (
              input.nodeId !== null &&
              !state.nodes.some((x) => x.id === input.nodeId)
            ) {
              throw new NotFoundError(`no node ${input.nodeId}`);
            }
            id = nextId(
              "D",
              state.decisions.map((d) => d.id),
              3,
            );
            const decision: Decision = {
              id,
              node: input.nodeId,
              question: input.question,
              options: input.options ?? [],
              default: input.default,
              chosen: null,
              decided: null,
              rationale: input.rationale ?? null,
              standing: false,
              source: input.source ?? null,
            };
            state.decisions.push(decision);
            return {
              task: null,
              node: input.nodeId,
              session: input.session ?? null,
              note: `decision_open ${id}: ${input.question}`,
            };
          },
        );
        return writeResult(result, { decisionId: id });
      }),
  );

  server.registerTool(
    "decision_close",
    {
      title: "Close a decision",
      description:
        "Records the owner's answer to an open decision and commits.",
      inputSchema: {
        decisionId: z.string().regex(/^(?:D\d{3,}|RU-\d{3,})$/),
        chosen: z.string().min(1),
        rationale: z.string().optional(),
        standing: z
          .boolean()
          .optional()
          .describe("True when the answer is a precedent."),
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        let node: string | null = null;
        const result = await store().write(
          `${input.decisionId}: ${input.chosen}`,
          (state) => {
            const applied = closeDecision(state, input, today(now));
            node = applied.decision.node;
            return applied.event;
          },
        );
        return writeResult(result, {
          decisionId: input.decisionId,
          nodeId: node,
        });
      }),
  );
}
