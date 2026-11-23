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

  it("omits project when none is given (P2-N054: it is no longer read from MCP_PROJECT)", () => {
    const identity = getServiceIdentity({});
    expect(identity).not.toHaveProperty("project");
  });

  it("reports the project it is given — the endpoint path's resolved project", () => {
    const identity = getServiceIdentity({}, undefined, "example/other-repo");
    expect(identity.project).toBe("example/other-repo");
  });

  it("treats a blank SERVICE_COMMIT as unset", () => {
    const identity = getServiceIdentity({ SERVICE_COMMIT: "   " });
    expect(identity.commit).toBe("unknown");
  });

  it("omits invokedQualifier when no qualifier info is given", () => {
    const identity = getServiceIdentity({});
    expect(identity).not.toHaveProperty("invokedQualifier");
    expect(Object.keys(identity).sort()).toEqual([
      "commit",
      "service",
      "version",
    ]);
  });

  it("reports the invoked qualifier when given", () => {
    expect(getServiceIdentity({}, { qualifier: "live" }).invokedQualifier).toBe(
      "live",
    );
    expect(
      getServiceIdentity({}, { qualifier: "$LATEST" }).invokedQualifier,
    ).toBe("$LATEST");
  });
});
