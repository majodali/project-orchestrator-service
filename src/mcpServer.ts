/**
 * The MCP server itself. `service_identity` (chunk 1 child B, node
 * P2-N008, the reachability slice) proves a session can call this
 * service at all, over an authenticated transport, and get a real
 * answer back. `plan_read` (chunk 1 child C, node P2-N009) is the
 * first real plan-state tool — see src/planReadTool.ts.
 * `plan_lease_acquire` / `plan_update` / `plan_confirm` /
 * `plan_lease_release` (chunk 1 child D, node P2-N010) are the write
 * path — see src/planWriteTools.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getServiceIdentity } from "./serviceInfo.js";
import { registerPlanReadTool } from "./planReadTool.js";
import { registerPlanWriteTools } from "./planWriteTools.js";
import type { RegisterFetcher } from "./planRegister/registerFetcher.js";
import type { LeaseBackend } from "./planRegister/leaseBackend.js";

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
   * Overrides `plan_read` and the write path's GitHub fetcher —
   * test-only. Production call sites (src/httpApp.ts) omit this and
   * get the real, GitHub-App-backed fetcher built lazily from
   * environment configuration (src/planRegister/defaultFetcher.ts).
   */
  planRegisterFetcher?: RegisterFetcher;
  /**
   * Overrides the write path's lease backend — test-only (and used by
   * a local `npm run dev` session with no DynamoDB configured, via
   * src/planRegister/inMemoryLeaseBackend.ts). Production call sites
   * omit this and get the real, DynamoDB-backed backend built lazily
   * from environment configuration
   * (src/planRegister/defaultLeaseBackend.ts).
   */
  planLeaseBackend?: LeaseBackend;
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
  registerPlanWriteTools(server, {
    fetcherOverride: options.planRegisterFetcher,
    leaseBackendOverride: options.planLeaseBackend,
  });

  return server;
}
