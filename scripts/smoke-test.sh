#!/usr/bin/env bash
#
# Smoke test for project-orchestrator-service (node P2-N016, chunk 2
# child D of docs/specs/p2-n012-deploy-from-ci-on-merge.md in the
# coordinating repository). Three checks, in order: `/health` returns
# 200; `tools/list` carries all six tools; a full
# plan_lease_acquire/plan_lease_release cycle succeeds. Any failure
# prints "SMOKE FAILURE" naming the check and exits non-zero — the
# deploy workflow (.github/workflows/deploy.yml) runs this against the
# preprod Function URL before promoting `live`, so a non-zero exit
# here stops that promotion (G5).
#
# Runnable by hand from a workstation against either endpoint (I8) —
# see docs/runbook.md's "Running the smoke test by hand" note.
#
# No new dependency (R14): curl, the AWS CLI (already a prerequisite —
# see docs/runbook.md's "What you need before you start"), and Node's
# own built-ins only. No jq.
#
# Required environment variables:
#   SERVICE_URL              The base URL to test: $ENDPOINT
#                             (production; no trailing slash) or
#                             $PREPROD_ENDPOINT (a Lambda Function URL,
#                             which itself carries a trailing slash —
#                             this script normalizes either shape).
#   AWS_REGION                The region the bearer-token secret lives
#                             in.
#   AUTH_TOKEN_SECRET_NAME    Name (not ARN) of the Secrets Manager
#                             secret holding the bearer token (the same
#                             secret docs/runbook.md Step 1 creates).
#                             Read here at run time via
#                             `aws secretsmanager get-secret-value` —
#                             never a literal, never a new Actions
#                             secret (I6).
#
# AWS credentials come from whatever the caller already has configured
# (the deploy role's OIDC session in CI, or the operator's own AWS
# credentials by hand) — this script does not assume a role itself.

set -euo pipefail

: "${SERVICE_URL:?Set SERVICE_URL to the endpoint to test (\$ENDPOINT or \$PREPROD_ENDPOINT).}"
: "${AWS_REGION:?Set AWS_REGION (the region the bearer-token secret lives in).}"
: "${AUTH_TOKEN_SECRET_NAME:?Set AUTH_TOKEN_SECRET_NAME to the Secrets Manager secret holding the bearer token.}"

# Strip exactly one trailing slash, so both $ENDPOINT (none) and
# $PREPROD_ENDPOINT (a Function URL, which always carries one) work
# unmodified.
BASE_URL="${SERVICE_URL%/}"

echo "== Smoke test target: ${BASE_URL} =="

echo "== Reading the bearer token from Secrets Manager (${AUTH_TOKEN_SECRET_NAME}) — never a new Actions secret (I6) =="
TOKEN="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$AUTH_TOKEN_SECRET_NAME" \
  --query SecretString \
  --output text)"
# Mask immediately, before anything below could echo it — the same
# caution docs/runbook.md's "Running the smoke test by hand" note
# gives a human running this directly: never `echo "$TOKEN"`.
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::add-mask::${TOKEN}"
fi

mcp_call() {
  # $1 = JSON request body. Prints only the response body; never
  # echoes $TOKEN itself.
  curl -sS -X POST "${BASE_URL}/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "$1"
}

echo
echo "== Check 1/3: GET /health returns 200 =="
HEALTH_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/health")"
if [ "$HEALTH_STATUS" != "200" ]; then
  echo "SMOKE FAILURE (check 1/3, /health): GET ${BASE_URL}/health returned ${HEALTH_STATUS}, expected 200." >&2
  exit 1
fi
echo "OK — /health returned 200."

echo
echo "== Check 2/3: tools/list carries all six tools =="
TOOLS_RESPONSE="$(mcp_call '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')"
MISSING_TOOLS="$(TOOLS_RESPONSE="$TOOLS_RESPONSE" node -e '
  const required = [
    "service_identity",
    "plan_read",
    "plan_lease_acquire",
    "plan_update",
    "plan_confirm",
    "plan_lease_release",
  ];
  let body;
  try {
    body = JSON.parse(process.env.TOOLS_RESPONSE);
  } catch {
    process.stdout.write(required.join(","));
    process.exit(0);
  }
  const names = new Set((body.result?.tools ?? []).map((t) => t.name));
  process.stdout.write(required.filter((name) => !names.has(name)).join(","));
')"
if [ -n "$MISSING_TOOLS" ]; then
  echo "SMOKE FAILURE (check 2/3, tools/list): missing tool(s): ${MISSING_TOOLS}." >&2
  echo "Full response: ${TOOLS_RESPONSE}" >&2
  exit 1
fi
echo "OK — tools/list carries all six tools."

echo
echo "== Check 3/3: full lease acquire-and-release cycle =="
ACQUIRE_RESPONSE="$(mcp_call '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plan_lease_acquire","arguments":{"holder":"ci-smoke-test"}}}')"
LEASE_TOKEN="$(ACQUIRE_RESPONSE="$ACQUIRE_RESPONSE" node -e '
  let body;
  try {
    body = JSON.parse(process.env.ACQUIRE_RESPONSE);
  } catch {
    process.exit(0);
  }
  const token = body.result?.structuredContent?.token;
  if (typeof token === "string") process.stdout.write(token);
')"
if [ -z "$LEASE_TOKEN" ]; then
  echo "SMOKE FAILURE (check 3/3, plan_lease_acquire): no lease token in the response." >&2
  echo "Full response: ${ACQUIRE_RESPONSE}" >&2
  exit 1
fi

RELEASE_BODY="$(LEASE_TOKEN="$LEASE_TOKEN" node -e '
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "plan_lease_release", arguments: { leaseToken: process.env.LEASE_TOKEN } },
  }));
')"
RELEASE_RESPONSE="$(mcp_call "$RELEASE_BODY")"
RELEASED="$(RELEASE_RESPONSE="$RELEASE_RESPONSE" node -e '
  let body;
  try {
    body = JSON.parse(process.env.RELEASE_RESPONSE);
  } catch {
    process.exit(0);
  }
  process.stdout.write(body.result?.structuredContent?.released === true ? "true" : "");
')"
if [ "$RELEASED" != "true" ]; then
  echo "SMOKE FAILURE (check 3/3, plan_lease_release): did not report {\"released\": true}." >&2
  echo "Full response: ${RELEASE_RESPONSE}" >&2
  exit 1
fi
echo "OK — lease acquired and released against ${BASE_URL}."

echo
echo "== Smoke test passed: all three checks OK against ${BASE_URL} =="
