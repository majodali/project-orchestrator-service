/**
 * Production wiring for the `LeaseBackend` the write-path tools use
 * when no override is supplied (chunk 1 child D, node P2-N010) — the
 * same lazy-build-on-first-use shape ./defaultFetcher.ts established
 * for `plan_read`'s GitHub App fetcher, so a server with no
 * `LEASE_TABLE_NAME` configured still starts and lists
 * `plan_lease_acquire` / `plan_update` / `plan_confirm` /
 * `plan_lease_release` cleanly; only a call to one of them reports the
 * missing configuration, by name, rather than a startup crash.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import { DynamoLeaseBackend } from "./dynamoLeaseBackend.js";
import type { LeaseBackend } from "./leaseBackend.js";

export class LeaseBackendNotConfiguredError extends Error {
  constructor() {
    super(
      "the write lease's DynamoDB table is not configured (missing environment " +
        "variable LEASE_TABLE_NAME). Owner action O2 (deploy with this child's " +
        "template.yaml, which provisions the table) has not been completed for " +
        "this deployment yet.",
    );
    this.name = "LeaseBackendNotConfiguredError";
  }
}

// Cached for the lifetime of this module instance (a warm Lambda
// container, or the local dev process), the same reasoning
// ./defaultFetcher.ts gives for caching its fetcher.
let cached: LeaseBackend | null = null;

export function getDefaultLeaseBackend(
  env: NodeJS.ProcessEnv = process.env,
): LeaseBackend {
  if (cached) {
    return cached;
  }
  const tableName = env.LEASE_TABLE_NAME?.trim();
  if (!tableName) {
    throw new LeaseBackendNotConfiguredError();
  }
  cached = new DynamoLeaseBackend(tableName, new DynamoDBClient({}));
  return cached;
}

/** Test-only escape hatch, mirroring
 * ./defaultFetcher.ts's resetDefaultRegisterFetcherForTests. */
export function resetDefaultLeaseBackendForTests(): void {
  cached = null;
}
