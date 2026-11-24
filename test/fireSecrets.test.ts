import { afterEach, describe, expect, it } from "vitest";

import {
  FireSecretError,
  getFireToken,
  resetFireTokenCacheForTests,
} from "../src/fire/secrets.js";

const ENV = {
  AWS_ACCESS_KEY_ID: "AKIAFAKEFAKEFAKEFAKE",
  AWS_SECRET_ACCESS_KEY: "fakeSecretAccessKeyFakeSecretAccessKeyFakeSe",
  AWS_SESSION_TOKEN: "fake-session-token",
  AWS_REGION: "us-east-1",
};

function fetchReturning(secretString: string | undefined, status = 200) {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ SecretString: secretString }), {
      status,
    });
  }) as typeof fetch;
  return { fetchImpl, callCount: () => calls };
}

/** `src/fire/secrets.ts`'s runtime read (P2-N048, design 6 and
 * criterion 7): built on the environment's own AWS credentials, with
 * a brief cache so firing twice in one write costs one read. */
describe("getFireToken", () => {
  afterEach(() => resetFireTokenCacheForTests());

  it("reads the secret's SecretString through a signed request", async () => {
    const { fetchImpl } = fetchReturning("sk-ant-oat01-fake");
    const token = await getFireToken("fire/implementer", {
      env: ENV,
      fetchImpl,
    });
    expect(token).toBe("sk-ant-oat01-fake");
  });

  it("caches the value briefly: a second read within the window makes no call", async () => {
    let now = 1_000_000;
    const { fetchImpl, callCount } = fetchReturning("sk-ant-oat01-fake");
    await getFireToken("fire/implementer", {
      env: ENV,
      fetchImpl,
      now: () => now,
    });
    now += 1000; // well inside FIRE_TOKEN_CACHE_MS
    await getFireToken("fire/implementer", {
      env: ENV,
      fetchImpl,
      now: () => now,
    });
    expect(callCount()).toBe(1);
  });

  it("reads again once the cache has expired", async () => {
    let now = 1_000_000;
    const { fetchImpl, callCount } = fetchReturning("sk-ant-oat01-fake");
    await getFireToken("fire/implementer", {
      env: ENV,
      fetchImpl,
      now: () => now,
    });
    now += 6 * 60 * 1000; // past FIRE_TOKEN_CACHE_MS (5 minutes)
    await getFireToken("fire/implementer", {
      env: ENV,
      fetchImpl,
      now: () => now,
    });
    expect(callCount()).toBe(2);
  });

  it("refuses a secret with no SecretString", async () => {
    const { fetchImpl } = fetchReturning(undefined);
    await expect(
      getFireToken("fire/implementer", { env: ENV, fetchImpl }),
    ).rejects.toBeInstanceOf(FireSecretError);
  });

  it("refuses when the environment has no AWS credentials", async () => {
    const { fetchImpl } = fetchReturning("sk-ant-oat01-fake");
    await expect(
      getFireToken("fire/implementer", { env: {}, fetchImpl }),
    ).rejects.toBeInstanceOf(FireSecretError);
  });

  it("refuses when Secrets Manager answers with an error status", async () => {
    const { fetchImpl } = fetchReturning("sk-ant-oat01-fake", 400);
    await expect(
      getFireToken("fire/implementer", { env: ENV, fetchImpl }),
    ).rejects.toBeInstanceOf(FireSecretError);
  });
});
