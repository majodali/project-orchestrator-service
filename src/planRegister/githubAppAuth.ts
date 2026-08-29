/**
 * GitHub App authentication (chunk 1 child C, node P2-N009). Decision
 * 6 of the p2-n002 plan: a GitHub App installation with
 * `contents: read`, its private key in the platform secret store
 * (owner action O3) — never a personal access token.
 *
 * JWT signing (the fiddly, easy-to-get-wrong part: RS256, clock skew,
 * the exact claim shape GitHub expects) is delegated to
 * `universal-github-app-jwt`, the octokit-org helper purpose-built for
 * this — a zero-dependency package, not the full `@octokit/auth-app`
 * (which also pulls in OAuth-app/OAuth-user strategies this service
 * never uses). Exchanging that JWT for an installation access token is
 * one plain REST call, made here with the same injectable `fetch` this
 * module's caller (registerFetcher.ts) uses, so both are testable
 * without real credentials or network access.
 */

import githubAppJwt from "universal-github-app-jwt";

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "project-orchestrator-service";

// Refresh this many ms before actual expiry, so a token already close
// to expiring is not handed to a caller that might still be using it
// seconds later.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export interface GithubAppCredentials {
  appId: string;
  installationId: string;
  privateKey: string;
}

export type InstallationTokenProvider = () => Promise<string>;

export class GithubAppAuthError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "GithubAppAuthError";
    this.status = status;
    this.body = body;
  }
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

/**
 * Builds a function that returns a valid installation access token,
 * minting a fresh one (App JWT → installation token exchange) only
 * when none is cached or the cached one is close to expiry. GitHub
 * issues installation tokens with a one-hour lifetime; caching in
 * module-held closure state means a warm Lambda container reuses one
 * token across many `plan_read` calls instead of minting fresh on
 * every call (I5 is unaffected — this caches *authorization*, never
 * plan-state content, which is always re-fetched from GitHub).
 */
export function createInstallationTokenProvider(
  credentials: GithubAppCredentials,
  fetchImpl: typeof fetch = fetch,
): InstallationTokenProvider {
  let cached: CachedToken | null = null;

  return async function getInstallationToken(): Promise<string> {
    const now = Date.now();
    if (cached && cached.expiresAtMs - now > EXPIRY_SAFETY_MARGIN_MS) {
      return cached.token;
    }

    const { token: appJwt } = await githubAppJwt({
      id: credentials.appId,
      privateKey: credentials.privateKey,
    });

    const res = await fetchImpl(
      `${GITHUB_API_BASE}/app/installations/${encodeURIComponent(
        credentials.installationId,
      )}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": USER_AGENT,
        },
      },
    );

    if (!res.ok) {
      throw new GithubAppAuthError(
        `could not mint an installation access token for installation ${credentials.installationId}`,
        res.status,
        await safeText(res),
      );
    }

    const body = (await res.json()) as { token: string; expires_at: string };
    cached = { token: body.token, expiresAtMs: Date.parse(body.expires_at) };
    return cached.token;
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
