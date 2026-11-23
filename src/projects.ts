/**
 * The deployment's project list (P2-N054, design 1, S1): which
 * repositories' endpoint paths, `/mcp/<owner>/<repo>`, this
 * deployment serves. Deployment configuration, not state — a state
 * file in a repository would need a project to bootstrap from — so
 * this reads environment variables, never git.
 *
 * `MCP_PROJECTS` is a comma-separated list of `owner/repo`, each item
 * trimmed and matching `PROJECT_ID`. Order is significant: the first
 * item is what the bare `/mcp` path serves (until P2-N059 retires it).
 * `MCP_PROJECT` is accepted as the spelling of a list of one, for a
 * single-project deployment. A duplicate item, a malformed item, an
 * empty list and an absent list are each a refusal naming what was
 * required and what was found (RU-013); so is `MCP_PROJECT` and
 * `MCP_PROJECTS` disagreeing when both are set.
 */

export interface Project {
  readonly owner: string;
  readonly repo: string;
}

export type ProjectListResult =
  { ok: true; projects: Project[] } | { ok: false; missing: string[] };

const PROJECT_ID = /^([\w.-]+)\/([\w.-]+)$/;

/** Parses one `owner/repo` item; null when it does not match. */
export function parseProjectId(raw: string): Project | null {
  const m = PROJECT_ID.exec(raw.trim());
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

export function projectId(p: Project): string {
  return `${p.owner}/${p.repo}`;
}

export function loadProjectList(
  env: NodeJS.ProcessEnv = process.env,
): ProjectListResult {
  const rawProjects = env.MCP_PROJECTS?.trim();
  const rawProject = env.MCP_PROJECT?.trim();

  if (!rawProjects && !rawProject) {
    return {
      ok: false,
      missing: [
        'MCP_PROJECTS (a comma-separated list of "<owner>/<repo>"; ' +
          "MCP_PROJECT is accepted as the spelling of a list of one)",
      ],
    };
  }

  if (!rawProjects) {
    // MCP_PROJECT alone: the spelling of a list of one.
    const p = parseProjectId(rawProject!);
    if (!p) {
      return {
        ok: false,
        missing: [
          `MCP_PROJECT (got ${JSON.stringify(rawProject)}; expected "<owner>/<repo>")`,
        ],
      };
    }
    return { ok: true, projects: [p] };
  }

  const items = rawProjects.split(",").map((s) => s.trim());
  if (items.length === 1 && items[0] === "") {
    return {
      ok: false,
      missing: [
        `MCP_PROJECTS (got ${JSON.stringify(rawProjects)}; expected a comma-separated list of "<owner>/<repo>")`,
      ],
    };
  }

  const seen = new Set<string>();
  const projects: Project[] = [];
  for (const item of items) {
    const p = parseProjectId(item);
    if (!p) {
      return {
        ok: false,
        missing: [
          `MCP_PROJECTS (item ${JSON.stringify(item)} is not "<owner>/<repo>")`,
        ],
      };
    }
    const key = projectId(p);
    if (seen.has(key)) {
      return {
        ok: false,
        missing: [`MCP_PROJECTS (duplicate project ${key})`],
      };
    }
    seen.add(key);
    projects.push(p);
  }

  if (rawProject !== undefined) {
    const soleId = projects.length === 1 ? projectId(projects[0]!) : null;
    if (soleId !== rawProject) {
      return {
        ok: false,
        missing: [
          `MCP_PROJECT and MCP_PROJECTS disagree (MCP_PROJECT=${JSON.stringify(rawProject)}, MCP_PROJECTS=${JSON.stringify(rawProjects)})`,
        ],
      };
    }
  }

  return { ok: true, projects };
}

/** The project a `owner`/`repo` pair resolves to, or undefined when
 * it is outside the deployment's list. */
export function findProject(
  projects: readonly Project[],
  owner: string,
  repo: string,
): Project | undefined {
  return projects.find((p) => p.owner === owner && p.repo === repo);
}
