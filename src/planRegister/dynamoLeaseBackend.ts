/**
 * The production `LeaseBackend` (chunk 1 child D, node P2-N010): one
 * DynamoDB item, written and read with conditional expressions so
 * acquire/release are atomic compare-and-swap operations rather than
 * read-then-write races. `template.yaml`'s `LeaseTable` (this child's
 * change) is the table; `LEASE_TABLE_NAME` in the Lambda environment
 * names it (see ./defaultLeaseBackend.ts).
 *
 * TTL expiry (decision 7) is enforced twice, deliberately: the `ttl`
 * attribute is DynamoDB's own Time to Live attribute, a best-effort
 * background deletion that AWS documents as running within (typically
 * well under, but not guaranteed under) 48 hours of expiry — too slow
 * to be *the* mechanism a single-writer lease relies on. The
 * authoritative check is `acquireLease`'s `ConditionExpression`
 * (`expiresAt < :now`, application time, evaluated by DynamoDB at
 * write time): a lease past its `expiresAt` is treated as free the
 * instant it expires, whether or not the TTL sweep has removed the
 * item yet.
 *
 * The DynamoDB client is injected as a minimal `{ send }` shape (not
 * the full `DynamoDBClient` type) so tests can supply a fake without
 * a real table, credentials, or network access — the same seam
 * `GithubAppRegisterFetcher` uses for `fetchImpl`.
 */

import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";

import { LEASE_KEY } from "./leaseBackend.js";
import type { LeaseBackend, LeaseInfo } from "./leaseBackend.js";

export interface DynamoSendClient {
  send(command: unknown): Promise<unknown>;
}

function toItem(info: LeaseInfo): Record<string, AttributeValue> {
  return {
    pk: { S: LEASE_KEY },
    holder: { S: info.holder },
    token: { S: info.token },
    acquiredAt: { S: info.acquiredAt },
    expiresAt: { S: info.expiresAt },
    ttl: { N: String(Math.floor(new Date(info.expiresAt).getTime() / 1000)) },
  };
}

function fromItem(item: Record<string, { S?: string; N?: string }>): LeaseInfo {
  return {
    holder: item.holder?.S ?? "",
    token: item.token?.S ?? "",
    acquiredAt: item.acquiredAt?.S ?? "",
    expiresAt: item.expiresAt?.S ?? "",
  };
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (
    err instanceof ConditionalCheckFailedException ||
    (err instanceof Error && err.name === "ConditionalCheckFailedException")
  );
}

export class DynamoLeaseBackend implements LeaseBackend {
  constructor(
    private readonly tableName: string,
    private readonly client: DynamoSendClient,
  ) {}

  async readLease(now: Date): Promise<LeaseInfo | null> {
    const res = (await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { pk: { S: LEASE_KEY } },
        ConsistentRead: true,
      }),
    )) as { Item?: Record<string, { S?: string; N?: string }> };
    if (!res.Item) {
      return null;
    }
    const info = fromItem(res.Item);
    if (new Date(info.expiresAt) <= now) {
      return null;
    }
    return info;
  }

  async acquireLease(candidate: LeaseInfo, now: Date): Promise<boolean> {
    try {
      await this.client.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: toItem(candidate),
          ConditionExpression: "attribute_not_exists(pk) OR expiresAt < :now",
          ExpressionAttributeValues: { ":now": { S: now.toISOString() } },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        return false;
      }
      throw err;
    }
  }

  async releaseLease(token: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: { pk: { S: LEASE_KEY } },
          ConditionExpression: "token = :token",
          ExpressionAttributeValues: { ":token": { S: token } },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        return false;
      }
      throw err;
    }
  }
}
