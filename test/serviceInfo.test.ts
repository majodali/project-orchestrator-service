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

  // node P2-N015 — the qualifier/lease-table fields are omitted
  // entirely (not `undefined`-valued, not `null`) when no
  // invokedQualifierInfo is given, which is what keeps every call site
  // above — none of which passes a second argument — reporting the
  // exact same four-key shape it always has (I7).
  it("omits invokedQualifier and leaseTable when no qualifier info is given", () => {
    const identity = getServiceIdentity({});
    expect(identity).not.toHaveProperty("invokedQualifier");
    expect(identity).not.toHaveProperty("leaseTable");
    expect(Object.keys(identity).sort()).toEqual([
      "commit",
      "project",
      "service",
      "version",
    ]);
  });

  it("reports the invoked qualifier and resolved lease table when given", () => {
    const identity = getServiceIdentity(
      {},
      {
        qualifier: "live",
        leaseTable: "project-orchestrator-service-LeaseTable-abc",
      },
    );
    expect(identity.invokedQualifier).toBe("live");
    expect(identity.leaseTable).toBe(
      "project-orchestrator-service-LeaseTable-abc",
    );
  });

  it("reports the refused qualifier with leaseTable omitted, not null or a default table", () => {
    const identity = getServiceIdentity(
      {},
      { qualifier: "$LATEST", leaseTable: null },
    );
    expect(identity.invokedQualifier).toBe("$LATEST");
    expect(identity).not.toHaveProperty("leaseTable");
  });
});
