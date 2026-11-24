import { describe, expect, it } from "vitest";

import { signAwsJsonRequest } from "../src/fire/awsSigV4.js";

const CREDENTIALS = {
  accessKeyId: "AKIAFAKEFAKEFAKEFAKE",
  secretAccessKey: "fakeSecretAccessKeyFakeSecretAccessKeyFakeSe",
};
const NOW = new Date("2026-11-24T05:22:06Z");

/** The hand-written SigV4 signer `src/fire/secrets.ts` calls instead
 * of an AWS SDK package (P2-N048, design 6). Checked as a pure
 * function of its inputs: the canonical request's shape, and that the
 * signature changes with the inputs that must change it. */
describe("signAwsJsonRequest", () => {
  it("builds the documented URL and headers for Secrets Manager's GetSecretValue", () => {
    const signed = signAwsJsonRequest(
      CREDENTIALS,
      "us-east-1",
      "secretsmanager",
      "secretsmanager.GetSecretValue",
      JSON.stringify({ SecretId: "fire/implementer" }),
      NOW,
    );
    expect(signed.url).toBe("https://secretsmanager.us-east-1.amazonaws.com/");
    expect(signed.headers["Content-Type"]).toBe("application/x-amz-json-1.1");
    expect(signed.headers.Host).toBe("secretsmanager.us-east-1.amazonaws.com");
    expect(signed.headers["X-Amz-Target"]).toBe(
      "secretsmanager.GetSecretValue",
    );
    expect(signed.headers["X-Amz-Date"]).toBe("20261124T052206Z");
    expect(signed.headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAFAKEFAKEFAKEFAKE\/20261124\/us-east-1\/secretsmanager\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/,
    );
    expect(signed.body).toBe(JSON.stringify({ SecretId: "fire/implementer" }));
  });

  it("adds the session-token header, signed, when credentials carry one", () => {
    const signed = signAwsJsonRequest(
      { ...CREDENTIALS, sessionToken: "fake-session-token" },
      "us-east-1",
      "secretsmanager",
      "secretsmanager.GetSecretValue",
      "{}",
      NOW,
    );
    expect(signed.headers["X-Amz-Security-Token"]).toBe("fake-session-token");
    expect(signed.headers.Authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target",
    );
  });

  it("signs the same inputs to the same signature every time", () => {
    const a = signAwsJsonRequest(
      CREDENTIALS,
      "us-east-1",
      "secretsmanager",
      "secretsmanager.GetSecretValue",
      "{}",
      NOW,
    );
    const b = signAwsJsonRequest(
      CREDENTIALS,
      "us-east-1",
      "secretsmanager",
      "secretsmanager.GetSecretValue",
      "{}",
      NOW,
    );
    expect(a.headers.Authorization).toBe(b.headers.Authorization);
  });

  it("changes the signature when the body changes", () => {
    const a = signAwsJsonRequest(
      CREDENTIALS,
      "us-east-1",
      "secretsmanager",
      "secretsmanager.GetSecretValue",
      JSON.stringify({ SecretId: "fire/a" }),
      NOW,
    );
    const b = signAwsJsonRequest(
      CREDENTIALS,
      "us-east-1",
      "secretsmanager",
      "secretsmanager.GetSecretValue",
      JSON.stringify({ SecretId: "fire/b" }),
      NOW,
    );
    expect(a.headers.Authorization).not.toBe(b.headers.Authorization);
  });

  it("changes the signature when the secret access key changes", () => {
    const a = signAwsJsonRequest(
      CREDENTIALS,
      "us-east-1",
      "secretsmanager",
      "secretsmanager.GetSecretValue",
      "{}",
      NOW,
    );
    const b = signAwsJsonRequest(
      {
        ...CREDENTIALS,
        secretAccessKey: "differentFakeSecretAccessKeyFakeSecret",
      },
      "us-east-1",
      "secretsmanager",
      "secretsmanager.GetSecretValue",
      "{}",
      NOW,
    );
    expect(a.headers.Authorization).not.toBe(b.headers.Authorization);
  });
});
