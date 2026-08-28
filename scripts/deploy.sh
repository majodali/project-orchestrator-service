#!/usr/bin/env bash
#
# One-command deploy for project-orchestrator-service (chunk 1 child B,
# node P2-N008 — the reachability slice). See docs/runbook.md for what
# must be true before this runs (owner actions O1 and O4) and what to
# do with what it prints.
#
# Required environment variables:
#   AWS_REGION              The region chosen under O1.
#   AUTH_TOKEN_SECRET_NAME   Name (not ARN) of the Secrets Manager
#                            secret created under O4 (docs/runbook.md
#                            Step 1). Never read by this script — only
#                            named, so CloudFormation can resolve it at
#                            deploy time.
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

STACK_NAME="${STACK_NAME:-project-orchestrator-service}"
STAGE="${STAGE:-prod}"
PROJECT_NAME="${PROJECT_NAME:-majodali/project-orchestrator}"
SERVICE_COMMIT="$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse HEAD)"

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
    "ServiceCommit=${SERVICE_COMMIT}"

echo
echo "== Endpoint =="
aws cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='Endpoint'].OutputValue" \
  --output text
