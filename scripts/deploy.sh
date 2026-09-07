#!/usr/bin/env bash
#
# One-command deploy for project-orchestrator-service. See
# docs/runbook.md for what must be true before this runs (owner
# actions O1, O3, and O4) and what to do with what it prints.
#
# Required environment variables:
#   AWS_REGION                     The region chosen under O1.
#   AUTH_TOKEN_SECRET_NAME          Name (not ARN) of the Secrets
#                                   Manager secret created under O4
#                                   (docs/runbook.md Step 1). Never
#                                   read by this script — only named,
#                                   so CloudFormation can resolve it at
#                                   deploy time.
#   GITHUB_APP_ID                   The GitHub App's numeric ID
#                                   (owner action O3, docs/runbook.md).
#                                   Not secret.
#   GITHUB_APP_INSTALLATION_ID      The App's installation ID for
#                                   majodali/project-orchestrator
#                                   (owner action O3). Not secret.
#   GITHUB_APP_PRIVATE_KEY_SECRET_NAME   Name (not ARN) of the Secrets
#                                   Manager secret holding the App's
#                                   PEM private key (owner action O3).
#                                   Never read by this script, the same
#                                   pattern as AUTH_TOKEN_SECRET_NAME.
#
# Optional:
#   STACK_NAME    Default: project-orchestrator-service
#   STAGE         Default: prod — a deployment label only (resource
#                 tag), NOT the API Gateway stage. The HTTP API's
#                 stage is fixed to $default in template.yaml so the
#                 endpoint carries no stage segment; see that file's
#                 Stage parameter and HttpApi resource for why.
#   PROJECT_NAME  Default: majodali/project-orchestrator

set -euo pipefail

: "${AWS_REGION:?Set AWS_REGION (the region chosen under O1; see docs/runbook.md).}"
: "${AUTH_TOKEN_SECRET_NAME:?Set AUTH_TOKEN_SECRET_NAME to the secret created under O4 (docs/runbook.md Step 1).}"
: "${GITHUB_APP_ID:?Set GITHUB_APP_ID to the GitHub App's numeric ID (owner action O3; see docs/runbook.md).}"
: "${GITHUB_APP_INSTALLATION_ID:?Set GITHUB_APP_INSTALLATION_ID to the App's installation ID for majodali/project-orchestrator (owner action O3; see docs/runbook.md).}"
: "${GITHUB_APP_PRIVATE_KEY_SECRET_NAME:?Set GITHUB_APP_PRIVATE_KEY_SECRET_NAME to the secret created under O3 (see docs/runbook.md).}"

STACK_NAME="${STACK_NAME:-project-orchestrator-service}"
STAGE="${STAGE:-prod}"
PROJECT_NAME="${PROJECT_NAME:-majodali/project-orchestrator}"
SERVICE_COMMIT="$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse HEAD)"

# node P2-N015 (I4) — read back `live`'s actual current FunctionVersion
# before this ordinary deploy, and pass that same value back as the
# LiveVersion parameter override, so this stack update declares no
# change to it and CloudFormation leaves LiveAlias alone. This is the
# mechanism docs/findings/alias-assumptions.md (assumption 5)
# prescribes verbatim — see template.yaml's LiveVersion parameter for
# the full reasoning.
#
# node P2-N016 (T036) rework — this read-back protects an invariant
# ("`live` never points at `$LATEST`") that has to already hold before
# it can do any protecting: if `live` is actually at `$LATEST` (a
# mutable qualifier), reading it back and passing it straight through
# does not "declare no change" in any way that matters — `live` starts
# serving whatever `sam deploy` just uploaded the instant the function
# code updates, before this script's own smoke test ever runs. That is
# exactly the outage this task fixes (docs/runbook.md's K-011
# correction has the full account). So only one case now falls through
# silently to `$LATEST`: no stack exists yet at all (first-ever
# deploy — describe-stacks itself errors, `EXISTING_FUNCTION_NAME`
# stays empty). Once a stack exists, `live` (an `AWS::Lambda::Alias`
# resource created in that same stack) always exists too, so
# `get-alias --name live` succeeding is the ordinary case and failing
# is itself an anomaly — both a successful read-back of `$LATEST` and
# an outright `get-alias` failure now refuse to deploy rather than
# guess, per the "fail closed" requirement (I4). See
# docs/runbook.md's "One-time owner bootstrap" section for the exact
# commands to pin `live` away from `$LATEST` once, by hand, before the
# next deploy — this script cannot do that for the owner (it does not
# hold the read-write moment a human choosing what "tested" means
# requires).
LIVE_VERSION='$LATEST'
EXISTING_FUNCTION_NAME="$(aws cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='McpFunctionName'].OutputValue" \
  --output text 2>/dev/null || true)"
if [ -n "$EXISTING_FUNCTION_NAME" ] && [ "$EXISTING_FUNCTION_NAME" != "None" ]; then
  if ! READ_BACK="$(aws lambda get-alias \
    --region "$AWS_REGION" \
    --function-name "$EXISTING_FUNCTION_NAME" \
    --name live \
    --query FunctionVersion \
    --output text)"; then
    echo "== REFUSING TO DEPLOY (node P2-N016, I4 — fail closed) ==" >&2
    echo "Stack '$STACK_NAME' already exists (function: $EXISTING_FUNCTION_NAME)," >&2
    echo "but 'aws lambda get-alias --name live' failed (see its own error above)." >&2
    echo "This script cannot confirm 'live' is safely pinned away from \$LATEST," >&2
    echo "so it will not deploy. Investigate by hand (aws lambda get-alias" >&2
    echo "--function-name '$EXISTING_FUNCTION_NAME' --name live) before retrying." >&2
    exit 1
  fi
  if [ "$READ_BACK" = '$LATEST' ]; then
    echo "== REFUSING TO DEPLOY (node P2-N016, I4 — fail closed) ==" >&2
    echo "'live' is currently pinned to \$LATEST on stack '$STACK_NAME'" >&2
    echo "(function: $EXISTING_FUNCTION_NAME). \$LATEST is mutable, so this" >&2
    echo "deploy would move production the instant 'sam deploy' updates the" >&2
    echo "function's code — before any smoke test runs. See docs/runbook.md's" >&2
    echo "\"One-time owner bootstrap\" section; the short version, run once by" >&2
    echo "hand before retrying this script:" >&2
    echo "  NEW_VERSION=\$(aws lambda publish-version --region '$AWS_REGION' \\" >&2
    echo "    --function-name '$EXISTING_FUNCTION_NAME' --query Version --output text)" >&2
    echo "  aws lambda update-alias --region '$AWS_REGION' \\" >&2
    echo "    --function-name '$EXISTING_FUNCTION_NAME' --name live \\" >&2
    echo "    --function-version \"\$NEW_VERSION\"" >&2
    echo "Then confirm with: aws lambda get-alias --region '$AWS_REGION' \\" >&2
    echo "  --function-name '$EXISTING_FUNCTION_NAME' --name live --query FunctionVersion" >&2
    echo "— it must print a plain number, not \$LATEST, before this script is re-run." >&2
    exit 1
  fi
  LIVE_VERSION="$READ_BACK"
fi
echo "== live is currently at FunctionVersion=${LIVE_VERSION} — this deploy will not move it (I4) =="

echo "== sam build (esbuild bundling src/lambda.ts) =="
sam build

echo
echo "== sam deploy: stack '$STACK_NAME', region '$AWS_REGION', stage '$STAGE' =="
sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "Stage=${STAGE}" \
    "AuthTokenSecretName=${AUTH_TOKEN_SECRET_NAME}" \
    "ProjectName=${PROJECT_NAME}" \
    "ServiceCommit=${SERVICE_COMMIT}" \
    "GithubAppId=${GITHUB_APP_ID}" \
    "GithubAppInstallationId=${GITHUB_APP_INSTALLATION_ID}" \
    "GithubAppPrivateKeySecretName=${GITHUB_APP_PRIVATE_KEY_SECRET_NAME}" \
    "LiveVersion=${LIVE_VERSION}"

echo
echo "== Endpoint =="
aws cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='Endpoint'].OutputValue" \
  --output text
