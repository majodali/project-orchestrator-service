import { describe, expect, it } from "vitest";

import {
  AliasLeaseTableNotConfiguredError,
  UnrecognizedLambdaQualifierError,
  parseInvokedQualifier,
  resolveAliasLeaseTable,
} from "../src/planRegister/aliasLeaseTable.js";

/**
 * Unit tests of the pure qualifier-parsing/table-resolution functions
 * (node P2-N015). Necessary but, on their own, exactly the kind of
 * check the task's own warning names — "trivially unit-testable in a
 * way that proves nothing about the deployed path" — so
 * test/lambda.test.ts's new describe block drives the same logic
 * through the real exported Lambda `handler` with a realistic
 * `LambdaContext`, and test/httpApp.test.ts's new block drives it
 * through the real Hono app via `c.env`. This file only covers the
 * parsing/resolution edge cases that are awkward to exercise
 * end-to-end (malformed ARNs, every qualifier shape at once).
 */

const REGION_ACCOUNT = "us-west-2:123456789012"; // S-001: a fabricated account, not a real one

function arn(qualifier?: string): string {
  const base = `arn:aws:lambda:${REGION_ACCOUNT}:function:McpFunction`;
  return qualifier === undefined ? base : `${base}:${qualifier}`;
}

describe("parseInvokedQualifier", () => {
  it("extracts the alias name from a qualified ARN", () => {
    expect(parseInvokedQualifier(arn("live"))).toBe("live");
    expect(parseInvokedQualifier(arn("preprod"))).toBe("preprod");
  });

  it("extracts $LATEST from a $LATEST-qualified ARN", () => {
    expect(parseInvokedQualifier(arn("$LATEST"))).toBe("$LATEST");
  });

  it("extracts a numeric version qualifier", () => {
    expect(parseInvokedQualifier(arn("7"))).toBe("7");
  });

  it("returns undefined for an unqualified ARN (no trailing segment)", () => {
    expect(parseInvokedQualifier(arn())).toBeUndefined();
  });

  it("returns undefined for a garbage string", () => {
    expect(parseInvokedQualifier("not-an-arn")).toBeUndefined();
  });
});

describe("resolveAliasLeaseTable", () => {
  const env = {
    LEASE_TABLE_NAME: "prod-lease-table",
    PREPROD_LEASE_TABLE_NAME: "preprod-lease-table",
  };

  it('resolves "live" to LEASE_TABLE_NAME', () => {
    expect(resolveAliasLeaseTable(arn("live"), env)).toEqual({
      qualifier: "live",
      tableName: "prod-lease-table",
    });
  });

  it('resolves "preprod" to PREPROD_LEASE_TABLE_NAME', () => {
    expect(resolveAliasLeaseTable(arn("preprod"), env)).toEqual({
      qualifier: "preprod",
      tableName: "preprod-lease-table",
    });
  });

  it("refuses $LATEST — fails closed rather than defaulting to production", () => {
    expect(() => resolveAliasLeaseTable(arn("$LATEST"), env)).toThrow(
      UnrecognizedLambdaQualifierError,
    );
  });

  it("refuses an unqualified invocation, naming it as $LATEST", () => {
    try {
      resolveAliasLeaseTable(arn(), env);
      expect.unreachable("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(UnrecognizedLambdaQualifierError);
      expect((err as UnrecognizedLambdaQualifierError).qualifier).toBe(
        "$LATEST",
      );
    }
  });

  it("refuses a numbered-version qualifier", () => {
    expect(() => resolveAliasLeaseTable(arn("3"), env)).toThrow(
      UnrecognizedLambdaQualifierError,
    );
  });

  it("refuses an unrelated alias name, naming exactly what it saw", () => {
    try {
      resolveAliasLeaseTable(arn("staging"), env);
      expect.unreachable("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(UnrecognizedLambdaQualifierError);
      expect((err as UnrecognizedLambdaQualifierError).qualifier).toBe(
        "staging",
      );
      expect((err as Error).message).toContain('"staging"');
    }
  });

  it("is case-sensitive — LIVE is refused, not treated as live", () => {
    expect(() => resolveAliasLeaseTable(arn("LIVE"), env)).toThrow(
      UnrecognizedLambdaQualifierError,
    );
  });

  it("reports a configuration gap for live when LEASE_TABLE_NAME is unset, distinctly from a refusal", () => {
    expect(() =>
      resolveAliasLeaseTable(arn("live"), { PREPROD_LEASE_TABLE_NAME: "p" }),
    ).toThrow(AliasLeaseTableNotConfiguredError);
  });

  it("reports a configuration gap for preprod when PREPROD_LEASE_TABLE_NAME is unset", () => {
    expect(() =>
      resolveAliasLeaseTable(arn("preprod"), { LEASE_TABLE_NAME: "p" }),
    ).toThrow(AliasLeaseTableNotConfiguredError);
  });
});
