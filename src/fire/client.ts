/**
 * The call to the scheduled-task fire endpoint (P2-N048, design 6;
 * re-read 2026-11-24 at code.claude.com/docs/en/routines and
 * platform.claude.com/docs/en/api/claude-code/routines-fire, both
 * marked research preview — "the shapes may change").
 *
 * `POST https://api.anthropic.com/v1/claude_code/routines/{trig_id}/fire`,
 * bearer-authenticated with the task's own per-routine token, body
 * `{ "text": <= 65,536 chars }`. The answer is `{ type,
 * claude_code_session_id, claude_code_session_url }`, returned when
 * the session is created, not when it finishes. No field of the
 * response, and nothing in `text`, is read back by this service or by
 * a fired session (D121): both are for the run's own History.
 */

export interface FireResponse {
  readonly type: "routine_fire";
  readonly claudeCodeSessionId: string;
  readonly claudeCodeSessionUrl: string;
}

export class FireHttpError extends Error {
  readonly status: number;
  /** From the `Retry-After` header on a 429, in seconds; null when the
   * response carried none or it did not parse as a plain integer. */
  readonly retryAfterSeconds: number | null;
  readonly body: string;

  constructor(
    message: string,
    status: number,
    retryAfterSeconds: number | null,
    body: string,
  ) {
    super(message);
    this.name = "FireHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.body = body;
  }
}

function fireUrl(trigId: string): string {
  return `https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(trigId)}/fire`;
}

/** The oldest version the documentation says the endpoint accepts,
 * "and behaves the same in each" (routines-fire, "Headers"). Pinning
 * to it rather than a newer dated version means this call keeps
 * working with no service deploy even if a newer version is retired
 * first; the endpoint's own versioning promise (not this choice) is
 * what criterion 6 relies on. */
const ANTHROPIC_VERSION = "2023-06-01";

/** Documented as accepted "with and without" this header, but sent
 * anyway: the warning on the same page says a breaking change ships
 * behind a new dated value, with "the two most recent previous header
 * versions" still working — carrying the current one is what keeps
 * this call inside that window rather than the undocumented "without"
 * case. */
const ANTHROPIC_BETA = "experimental-cc-routine-2026-04-01";

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

export type FireFn = (
  trigId: string,
  token: string,
  text: string,
  fetchImpl?: typeof fetch,
) => Promise<FireResponse>;

/** Fires one scheduled task. Throws `FireHttpError` on any non-2xx
 * answer; the caller (src/fire/run.ts) treats a 429 specially and
 * every other failure as "nothing committed by this call, the plan
 * stays correct, the work is merely unstarted" (design 1). */
export const fireRoutine: FireFn = async (
  trigId,
  token,
  text,
  fetchImpl = fetch,
) => {
  const res = await fetchImpl(fireUrl(trigId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": ANTHROPIC_BETA,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSeconds =
      retryAfterHeader !== null && /^\d+$/.test(retryAfterHeader)
        ? Number(retryAfterHeader)
        : null;
    throw new FireHttpError(
      `fire ${trigId} failed with HTTP ${res.status}`,
      res.status,
      retryAfterSeconds,
      await safeText(res),
    );
  }
  const body = (await res.json()) as {
    type: string;
    claude_code_session_id: string;
    claude_code_session_url: string;
  };
  return {
    type: "routine_fire",
    claudeCodeSessionId: body.claude_code_session_id,
    claudeCodeSessionUrl: body.claude_code_session_url,
  };
};
