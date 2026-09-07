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
import type { LeaseBackend, LeaseInfo } from "./leaseBackend.js";
import { resolveAliasLeaseTable } from "./aliasLeaseTable.js";

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

// ---- Alias-aware selection (node P2-N015) --------------------------------
//
// A *separate* cache and a *separate* entry point from the two above,
// deliberately: `getDefaultLeaseBackend` (LEASE_TABLE_NAME, no
// qualifier) is what the local dev server and every test still call,
// unchanged (I7). This one is reached only from src/httpApp.ts, only
// when a Lambda `invokedFunctionArn` is present. Cached per resolved
// table name so `live` and `preprod` never share a client, and so a
// warm container that has already resolved one alias does not pay for
// a second `DynamoDBClient` on every request.

const aliasCache = new Map<string, LeaseBackend>();

/**
 * Resolves the qualifier from `invokedFunctionArn` (failing closed —
 * see ./aliasLeaseTable.ts) and returns a `LeaseBackend` bound to the
 * matching table. The resolution itself throws before any AWS client
 * is constructed, so an unrecognized qualifier never touches
 * DynamoDB — the refusal is a pure computation, provably so by
 * `test/aliasLeaseTable.test.ts` and the fail-closed cases in
 * `test/httpApp.aliasLease.test.ts`, which exercise this function
 * with no network access at all.
 */
export function getAliasAwareLeaseBackend(
  invokedFunctionArn: string,
  env: NodeJS.ProcessEnv = process.env,
): LeaseBackend {
  const { tableName } = resolveAliasLeaseTable(invokedFunctionArn, env);
  const existing = aliasCache.get(tableName);
  if (existing) {
    return existing;
  }
  const backend = new DynamoLeaseBackend(tableName, new DynamoDBClient({}));
  aliasCache.set(tableName, backend);
  return backend;
}

/**
 * A `LeaseBackend` that defers both qualifier resolution and (on the
 * success path) `DynamoDBClient` construction until the first actual
 * call — so building this wrapper, on every request under Lambda, has
 * no cost and touches no AWS API regardless of which MCP tool (if
 * any) a given request ends up calling. src/httpApp.ts builds one of
 * these per request whenever `c.env.lambdaContext.invokedFunctionArn`
 * is present, and passes it as the write tools' `planLeaseBackend`
 * override — the same seam test/dev overrides already use, now doing
 * real work instead of standing in for it.
 */
export class LazyAliasLeaseBackend implements LeaseBackend {
  constructor(
    private readonly invokedFunctionArn: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private resolve(): LeaseBackend {
    return getAliasAwareLeaseBackend(this.invokedFunctionArn, this.env);
  }

  // Deliberately `async` (not "return this.resolve().readLease(now)"
  // directly): resolve() can throw synchronously (an unrecognized
  // qualifier, before any AWS client exists — see
  // getAliasAwareLeaseBackend). Wrapping in `async` guarantees that
  // throw always surfaces as a rejected Promise, the same shape every
  // caller (planWriteTools.ts, and any LeaseBackend consumer) already
  // expects from every other method on this interface, rather than an
  // occasional synchronous throw depending on which qualifier a given
  // request happened to carry.
  async readLease(now: Date): ReturnType<LeaseBackend["readLease"]> {
    return this.resolve().readLease(now);
  }

  async acquireLease(
    candidate: LeaseInfo,
    now: Date,
  ): ReturnType<LeaseBackend["acquireLease"]> {
    return this.resolve().acquireLease(candidate, now);
  }

  async releaseLease(token: string): ReturnType<LeaseBackend["releaseLease"]> {
    return this.resolve().releaseLease(token);
  }
}

/** Test-only escape hatch for the alias-aware cache above. */
export function resetAliasAwareLeaseBackendForTests(): void {
  aliasCache.clear();
}
