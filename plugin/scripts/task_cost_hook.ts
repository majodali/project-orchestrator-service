#!/usr/bin/env node
// Generated from plugin/scripts/task_cost_hook.ts in majodali/project-orchestrator by vendor_cost_hook.ts (RU-012) - do not edit here; edit the source and re-run.
/**
 * The cost hook (the rebuild plan, "Cost capture"; owner, 2026-11-11).
 * Claude Code runs it after `task_close` returns (PostToolUse, wired
 * in .claude/settings.json). It measures the task from the session
 * transcript (./lib/task-cost.ts) and records the figure with the
 * orchestration service's `task_cost` tool, so no session estimates
 * its own tokens.
 *
 * It never fails the session: whatever goes wrong, it says so on
 * stderr and exits 0, and the task simply has no measured cost. It
 * prints no token and no secret.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { measureTask, parseTranscript } from "./lib/task-cost.ts";

function note(text: string): void {
  process.stderr.write(`task-cost hook: ${text}\n`);
}

async function readStdin(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

function serviceUrl(projectDir: string): string | null {
  try {
    const config = JSON.parse(
      readFileSync(join(projectDir, ".mcp.json"), "utf8"),
    ) as { mcpServers?: Record<string, { url?: string }> };
    return config.mcpServers?.["project-orchestrator"]?.url ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const input = JSON.parse(await readStdin()) as {
    session_id?: string;
    transcript_path?: string;
    tool_name?: string;
    tool_input?: { taskId?: string };
    cwd?: string;
  };
  if (!input.tool_name || !/(^|__)task_close$/.test(input.tool_name)) return;
  const taskId = input.tool_input?.taskId;
  if (!taskId || !/^T\d{3,}$/.test(taskId)) return note("no task identifier");
  if (!input.transcript_path || !existsSync(input.transcript_path)) {
    return note("no transcript to measure");
  }
  // The transcript is written a moment behind the conversation.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const main = parseTranscript(readFileSync(input.transcript_path, "utf8"));
  const subagentDir = join(
    dirname(input.transcript_path),
    input.session_id ?? "",
    "subagents",
  );
  const subagents =
    input.session_id && existsSync(subagentDir)
      ? readdirSync(subagentDir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) =>
            parseTranscript(readFileSync(join(subagentDir, f), "utf8")),
          )
      : [];
  const cost = measureTask(main, taskId, subagents);
  if (cost === null) {
    return note(`${taskId} was not opened in this session; nothing recorded`);
  }
  const url = serviceUrl(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? ".");
  const token = process.env.MCP_AUTH_TOKEN;
  if (!url || !token) return note("no service address or no MCP_AUTH_TOKEN");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "task_cost",
        arguments: {
          taskId,
          tokensIn: cost.tokensIn,
          tokensOut: cost.tokensOut,
          cacheRead: cost.cacheRead,
          cacheWrite: cost.cacheWrite,
          ...(cost.model === null ? {} : { model: cost.model }),
          source: "transcript",
          session: `cost hook, session ${input.session_id ?? "unknown"}`,
        },
      },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const body = (await res.json().catch(() => null)) as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  } | null;
  if (!res.ok || body?.result?.isError) {
    return note(
      `the service did not record ${taskId}: HTTP ${res.status} ${body?.result?.content?.[0]?.text ?? ""}`,
    );
  }
  note(
    `${taskId}: ${cost.tokensIn} in, ${cost.tokensOut} out, ${cost.cacheRead} cache read, ${cost.cacheWrite} cache write over ${cost.messages} messages`,
  );
}

main()
  .catch((err: unknown) => {
    note(err instanceof Error ? err.message : String(err));
  })
  .finally(() => {
    process.exitCode = 0;
  });
