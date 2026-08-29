import { describe, expect, it } from "vitest";

import { loadGithubAppConfig } from "../src/githubAppConfig.js";

describe("loadGithubAppConfig", () => {
  it("reports all three variables missing on an empty environment", () => {
    const result = loadGithubAppConfig({});
    expect(result).toEqual({
      ok: false,
      missing: [
        "GITHUB_APP_ID",
        "GITHUB_APP_INSTALLATION_ID",
        "GITHUB_APP_PRIVATE_KEY",
      ],
    });
  });

  it("reports only what is actually missing", () => {
    const result = loadGithubAppConfig({ GITHUB_APP_ID: "123" });
    expect(result).toEqual({
      ok: false,
      missing: ["GITHUB_APP_INSTALLATION_ID", "GITHUB_APP_PRIVATE_KEY"],
    });
  });

  it("defaults the repository to majodali/project-orchestrator", () => {
    const result = loadGithubAppConfig({
      GITHUB_APP_ID: "123",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY:
        "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
    });
    expect(result).toEqual({
      ok: true,
      config: {
        appId: "123",
        installationId: "456",
        privateKey:
          "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
        owner: "majodali",
        repo: "project-orchestrator",
      },
    });
  });

  it("reads the repository from MCP_PROJECT when set", () => {
    const result = loadGithubAppConfig({
      GITHUB_APP_ID: "123",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY: "key",
      MCP_PROJECT: "example/other-repo",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.owner).toBe("example");
      expect(result.config.repo).toBe("other-repo");
    }
  });

  it("reports a malformed MCP_PROJECT rather than silently misreading it", () => {
    const result = loadGithubAppConfig({
      GITHUB_APP_ID: "123",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY: "key",
      MCP_PROJECT: "not-a-slash-shape",
    });
    expect(result.ok).toBe(false);
  });

  it("treats blank environment variables as unset", () => {
    const result = loadGithubAppConfig({
      GITHUB_APP_ID: "   ",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY: "key",
    });
    expect(result).toEqual({ ok: false, missing: ["GITHUB_APP_ID"] });
  });
});
