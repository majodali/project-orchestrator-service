/**
 * Service identity metadata — the payload the `service_identity` MCP
 * tool returns (chunk 1 child B, node P2-N008, the reachability
 * slice). Deliberately the only piece of "business logic" this slice
 * carries: enough to prove the round trip end to end, nothing about
 * plan state.
 */

// Import attribute (`with { type: "json" }`) rather than a runtime
// `fs`/`require` read: esbuild (the SAM build method for this
// function, see template.yaml) inlines JSON imports into the bundle
// at build time, so the version travels with the Lambda artifact
// instead of depending on package.json being present next to the
// bundled file at runtime.
import packageJson from "../package.json" with { type: "json" };

export interface ServiceIdentity {
  /** The service's own name, from package.json. */
  service: string;
  /** The service's own version, from package.json. */
  version: string;
  /**
   * The commit this build was deployed from. Set by the deploy script
   * (`scripts/deploy.sh`) from `git rev-parse HEAD` at build time and
   * passed through as the `ServiceCommit` SAM parameter, which lands
   * in the Lambda environment as `SERVICE_COMMIT`. Local runs have no
   * build step, so this stays `"unknown"` unless a caller sets the
   * variable explicitly.
   */
  commit: string;
  /**
   * The coordinating repository this deployment is configured for —
   * not read from anywhere at request time (chunk 1 child B does no
   * git reads; that starts at child C). Set by the `MCP_PROJECT`
   * environment variable so one deployment could, in principle, be
   * repointed without a code change.
   */
  project: string;
}

const DEFAULT_PROJECT = "majodali/project-orchestrator";

export function getServiceIdentity(
  env: NodeJS.ProcessEnv = process.env,
): ServiceIdentity {
  return {
    service: packageJson.name,
    version: packageJson.version,
    commit: env.SERVICE_COMMIT?.trim() || "unknown",
    project: env.MCP_PROJECT?.trim() || DEFAULT_PROJECT,
  };
}
