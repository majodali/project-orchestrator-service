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
   * The project the request's endpoint path resolved to (P2-N054,
   * design 1, S2), `owner/repo`. Absent when no path was resolved —
   * `/health`, and `getServiceIdentity().version` in
   * src/mcpServer.ts, neither of which answer for a project.
   */
  project?: string;
  /**
   * The Lambda qualifier this request was invoked through ("live" /
   * "preprod" / "$LATEST"), deliberately absent, not null, when this
   * process is not running under Lambda at all (the local dev server,
   * the test suite). The smoke test reads it to know which alias
   * answered.
   */
  invokedQualifier?: string;
}

export interface InvokedQualifierInfo {
  qualifier: string;
}

export function getServiceIdentity(
  env: NodeJS.ProcessEnv = process.env,
  invokedQualifierInfo?: InvokedQualifierInfo,
  project?: string,
): ServiceIdentity {
  return {
    service: packageJson.name,
    version: packageJson.version,
    commit: env.SERVICE_COMMIT?.trim() || "unknown",
    ...(project !== undefined ? { project } : {}),
    ...(invokedQualifierInfo
      ? { invokedQualifier: invokedQualifierInfo.qualifier }
      : {}),
  };
}
