import { describe, expect, it } from "vitest";

import {
  DEFAULT_PER_ACCOUNT_DAILY_CAP,
  DISABLED_FIRE_SETTINGS,
  DOCUMENTED_PER_ACCOUNT_HOURLY_CAP,
  DOCUMENTED_PER_TASK_HOURLY_CAP,
  parseFireSettings,
} from "../src/fire/settings.js";

/** `orchestration/orchestrator.json`'s `fire` section (P2-N048,
 * design 2 and criterion 8: the path stays off until the owner has
 * written and enabled it). */
describe("parseFireSettings", () => {
  it("is disabled when there is no settings file", () => {
    expect(parseFireSettings(null)).toEqual(DISABLED_FIRE_SETTINGS);
  });

  it("is disabled when the file has no fire section", () => {
    const settings = parseFireSettings(
      JSON.stringify({ limits: { execute: 2 }, checkAfterMinutes: 30 }),
    );
    expect(settings.enabled).toBe(false);
    expect(settings.checkAfterMinutes).toBe(30);
  });

  it("is disabled when the fire section does not say enabled: true", () => {
    const settings = parseFireSettings(
      JSON.stringify({ fire: { repositories: {} } }),
    );
    expect(settings.enabled).toBe(false);
  });

  it("is disabled, not thrown, on invalid JSON", () => {
    expect(parseFireSettings("{not json")).toEqual(DISABLED_FIRE_SETTINGS);
  });

  it("parses an enabled section with task references", () => {
    const settings = parseFireSettings(
      JSON.stringify({
        checkAfterMinutes: 45,
        fire: {
          enabled: true,
          perTaskHourlyCap: 10,
          perAccountHourlyCap: 40,
          repositories: {
            "majodali/project-orchestrator": {
              planner: { trig: "trig_planner", secret: "fire/planner" },
              implementer: { trig: "trig_impl", secret: "fire/impl" },
            },
            "majodali/project-orchestrator-service": {
              implementer: { trig: "trig_impl_svc", secret: "fire/impl-svc" },
            },
          },
        },
      }),
    );
    expect(settings.enabled).toBe(true);
    expect(settings.checkAfterMinutes).toBe(45);
    expect(settings.perTaskHourlyCap).toBe(10);
    expect(settings.perAccountHourlyCap).toBe(40);
    expect(
      settings.repositories.get("majodali/project-orchestrator")?.planner,
    ).toEqual({ trig: "trig_planner", secret: "fire/planner" });
    expect(
      settings.repositories.get("majodali/project-orchestrator-service")
        ?.implementer,
    ).toEqual({ trig: "trig_impl_svc", secret: "fire/impl-svc" });
  });

  it("never lets the settings file raise the caps past the documented maximum", () => {
    const settings = parseFireSettings(
      JSON.stringify({
        fire: {
          enabled: true,
          perTaskHourlyCap: 999,
          perAccountHourlyCap: 999,
          repositories: {},
        },
      }),
    );
    expect(settings.perTaskHourlyCap).toBe(DOCUMENTED_PER_TASK_HOURLY_CAP);
    expect(settings.perAccountHourlyCap).toBe(
      DOCUMENTED_PER_ACCOUNT_HOURLY_CAP,
    );
  });

  it("accepts a cap below the documented maximum", () => {
    const settings = parseFireSettings(
      JSON.stringify({
        fire: { enabled: true, perTaskHourlyCap: 5, repositories: {} },
      }),
    );
    expect(settings.perTaskHourlyCap).toBe(5);
  });

  it("defaults the daily cap, which the endpoint documents no maximum for", () => {
    const settings = parseFireSettings(
      JSON.stringify({ fire: { enabled: true, repositories: {} } }),
    );
    expect(settings.perAccountDailyCap).toBe(DEFAULT_PER_ACCOUNT_DAILY_CAP);
  });

  it("takes the daily cap from the settings file when given, with no clamp", () => {
    const settings = parseFireSettings(
      JSON.stringify({
        fire: {
          enabled: true,
          perAccountDailyCap: 500,
          repositories: {},
        },
      }),
    );
    expect(settings.perAccountDailyCap).toBe(500);
  });

  it("falls back to the default daily cap on a non-positive or invalid value", () => {
    const settings = parseFireSettings(
      JSON.stringify({
        fire: { enabled: true, perAccountDailyCap: -3, repositories: {} },
      }),
    );
    expect(settings.perAccountDailyCap).toBe(DEFAULT_PER_ACCOUNT_DAILY_CAP);
  });

  it("skips a role entry missing a trig or a secret", () => {
    const settings = parseFireSettings(
      JSON.stringify({
        fire: {
          enabled: true,
          repositories: {
            "majodali/project-orchestrator": {
              planner: { trig: "trig_planner" },
              implementer: { trig: "trig_impl", secret: "fire/impl" },
            },
          },
        },
      }),
    );
    const roles = settings.repositories.get("majodali/project-orchestrator");
    expect(roles?.planner).toBeUndefined();
    expect(roles?.implementer).toEqual({
      trig: "trig_impl",
      secret: "fire/impl",
    });
  });
});
