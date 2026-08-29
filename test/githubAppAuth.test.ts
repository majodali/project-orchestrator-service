import { generateKeyPairSync } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  GithubAppAuthError,
  createInstallationTokenProvider,
} from "../src/planRegister/githubAppAuth.js";

/**
 * `createInstallationTokenProvider` tests (chunk 1 child C, node
 * P2-N009). Uses a throwaway RSA key pair generated fresh in memory
 * for this test run only (never written to disk, never committed) —
 * `universal-github-app-jwt` needs a real PEM to sign against, but
 * this key has no GitHub App behind it and grants no access to
 * anything (S-001/S-002: no secret, real or fake-but-plausible, ever
 * belongs in a committed fixture).
 */

let privateKeyPem: string;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  privateKeyPem = privateKey;
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errorResponse(status: number, text: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ message: text }),
    text: async () => text,
  } as unknown as Response;
}

describe("createInstallationTokenProvider", () => {
  it("mints an installation token via the app/installations access_tokens endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(async () =>
      jsonResponse({
        token: "ghs_installation_token",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }),
    );

    const getToken = createInstallationTokenProvider(
      { appId: "12345", installationId: "999", privateKey: privateKeyPem },
      fetchImpl,
    );

    const token = await getToken();

    expect(token).toBe("ghs_installation_token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.github.com/app/installations/999/access_tokens",
    );
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
  });

  it("caches the token across calls until it is close to expiry", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(async () =>
      jsonResponse({
        token: "ghs_first",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }),
    );

    const getToken = createInstallationTokenProvider(
      { appId: "12345", installationId: "999", privateKey: privateKeyPem },
      fetchImpl,
    );

    const first = await getToken();
    const second = await getToken();

    expect(first).toBe("ghs_first");
    expect(second).toBe("ghs_first");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("mints a fresh token once the cached one is close to expiry", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () =>
        jsonResponse({
          token: "ghs_first",
          expires_at: new Date(Date.now() + 5_000).toISOString(), // near-expired
        }),
      )
      .mockImplementationOnce(async () =>
        jsonResponse({
          token: "ghs_second",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
      );

    const getToken = createInstallationTokenProvider(
      { appId: "12345", installationId: "999", privateKey: privateKeyPem },
      fetchImpl,
    );

    const first = await getToken();
    const second = await getToken();

    expect(first).toBe("ghs_first");
    expect(second).toBe("ghs_second");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws GithubAppAuthError, naming status and body, when minting fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        errorResponse(403, "installation suspended"),
      );

    const getToken = createInstallationTokenProvider(
      { appId: "12345", installationId: "999", privateKey: privateKeyPem },
      fetchImpl,
    );

    await expect(getToken()).rejects.toBeInstanceOf(GithubAppAuthError);
    await expect(getToken()).rejects.toMatchObject({
      name: "GithubAppAuthError",
      status: 403,
    });
  });
});
