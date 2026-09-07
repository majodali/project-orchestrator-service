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
  /**
   * The Lambda qualifier this request was invoked through ("live" /
   * "preprod"), or the qualifier a fail-closed refusal saw (node
   * P2-N015) — deliberately **absent** (not `null`; the key itself is
   * omitted) rather than a placeholder value when this process is not
   * running under Lambda at all (local dev server, the test suite),
   * since there is no qualifier to report in that case. This is what
   * turns "the right table was chosen" from an inference into one
   * authenticated call (G3, G4 of the p2-n012 specification).
   */
  invokedQualifier?: string;
  /**
   * The lease table *name* this request's qualifier resolved to.
   * Absent whenever `invokedQualifier` is absent, and also absent when
   * the qualifier was refused (fail-closed — an unrecognized qualifier
   * resolves to no table). Deliberately the table's name only, never
   * its ARN or any account identifier (S-001).
   */
  leaseTable?: string;
}

/**
 * Per-request Lambda-alias context, computed once in src/httpApp.ts
 * from `c.env.lambdaContext.invokedFunctionArn` and threaded through
 * src/mcpServer.ts to this module — see
 * src/planRegister/aliasLeaseTable.ts for how it is resolved.
 */
export interface InvokedQualifierInfo {
  qualifier: string;
  /** `null` when the qualifier was refused — no table was resolved. */
  leaseTable: string | null;
}

const DEFAULT_PROJECT = "majodali/project-orchestrator";

export function getServiceIdentity(
  env: NodeJS.ProcessEnv = process.env,
  invokedQualifierInfo?: InvokedQualifierInfo,
): ServiceIdentity {
  return {
    service: packageJson.name,
    version: packageJson.version,
    commit: env.SERVICE_COMMIT?.trim() || "unknown",
    project: env.MCP_PROJECT?.trim() || DEFAULT_PROJECT,
    ...(invokedQualifierInfo
      ? {
          invokedQualifier: invokedQualifierInfo.qualifier,
          ...(invokedQualifierInfo.leaseTable !== null
            ? { leaseTable: invokedQualifierInfo.leaseTable }
            : {}),
        }
      : {}),
  };
}
