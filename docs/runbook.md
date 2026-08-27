# Deploy runbook — reachability slice (chunk 1 child B, node P2-N008)

<!-- Written before any owner action named below is requested — the
     spec requires this ordering (I8), not just as a nicety. Every
     step a human must take is one of O1, O2, O4, or O5 from the
     [orchestration-service plan](https://github.com/majodali/project-orchestrator/blob/main/docs/plans/orchestration-service.md#what-this-environment-can-deliver-and-what-is-the-owners).
     O3 (the GitHub App) is **not** part of this child — the
     reachability slice does no git reads; O3 lands with chunk 1
     child C. A step this document asks for that is not one of
     O1/O2/O4/O5 is a runbook defect, to be fixed here, not narrated
     at the gate. -->

This is the procedure that takes a stranger from an empty AWS account
to a deployed, authenticated MCP endpoint answering the
`service_identity` tool — the reachability slice's entire content.
Nothing here writes to git or reads plan state; that starts with
children C and D.

## What you need before you start

- An AWS account and a chosen region (**O1**). Any region that offers
  Lambda and HTTP API works; there is nothing region-specific in
  `template.yaml`.
- AWS credentials for that account available to your shell (however
  you normally authenticate — this runbook does not prescribe a
  method).
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
  and the AWS CLI, installed locally.
- Node.js 22+ and this repository cloned, with `npm install` already
  run (`sam build`'s esbuild step needs `node_modules` present).

Nothing above requires an agent session; this is what the owner does
alone, in one sitting.

## Step 1 — Mint the bearer client token and store it (O4, part 1)

The client secret the enlistment file (`.mcp.json`) presents to the
service. Generate one and store it in AWS Secrets Manager — the
service reads it from there only at deploy time (see `template.yaml`'s
`AuthTokenSecretName` parameter and the `MCP_AUTH_TOKEN` dynamic
reference); it is never a literal in this repository or in the
coordinating repository.

```sh
TOKEN=$(openssl rand -base64 32)
aws secretsmanager create-secret \
  --region "$AWS_REGION" \
  --name project-orchestrator-service/mcp-auth-token \
  --secret-string "$TOKEN"
```

**Verify:** `aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id project-orchestrator-service/mcp-auth-token --query SecretString --output text` prints the same value you generated. Keep `$TOKEN` — you need it again in Step 4; it does not need to be re-read from Secrets Manager for that.

## Step 2 — Deploy (O2)

One command, `scripts/deploy.sh`, wraps `sam build` and `sam deploy`
with this slice's required parameters:

```sh
export AWS_REGION=us-east-1                                       # the region from O1
export AUTH_TOKEN_SECRET_NAME=project-orchestrator-service/mcp-auth-token   # from Step 1
./scripts/deploy.sh
```

It builds with esbuild (`template.yaml`'s `Metadata.BuildMethod`,
bundling `src/lambda.ts`), deploys via CloudFormation
(`--resolve-s3`, so no bucket needs to exist beforehand), and prints
the stack's `Endpoint` output. **Report that URL** — it is the value
`.mcp.json` needs (Step 4) and what this runbook's verification steps
below call `$ENDPOINT`.

**Verify:** the script exits 0 and the printed `Endpoint` is an
`https://…execute-api…amazonaws.com/prod` URL.

## Step 3 — Verify the deployed endpoint answers, unauthenticated first

```sh
curl -sS -i "$ENDPOINT/health"
```

Expect `200` with a JSON body naming the service and its version. This
isolates "is anything listening" (API Gateway → Lambda wiring) from
"is MCP itself answering" before you touch auth.

**If this fails:** check `aws cloudformation describe-stacks` for
stack status, and `aws logs tail /aws/lambda/<McpFunctionName-from-the-stack-output>` for a Lambda error. Nothing past this point will
work until `/health` does.

## Step 4 — Make the token available as an environment variable (O4, part 2)

On every surface you enlist a session from (local shell, and the web
surface's environment/secrets configuration — mechanism differs by
surface; both need the variable present under the same name
`.mcp.json` references):

```sh
export MCP_AUTH_TOKEN="$TOKEN"     # the value from Step 1
```

## Step 5 — Verify the deployed endpoint over MCP, with and without the token

```sh
# Without a token — expect 401
curl -sS -i -X POST "$ENDPOINT/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# With the token — expect 200 and a tools list containing "service_identity"
curl -sS -i -X POST "$ENDPOINT/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"service_identity","arguments":{}}}'
```

The second call's `structuredContent` should report `commit` as the
SHA `scripts/deploy.sh` passed at deploy time — cross-check against
`git rev-parse HEAD` in your clone at the moment you ran Step 2.

## Step 6 — Enlist a session

Add the `.mcp.json` below to the coordinating repository
(`majodali/project-orchestrator`) — see
`docs/mcp-enlistment.template.json` in this repository for the exact
shape and where it goes; enlisting the coordinating repo itself is
the Orchestrator's/owner's change, not this repository's, so it is
proposed rather than committed here.

```json
{
  "mcpServers": {
    "project-orchestrator": {
      "type": "http",
      "url": "<ENDPOINT>/mcp",
      "headers": { "Authorization": "Bearer ${MCP_AUTH_TOKEN}" },
      "timeout": 30000
    }
  }
}
```

Clone the coordinating repository fresh in both a local terminal
session and a Claude Code web session, with only `MCP_AUTH_TOKEN` set
in the environment (no other configuration). In each:

1. List tools — `service_identity` should appear.
2. Call `service_identity` — it should return within the configured
   timeout, matching Step 5's `curl` output.

**If the web surface cannot reach the endpoint** (a platform egress
block, not an auth or deploy problem — distinguishable because the
same call succeeds from the local surface and from `curl`): that is
**O5**, an allowlist or connector-routing change the platform
requires. Apply it and repeat this step; if the platform makes it
impossible rather than merely requiring configuration, stop and record
that as a finding against R11 rather than continuing.

## Step 7 — Cold and warm latency (G7)

With the endpoint deployed and idle for at least 10 minutes (Lambda
has scaled to zero), time the identity call twice in a row:

```sh
time curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$ENDPOINT/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"service_identity","arguments":{}}}'
# repeat immediately — this second call is warm
time curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$ENDPOINT/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"service_identity","arguments":{}}}'
```

Record both measured numbers here, then set `.mcp.json`'s `timeout`
comfortably above the cold figure (the template above ships a
conservative placeholder of 30000 ms pending this measurement — treat
it as provisional, not the recorded value):

| Measurement                    | Value                                                                                          | Measured |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | -------- |
| Cold (first call after idle)   | **TBD — no deployment exists yet; this session has no AWS credentials (see task T008 report)** | —        |
| Warm (immediately following)   | **TBD**                                                                                        | —        |
| Configured `.mcp.json` timeout | 30000 ms (provisional; revise once cold/warm are measured)                                     | —        |

## Running cost

Not yet measured — record the actual AWS Cost Explorer figure here
after the first billing period with this stack deployed (the plan's
design sketch expects cents per month at this volume).

## Troubleshooting

- **`/health` never answers** — check `sam deploy`'s output for stack
  failure events (`aws cloudformation describe-stack-events`); the
  most common cause is the `AuthTokenSecretName` parameter not
  matching the secret created in Step 1 exactly (CloudFormation
  resolves the dynamic reference at deploy time and fails the deploy,
  not the runtime call, if it cannot).
- **`/mcp` returns 500 `server_misconfigured`** — `MCP_AUTH_TOKEN` did
  not resolve into the Lambda's environment; re-check the secret name
  and that the deploying principal has `secretsmanager:GetSecretValue`
  on it (CloudFormation resolves the dynamic reference using the
  deploying principal's permissions, not the Lambda's execution role —
  the Lambda never calls Secrets Manager itself).
- **Local surface works, web surface does not** — this is O5, not a
  deploy defect; see Step 6.
