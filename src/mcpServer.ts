/**
 * The MCP server itself — chunk 1 child B, node P2-N008 (the
 * reachability slice). One tool, `service_identity`, deliberately
 * near-empty of content: it exists to prove that a session can call
 * this service at all, over an authenticated transport, and get a
 * real answer back. No plan-state logic; that starts with children C
 * and D (see docs/backlog.md).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getServiceIdentity } from "./serviceInfo.js";

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

/**
 * Builds a fresh `McpServer` instance. Called once per request in
 * stateless mode (see `src/httpApp.ts`) — the server carries no state
 * of its own, so there is nothing to share or clean up between calls.
 */
export function createMcpServer(): McpServer {
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

  return server;
}
