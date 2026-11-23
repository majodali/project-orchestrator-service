import { describe, expect, it } from "vitest";

import { loadGithubAppConfig } from "../src/githubAppConfig.js";

describe("loadGithubAppConfig", () => {
  it("reports both variables missing on an empty environment", () => {
    const result = loadGithubAppConfig({});
    expect(result).toEqual({
      ok: false,
      missing: ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"],
    });
  });

  it("reports only what is actually missing", () => {
    const result = loadGithubAppConfig({ GITHUB_APP_ID: "123" });
    expect(result).toEqual({
      ok: false,
      missing: ["GITHUB_APP_PRIVATE_KEY"],
    });
  });

  it("carries App credentials only — no repository (P2-N054, F3)", () => {
    const result = loadGithubAppConfig({
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY:
        "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
    });
    expect(result).toEqual({
      ok: true,
      config: {
        appId: "123",
        privateKey:
          "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
      },
    });
  });

  it("treats blank environment variables as unset", () => {
    const result = loadGithubAppConfig({
      GITHUB_APP_ID: "   ",
      GITHUB_APP_PRIVATE_KEY: "key",
    });
    expect(result).toEqual({ ok: false, missing: ["GITHUB_APP_ID"] });
  });
});
