/**
 * project-orchestrator-service — legacy skeleton smoke-test target.
 *
 * This module dates from iteration-zero scaffolding (node P2-N007,
 * chunk 1 child A). It is kept, unchanged in behavior, only because
 * test/index.test.ts still exercises it as a build/module-resolution
 * smoke test; it is not part of the running service. The MCP server
 * itself now lives in src/mcpServer.ts + src/httpApp.ts, run locally
 * via src/localServer.ts and deployed via src/lambda.ts (chunk 1
 * child B, node P2-N008 — see ../docs/backlog.md). Later children add
 * `plan_read` / `plan_lease_acquire` / `plan_update` / `plan_confirm`.
 */

export const SERVICE_NAME = "project-orchestrator-service";

/** Unchanged since P2-N007; describes the pre-service-code state this
 * module was written to prove buildable, not the service's current
 * state (see src/serviceInfo.ts's `getServiceIdentity` for that). */
export function describeService(): string {
  return `${SERVICE_NAME}: skeleton only, no MCP tools implemented yet`;
}
