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
  type Task,
} from "./model/schema.js";
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
        const changes: string[] = [];
        const result = await store().write(
          `${input.nodeId}: ${input.reason}`,
          (state) => {
            const n = state.nodes.find((x) => x.id === input.nodeId);
            if (!n) throw new NotFoundError(`no node ${input.nodeId}`);
            if (input.stage !== undefined && input.stage !== n.stage) {
              changes.push(`stage ${n.stage} -> ${input.stage}`);
              n.stage = input.stage;
              if (input.stage === "done" && n.done === null)
                n.done = today(now);
              if (input.stage !== "done") n.done = null;
            }
            if (input.hold !== undefined) {
              changes.push(
                input.hold
                  ? `hold ${input.hold.kind}: ${input.hold.reason}`
                  : "hold lifted",
              );
              n.hold = input.hold;
            }
            if (input.start !== undefined && input.start !== n.start) {
              changes.push(`start ${input.start}`);
              n.start = input.start;
            }
            if (input.outcome !== undefined) {
              changes.push("outcome");
              n.outcome = input.outcome;
            }
            if (input.title !== undefined) {
              changes.push(`title "${input.title}"`);
              n.title = input.title;
            }
            if (input.note !== undefined) {
              changes.push("note");
              n.note = input.note;
            }
            if (input.after !== undefined) {
              changes.push(`after ${input.after.join(", ") || "nothing"}`);
              n.after = input.after;
            }
            if (changes.length === 0)
              throw new NotFoundError(
                "nothing to change: no field given differs",
              );
            return {
              task: null,
              node: n.id,
              session: input.session ?? null,
              note: `node_update ${n.id}: ${changes.join("; ")}. ${input.reason}`,
            };
          },
        );
        return writeResult(result, { nodeId: input.nodeId, changes });
      }),
  );

  server.registerTool(
    "task_open",
    {
      title: "Open a task",
      description:
        "Opens a task on a node, with the next task identifier, and commits. A node " +
        "has at most one open task.",
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
        let id = "";
        const result = await store().write(
          `${input.nodeId}: task opened`,
          (state) => {
            if (!state.nodes.some((x) => x.id === input.nodeId)) {
              throw new NotFoundError(`no node ${input.nodeId}`);
            }
            id = nextId(
              "T",
              state.tasks.map((t) => t.id),
              3,
            );
            const task: Task = {
              id,
              node: input.nodeId,
              step: input.step,
              status: "open",
              role: input.role ?? null,
              model: input.model ?? null,
              tokens: { in: null, out: null },
              opened: timestamp(now),
              closed: null,
              ref: null,
              pr: null,
              summary: input.summary ?? null,
              notes: null,
            };
            state.tasks.push(task);
            return {
              task: id,
              node: input.nodeId,
              session: input.session ?? null,
              note: `task_open ${id} on ${input.nodeId}, ${input.step}${input.summary ? `: ${input.summary}` : ""}`,
            };
          },
        );
        return writeResult(result, { taskId: id });
      }),
  );

  server.registerTool(
    "task_close",
    {
      title: "Close a task",
      description:
        "Closes an open task with its status, summary, pull request, commit and " +
        "token counts, and commits.",
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
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        let node = "";
        const result = await store().write(
          `${input.taskId}: ${input.status}`,
          (state) => {
            const t = state.tasks.find((x) => x.id === input.taskId);
            if (!t) throw new NotFoundError(`no task ${input.taskId}`);
            if (t.status !== "open")
              throw new NotFoundError(
                `task ${input.taskId} is ${t.status}, not open`,
              );
            t.status = input.status as Task["status"];
            t.closed = timestamp(now);
            t.summary = input.summary;
            if (input.pr !== undefined) t.pr = input.pr;
            if (input.ref !== undefined) t.ref = input.ref;
            if (input.tokensIn !== undefined) t.tokens.in = input.tokensIn;
            if (input.tokensOut !== undefined) t.tokens.out = input.tokensOut;
            node = t.node;
            return {
              task: t.id,
              node: t.node,
              session: input.session ?? null,
              note: `task_close ${t.id} ${input.status}: ${input.summary}`,
            };
          },
        );
        return writeResult(result, { taskId: input.taskId, nodeId: node });
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
            const d = state.decisions.find((x) => x.id === input.decisionId);
            if (!d) throw new NotFoundError(`no decision ${input.decisionId}`);
            if (d.chosen !== null)
              throw new NotFoundError(
                `decision ${input.decisionId} is already closed`,
              );
            d.chosen = input.chosen;
            d.decided = today(now);
            if (input.rationale !== undefined) d.rationale = input.rationale;
            if (input.standing !== undefined) d.standing = input.standing;
            node = d.node;
            return {
              task: null,
              node: d.node,
              session: input.session ?? null,
              note: `decision_close ${d.id}: ${input.chosen}`,
            };
          },
        );
        return writeResult(result, {
          decisionId: input.decisionId,
          nodeId: node,
        });
      }),
  );
}
