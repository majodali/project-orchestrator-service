/**
 * AWS Lambda entry point — chunk 1 child B. Wraps the same
 * `createApp()` Hono app the local dev server runs (src/localServer.ts)
 * with `hono/aws-lambda`'s `handle()`, which adapts API Gateway
 * (v1 and v2), ALB, and Lambda Function URL events to and from the Web
 * Standard Request/Response objects the app already speaks — no
 * separate HTTP-framing code path to drift from what is verified
 * locally.
 *
 * See template.yaml for the function definition (Node.js 22 runtime,
 * HTTP API trigger, esbuild bundling) and docs/runbook.md for how this
 * gets deployed.
 */

import { handle } from "hono/aws-lambda";

import { createApp } from "./httpApp.js";

export const handler = handle(createApp());
