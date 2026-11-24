/**
 * The fire settings: `orchestration/orchestrator.json`'s `fire`
 * section, read from the coordinating repository (P2-N048, design 2).
 * Identifiers and secret names live in git; a secret's own value never
 * does (src/fire/secrets.ts reads that at runtime).
 *
 * Absent, malformed, or `enabled` anything but `true` all parse to the
 * same disabled settings: the whole path stays off until the owner's
 * setup (docs/plans/p2-n046-service-fired-sessions.md, "What the owner
 * sets up") has written a real section and turned it on (criterion 8).
 */

export type FireRole = "planner" | "implementer" | "reviewer";

const FIRE_ROLES: readonly FireRole[] = ["planner", "implementer", "reviewer"];

export interface FireTaskRef {
  /** The scheduled task's identifier, prefixed `trig_` despite the
   * documentation's own parameter name ("routine_id"). */
  readonly trig: string;
  /** The name (not ARN) of the AWS Secrets Manager secret holding this
   * task's per-routine bearer token. */
  readonly secret: string;
}

export interface FireSettings {
  readonly enabled: boolean;
  /** Minutes to wait before firing the same node and step again
   * (reused from the settings file's top-level field, the same one
   * the retired orchestrator session's watcher read). */
  readonly checkAfterMinutes: number;
  /** This deployment's own cap, already clamped to the documented
   * platform maximum (`DOCUMENTED_PER_TASK_HOURLY_CAP`): the service
   * never asks the settings file to raise it past what the endpoint
   * itself enforces. */
  readonly perTaskHourlyCap: number;
  readonly perAccountHourlyCap: number;
  /** repository -> role -> the scheduled task firing that role's work
   * in that repository. A repository or role missing here has no
   * scheduled task configured; an offer that needs one is reported to
   * the owner, not fired (design 2). */
  readonly repositories: ReadonlyMap<
    string,
    Partial<Record<FireRole, FireTaskRef>>
  >;
}

/** The hourly caps the `/fire` endpoint documents
 * (platform.claude.com/docs/en/api/claude-code/routines-fire, "Rate
 * limits", read 2026-11-24): 30 fires an hour for one scheduled task,
 * shared with **Run now**, and 100 an hour for the account. The
 * service's own settings may set a lower cap; never a higher one. */
export const DOCUMENTED_PER_TASK_HOURLY_CAP = 30;
export const DOCUMENTED_PER_ACCOUNT_HOURLY_CAP = 100;

const DEFAULT_CHECK_AFTER_MINUTES = 45;

export const DISABLED_FIRE_SETTINGS: FireSettings = {
  enabled: false,
  checkAfterMinutes: DEFAULT_CHECK_AFTER_MINUTES,
  perTaskHourlyCap: DOCUMENTED_PER_TASK_HOURLY_CAP,
  perAccountHourlyCap: DOCUMENTED_PER_ACCOUNT_HOURLY_CAP,
  repositories: new Map(),
};

function clampToDocumented(value: unknown, documentedMax: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return documentedMax;
  }
  return Math.min(value, documentedMax);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses `orchestration/orchestrator.json`'s text into the fire
 * settings, or the disabled defaults when `text` is `null` (the file
 * does not exist yet), is not valid JSON, or carries no `fire`
 * section. Never throws: a malformed settings file leaves firing off
 * rather than crashing the write it followed. */
export function parseFireSettings(text: string | null): FireSettings {
  if (text === null) return DISABLED_FIRE_SETTINGS;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return DISABLED_FIRE_SETTINGS;
  }
  if (!isRecord(raw)) return DISABLED_FIRE_SETTINGS;

  const checkAfterMinutes =
    typeof raw.checkAfterMinutes === "number" && raw.checkAfterMinutes > 0
      ? raw.checkAfterMinutes
      : DEFAULT_CHECK_AFTER_MINUTES;

  const fire = raw.fire;
  if (!isRecord(fire)) {
    return { ...DISABLED_FIRE_SETTINGS, checkAfterMinutes };
  }

  const enabled = fire.enabled === true;
  const perTaskHourlyCap = clampToDocumented(
    fire.perTaskHourlyCap,
    DOCUMENTED_PER_TASK_HOURLY_CAP,
  );
  const perAccountHourlyCap = clampToDocumented(
    fire.perAccountHourlyCap,
    DOCUMENTED_PER_ACCOUNT_HOURLY_CAP,
  );

  const repositories = new Map<
    string,
    Partial<Record<FireRole, FireTaskRef>>
  >();
  if (isRecord(fire.repositories)) {
    for (const [repository, rolesRaw] of Object.entries(fire.repositories)) {
      if (!isRecord(rolesRaw)) continue;
      const roles: Partial<Record<FireRole, FireTaskRef>> = {};
      for (const role of FIRE_ROLES) {
        const entry = rolesRaw[role];
        if (!isRecord(entry)) continue;
        const { trig, secret } = entry;
        if (
          typeof trig === "string" &&
          trig.length > 0 &&
          typeof secret === "string" &&
          secret.length > 0
        ) {
          roles[role] = { trig, secret };
        }
      }
      repositories.set(repository, roles);
    }
  }

  return {
    enabled,
    checkAfterMinutes,
    perTaskHourlyCap,
    perAccountHourlyCap,
    repositories,
  };
}
