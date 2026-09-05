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
# the full reasoning. Two cases fall through to the template's own
# default ($LATEST, harmless — see that parameter's description)
# rather than failing this deploy: no stack exists yet (first-ever
# deploy — describe-stacks errors), or the stack exists but `live` has
# never been promoted (get-alias errors, e.g. before this node's first
# deploy has run once). Only a real, already-promoted `live` changes
# this from the default.
LIVE_VERSION='$LATEST'
EXISTING_FUNCTION_NAME="$(aws cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='McpFunctionName'].OutputValue" \
  --output text 2>/dev/null || true)"
if [ -n "$EXISTING_FUNCTION_NAME" ] && [ "$EXISTING_FUNCTION_NAME" != "None" ]; then
  READ_BACK="$(aws lambda get-alias \
    --region "$AWS_REGION" \
    --function-name "$EXISTING_FUNCTION_NAME" \
    --name live \
    --query FunctionVersion \
    --output text 2>/dev/null || true)"
  if [ -n "$READ_BACK" ] && [ "$READ_BACK" != "None" ]; then
    LIVE_VERSION="$READ_BACK"
  fi
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
