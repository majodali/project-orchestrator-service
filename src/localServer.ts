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
import { previewViewOptions } from "./view/fixtureReader.js";

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8787;

// `VIEW_FIXTURE_DIR` set: the web view reads that directory instead of
// GitHub (the preview mode, src/view/fixtureReader.ts). Unset: the
// options are undefined and the app is the one Lambda runs.
const view = previewViewOptions();
const app = createApp(view === undefined ? {} : { view });

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(
    `project-orchestrator-service listening on http://localhost:${info.port}`,
  );
  console.log(`  health: http://localhost:${info.port}/health`);
  console.log(`  mcp:    http://localhost:${info.port}/mcp`);
  console.log(`  view:   http://localhost:${info.port}/view`);
  if (view !== undefined) {
    console.log(
      `  the view reads ${process.env.VIEW_FIXTURE_DIR}, not GitHub (preview mode)`,
    );
  }
});

function shutdown() {
  server.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
