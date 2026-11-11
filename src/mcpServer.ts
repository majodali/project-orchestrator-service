/**
 * The MCP server: `service_identity`, and the state tools of
 * src/stateTools.ts, which read and write orchestration/state.json of
 * the coordinating repository through the installed GitHub App (the
 * rebuild plan, milestone 3). Nothing else holds state: no lease, no
 * table.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getServiceIdentity } from "./serviceInfo.js";
import type { InvokedQualifierInfo } from "./serviceInfo.js";
import { registerStateTools } from "./stateTools.js";
import type { StateToolsOptions } from "./stateTools.js";

const identityOutputShape = {
  service: z.string().describe("The service's own name."),
  version: z.string().describe("The service's own version (package.json)."),
  commit: z
    .string()
    .describe(
      'The git commit this deployment was built from, or "unknown" for an unbuilt local run.',
    ),
  project: z
    .string()
    .describe("The coordinating repository this deployment is configured for."),
  invokedQualifier: z
    .string()
    .optional()
    .describe(
      'The Lambda alias this request was invoked through ("live" / "preprod" / "$LATEST"). ' +
        "Absent when this process is not running under Lambda at all.",
    ),
} as const;

const identityOutputSchema = z.object(identityOutputShape);

export interface CreateMcpServerOptions {
  /** Test-only: the state tools' store and clock. */
  state?: StateToolsOptions;
  /** The invoked Lambda qualifier, forwarded into `service_identity`;
   * undefined outside Lambda. */
  lambdaQualifier?: InvokedQualifierInfo;
}

export const TOOL_NAMES = [
  "service_identity",
  "plan_read",
  "node_update",
  "node_add",
  "task_next",
  "task_open",
  "task_close",
  "decision_open",
  "decision_close",
] as const;

export function createMcpServer(
  options: CreateMcpServerOptions = {},
): McpServer {
  const server = new McpServer({
    name: "project-orchestrator-service",
    version: getServiceIdentity().version,
  });

  server.registerTool(
    "service_identity",
    {
      title: "Service identity",
      description:
        "Returns this service's own name, version, build commit, and configured " +
        "project — the proof that a session can reach the deployed, authenticated " +
        "MCP server at all. Carries no plan state.",
      inputSchema: {},
      outputSchema: identityOutputShape,
    },
    () => {
      const identity = getServiceIdentity(process.env, options.lambdaQualifier);
      const structuredContent = identityOutputSchema.parse(identity);
      return {
        content: [
          { type: "text", text: JSON.stringify(structuredContent, null, 2) },
        ],
        structuredContent,
      };
    },
  );

  registerStateTools(server, options.state);

  return server;
}
