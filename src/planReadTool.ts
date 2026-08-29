/**
 * `plan_read` — chunk 1 child C, node P2-N009 of
 * docs/plans/p2-n002-service-skeleton.md in the coordinating
 * repository (majodali/project-orchestrator).
 *
 * Reads that repository's real Plan register (docs/plan-register.md)
 * at an explicit git ref (default: the repository's default branch),
 * through the installed GitHub App — never from any local or cached
 * copy (I5: "no tool derives plan state from anything but repository
 * content fetched through the GitHub App"). Parses it into structured
 * nodes (src/planRegister/parser.ts, grammar cited to
 * docs/process/plan-register.md) and answers whole-tree or subtree
 * (`nodeId`) queries. Every response carries the commit SHA and fetch
 * time the answer was computed from.
 *
 * `fetcherOverride` is the injectable seam I5 requires for testing
 * without real GitHub credentials (see src/planRegister/registerFetcher.ts).
 * Production wiring (src/mcpServer.ts / src/httpApp.ts) leaves it
 * unset and gets src/planRegister/defaultFetcher.ts's real,
 * GitHub-App-backed fetcher instead.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { parseRegister, subtreeIds } from "./planRegister/parser.js";
import type { PlanNode, RegisterParseResult } from "./planRegister/types.js";
import type { RegisterFetcher } from "./planRegister/registerFetcher.js";
import { GithubFetchError } from "./planRegister/registerFetcher.js";
import { GithubAppAuthError } from "./planRegister/githubAppAuth.js";
import {
  GithubAppNotConfiguredError,
  getDefaultRegisterFetcher,
} from "./planRegister/defaultFetcher.js";

const holdOutputShape = z.object({
  kind: z.enum(["gated", "blocked"]),
  reason: z.string(),
});

const linkOutputShape = z.object({
  label: z.string(),
  target: z.string(),
});

const nodeOutputShape = z.object({
  id: z.string(),
  stage: z
    .string()
    .describe(
      "As recorded in the register. Vocabulary: docs/process/plan-model.md " +
        "in the coordinating repository — cited, not re-declared here.",
    ),
  hold: holdOutputShape.nullable(),
  title: z.string(),
  annotation: z
    .string()
    .nullable()
    .describe("Verbatim text after the entry's em dash, if any."),
  links: z
    .array(linkOutputShape)
    .describe("Best-effort label: target pairs parsed from annotation."),
  parentId: z.string().nullable(),
  childIds: z.array(z.string()),
  line: z
    .number()
    .int()
    .describe("1-based line number in the source register text."),
});

const parseErrorOutputShape = z.object({
  line: z.number().int(),
  raw: z.string(),
  reason: z.string(),
});

const planReadOutputShape = {
  ref: z
    .string()
    .describe(
      "The ref requested, or the resolved default-branch name if none was given.",
    ),
  sha: z
    .string()
    .describe(
      "The commit SHA this answer was computed from (I5 — ref discipline).",
    ),
  fetchedAt: z
    .string()
    .describe("ISO-8601 timestamp of the GitHub fetch this answer reflects."),
  rootIds: z
    .array(z.string())
    .describe(
      "Top-level node IDs in the returned set: the whole tree's roots, " +
        "or the single queried node for a subtree query.",
    ),
  nodes: z.array(nodeOutputShape),
  errors: z
    .array(parseErrorOutputShape)
    .describe(
      "Node-like register lines that did not parse — reported, never silently dropped.",
    ),
} as const;

const planReadOutputSchema = z.object(planReadOutputShape);

const planReadInputShape = {
  ref: z
    .string()
    .optional()
    .describe(
      "Git ref (branch, tag, or commit SHA) to read the coordinating repository's " +
        "docs/plan-register.md at. Defaults to the repository's default branch (I5).",
    ),
  nodeId: z
    .string()
    .optional()
    .describe(
      "A node ID (e.g. P2-N009). If set, returns only that node and its " +
        "descendants (a subtree query) instead of the whole tree.",
    ),
} as const;

function toolError(text: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { content: [{ type: "text", text }], isError: true };
}

function describeFetchError(err: unknown): string {
  if (err instanceof GithubAppNotConfiguredError) {
    return err.message;
  }
  if (err instanceof GithubAppAuthError || err instanceof GithubFetchError) {
    return `${err.message} (HTTP ${err.status}): ${err.body}`;
  }
  if (err instanceof Error) {
    return `plan_read could not reach GitHub: ${err.message}`;
  }
  return `plan_read could not reach GitHub: ${String(err)}`;
}

function selectNodes(
  parsed: RegisterParseResult,
  nodeId: string | undefined,
): { nodes: PlanNode[]; rootIds: string[] } | { error: string } {
  if (nodeId === undefined) {
    return {
      nodes: parsed.order.map((id) => parsed.nodes.get(id)!),
      rootIds: parsed.rootIds,
    };
  }
  const ids = subtreeIds(parsed, nodeId);
  if (ids === null) {
    return { error: `no node ${JSON.stringify(nodeId)} in this register` };
  }
  return { nodes: ids.map((id) => parsed.nodes.get(id)!), rootIds: [nodeId] };
}

export function registerPlanReadTool(
  server: McpServer,
  fetcherOverride?: RegisterFetcher,
): void {
  server.registerTool(
    "plan_read",
    {
      title: "Plan register read",
      description:
        "Reads the coordinating repository's (majodali/project-orchestrator) Plan " +
        "register (docs/plan-register.md) at a git ref, through the installed " +
        "GitHub App — never from any local or cached copy (I5). Returns every " +
        "node's ID, stage, hold marker, title, links, and parent/child edges " +
        "(grammar: docs/process/plan-register.md), plus the commit SHA and fetch " +
        "time the answer was computed from. Pass nodeId for a subtree query — " +
        "that node and its descendants only. Stage vocabulary is the node " +
        "lifecycle in docs/process/plan-model.md, cited there, not restated here.",
      inputSchema: planReadInputShape,
      outputSchema: planReadOutputShape,
    },
    async ({ ref, nodeId }) => {
      const fetcher = fetcherOverride ?? getDefaultRegisterFetcher();

      let fetched;
      try {
        fetched = await fetcher.fetchPlanRegister(ref);
      } catch (err) {
        return toolError(describeFetchError(err));
      }

      const parsed = parseRegister(fetched.content);
      const selection = selectNodes(parsed, nodeId);
      if ("error" in selection) {
        return toolError(
          `${selection.error} at ${fetched.sha} (ref ${fetched.ref}, fetched ${fetched.fetchedAt}).`,
        );
      }

      const structuredContent = planReadOutputSchema.parse({
        ref: fetched.ref,
        sha: fetched.sha,
        fetchedAt: fetched.fetchedAt,
        rootIds: selection.rootIds,
        nodes: selection.nodes,
        errors: parsed.errors,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );
}
