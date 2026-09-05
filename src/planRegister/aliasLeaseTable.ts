/**
 * Alias-aware lease-table selection, failing closed (node P2-N015,
 * child C of the coordinating repository's
 * docs/specs/p2-n012-deploy-from-ci-on-merge.md).
 *
 * Lambda environment variables are per-*version*, not per-alias
 * (child A's finding, docs/findings/alias-assumptions.md, assumption
 * 1) — one published version answers both the `live` and `preprod`
 * aliases and cannot tell them apart from `process.env` alone. The
 * handler therefore reads its own invoked qualifier from the Lambda
 * context instead (assumption 2: `c.env.lambdaContext.invokedFunctionArn`,
 * readable inside any `hono/aws-lambda`-wrapped route — see
 * src/httpApp.ts) and picks the lease table from it.
 *
 * Fails closed: any qualifier that is not exactly "live" or "preprod"
 * — `$LATEST` included, and an unqualified invocation (the ARN
 * carries no qualifier segment at all — AWS's own context
 * documentation: "Indicates if the invoker specified a version number
 * or alias", i.e. absent when none was) — is refused, naming the
 * qualifier it saw, rather than ever defaulting to the production
 * table.
 *
 * Scoped to Lambda by construction, not by an explicit environment
 * check: this module is only ever reached from src/httpApp.ts when
 * `c.env?.lambdaContext?.invokedFunctionArn` is present. The local dev
 * server (src/localServer.ts) and the test suite never populate that
 * field — `app.request()` with no third `env` argument leaves `c.env`
 * empty — so they never call into this module at all and keep
 * resolving the table from `LEASE_TABLE_NAME` via
 * ./defaultLeaseBackend.ts exactly as before (I7).
 */

export const LIVE_QUALIFIER = "live";
export const PREPROD_QUALIFIER = "preprod";

/**
 * Thrown when the invoked qualifier is neither "live" nor "preprod".
 * The fail-closed refusal: never caught and defaulted anywhere in
 * this module or its callers.
 */
export class UnrecognizedLambdaQualifierError extends Error {
  constructor(public readonly qualifier: string) {
    super(
      `refusing to select a lease table: the invoked Lambda qualifier ` +
        `${JSON.stringify(qualifier)} is neither "${LIVE_QUALIFIER}" nor ` +
        `"${PREPROD_QUALIFIER}" — failing closed rather than defaulting to ` +
        "the production table (see docs/runbook.md).",
    );
    this.name = "UnrecognizedLambdaQualifierError";
  }
}

/**
 * Thrown when the qualifier is recognized but this deployment's
 * template.yaml did not wire the environment variable that names its
 * table — a configuration gap, not a caller error.
 */
export class AliasLeaseTableNotConfiguredError extends Error {
  constructor(
    public readonly qualifier: string,
    public readonly envVarName: string,
  ) {
    super(
      `the "${qualifier}" alias's lease table is not configured (missing ` +
        `environment variable ${envVarName}) — this deployment's ` +
        "template.yaml did not wire it for this alias",
    );
    this.name = "AliasLeaseTableNotConfiguredError";
  }
}

/**
 * Extracts the qualifier segment (alias name, version number, or
 * `$LATEST`) from a Lambda `invokedFunctionArn`, per AWS's documented
 * shape
 * `arn:aws:lambda:<region>:<account-id>:function:<name>[:<qualifier>]`
 * (docs.aws.amazon.com/lambda/latest/dg/nodejs-context.html, read
 * 2026-09-01 by child A). Returns `undefined` when the ARN carries no
 * qualifier segment at all (an unqualified invocation) rather than
 * guessing — callers decide how to name that case in a refusal.
 */
export function parseInvokedQualifier(
  invokedFunctionArn: string,
): string | undefined {
  const parts = invokedFunctionArn.split(":");
  // 0:arn 1:aws 2:lambda 3:region 4:account-id 5:function 6:name [7:qualifier]
  if (parts.length >= 8 && parts[2] === "lambda" && parts[5] === "function") {
    return parts[7];
  }
  return undefined;
}

export interface ResolvedAliasLeaseTable {
  qualifier: string;
  tableName: string;
}

/**
 * Resolves the lease table name for a Lambda-invoked request, failing
 * closed. `env.LEASE_TABLE_NAME` (the existing variable, wired to the
 * production `LeaseTable` in template.yaml) serves `live`;
 * `env.PREPROD_LEASE_TABLE_NAME` (new, wired to `PreprodLeaseTable`)
 * serves `preprod`. Never returns a table for anything else — throws
 * `UnrecognizedLambdaQualifierError` or
 * `AliasLeaseTableNotConfiguredError` instead.
 */
export function resolveAliasLeaseTable(
  invokedFunctionArn: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAliasLeaseTable {
  const qualifier = parseInvokedQualifier(invokedFunctionArn) ?? "$LATEST";
  if (qualifier === LIVE_QUALIFIER) {
    const tableName = env.LEASE_TABLE_NAME?.trim();
    if (!tableName) {
      throw new AliasLeaseTableNotConfiguredError(
        qualifier,
        "LEASE_TABLE_NAME",
      );
    }
    return { qualifier, tableName };
  }
  if (qualifier === PREPROD_QUALIFIER) {
    const tableName = env.PREPROD_LEASE_TABLE_NAME?.trim();
    if (!tableName) {
      throw new AliasLeaseTableNotConfiguredError(
        qualifier,
        "PREPROD_LEASE_TABLE_NAME",
      );
    }
    return { qualifier, tableName };
  }
  throw new UnrecognizedLambdaQualifierError(qualifier);
}
