import { describe, expect, it } from "vitest";

import { DynamoLeaseBackend } from "../src/planRegister/dynamoLeaseBackend.js";
import type { DynamoSendClient } from "../src/planRegister/dynamoLeaseBackend.js";
import { findUnaliasedReservedAttributeNames } from "../src/planRegister/dynamoExpressionSafety.js";
import { isDynamoReservedWord } from "../src/planRegister/dynamoReservedWords.js";
import type { LeaseInfo } from "../src/planRegister/leaseBackend.js";

/**
 * Guards against the production defect T027 fixed (node P2-N010
 * rework): `releaseLease`'s `ConditionExpression: "token = :token"`
 * worked against every test in this repository (all 124 of them ran
 * `InMemoryLeaseBackend`, and `DynamoLeaseBackend`'s own contract test
 * in test/leaseBackend.test.ts uses a fake client that reads
 * `ExpressionAttributeValues` directly and never parses the
 * expression string) and failed against the real DynamoDB table on
 * its first production call: "token" is a reserved word, so the
 * unaliased `ConditionExpression` was rejected.
 *
 * No AWS credentials or network access, per section 2's option (a):
 * this validates expression *text* against DynamoDB's reserved-word
 * list rather than exercising a real client. It does not cover
 * reserved words this session's necessarily partial, unverified word
 * list does not know about, or any DynamoDB validation beyond
 * reserved-word collisions — see dynamoReservedWords.ts and
 * dynamoExpressionSafety.ts's doc comments for exactly what that
 * gap is.
 */

function lease(overrides: Partial<LeaseInfo> = {}): LeaseInfo {
  return {
    holder: "task-T027",
    token: "token-1",
    acquiredAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:10:00.000Z",
    ...overrides,
  };
}

describe("findUnaliasedReservedAttributeNames", () => {
  it("flags a bare reserved word used as an attribute name", () => {
    expect(
      findUnaliasedReservedAttributeNames({
        ConditionExpression: "token = :token",
      }),
    ).toEqual(["token"]);
  });

  it("does not flag a reserved word that has been aliased", () => {
    expect(
      findUnaliasedReservedAttributeNames({
        ConditionExpression: "#token = :token",
      }),
    ).toEqual([]);
  });

  it("does not flag a non-reserved attribute name", () => {
    expect(
      findUnaliasedReservedAttributeNames({
        ConditionExpression: "attribute_not_exists(pk) OR expiresAt < :now",
      }),
    ).toEqual([]);
  });

  it("does not mistake expression-syntax words (AND, OR, function names) for attribute names", () => {
    expect(
      findUnaliasedReservedAttributeNames({
        ConditionExpression:
          "attribute_exists(pk) AND begins_with(pk, :prefix) OR size(pk) > :n",
      }),
    ).toEqual([]);
  });

  it("checks KeyConditionExpression, ProjectionExpression, UpdateExpression and FilterExpression too", () => {
    expect(
      findUnaliasedReservedAttributeNames({
        KeyConditionExpression: "status = :s",
      }),
    ).toEqual(["status"]);
    expect(
      findUnaliasedReservedAttributeNames({
        ProjectionExpression: "name, value",
      }),
    ).toEqual(["name", "value"]);
    expect(
      findUnaliasedReservedAttributeNames({
        UpdateExpression: "SET #owner = :o",
      }),
    ).toEqual([]);
    expect(
      findUnaliasedReservedAttributeNames({
        FilterExpression: "region = :r",
      }),
    ).toEqual(["region"]);
  });

  it("isDynamoReservedWord agrees with the production finding: token is reserved, holder is not", () => {
    expect(isDynamoReservedWord("token")).toBe(true);
    expect(isDynamoReservedWord("TOKEN")).toBe(true);
    expect(isDynamoReservedWord("holder")).toBe(false);
    expect(isDynamoReservedWord("acquiredAt")).toBe(false);
    expect(isDynamoReservedWord("expiresAt")).toBe(false);
    expect(isDynamoReservedWord("pk")).toBe(false);
  });
});

/**
 * A recording (not emulating) fake `send`: it captures every
 * command's `input` verbatim and returns a harmless response, so this
 * test proves something the FakeDynamoTable in
 * test/leaseBackend.test.ts cannot — that the *exact expression
 * strings DynamoLeaseBackend actually builds* are reserved-word-safe,
 * driven through the real class rather than a hand-copied expectation
 * of what it should send.
 */
class RecordingDynamoTable implements DynamoSendClient {
  readonly captured: { commandName: string; input: Record<string, unknown> }[] =
    [];

  send(command: unknown): Promise<unknown> {
    const c = command as {
      constructor: { name: string };
      input: Record<string, unknown>;
    };
    this.captured.push({ commandName: c.constructor.name, input: c.input });
    if (c.constructor.name === "GetItemCommand") {
      return Promise.resolve({ Item: undefined });
    }
    return Promise.resolve({});
  }
}

describe("DynamoLeaseBackend builds only reserved-word-safe expressions", () => {
  it("every ConditionExpression / KeyConditionExpression / ProjectionExpression sent by readLease, acquireLease and releaseLease is safe", async () => {
    const table = new RecordingDynamoTable();
    const backend = new DynamoLeaseBackend("lease-table", table);
    const now = new Date("2026-09-01T00:00:00.000Z");

    await backend.readLease(now);
    await backend.acquireLease(lease(), now);
    await backend.releaseLease("token-1");

    expect(table.captured.length).toBe(3);
    for (const { commandName, input } of table.captured) {
      const unsafe = findUnaliasedReservedAttributeNames(input);
      expect(
        unsafe,
        `${commandName} built an expression with an unaliased reserved word: ` +
          `${unsafe.join(", ")} — input: ${JSON.stringify(input)}`,
      ).toEqual([]);
    }
  });
});
