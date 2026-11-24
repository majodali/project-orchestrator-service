/**
 * The fire token, read at runtime from AWS Secrets Manager (P2-N048,
 * design 6). The three secrets the service already holds
 * (MCP_AUTH_TOKEN, the GitHub App's private key, the view token)
 * reach it as environment variables CloudFormation resolves at deploy
 * time; a fire token cannot follow that pattern, because regenerating
 * one in the web UI revokes the previous one at once (no public API
 * for token management, platform.claude.com/docs/en/api/claude-code/
 * routines-fire, "Authentication"), which would leave firing broken
 * until the next deploy. So this reads the secret's current value
 * each time it is needed, caching it only briefly: long enough that
 * firing twice in one write (criterion 5) costs one read, not two;
 * short enough that a rotated token is picked up well inside one
 * deploy cycle. No token is ever in git, in a log, or in the
 * function's own configuration (criterion 7) — this module is the one
 * place a fire token exists in memory at all.
 *
 * Calls Secrets Manager's `GetSecretValue` directly over its JSON
 * protocol, SigV4-signed by hand (src/fire/awsSigV4.ts) rather than
 * through an AWS SDK package, which this service does not otherwise
 * depend on and which a new dependency needs the owner's say (the
 * implementer's own page). `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
 * `AWS_SESSION_TOKEN` and `AWS_REGION` are the Lambda execution
 * environment's own variables — every function has them, with no
 * template change — not secrets this service configures itself.
 * Calling it needs `secretsmanager:GetSecretValue` on the function's
 * execution role for the fire secrets (design 6; owner action O3,
 * node P2-N049), which this task does not grant.
 */

import { signAwsJsonRequest } from "./awsSigV4.js";
import type { AwsCredentials } from "./awsSigV4.js";

export const FIRE_TOKEN_CACHE_MS = 5 * 60 * 1000;

interface CacheEntry {
  readonly value: string;
  readonly expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export class FireSecretError extends Error {
  constructor(secretName: string, reason: string) {
    super(`secret ${secretName}: ${reason}`);
    this.name = "FireSecretError";
  }
}

function credentialsFromEnv(env: NodeJS.ProcessEnv): AwsCredentials | null {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: env.AWS_SESSION_TOKEN,
  };
}

function regionFromEnv(env: NodeJS.ProcessEnv): string | null {
  return env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? null;
}

/** The named secret's current `SecretString`, from the brief cache or
 * freshly read from Secrets Manager. Never logs the secret name
 * alongside its value, and never returns a value this process did
 * not just read or cache itself. */
export async function getFireToken(
  secretName: string,
  options: {
    env?: NodeJS.ProcessEnv;
    now?: () => number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;

  const cached = cache.get(secretName);
  if (cached && cached.expiresAt > now()) return cached.value;

  const credentials = credentialsFromEnv(env);
  if (!credentials) {
    throw new FireSecretError(
      secretName,
      "no AWS credentials in the Lambda execution environment (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)",
    );
  }
  const region = regionFromEnv(env);
  if (!region) {
    throw new FireSecretError(secretName, "no AWS_REGION in the environment");
  }

  const body = JSON.stringify({ SecretId: secretName });
  const signed = signAwsJsonRequest(
    credentials,
    region,
    "secretsmanager",
    "secretsmanager.GetSecretValue",
    body,
    new Date(now()),
  );
  const res = await fetchImpl(signed.url, {
    method: "POST",
    headers: signed.headers,
    body: signed.body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new FireSecretError(
      secretName,
      `Secrets Manager answered HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { SecretString?: string };
  if (!json.SecretString) {
    throw new FireSecretError(secretName, "has no SecretString");
  }
  cache.set(secretName, {
    value: json.SecretString,
    expiresAt: now() + FIRE_TOKEN_CACHE_MS,
  });
  return json.SecretString;
}

/** Test-only: clears the module-level cache, so a test can
 * re-exercise reading fresh. Not used by production code. */
export function resetFireTokenCacheForTests(): void {
  cache.clear();
}
