/**
 * project-orchestrator-service — entry point.
 *
 * This module is iteration-zero scaffolding (node P2-N007, chunk 1
 * child A of the orchestration-service plan). It exists to prove the
 * TypeScript/Node skeleton builds, lints, and tests cleanly — it is
 * not the MCP server itself.
 *
 * The MCP server, its tools (`plan_read`, `plan_lease_acquire`,
 * `plan_update`, `plan_confirm`, ...), the Lambda handler, and the
 * infrastructure-as-code definition arrive in later children of this
 * chunk (see ../docs/backlog.md and the chunk plan/spec cited there).
 */

export const SERVICE_NAME = "project-orchestrator-service";

/** Placeholder describing the skeleton's current state. Superseded
 * once the reachability slice (chunk 1 child B) adds a real identity
 * tool answered over MCP. */
export function describeService(): string {
  return `${SERVICE_NAME}: skeleton only, no MCP tools implemented yet`;
}
