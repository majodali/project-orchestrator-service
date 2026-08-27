/**
 * Local dev server — runs the same `createApp()` Hono app that the
 * Lambda handler wraps, over plain Node HTTP. Used for:
 *   - `npm run dev` (a human trying the service against a local
 *     Claude Code session, per the deploy runbook's local-verification
 *     step);
 *   - the integration test that calls `service_identity` over real
 *     HTTP with and without a valid token (test/httpApp.identity.test.ts).
 *
 * Not the deployed service — see src/lambda.ts and template.yaml for
 * that. Kept intentionally thin: this file's only job is to bind
 * `createApp()`'s fetch handler to a port.
 */

import { serve } from "@hono/node-server";

import { createApp } from "./httpApp.js";

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8787;

const app = createApp();

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(
    `project-orchestrator-service listening on http://localhost:${info.port}`,
  );
  console.log(`  health: http://localhost:${info.port}/health`);
  console.log(`  mcp:    http://localhost:${info.port}/mcp`);
});

function shutdown() {
  server.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
