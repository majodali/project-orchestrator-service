#!/usr/bin/env bash
#
# Smoke test for project-orchestrator-service (node P2-N016, chunk 2
# child D of docs/specs/p2-n012-deploy-from-ci-on-merge.md in the
# coordinating repository). Four checks, in order: `/health` returns
# 200; `tools/list` carries the ten tools; `plan_read` answers the
# state file at a commit (a read: the smoke test never writes); and (node
# P2-N021, the web view) signing in with the view token and reading
# `/view` returns 200 with a 40-character SHA in the page's header.
# Any failure
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
#   VIEW_TOKEN_SECRET_NAME    Name (not ARN) of the Secrets Manager
#                             secret holding the web view's token
#                             (node P2-N021, owner action O-view-1).
#                             Read here at run time the same way, for
#                             check 4 only.
#
# AWS credentials come from whatever the caller already has configured
# (the deploy role's OIDC session in CI, or the operator's own AWS
# credentials by hand) — this script does not assume a role itself.

set -euo pipefail

: "${SERVICE_URL:?Set SERVICE_URL to the endpoint to test (\$ENDPOINT or \$PREPROD_ENDPOINT).}"
: "${AWS_REGION:?Set AWS_REGION (the region the bearer-token secret lives in).}"
: "${AUTH_TOKEN_SECRET_NAME:?Set AUTH_TOKEN_SECRET_NAME to the Secrets Manager secret holding the bearer token.}"
: "${VIEW_TOKEN_SECRET_NAME:?Set VIEW_TOKEN_SECRET_NAME to the Secrets Manager secret holding the web view token (O-view-1).}"

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
echo "== Check 1/4: GET /health returns 200 =="
HEALTH_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/health")"
if [ "$HEALTH_STATUS" != "200" ]; then
  echo "SMOKE FAILURE (check 1/4, /health): GET ${BASE_URL}/health returned ${HEALTH_STATUS}, expected 200." >&2
  # node P2-N016 (T036) — this exact failure (a 403 on preprod's own
  # /health) was Lambda's own function-URL authorization layer, not
  # the application (src/httpApp.ts never authenticates /health):
  # confirmed by the response carrying an `x-amzn-ErrorType` header
  # and Lambda's function-URL troubleshooting link, not the app's own
  # JSON error shape. Diagnostic only — never changes this check's
  # pass/fail outcome, just makes that signature visible on this run's
  # own log instead of requiring a second, by-hand `curl -i`.
  if [ "$HEALTH_STATUS" = "403" ]; then
    HEALTH_HEADERS="$(curl -sS -o /dev/null -D - "${BASE_URL}/health" || true)"
    if printf '%s' "$HEALTH_HEADERS" | grep -qi '^x-amzn-errortype:'; then
      echo "This 403 carries Lambda's own 'x-amzn-ErrorType' header — Lambda's" >&2
      echo "function-URL authorization layer refused the request before it ever" >&2
      echo "reached the application, not an application-level 403. See" >&2
      echo "docs/runbook.md's Troubleshooting entry for this exact signature." >&2
      printf '%s\n' "$HEALTH_HEADERS" | grep -i '^x-amzn-errortype:' >&2
    fi
  fi
  exit 1
fi
echo "OK — /health returned 200."

echo
echo "== Check 2/4: tools/list carries the ten tools =="
TOOLS_RESPONSE="$(mcp_call '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')"
MISSING_TOOLS="$(TOOLS_RESPONSE="$TOOLS_RESPONSE" node -e '
  const required = [
    "service_identity",
    "plan_read",
    "node_update",
    "node_add",
    "node_remove",
    "task_next",
    "task_open",
    "task_close",
    "decision_open",
    "decision_close",
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
  echo "SMOKE FAILURE (check 2/4, tools/list): missing tool(s): ${MISSING_TOOLS}." >&2
  echo "Full response: ${TOOLS_RESPONSE}" >&2
  exit 1
fi
echo "OK — tools/list carries the ten tools."

echo
echo "== Check 3/4: plan_read answers the state file at a commit =="
# A read only: the smoke test never writes the coordinating repository.
READ_RESPONSE="$(mcp_call '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plan_read","arguments":{}}}')"
READ_SHA="$(READ_RESPONSE="$READ_RESPONSE" node -e '
  let body;
  try {
    body = JSON.parse(process.env.READ_RESPONSE);
  } catch {
    process.exit(0);
  }
  const content = body.result?.structuredContent;
  if (body.result?.isError || !content) process.exit(0);
  const sha = content.sha;
  const nodes = Array.isArray(content.nodes) ? content.nodes.length : 0;
  if (typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) && nodes > 0) process.stdout.write(sha);
')"
if [ -z "$READ_SHA" ]; then
  echo "SMOKE FAILURE (check 3/4, plan_read): no 40-character SHA with nodes in the response." >&2
  echo "Full response: ${READ_RESPONSE}" >&2
  exit 1
fi
echo "OK — plan_read answered the state file at commit ${READ_SHA}."

echo
echo "== Check 4/4: sign in to the web view and read the tree page =="
# node P2-N021 (criterion V19). The view token is read from Secrets
# Manager at run time, as the bearer token is above, and masked at
# once. It reaches curl on standard input, never in its arguments.
VIEW_TOKEN="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$VIEW_TOKEN_SECRET_NAME" \
  --query SecretString \
  --output text)"
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::add-mask::${VIEW_TOKEN}"
fi
VIEW_WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$VIEW_WORK_DIR"' EXIT
SIGN_IN_STATUS="$(printf '%s' "$VIEW_TOKEN" | curl -sS -o /dev/null \
  -D "${VIEW_WORK_DIR}/sign-in-headers" \
  -w '%{http_code}' \
  -X POST "${BASE_URL}/view/sign-in" \
  --data-urlencode "token@-")"
if [ "$SIGN_IN_STATUS" != "303" ]; then
  echo "SMOKE FAILURE (check 4/4, /view sign-in): POST ${BASE_URL}/view/sign-in returned ${SIGN_IN_STATUS}, expected 303." >&2
  exit 1
fi
# The cookie is Secure; it is sent back as a header rather than through
# a cookie jar, so the check reads the same against either endpoint.
VIEW_COOKIE="$(tr -d '\r' < "${VIEW_WORK_DIR}/sign-in-headers" \
  | sed -n 's/^[Ss][Ee][Tt]-[Cc][Oo][Oo][Kk][Ii][Ee]: \(po_view=[^;]*\).*/\1/p' \
  | head -n 1)"
if [ -z "$VIEW_COOKIE" ]; then
  echo "SMOKE FAILURE (check 4/4, /view sign-in): the 303 set no view cookie." >&2
  exit 1
fi
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::add-mask::${VIEW_COOKIE}"
fi
printf 'Cookie: %s\n' "$VIEW_COOKIE" > "${VIEW_WORK_DIR}/cookie-header"
VIEW_STATUS="$(curl -sS -o "${VIEW_WORK_DIR}/view.html" -w '%{http_code}' \
  -H "@${VIEW_WORK_DIR}/cookie-header" \
  "${BASE_URL}/view")"
if [ "$VIEW_STATUS" != "200" ]; then
  echo "SMOKE FAILURE (check 4/4, /view): GET ${BASE_URL}/view returned ${VIEW_STATUS}, expected 200." >&2
  exit 1
fi
VIEW_SHA="$(grep -Eo '<code data-sha>[0-9a-f]{40}</code>' "${VIEW_WORK_DIR}/view.html" \
  | head -n 1 \
  | sed -E 's/<[^>]*>//g' || true)"
if [ -z "$VIEW_SHA" ]; then
  echo "SMOKE FAILURE (check 4/4, /view): the page's header carries no 40-character SHA." >&2
  exit 1
fi
echo "OK — /view returned 200 at commit ${VIEW_SHA}."

echo
echo "== Smoke test passed: all four checks OK against ${BASE_URL} =="
