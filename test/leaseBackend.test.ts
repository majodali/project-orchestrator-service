import { describe, expect, it } from "vitest";

import { InMemoryLeaseBackend } from "../src/planRegister/inMemoryLeaseBackend.js";
import { DynamoLeaseBackend } from "../src/planRegister/dynamoLeaseBackend.js";
import type { DynamoSendClient } from "../src/planRegister/dynamoLeaseBackend.js";
import type { LeaseInfo } from "../src/planRegister/leaseBackend.js";

/**
 * `LeaseBackend` tests (chunk 1 child D, node P2-N010, decision 7 —
 * "a minimal advisory lease: acquire, TTL expiry, release"):
 * `InMemoryLeaseBackend` exercises the semantics exhaustively (it is
 * also what every plan_write_tools MCP-contract test and the local
 * `npm run dev` fallback use); `DynamoLeaseBackend` gets a contract
 * test against a fake DynamoDB client that emulates conditional-write
 * semantics in memory, proving the translation to commands is
 * correct without a real AWS account.
 */

function lease(overrides: Partial<LeaseInfo> = {}): LeaseInfo {
  return {
    holder: "task-T024",
    token: "token-1",
    acquiredAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:10:00.000Z",
    ...overrides,
  };
}

describe("InMemoryLeaseBackend", () => {
  it("grants an acquire when nothing is held", async () => {
    const backend = new InMemoryLeaseBackend();
    const now = new Date("2026-09-01T00:00:00.000Z");
    await expect(backend.acquireLease(lease(), now)).resolves.toBe(true);
  });

  it("refuses a second acquirer while the first lease is live", async () => {
    const backend = new InMemoryLeaseBackend();
    const now = new Date("2026-09-01T00:00:00.000Z");
    await backend.acquireLease(lease({ token: "token-1" }), now);
    await expect(
      backend.acquireLease(lease({ token: "token-2" }), now),
    ).resolves.toBe(false);
  });

  it("readLease reports the held lease while it is live", async () => {
    const backend = new InMemoryLeaseBackend();
    const now = new Date("2026-09-01T00:00:00.000Z");
    await backend.acquireLease(lease(), now);
    await expect(backend.readLease(now)).resolves.toMatchObject({
      holder: "task-T024",
      token: "token-1",
    });
  });

  it("treats an expired lease as absent, and lets a new acquirer take it", async () => {
    const backend = new InMemoryLeaseBackend();
    const acquiredAt = new Date("2026-09-01T00:00:00.000Z");
    await backend.acquireLease(
      lease({ token: "token-1", expiresAt: "2026-09-01T00:10:00.000Z" }),
      acquiredAt,
    );

    const afterExpiry = new Date("2026-09-01T00:10:01.000Z");
    await expect(backend.readLease(afterExpiry)).resolves.toBeNull();
    await expect(
      backend.acquireLease(lease({ token: "token-2" }), afterExpiry),
    ).resolves.toBe(true);
  });

  it("releases only when the token matches", async () => {
    const backend = new InMemoryLeaseBackend();
    const now = new Date("2026-09-01T00:00:00.000Z");
    await backend.acquireLease(lease({ token: "token-1" }), now);

    await expect(backend.releaseLease("wrong-token")).resolves.toBe(false);
    await expect(backend.readLease(now)).resolves.not.toBeNull();

    await expect(backend.releaseLease("token-1")).resolves.toBe(true);
    await expect(backend.readLease(now)).resolves.toBeNull();
  });

  it("lets a new acquirer in immediately after a release", async () => {
    const backend = new InMemoryLeaseBackend();
    const now = new Date("2026-09-01T00:00:00.000Z");
    await backend.acquireLease(lease({ token: "token-1" }), now);
    await backend.releaseLease("token-1");
    await expect(
      backend.acquireLease(lease({ token: "token-2" }), now),
    ).resolves.toBe(true);
  });
});

/**
 * A fake DynamoDB `send` that emulates exactly the conditional-write
 * semantics `DynamoLeaseBackend` relies on: `PutItem` with
 * `attribute_not_exists(pk) OR expiresAt < :now`, and `DeleteItem`
 * with `token = :token`. This is not a DynamoDB reimplementation —
 * just enough command handling to prove `DynamoLeaseBackend`
 * translates operations correctly, without a real table or
 * credentials (the same reasoning test/registerFetcher.test.ts gives
 * for its injected `fetchImpl`).
 */
class FakeDynamoTable implements DynamoSendClient {
  private item: Record<string, { S?: string; N?: string }> | null = null;

  send(command: unknown): Promise<unknown> {
    const c = command as {
      constructor: { name: string };
      input: {
        Item?: Record<string, { S?: string; N?: string }>;
        ConditionExpression?: string;
        ExpressionAttributeValues?: Record<string, { S?: string }>;
        ConsistentRead?: boolean;
      };
    };
    const name = c.constructor.name;

    if (name === "GetItemCommand") {
      return Promise.resolve({ Item: this.item ?? undefined });
    }

    if (name === "PutItemCommand") {
      const nowStr = c.input.ExpressionAttributeValues![":now"]!.S!;
      const conditionOk =
        this.item === null || this.item.expiresAt!.S! < nowStr;
      if (!conditionOk) {
        return Promise.reject(conditionalCheckFailed());
      }
      this.item = c.input.Item!;
      return Promise.resolve({});
    }

    if (name === "DeleteItemCommand") {
      const token = c.input.ExpressionAttributeValues![":token"]!.S!;
      if (!this.item || this.item.token!.S! !== token) {
        return Promise.reject(conditionalCheckFailed());
      }
      this.item = null;
      return Promise.resolve({});
    }

    return Promise.reject(
      new Error(`FakeDynamoTable: unhandled command ${name}`),
    );
  }
}

function conditionalCheckFailed(): Error {
  const err = new Error("The conditional request failed");
  err.name = "ConditionalCheckFailedException";
  return err;
}

describe("DynamoLeaseBackend", () => {
  it("acquires when the table has no item yet", async () => {
    const backend = new DynamoLeaseBackend(
      "lease-table",
      new FakeDynamoTable(),
    );
    const now = new Date("2026-09-01T00:00:00.000Z");
    await expect(backend.acquireLease(lease(), now)).resolves.toBe(true);
  });

  it("refuses a second acquire while the item is live, via ConditionalCheckFailedException", async () => {
    const table = new FakeDynamoTable();
    const backend = new DynamoLeaseBackend("lease-table", table);
    const now = new Date("2026-09-01T00:00:00.000Z");
    await backend.acquireLease(lease({ token: "token-1" }), now);
    await expect(
      backend.acquireLease(lease({ token: "token-2" }), now),
    ).resolves.toBe(false);
  });

  it("allows re-acquiring past the stored expiresAt, application-level TTL enforcement", async () => {
    const table = new FakeDynamoTable();
    const backend = new DynamoLeaseBackend("lease-table", table);
    const acquiredAt = new Date("2026-09-01T00:00:00.000Z");
    await backend.acquireLease(
      lease({ token: "token-1", expiresAt: "2026-09-01T00:10:00.000Z" }),
      acquiredAt,
    );

    const afterExpiry = new Date("2026-09-01T00:10:01.000Z");
    await expect(
      backend.acquireLease(lease({ token: "token-2" }), afterExpiry),
    ).resolves.toBe(true);
  });

  it("readLease treats a stored-but-expired item as absent even though the fake table still has it", async () => {
    const table = new FakeDynamoTable();
    const backend = new DynamoLeaseBackend("lease-table", table);
    const acquiredAt = new Date("2026-09-01T00:00:00.000Z");
    await backend.acquireLease(
      lease({ expiresAt: "2026-09-01T00:10:00.000Z" }),
      acquiredAt,
    );
    const afterExpiry = new Date("2026-09-01T00:10:01.000Z");
    await expect(backend.readLease(afterExpiry)).resolves.toBeNull();
  });

  it("releases only with the matching token", async () => {
    const table = new FakeDynamoTable();
    const backend = new DynamoLeaseBackend("lease-table", table);
    const now = new Date("2026-09-01T00:00:00.000Z");
    await backend.acquireLease(lease({ token: "token-1" }), now);

    await expect(backend.releaseLease("wrong")).resolves.toBe(false);
    await expect(backend.releaseLease("token-1")).resolves.toBe(true);
  });

  it("propagates a non-conditional error rather than swallowing it", async () => {
    const failing: DynamoSendClient = {
      send: () => Promise.reject(new Error("network down")),
    };
    const backend = new DynamoLeaseBackend("lease-table", failing);
    await expect(backend.acquireLease(lease(), new Date())).rejects.toThrow(
      "network down",
    );
  });
});
