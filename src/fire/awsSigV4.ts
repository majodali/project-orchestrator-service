/**
 * A minimal AWS Signature Version 4 signer, for the one request shape
 * `src/fire/secrets.ts` needs: a JSON-1.1 POST with no query string
 * (docs.aws.amazon.com/general/latest/gr/signature-version-4.html,
 * "Create a signed AWS API request", read 2026-11-24). Written by
 * hand rather than pulling in an AWS SDK package: a new dependency is
 * the owner's decision (the implementer's own page, "In every task"),
 * and this service has so far reached AWS only through
 * CloudFormation's deploy-time `{{resolve:secretsmanager:...}}`
 * (template.yaml), never through a client library at runtime.
 *
 * Exported as a pure function of its inputs (including `now`) so a
 * test can check the canonical request and the signature without a
 * real AWS call or real credentials.
 */

import { createHash, createHmac } from "node:crypto";

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export interface SignedJsonRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** `YYYYMMDDTHHMMSSZ` and its first eight characters, from a UTC
 * instant — SigV4's own date format, distinct from ISO-8601. */
function amzDateParts(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * Signs one JSON-1.1 API call (`target`, such as
 * `secretsmanager.GetSecretValue`) against `service` in `region`, as
 * a request with no query string and a JSON body — the whole shape
 * every AWS JSON-protocol API this service might ever call at runtime
 * shares, not only Secrets Manager's.
 */
export function signAwsJsonRequest(
  credentials: AwsCredentials,
  region: string,
  service: string,
  target: string,
  body: string,
  now: Date,
): SignedJsonRequest {
  const host = `${service}.${region}.amazonaws.com`;
  const { amzDate, dateStamp } = amzDateParts(now);
  const payloadHash = sha256Hex(body);

  const headerEntries: Array<[string, string]> = [
    ["content-type", "application/x-amz-json-1.1"],
    ["host", host],
    ["x-amz-date", amzDate],
    ["x-amz-target", target],
  ];
  if (credentials.sessionToken) {
    headerEntries.push(["x-amz-security-token", credentials.sessionToken]);
  }
  headerEntries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const canonicalHeaders = headerEntries
    .map(([name, value]) => `${name}:${value.trim()}\n`)
    .join("");
  const signedHeaders = headerEntries.map(([name]) => name).join(";");

  const canonicalRequest = [
    "POST",
    "/",
    "", // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = hmacSha256(kSigning, stringToSign).toString("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/x-amz-json-1.1",
    Host: host,
    "X-Amz-Date": amzDate,
    "X-Amz-Target": target,
    Authorization: authorization,
  };
  if (credentials.sessionToken) {
    headers["X-Amz-Security-Token"] = credentials.sessionToken;
  }

  return { url: `https://${host}/`, headers, body };
}
