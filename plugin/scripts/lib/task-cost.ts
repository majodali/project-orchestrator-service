// Generated from plugin/scripts/lib/task-cost.ts in majodali/project-orchestrator by vendor_cost_hook.ts (RU-012) - do not edit here; edit the source and re-run.
/**
 * Measures what a task cost from a Claude Code session transcript (the
 * rebuild plan, "Cost capture"; owner, 2026-11-11): the tokens by type
 * and the model, from the close of the session's previous task, or
 * from the start of the session when there is none, to the end of the
 * transcript.
 *
 * Not from the task's claim (owner, 2026-11-16). A session reads the
 * plan, the node's documents and the pull request before it claims,
 * and a verification's claim came seconds before its close: counting
 * from the claim left that work in no task's cost. Counting from the
 * previous close puts every token of a session in exactly one task. A
 * task opened inside another (a trial on a scratch node) takes what
 * came before its close, and the outer task the rest.
 *
 * The transcript's format is internal to Claude Code and undocumented,
 * so everything here is tolerant: a line that does not parse or lacks
 * a field is skipped, and a transcript in which the task's claim
 * cannot be found measures nothing rather than guessing.
 *
 * What the format is, as read from real transcripts on 2026-11-11: one
 * JSON object per line; an assistant entry carries `message.id`,
 * `message.model` and `message.usage` with `input_tokens`,
 * `output_tokens`, `cache_read_input_tokens` and
 * `cache_creation_input_tokens`; one message spans several lines, one
 * per content block, each repeating the usage, so a message is counted
 * once; a tool result is a user entry whose content block names its
 * `tool_use_id`. Subagent transcripts are separate files in the same
 * shape.
 */

export interface TaskCost {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  /** The model that produced most of the output, when any is named. */
  model: string | null;
  /** How many model messages were counted. */
  messages: number;
}

type Entry = Record<string, unknown>;

/** The lines of a transcript that parse as JSON objects. */
export function parseTranscript(text: string): Entry[] {
  const out: Entry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "object" && value !== null) out.push(value as Entry);
    } catch {
      // A line cut off mid-write, or not JSON: skipped.
    }
  }
  return out;
}

function blocks(entry: Entry): Entry[] {
  const message = entry.message as Entry | undefined;
  const content = message?.content;
  return Array.isArray(content)
    ? content.filter((b): b is Entry => typeof b === "object" && b !== null)
    : [];
}

/** A tool result's text: the string itself, or the text blocks of a
 * list joined. */
function resultText(block: Entry): string {
  const content = block.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: unknown) =>
        typeof b === "object" &&
        b !== null &&
        typeof (b as Entry).text === "string"
          ? ((b as Entry).text as string)
          : JSON.stringify(b),
      )
      .join("\n");
  }
  return JSON.stringify(content ?? "");
}

/**
 * Where the task was claimed: the index and time of the `task_open`
 * call whose result names the task, the last one if several do.
 */
export function findClaim(
  entries: Entry[],
  taskId: string,
): { index: number; timestamp: string | null } | null {
  const opens = new Map<string, number>();
  const names = new RegExp(`"taskId"\\s*:\\s*"${taskId}"`);
  let found: { index: number; timestamp: string | null } | null = null;
  entries.forEach((entry, index) => {
    for (const block of blocks(entry)) {
      if (
        block.type === "tool_use" &&
        typeof block.name === "string" &&
        /(^|__)task_open$/.test(block.name) &&
        typeof block.id === "string"
      ) {
        opens.set(block.id, index);
      }
      if (
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string" &&
        opens.has(block.tool_use_id) &&
        names.test(resultText(block))
      ) {
        const at = opens.get(block.tool_use_id)!;
        const ts = entries[at]!.timestamp;
        found = { index: at, timestamp: typeof ts === "string" ? ts : null };
      }
    }
  });
  return found;
}

/**
 * Where the task's cost starts: just after the last `task_close` call
 * for another task, or the start of the transcript. A close of this
 * same task is not a boundary: the hook runs after it, and a close
 * the service refused (checks still running) is called again.
 */
export function findWindowStart(
  entries: Entry[],
  taskId: string,
): { index: number; timestamp: string | null } {
  let start: { index: number; timestamp: string | null } = {
    index: 0,
    timestamp: null,
  };
  entries.forEach((entry, index) => {
    for (const block of blocks(entry)) {
      if (
        block.type === "tool_use" &&
        typeof block.name === "string" &&
        /(^|__)task_close$/.test(block.name)
      ) {
        const closed = (block.input as Entry | undefined)?.taskId;
        if (closed === taskId) continue;
        const ts = entry.timestamp;
        start = {
          index: index + 1,
          timestamp: typeof ts === "string" ? ts : null,
        };
      }
    }
  });
  return start;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/** Adds the usage of each model message once, however many lines
 * carry it. */
function addUsage(
  entries: Entry[],
  seen: Map<string, { usage: Entry; model: string | null }>,
): void {
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    const message = entry.message as Entry | undefined;
    const usage = message?.usage as Entry | undefined;
    const id = message?.id;
    if (!usage || typeof id !== "string") continue;
    const before = seen.get(id);
    // The last line of a message carries its final output count.
    if (
      !before ||
      count(usage.output_tokens) >= count(before.usage.output_tokens)
    ) {
      seen.set(id, {
        usage,
        model: typeof message?.model === "string" ? message.model : null,
      });
    }
  }
}

/**
 * The cost of a task: the main transcript from the close of the
 * previous task on, or from its start, and the subagent transcripts'
 * entries from that time on. Null when the task's claim is not in the
 * transcript: the task was opened by another session, and this one
 * cannot say what it cost.
 */
export function measureTask(
  main: Entry[],
  taskId: string,
  subagents: Entry[][] = [],
): TaskCost | null {
  if (findClaim(main, taskId) === null) return null;
  const start = findWindowStart(main, taskId);
  const seen = new Map<string, { usage: Entry; model: string | null }>();
  addUsage(main.slice(start.index), seen);
  for (const entries of subagents) {
    addUsage(
      entries.filter(
        (e) =>
          start.timestamp === null ||
          typeof e.timestamp !== "string" ||
          e.timestamp >= start.timestamp,
      ),
      seen,
    );
  }
  const cost: TaskCost = {
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    model: null,
    messages: seen.size,
  };
  const byModel = new Map<string, number>();
  for (const { usage, model } of seen.values()) {
    cost.tokensIn += count(usage.input_tokens);
    cost.tokensOut += count(usage.output_tokens);
    cost.cacheRead += count(usage.cache_read_input_tokens);
    cost.cacheWrite += count(usage.cache_creation_input_tokens);
    if (model !== null) {
      byModel.set(
        model,
        (byModel.get(model) ?? 0) + count(usage.output_tokens),
      );
    }
  }
  let most = -1;
  for (const [model, out] of byModel) {
    if (out > most) {
      most = out;
      cost.model = model;
    }
  }
  return cost;
}
