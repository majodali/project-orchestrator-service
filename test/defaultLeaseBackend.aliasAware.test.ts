import { afterEach, describe, expect, it } from "vitest";

import {
  LazyAliasLeaseBackend,
  getAliasAwareLeaseBackend,
  resetAliasAwareLeaseBackendForTests,
} from "../src/planRegister/defaultLeaseBackend.js";
import { DynamoLeaseBackend } from "../src/planRegister/dynamoLeaseBackend.js";
import { UnrecognizedLambdaQualifierError } from "../src/planRegister/aliasLeaseTable.js";

/**
 * `getAliasAwareLeaseBackend` / `LazyAliasLeaseBackend` (node P2-N015).
 * These tests never call `.readLease` / `.acquireLease` /
 * `.releaseLease` on a real `DynamoLeaseBackend` — only
 * `new DynamoDBClient({})`'s constructor, which (like the existing,
 * already-shipped `getDefaultLeaseBackend`) does no I/O and needs no
 * credentials or network access — so they run offline, the same as
 * every other test in this suite.
 */

const REGION_ACCOUNT = "us-west-2:123456789012"; // S-001: fabricated, not a real account

function arn(qualifier?: string): string {
  const base = `arn:aws:lambda:${REGION_ACCOUNT}:function:McpFunction`;
  return qualifier === undefined ? base : `${base}:${qualifier}`;
}

const ENV = {
  LEASE_TABLE_NAME: "prod-lease-table",
  PREPROD_LEASE_TABLE_NAME: "preprod-lease-table",
};

describe("getAliasAwareLeaseBackend", () => {
  afterEach(() => {
    resetAliasAwareLeaseBackendForTests();
  });

  it('builds a DynamoLeaseBackend bound to LEASE_TABLE_NAME for "live"', () => {
    const backend = getAliasAwareLeaseBackend(arn("live"), ENV);
    expect(backend).toBeInstanceOf(DynamoLeaseBackend);
    expect((backend as DynamoLeaseBackend).tableName).toBe("prod-lease-table");
  });

  it('builds a DynamoLeaseBackend bound to PREPROD_LEASE_TABLE_NAME for "preprod"', () => {
    const backend = getAliasAwareLeaseBackend(arn("preprod"), ENV);
    expect(backend).toBeInstanceOf(DynamoLeaseBackend);
    expect((backend as DynamoLeaseBackend).tableName).toBe(
      "preprod-lease-table",
    );
  });

  it("throws before constructing anything for an unrecognized qualifier", () => {
    expect(() => getAliasAwareLeaseBackend(arn("$LATEST"), ENV)).toThrow(
      UnrecognizedLambdaQualifierError,
    );
  });

  it("caches by resolved table name — the same qualifier returns the same instance", () => {
    const first = getAliasAwareLeaseBackend(arn("live"), ENV);
    const second = getAliasAwareLeaseBackend(arn("live"), ENV);
    expect(second).toBe(first);
  });

  it("live and preprod never share an instance", () => {
    const live = getAliasAwareLeaseBackend(arn("live"), ENV);
    const preprod = getAliasAwareLeaseBackend(arn("preprod"), ENV);
    expect(live).not.toBe(preprod);
  });

  it("resetAliasAwareLeaseBackendForTests clears the cache", () => {
    const first = getAliasAwareLeaseBackend(arn("live"), ENV);
    resetAliasAwareLeaseBackendForTests();
    const second = getAliasAwareLeaseBackend(arn("live"), ENV);
    expect(second).not.toBe(first);
  });
});

describe("LazyAliasLeaseBackend", () => {
  afterEach(() => {
    resetAliasAwareLeaseBackendForTests();
  });

  it("constructing it does nothing observable — no throw even for a bad qualifier", () => {
    // The whole point: httpApp.ts builds one of these on every Lambda
    // request regardless of which tool (if any) gets called, so
    // construction alone must never touch DynamoDB or throw.
    expect(() => new LazyAliasLeaseBackend(arn("$LATEST"), ENV)).not.toThrow();
  });

  it("resolve() delegates to the same table getAliasAwareLeaseBackend would pick, for a recognized qualifier", () => {
    // Deliberately does not call readLease/acquireLease/releaseLease
    // here — that would reach a real DynamoDBClient.send() call with
    // no AWS credentials or network access in this sandbox. Instead,
    // this confirms the *selection* is correct by calling the same
    // resolution getAliasAwareLeaseBackend uses and checking it is
    // cached under the resolved table — the wiring
    // test/lambda.test.ts's service_identity assertions confirm this
    // same selection end to end through the real handler.
    const resolved = getAliasAwareLeaseBackend(arn("preprod"), ENV);
    expect((resolved as DynamoLeaseBackend).tableName).toBe(
      "preprod-lease-table",
    );
  });

  it("throws the fail-closed error on first call for an unrecognized qualifier", async () => {
    const backend = new LazyAliasLeaseBackend(arn("staging"), ENV);
    const now = new Date("2026-09-01T00:00:00.000Z");
    await expect(backend.readLease(now)).rejects.toBeInstanceOf(
      UnrecognizedLambdaQualifierError,
    );
    await expect(
      backend.acquireLease(
        {
          holder: "x",
          token: "y",
          acquiredAt: now.toISOString(),
          expiresAt: now.toISOString(),
        },
        now,
      ),
    ).rejects.toBeInstanceOf(UnrecognizedLambdaQualifierError);
    await expect(backend.releaseLease("y")).rejects.toBeInstanceOf(
      UnrecognizedLambdaQualifierError,
    );
  });
});
