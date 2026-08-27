import { describe, expect, it } from "vitest";

import { getServiceIdentity } from "../src/serviceInfo.js";

describe("getServiceIdentity", () => {
  it("reports the service name and version from package.json", () => {
    const identity = getServiceIdentity({});
    expect(identity.service).toBe("project-orchestrator-service");
    expect(identity.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("defaults commit to 'unknown' when SERVICE_COMMIT is unset", () => {
    const identity = getServiceIdentity({});
    expect(identity.commit).toBe("unknown");
  });

  it("reports the build commit from SERVICE_COMMIT when set", () => {
    const identity = getServiceIdentity({ SERVICE_COMMIT: "abc1234" });
    expect(identity.commit).toBe("abc1234");
  });

  it("defaults project to the coordinating repository", () => {
    const identity = getServiceIdentity({});
    expect(identity.project).toBe("majodali/project-orchestrator");
  });

  it("reports the configured project from MCP_PROJECT when set", () => {
    const identity = getServiceIdentity({ MCP_PROJECT: "example/other-repo" });
    expect(identity.project).toBe("example/other-repo");
  });

  it("treats a blank SERVICE_COMMIT as unset", () => {
    const identity = getServiceIdentity({ SERVICE_COMMIT: "   " });
    expect(identity.commit).toBe("unknown");
  });
});
