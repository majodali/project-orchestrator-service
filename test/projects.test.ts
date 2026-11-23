import { describe, expect, it } from "vitest";

import {
  findProject,
  loadProjectList,
  parseProjectId,
  projectId,
} from "../src/projects.js";

/**
 * The deployment's project list (P2-N054, design 1, S1): validates
 * `MCP_PROJECTS` / `MCP_PROJECT` before any endpoint path is resolved
 * against it.
 */

describe("loadProjectList", () => {
  it("refuses an absent list, naming what was required", () => {
    const result = loadProjectList({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing.join(" ")).toContain("MCP_PROJECTS");
    }
  });

  it("reads MCP_PROJECT as the spelling of a list of one", () => {
    const result = loadProjectList({
      MCP_PROJECT: "majodali/project-orchestrator",
    });
    expect(result).toEqual({
      ok: true,
      projects: [{ owner: "majodali", repo: "project-orchestrator" }],
    });
  });

  it("refuses a malformed MCP_PROJECT", () => {
    const result = loadProjectList({ MCP_PROJECT: "not-a-slash-shape" });
    expect(result.ok).toBe(false);
  });

  it("parses an ordered, comma-separated MCP_PROJECTS", () => {
    const result = loadProjectList({
      MCP_PROJECTS: "majodali/project-orchestrator, majodali/methodology-tools",
    });
    expect(result).toEqual({
      ok: true,
      projects: [
        { owner: "majodali", repo: "project-orchestrator" },
        { owner: "majodali", repo: "methodology-tools" },
      ],
    });
  });

  it("refuses an empty MCP_PROJECTS", () => {
    const result = loadProjectList({ MCP_PROJECTS: "" });
    expect(result.ok).toBe(false);
  });

  it("refuses a malformed item in MCP_PROJECTS, naming it", () => {
    const result = loadProjectList({
      MCP_PROJECTS: "majodali/project-orchestrator,not-a-slash-shape",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing.join(" ")).toContain("not-a-slash-shape");
    }
  });

  it("refuses a duplicate item in MCP_PROJECTS, naming it", () => {
    const result = loadProjectList({
      MCP_PROJECTS:
        "majodali/project-orchestrator,majodali/project-orchestrator",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing.join(" ")).toContain("duplicate");
    }
  });

  it("accepts MCP_PROJECT and MCP_PROJECTS agreeing on a list of one", () => {
    const result = loadProjectList({
      MCP_PROJECT: "majodali/project-orchestrator",
      MCP_PROJECTS: "majodali/project-orchestrator",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses MCP_PROJECT and MCP_PROJECTS disagreeing, naming both", () => {
    const result = loadProjectList({
      MCP_PROJECT: "majodali/project-orchestrator",
      MCP_PROJECTS: "majodali/methodology-tools",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing.join(" ")).toContain(
        "majodali/project-orchestrator",
      );
      expect(result.missing.join(" ")).toContain("majodali/methodology-tools");
    }
  });

  it("refuses MCP_PROJECT disagreeing with a longer MCP_PROJECTS", () => {
    const result = loadProjectList({
      MCP_PROJECT: "majodali/project-orchestrator",
      MCP_PROJECTS: "majodali/project-orchestrator,majodali/methodology-tools",
    });
    expect(result.ok).toBe(false);
  });
});

describe("parseProjectId / projectId", () => {
  it("round-trips an owner/repo pair", () => {
    const p = parseProjectId("majodali/project-orchestrator");
    expect(p).toEqual({ owner: "majodali", repo: "project-orchestrator" });
    expect(projectId(p!)).toBe("majodali/project-orchestrator");
  });

  it("rejects a string with no slash", () => {
    expect(parseProjectId("majodali")).toBeNull();
  });
});

describe("findProject", () => {
  const projects = [
    { owner: "majodali", repo: "project-orchestrator" },
    { owner: "majodali", repo: "methodology-tools" },
  ];

  it("finds a project in the list", () => {
    expect(findProject(projects, "majodali", "methodology-tools")).toEqual({
      owner: "majodali",
      repo: "methodology-tools",
    });
  });

  it("answers undefined for a repository outside the list", () => {
    expect(findProject(projects, "majodali", "scratch")).toBeUndefined();
  });
});
