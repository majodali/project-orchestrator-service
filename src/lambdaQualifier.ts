/**
 * The Lambda qualifier a request was invoked through, read from the
 * invoked function ARN that `hono/aws-lambda` puts on the context:
 * `live`, `preprod`, or `$LATEST` when the ARN carries none. Reported
 * by `service_identity` so the smoke test can tell which alias it is
 * talking to (node P2-N015 kept this; the lease table it once selected
 * is gone since the rebuild's milestone 3).
 */

const ARN_QUALIFIER = /^arn:aws:lambda:[^:]+:\d+:function:[^:]+(?::([^:]+))?$/;

export function parseInvokedQualifier(
  invokedFunctionArn: string,
): string | undefined {
  const m = ARN_QUALIFIER.exec(invokedFunctionArn);
  if (!m) return undefined;
  return m[1] ?? "$LATEST";
}
