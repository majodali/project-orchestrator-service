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

import {
  NODE_CLASS_LABELS,
  childrenOf,
  classifyAll,
  type Finding,
} from "./model/check.js";
import {
  COST_SOURCES,
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
  expectedHeads,
  failedCheckNode,
  mergesAtClose,
  nextDecisionId,
  nextTaskId,
  openTask,
  pullRequestsOf,
  recordCost,
  removeNode,
  repositoryOf,
  scopeOf,
  staleTasks,
  type CloseInput,
  type CloseResult,
  type OpenResult,
  type RemoveResult,
} from "./model/loop.js";
import {
  closeDecision,
  decisionsForTask,
  standingDecisions,
  updateNode,
} from "./model/mutations.js";
import {
  NotFoundError,
  StateStore,
  StateUnreadableError,
  WriteRefusedError,
  type WriteEvent,
  type WriteResult,
} from "./model/store.js";
import { GithubAppAuthError } from "./planRegister/githubAppAuth.js";
import {
  GithubAppNotConfiguredError,
  getDefaultCommitReader,
  getDefaultGitWriter,
  getDefaultPullRequests,
} from "./planRegister/defaultFetcher.js";
import { GitConflictError, GitWriteError } from "./planRegister/gitWriter.js";
import {
  NotMergeableError,
  PullRequestError,
  ensureMerged,
  type PullRequests,
} from "./planRegister/pullRequests.js";
import { GithubFetchError } from "./planRegister/registerFetcher.js";
import { requirePendingDocs } from "./pendingDocs.js";
import { defaultFireRuntime } from "./fire/default.js";
import { runFireCheck, type FireRuntime } from "./fire/run.js";

/** What every enlisted session is told when it connects: the loop's
 * protocol, since nothing else reaches a session that was simply
 * asked to work on a node (owner, 2026-11-11). */
export const SERVER_INSTRUCTIONS = [
  "This service holds the plan of the project as one checked file, orchestration/state.json, and is the only writer of it, of docs/plan.md, of docs/plan-register.md, of docs/backlog.md and of orchestration/journal.jsonl. Never edit those five files; every change goes through these tools, one commit each.",
  "Work on a plan node goes through a task, whoever asked for it:",
  "1. `task_next` (with your role: planner, implementer or reviewer) answers the next node that offers a step, or call `plan_read` with a node to see one you were pointed at. Pass the repository you are working in, and it answers only that repository's steps.",
  "2. `task_open` claims the node for a step before you start. It answers the node, its documents, the decisions on it and above it, and the standing decisions, which bind every task. If it refuses, the reason is the answer: tell the person and stop.",
  "3. Do the work on a branch and open a pull request. Do not merge it: the service merges it when the result is accepted. Commit to it only while your task is open: the service refuses to merge a pull request that has commits made after its last execute task closed.",
  "4. `task_close` records the result: status, a summary of at most sixty words, the pull request (or the branch, and the service opens one), and questions for the owner as `asks`. A plan or specify step delivers the node's outcome and documents here.",
  "   - `closed`: the step is finished and its criteria are met. Never close `closed` with a criterion unmet.",
  "   - `needs-judgment`, with `asks`: the work cannot finish until the owner answers. The questions gate the node; once they are answered it offers the same step again, and a new task continues on the same pull request.",
  "   - `blocked`: something outside the session stops the work, and the node is held for the owner. With `asks`, the questions gate it instead.",
  "   - A reviewer closes a failed verification as `blocked`, with each unmet criterion in the summary. That is not a stop for the owner: the node offers `execute` again for the rework, the rework's task is told what failed, and its close sends the node back for verification.",
  "5. When the answer carries `stop`, or `task_next` answers nothing, return to the person: the owner answers decisions and lifts holds in the view.",
  "Every write to a node or a decision (`node_update`, `node_add`, `node_remove`, `decision_open`, `decision_close`) names the open task it is part of as `task`, and is refused without one. The only exception is a change the owner dictated to you in this conversation: pass their words as `ownerInstruction`. Being asked to work on a node is not that: claim it.",
  "A node that turns out to be obsolete is removed with `node_remove`, not parked or held; git keeps its history. A hold or a park is for work that will resume.",
  "To move a document a node links: under your open execute task, call `node_update` on that node with `docsOnMerge` naming the new path, then move the file in your task's pull request. The old path is cleared at once and the new one is set when your node is done. Never move a linked file without it: the state file would name a path that is gone.",
  "A node's `repository`, the repository its work is claimed from, is set or cleared with `node_update`, under an open task or the owner's words; a child's defaults to its parent's at `node_add`. Changing it during another session's open task counts as a changed scope, like the title, outcome, parent, dependencies or documents.",
  "Do not estimate token counts at `task_close`: the repository's hook measures a task's cost and records it with `task_cost`.",
  "Pass `session` on every write: your session's own name or identifier, so the journal says who wrote.",
].join("\n");

export interface StateToolsOptions {
  /** Test-only: the store over a fake repository. Production builds
   * one over the GitHub App. */
  store?: StateStore;
  /** Test-only: the pull request client. Production uses the App. */
  pullRequests?: PullRequests;
  now?: () => Date;
  /** The project this server's endpoint path resolved to (P2-N054,
   * design 1, S2): required in production, where `store` and
   * `pullRequests` are built from it; a test that supplies both
   * directly need not pass it. */
  project?: { owner: string; repo: string };
  /** Test-only: the fire check's runtime (P2-N048). Production builds
   * one over AWS Secrets Manager and the real endpoint, from
   * `project`; with no `project` either, the fire check is skipped —
   * every existing test that supplies its own `store` with no
   * `project` keeps running with firing off, not failing. */
  fire?: FireRuntime;
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
    const committed =
      err.merged.length > 0
        ? `nothing from this write was committed, though ${err.merged.join(", ")} ${err.merged.length === 1 ? "was" : "were"} merged before the refusal`
        : "nothing was committed";
    return `refused: the change would violate the state's invariants; ${committed}.\n${findingsText(err.findings)}`;
  }
  if (err instanceof StateUnreadableError) {
    return `${err.message}; fix the file by hand before any tool can write.\n${findingsText(err.findings)}`;
  }
  if (err instanceof NotFoundError) return err.message;
  if (err instanceof GitConflictError) {
    return `${err.message}; the write was retried once and the branch moved again. Read and try again.`;
  }
  if (err instanceof GithubAppNotConfiguredError) return err.message;
  if (err instanceof NotMergeableError) {
    return `${err.message}. Nothing was committed; a node is done only when its pull requests are merged.`;
  }
  if (
    err instanceof PullRequestError ||
    err instanceof GithubAppAuthError ||
    err instanceof GithubFetchError ||
    err instanceof GitWriteError
  ) {
    return `${err.message} (HTTP ${err.status}): ${err.body}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** How a session's write to a node or a decision is authorized (owner,
 * 2026-11-12): by the open task it is part of, or, for a change the
 * owner dictated, by the owner's words. */
const authorityFields = {
  task: z
    .string()
    .regex(/^T\d{3,}$/)
    .optional()
    .describe(
      "The open task this write is part of: claim the node with task_open first. Required unless ownerInstruction is given.",
    ),
  ownerInstruction: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Only when the owner dictated this exact change to you in this conversation (hold, park, remove, retitle, answer a decision): their words, quoted. Never a way to do a node's work without a task.",
    ),
};

interface Authority {
  task?: string | undefined;
  ownerInstruction?: string | undefined;
}

/** The task a write is under, or the owner's instruction it rests on;
 * a write with neither is refused. */
function authorize(
  state: State,
  input: Authority,
): { task: string | null; note: string } {
  if (input.task !== undefined) {
    const task = state.tasks.find((t) => t.id === input.task);
    if (!task) throw new NotFoundError(`no task ${input.task}`);
    if (task.status !== "open") {
      throw new NotFoundError(
        `task ${input.task} is ${task.status}, not open; a write needs an open task: claim the node with task_open`,
      );
    }
    return { task: task.id, note: "" };
  }
  const words = input.ownerInstruction?.trim() ?? "";
  if (words !== "") {
    return {
      task: null,
      note: ` [no task; the owner's instruction: ${JSON.stringify(words)}]`,
    };
  }
  throw new NotFoundError(
    "refused: this write is not under a task. Claim the node with task_open and pass the task's identifier as `task`. " +
      "Only for a change the owner dictated to you in this conversation, pass their words as `ownerInstruction` instead. Nothing was committed.",
  );
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
  const requireProject = (): { owner: string; repo: string } => {
    if (!options.project) {
      throw new Error(
        "registerStateTools: no project resolved (internal error — the route must resolve a project before building the server)",
      );
    }
    return options.project;
  };
  const store = (): StateStore =>
    options.store ??
    (() => {
      const { owner, repo } = requireProject();
      return new StateStore({
        reader: getDefaultCommitReader(owner, repo),
        writer: getDefaultGitWriter(owner, repo),
        now,
      });
    })();

  const pullRequests = (): PullRequests =>
    options.pullRequests ??
    (() => {
      const { owner, repo } = requireProject();
      return getDefaultPullRequests(owner, repo);
    })();

  // Lazy, like `store()` and `pullRequests()` above, and for the same
  // reason: building the default runtime touches GitHub App
  // configuration (it shares the commit reader `plan_read` uses), and
  // a deployment missing that configuration — or a test that gives
  // neither a project nor its own runtime — must still serve every
  // other tool rather than fail at server construction.
  const fireRuntime = (): FireRuntime | undefined =>
    options.fire ??
    (options.project ? defaultFireRuntime(options.project, now) : undefined);

  /** Runs the fire check after a write a tool call just committed
   * (P2-N048, design 1: after a write, and at no other time). Never
   * lets a fire-check failure turn a successful write into a tool
   * error — the write already committed correctly; firing is a side
   * effect of it, not part of it. */
  const checkFire = async (session?: string): Promise<void> => {
    try {
      const runtime = fireRuntime();
      if (!runtime) return;
      await runFireCheck(store(), runtime, { session: session ?? null });
    } catch (err) {
      console.error("fire check failed:", describeError(err));
    }
  };

  /** `writeResult`, with the fire check run first. Every write tool
   * but `task_cost` returns through this: a task's measured cost never
   * moves a node's stage, so no step is ever newly offered by it. */
  const afterWrite = async (
    result: WriteResult,
    extra: Record<string, unknown>,
    session?: string,
  ): Promise<ToolResult> => {
    await checkFire(session);
    return writeResult(result, extra);
  };

  /** A write to nodes or decisions by a session: under an open task,
   * or on the owner's instruction; the commit and the journal say
   * which. The view's own writes do not come through here. */
  const guardedWrite = (
    input: Authority,
    message: string,
    mutate: (state: State, context: { baseSha: string }) => WriteEvent,
    step?: (state: State, context: { baseSha: string }) => Promise<void> | void,
  ): Promise<WriteResult> =>
    store().write(
      `${message}${input.task ? ` (${input.task})` : input.ownerInstruction ? " (no task: the owner's instruction)" : ""}`,
      (state, context) => {
        const authority = authorize(state, input);
        const event = mutate(state, context);
        return {
          ...event,
          task: authority.task ?? event.task,
          note: event.note + authority.note,
        };
      },
      step,
    );

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
        "Changes one node's stage, hold, start, outcome, title, note, dependencies, " +
        "repository or document paths and commits the state file. A node moved to " +
        "`done` gains today's date. Refused, with nothing committed, when the result " +
        "would violate an invariant. To move a linked document: name its new path in " +
        "`docsOnMerge` under your open execute task, then move the file in that " +
        "task's pull request.",
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
        repository: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+$/, "owner/name")
          .nullable()
          .optional()
          .describe(
            "The repository the node's work is claimed from and its pull request " +
              "opened in, owner/name, or null for the project's coordinating " +
              "repository. Counts as the node's scope, like its title, outcome, " +
              "parent, dependencies and documents.",
          ),
        note: z.string().nullable().optional(),
        after: z
          .array(nodeId)
          .optional()
          .describe("The full list of nodes this one waits for."),
        docs: z
          .object({
            plan: z.string().min(1).nullable().optional(),
            spec: z.string().min(1).nullable().optional(),
          })
          .optional()
          .describe(
            "The node's plan and specification documents, changed now: each a path or null. A path must already be a file on the default branch. To move a file, use docsOnMerge.",
          ),
        docsOnMerge: z
          .object({
            plan: z.string().min(1).optional(),
            spec: z.string().min(1).optional(),
          })
          .optional()
          .describe(
            "The path a document will have once your task's pull request merges. The node's path is cleared now, so the pull request may move the file, and the new path is set when your task's node is done. Needs `task`, your open execute task. Not for your task's own node: that changes its scope.",
          ),
        ...authorityFields,
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        let changes: string[] = [];
        let merged: string[] = [];
        const paths = [input.docs?.plan, input.docs?.spec].filter(
          (p): p is string => typeof p === "string",
        );
        if (paths.length > 0) {
          // A path set now must be a file now, or the default branch
          // would fail its check on the next commit.
          const sha = await store().headSha();
          for (const path of paths) {
            if (!(await store().fileExistsAt(sha, path))) {
              return toolError(
                `refused: ${path} is not a file on the default branch at ${sha}. Nothing was committed. To move a document, name its new path in docsOnMerge and move the file in your task's pull request.`,
              );
            }
          }
        }
        // Done needs the node's pull requests merged. The merge runs as
        // `write`'s step: only after the close has trialled clean
        // against the invariants, and only once even if the branch
        // moves and the write retries (P4-N073).
        const step =
          input.stage === "done"
            ? async (state: State): Promise<void> => {
                await requirePendingDocs(
                  store(),
                  pullRequests,
                  state,
                  input.nodeId,
                );
                merged = (
                  await ensureMerged(
                    pullRequests,
                    pullRequestsOf(state, input.nodeId),
                    undefined,
                    expectedHeads(state, input.nodeId),
                  )
                ).merged;
              }
            : undefined;
        let result: WriteResult;
        try {
          result = await guardedWrite(
            input,
            `${input.nodeId}: ${input.reason}`,
            (state) => {
              const applied = updateNode(state, input, today(now));
              changes = applied.changes;
              return applied.event;
            },
            step,
          );
        } catch (err) {
          if (err instanceof WriteRefusedError && merged.length > 0) {
            throw new WriteRefusedError(err.findings, merged);
          }
          throw err;
        }
        return afterWrite(
          result,
          {
            nodeId: input.nodeId,
            changes,
            ...(merged.length > 0 ? { merged } : {}),
          },
          input.session,
        );
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
    // An execute step on a node under verification is the rework of
    // a failed verification: what failed is the first thing to read.
    const failed =
      step === "execute" && node.stage === "verifying"
        ? failedCheckNode(node, childrenOf(state))
        : undefined;
    return {
      node: {
        ...node,
        class: classes.get(node.id),
        classLabel: NODE_CLASS_LABELS[classes.get(node.id)!],
      },
      step,
      steps,
      role,
      rework: failed
        ? {
            checkNode: failed.id,
            failed: failed.hold!.reason,
            pullRequests: pullRequestsOf(state, node.id),
            note: "This is the rework of a failed verification. Fix what the verification names, on the same pull request, then close this task: the check node gets a new round.",
          }
        : null,
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
      standing: standingDecisions(state),
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
        repository: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+$/, "owner/name")
          .optional()
          .describe(
            "The repository this session is working in: answers only the candidates whose node resolves to it. Default: every repository.",
          ),
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
          // A stale close can itself make a step newly offered (the
          // node's open task is gone), so it gets the same fire check
          // every other write does.
          await checkFire(input.session);
          read = await store().read();
          if (read.state === null) {
            return toolError(
              `orchestration/state.json at ${read.sha} does not validate:\n${findingsText(read.findings)}`,
            );
          }
        }
        const state = read.state;
        const found = candidates(state, input.role, input.repository);
        const first = found[0];
        if (first === undefined) {
          return ok({
            ref: read.ref,
            sha: read.sha,
            fetchedAt: read.fetchedAt,
            staleClosed,
            next: null,
            candidates: [],
            message: `no node offers a step${input.role ? ` for ${input.role}` : ""}${input.repository ? ` in ${input.repository}` : ""}; what remains waits on the owner, on a dependency or on an open task`,
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
            rework: c.step === "execute" && c.node.stage === "verifying",
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
        repository: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+$/, "owner/name")
          .optional()
          .describe(
            "The repository this claim is for: refused when the node resolves to another, naming which.",
          ),
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
              nextTaskId(state),
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
        return afterWrite(
          result,
          {
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
          },
          input.session,
        );
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
        "completes its parent). Each ask becomes an open decision, whatever the " +
        "status. `blocked` or `needs-judgment` with asks leaves the node gated by " +
        "those decisions, and it offers its step again once they are answered; " +
        "without asks the node is held for the owner. A verification closed " +
        "`blocked` has failed: the verified node offers `execute` again for the " +
        "rework, with no owner action. A scope that " +
        "changed since the task opened closes it as needs-judgment. A planning step " +
        "delivers the title, outcome and documents here, applied at close. Pull " +
        "requests are merged by the service, never by the session: a planning " +
        "step's at its close, an execute step's when its verification closes; a " +
        "pull request that cannot be merged refuses the close, and so does one " +
        "with commits made after its last execute task closed. Give `branch` " +
        "instead of `pr` and the service opens the pull request. Answers `stop` " +
        "when the session should return to the owner.",
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
        branch: z
          .string()
          .min(1)
          .optional()
          .describe(
            "The branch the work is on, when no pull request is open yet: the service opens one.",
          ),
        repo: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+$/)
          .optional()
          .describe(
            "The repository of `branch`, owner/name; default: the project.",
          ),
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        // The node's scope at the task's base commit, for the stop
        // condition; a task from before the loop has no base. `base`
        // is set once, at task_open, and never moves, so reading it
        // ahead of `write` opens no window the way reading the task
        // or the node for anything else would (P4-N073).
        const base = await store().read();
        const openTask = base.state?.tasks.find((t) => t.id === input.taskId);
        let scopeAtBase: string | null = null;
        if (openTask?.base) {
          const atBase = await store().readStateAt(openTask.base);
          const there = atBase.state?.nodes.find((n) => n.id === openTask.node);
          if (there) scopeAtBase = scopeOf(there);
        }
        // The pull request: opened here for a branch that has none,
        // and merged here when this close is the done decision. Both
        // run as `write`'s step, against the state the write itself
        // reads, so they happen only once the close has trialled clean
        // against the invariants, and never twice if the branch moves
        // and the write retries (P4-N073).
        let pr: string | undefined = input.pr;
        let merged: string[] = [];
        let headAtClose: string | undefined;
        const step = async (state: State): Promise<void> => {
          const task = state.tasks.find((t) => t.id === input.taskId);
          const headNode = state.nodes.find((n) => n.id === task?.node);
          const accepted =
            input.status === "closed" &&
            task !== undefined &&
            task.status === "open" &&
            headNode !== undefined &&
            !(scopeAtBase !== null && scopeAtBase !== scopeOf(headNode));
          if (!accepted) return;
          if (pr === undefined && task.pr === null && input.branch) {
            pr = await pullRequests().create({
              repo: input.repo ?? repositoryOf(headNode, state),
              branch: input.branch,
              title: `${headNode.id} ${task.step}: ${headNode.title}`,
              body: `${input.summary}\n\nTask ${task.id} on node ${headNode.id}, opened by the orchestration service at task_close.`,
            });
          }
          const toMerge = mergesAtClose(state, task, pr ?? task.pr);
          const verified =
            task.step === "verify" ? (headNode.parent ?? null) : null;
          if (verified !== null) {
            await requirePendingDocs(store(), pullRequests, state, verified);
          }
          merged = (
            await ensureMerged(
              pullRequests,
              toMerge,
              undefined,
              verified === null ? new Map() : expectedHeads(state, verified),
            )
          ).merged;
          // An execute step's pull request waits for its verification.
          // Its head at this close is recorded as the task's commit:
          // the merge later refuses a pull request that has moved on,
          // since those commits would belong to no task.
          const waiting = pr ?? task.pr;
          if (task.step === "execute" && waiting !== null) {
            headAtClose = (await pullRequests().get(waiting)).headSha;
          }
        };
        let closed: CloseResult | null = null;
        let result: WriteResult;
        try {
          result = await store().write(
            `${input.taskId}: ${input.status}`,
            (state) => {
              closed = closeTask(
                state,
                {
                  ...input,
                  ...(pr === undefined ? {} : { pr }),
                  ...(headAtClose === undefined ? {} : { ref: headAtClose }),
                  status: input.status as CloseInput["status"],
                },
                scopeAtBase,
                today(now),
                timestamp(now),
                nextDecisionId,
              );
              return closed.event;
            },
            step,
          );
        } catch (err) {
          if (err instanceof WriteRefusedError && merged.length > 0) {
            throw new WriteRefusedError(err.findings, merged);
          }
          throw err;
        }
        const done = closed!;
        return afterWrite(
          result,
          {
            taskId: done.task.id,
            status: done.task.status,
            nodeId: done.node.id,
            nodeStage: done.node.stage,
            pr: done.task.pr,
            merged,
            moved: done.moved,
            decisionsOpened: done.decisions,
            stop: done.stop,
          },
          input.session,
        );
      }),
  );

  server.registerTool(
    "task_cost",
    {
      title: "Record a task's cost",
      description:
        "Records a task's measured cost: tokens by type and the model. Called by " +
        "the repository's hook when task_close returns, or by a headless runner " +
        "with its run's result; a session does not call it with estimates. A " +
        "later record replaces an earlier one.",
      inputSchema: {
        taskId: z.string().regex(/^T\d{3,}$/),
        tokensIn: z.number().int().nonnegative(),
        tokensOut: z.number().int().nonnegative(),
        cacheRead: z.number().int().nonnegative().optional(),
        cacheWrite: z.number().int().nonnegative().optional(),
        model: z.string().min(1).optional(),
        source: z.enum(COST_SOURCES),
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        const result = await store().write(
          `${input.taskId}: cost recorded`,
          (state) => recordCost(state, input).event,
        );
        return writeResult(result, { taskId: input.taskId });
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
        ...authorityFields,
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        let id = "";
        const result = await guardedWrite(
          input,
          `${input.parentId ?? input.line ?? "plan"}: node added`,
          (state) => {
            const added = addNode(state, input);
            id = added.node.id;
            return added.event;
          },
        );
        return afterWrite(result, { nodeId: id }, input.session);
      }),
  );

  server.registerTool(
    "node_remove",
    {
      title: "Remove an obsolete node",
      description:
        "Removes an obsolete node with everything below it, their tasks and " +
        "their decisions, and commits; git keeps the history. A node that waited " +
        "for a removed one no longer does. Refused while a task is open under it. " +
        "For work that will resume, hold or park the node instead.",
      inputSchema: {
        nodeId,
        reason: z
          .string()
          .min(1)
          .describe(
            "Why the node is obsolete; goes in the commit and the journal.",
          ),
        ...authorityFields,
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        let removed: RemoveResult | null = null;
        const result = await guardedWrite(
          input,
          `${input.nodeId} removed: ${input.reason}`,
          (state) => {
            removed = removeNode(state, input);
            return removed.event;
          },
        );
        const done = removed!;
        return afterWrite(
          result,
          {
            removed: done.nodes,
            tasks: done.tasks,
            decisions: done.decisions,
            unlinked: done.unlinked,
            moved: done.moved,
          },
          input.session,
        );
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
        ...authorityFields,
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        let id = "";
        const result = await guardedWrite(
          input,
          `${input.nodeId ?? "project"}: decision opened`,
          (state) => {
            if (
              input.nodeId !== null &&
              !state.nodes.some((x) => x.id === input.nodeId)
            ) {
              throw new NotFoundError(`no node ${input.nodeId}`);
            }
            id = nextDecisionId(state);
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
        return afterWrite(result, { decisionId: id }, input.session);
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
        ...authorityFields,
        session: sessionField,
      },
    },
    async (input) =>
      run(async () => {
        let node: string | null = null;
        const result = await guardedWrite(
          input,
          `${input.decisionId}: ${input.chosen}`,
          (state) => {
            const applied = closeDecision(state, input, today(now));
            node = applied.decision.node;
            return applied.event;
          },
        );
        return afterWrite(
          result,
          { decisionId: input.decisionId, nodeId: node },
          input.session,
        );
      }),
  );
}
