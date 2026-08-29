/**
 * The MCP server itself. `service_identity` (chunk 1 child B, node
 * P2-N008, the reachability slice) proves a session can call this
 * service at all, over an authenticated transport, and get a real
 * answer back. `plan_read` (chunk 1 child C, node P2-N009) is the
 * first real plan-state tool — see src/planReadTool.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getServiceIdentity } from "./serviceInfo.js";
import { registerPlanReadTool } from "./planReadTool.js";
import type { RegisterFetcher } from "./planRegister/registerFetcher.js";

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
} as const;

const identityOutputSchema = z.object(identityOutputShape);

export interface CreateMcpServerOptions {
  /**
   * Overrides `plan_read`'s GitHub fetcher — test-only. Production
   * call sites (src/httpApp.ts) omit this and get the real,
   * GitHub-App-backed fetcher built lazily from environment
   * configuration (src/planRegister/defaultFetcher.ts).
   */
  planRegisterFetcher?: RegisterFetcher;
}

/**
 * Builds a fresh `McpServer` instance. Called once per request in
 * stateless mode (see `src/httpApp.ts`) — the server carries no state
 * of its own, so there is nothing to share or clean up between calls.
 */
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
        "project — the reachability slice's proof that a session can reach the " +
        "deployed, authenticated MCP server at all (R11). Carries no plan state.",
      inputSchema: {},
      outputSchema: identityOutputShape,
    },
    () => {
      const identity = getServiceIdentity();
      // Validated against outputSchema by the SDK before it leaves the
      // process; parsing here as well only to get a fully-typed value
      // for the structuredContent field.
      const structuredContent = identityOutputSchema.parse(identity);
      return {
        content: [
          { type: "text", text: JSON.stringify(structuredContent, null, 2) },
        ],
        structuredContent,
      };
    },
  );

  registerPlanReadTool(server, options.planRegisterFetcher);

  return server;
}
