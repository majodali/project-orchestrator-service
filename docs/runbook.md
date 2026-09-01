# Deploy runbook

<!-- Written before any owner action named below is requested — the
     spec requires this ordering (I8), not just as a nicety. Every
     step a human must take is one of O1, O2, O3, O4, or O5 from the
     [orchestration-service plan](https://github.com/majodali/project-orchestrator/blob/main/docs/plans/orchestration-service.md#what-this-environment-can-deliver-and-what-is-the-owners).
     A step this document asks for that is not one of O1–O6 is a
     runbook defect, to be fixed here, not narrated at the gate. -->

This is the procedure that takes a stranger from an empty AWS account
to a deployed, authenticated MCP endpoint answering the
`service_identity` tool (chunk 1 child B, node P2-N008 — the
reachability slice), the `plan_read` tool (chunk 1 child C, node
P2-N009 — the first real plan-state read, through an installed GitHub
App), and the write path — `plan_lease_acquire` / `plan_update` /
`plan_confirm` / `plan_lease_release` (chunk 1 child D, node P2-N010).
**This service itself never writes to git** — the write path validates
a transition and returns the exact edit to make; the calling session
applies it, commits it, and pushes (G4). No owner action changes for
child D: the advisory lease's DynamoDB table (`LeaseTable` in
`template.yaml`) is provisioned by the same `sam deploy` Step 3
already runs, with no secret and no new required environment
variable.

## What you need before you start

- An AWS account and a chosen region (**O1**). Any region that offers
  Lambda and HTTP API works; there is nothing region-specific in
  `template.yaml`.
- AWS credentials for that account available to your shell (however
  you normally authenticate — this runbook does not prescribe a
  method).
- A GitHub account with permission to create and install a GitHub App
  on `majodali/project-orchestrator` (**O3**).
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

**Verify:** `aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id project-orchestrator-service/mcp-auth-token --query SecretString --output text` prints the same value you generated. Keep `$TOKEN` — you need it again in Step 5; it does not need to be re-read from Secrets Manager for that.

## Step 2 — Configure GitHub App access (O3)

`plan_read` reads the coordinating repository's Plan register through
a GitHub App installation with `contents: read` — decision 6 of the
p2-n002 plan, never a personal access token.

1. Create the App: GitHub → **Settings → Developer settings → GitHub
   Apps → New GitHub App**. Repository permissions: **Contents:
   Read-only**. No webhook is needed for chunk 1 — uncheck "Active"
   under Webhook, or leave the URL blank.
2. Generate a private key for the App (App settings → **Generate a
   private key**) — this downloads a `.pem` file once; it cannot be
   downloaded again later.
3. Install the App on `majodali/project-orchestrator` only (**Install
   App**, select the repository — not "all repositories").
4. Record two values from the App's settings pages, both **not
   secret**:
   - the App's numeric **ID** (General settings page), and
   - the installation's numeric **ID** (visible in the installed
     App's settings URL, e.g.
     `https://github.com/settings/installations/12345678` → `12345678`).
5. Store the private key in Secrets Manager, the same pattern as
   Step 1's token:

```sh
aws secretsmanager create-secret \
  --region "$AWS_REGION" \
  --name project-orchestrator-service/github-app-private-key \
  --secret-string file:///path/to/the-downloaded-key.pem
```

**Verify:** `aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id project-orchestrator-service/github-app-private-key --query SecretString --output text | head -1` prints `-----BEGIN RSA PRIVATE KEY-----` (or `-----BEGIN PRIVATE KEY-----`). Keep the App ID and installation ID — you need them again in Step 3; the private key does not need to be re-read from Secrets Manager for that. Delete the local `.pem` file once it is stored (it is a real credential; do not leave it in a working tree — `.gitignore` already excludes `*.pem`, but "excluded from git" is not "does not exist on disk").

## Step 3 — Deploy (O2)

One command, `scripts/deploy.sh`, wraps `sam build` and `sam deploy`
with this chunk's required parameters:

```sh
export AWS_REGION=us-east-1                                       # the region from O1
export AUTH_TOKEN_SECRET_NAME=project-orchestrator-service/mcp-auth-token   # from Step 1
export GITHUB_APP_ID=123456                                       # from Step 2
export GITHUB_APP_INSTALLATION_ID=12345678                        # from Step 2
export GITHUB_APP_PRIVATE_KEY_SECRET_NAME=project-orchestrator-service/github-app-private-key   # from Step 2
./scripts/deploy.sh
```

It builds with esbuild (`template.yaml`'s `Metadata.BuildMethod`,
bundling `src/lambda.ts`), deploys via CloudFormation
(`--resolve-s3`, so no bucket needs to exist beforehand — this also
provisions `LeaseTable`, the advisory write lease's DynamoDB table,
node P2-N010; nothing extra to configure for it), and prints the
stack's `Endpoint` output. **Report that URL** — it is the value
`.mcp.json` needs (Step 6) and what this runbook's verification steps
below call `$ENDPOINT`.

**Verify:** the script exits 0 and the printed `Endpoint` is an
`https://…execute-api…amazonaws.com` URL — no stage segment (see "Why
the endpoint has no stage segment" below).

### Why the bundle carries an esbuild banner

`template.yaml`'s `BuildProperties.Banner` (and `package.json`'s
`bundle:lambda` script, the identical bundle for local checking) defines
a real `require` via `node:module`'s `createRequire` before any bundled
code runs. This was added as node P2-N010 rework, fixing a post-deploy
outage: `@aws-sdk/client-dynamodb` (the write path) reaches
`@smithy/node-http-handler`, which is CommonJS and `require()`s Node
builtins; under this template's `--format=esm` there is no ambient
`require`, so esbuild's own dynamic-require shim threw
`Dynamic require of "node:https" is not supported` the instant the
bundle was loaded — every cold start, so every route, including
`/health`, returned API Gateway's own `{"message":"Internal Server
Error"}` rather than the app's. **Do not remove the `Banner` property
or drop `--format=esm`'s banner flag** without re-running
`test/lambdaBundle.test.ts` (which imports the built bundle from a real
ESM subprocess, the only way this defect reproduces) against the
result — a `node -e` check or a plain dynamic import from inside a test
runner will not catch a regression here; see that test's doc comment.
No deploy procedure or parameter changed — `sam build && sam deploy`
(Step 3) is unchanged; a stack deployed before this fix simply needs a
redeploy of this same Step 3 with the fixed `template.yaml`.

### Why the endpoint has no stage segment

The HTTP API's actual stage is fixed to the API Gateway reserved name
`$default` (`template.yaml`'s `HttpApi` resource), not the `Stage`
parameter. This was discovered as a defect after the first deploy:
with a named stage (`StageName: prod`), the invoke URL and every
request's `rawPath` carried a `/prod` prefix
(`/prod/health`, `/prod/mcp`), but `src/httpApp.ts` only ever
registers `/health` and `/mcp` — so every path 404d, even though the
function was being invoked correctly and auth was never reached (the
body was Hono's plain-text `404 Not Found`, not API Gateway's JSON
`{"message":"Not Found"}`). `$default` makes `rawPath` identical to
what the app routes locally, preserving the one-Hono-app,
no-local/deployed-drift design this service is built around. **Do not
"tidy" `template.yaml`'s `HttpApi.Properties.StageName` back to
`!Ref Stage` or any named stage** — that reintroduces this exact
outage. `Stage` still exists as a deployment label (default `prod`)
applied as a resource tag, for telling deployments apart in
CloudWatch/Cost Explorer; it no longer selects the API Gateway stage.
`test/lambda.test.ts` regression-tests the deployed `rawPath` shape
directly against the Lambda handler.

## Step 4 — Verify the deployed endpoint answers, unauthenticated first

```sh
curl -sS -i "$ENDPOINT/health"
```

Expect `200` with a JSON body naming the service and its version. This
isolates "is anything listening" (API Gateway → Lambda wiring) from
"is MCP itself answering" before you touch auth.

**If this fails:** check `aws cloudformation describe-stacks` for
stack status, and `aws logs tail /aws/lambda/<McpFunctionName-from-the-stack-output>` for a Lambda error. Nothing past this point will
work until `/health` does.

## Step 5 — Make the token available as an environment variable (O4, part 2)

On every surface you enlist a session from (local shell, and the web
surface's environment/secrets configuration — mechanism differs by
surface; both need the variable present under the same name
`.mcp.json` references):

```sh
export MCP_AUTH_TOKEN="$TOKEN"     # the value from Step 1
```

## Step 6 — Verify the deployed endpoint over MCP, with and without the token

```sh
# Without a token — expect 401
curl -sS -i -X POST "$ENDPOINT/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# With the token — expect 200 and a tools list containing "service_identity" and "plan_read"
curl -sS -i -X POST "$ENDPOINT/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"service_identity","arguments":{}}}'

# plan_read against the coordinating repository's real register at its default branch —
# expect 200, a node list, and a sha/ref/fetchedAt in structuredContent
curl -sS -i -X POST "$ENDPOINT/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plan_read","arguments":{}}}'

# The write path's lease, exercised without touching the real
# register (a full plan_update/plan_confirm round trip against real
# content is the gate demonstration itself — see the p2-n002
# specification's G3). Expect 200 and a token in structuredContent,
# then a second 200 with {"released": true}.
curl -sS -i -X POST "$ENDPOINT/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plan_lease_acquire","arguments":{"holder":"runbook-verification"}}}'
# copy the "token" field from the response above into $LEASE_TOKEN
curl -sS -i -X POST "$ENDPOINT/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"plan_lease_release\",\"arguments\":{\"leaseToken\":\"$LEASE_TOKEN\"}}}"
```

The `service_identity` call's `structuredContent` should report
`commit` as the SHA `scripts/deploy.sh` passed at deploy time —
cross-check against `git rev-parse HEAD` in your clone at the moment
you ran Step 3. The `plan_read` call's `structuredContent.sha` should
match what GitHub shows as `majodali/project-orchestrator`'s default
branch HEAD at the moment you ran it — cross-check on GitHub.

**If `plan_read` returns a tool error naming `GITHUB_APP_ID`,
`GITHUB_APP_INSTALLATION_ID`, or `GITHUB_APP_PRIVATE_KEY`:** Step 3
was run without Step 2's values (or they do not match what
`template.yaml`'s parameters resolved) — re-run Step 3 with them set.
**If it returns a tool error citing a GitHub API status (401/403/404):**
recheck Step 2 — the App's installation, its `Contents: Read-only`
permission, and the installation ID all matter; the private key in
Secrets Manager must be the one downloaded for this same App.

## Step 7 — Enlist a session

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

1. List tools — `service_identity`, `plan_read`, `plan_lease_acquire`,
   `plan_update`, `plan_confirm`, and `plan_lease_release` should all
   appear.
2. Call `service_identity` — it should return within the configured
   timeout, matching Step 6's `curl` output.
3. Call `plan_read` — it should return within the configured timeout,
   matching Step 6's `curl` output, and match what the coordinating
   repository's `docs/plan-register.md` shows on GitHub at the
   reported SHA.
4. Move a real node through a real stage transition end to end
   (`plan_lease_acquire` -> `plan_update` -> apply the returned edit,
   commit, push -> `plan_confirm`) — the gate demonstration itself
   (p2-n002 specification, G3/G4); not a routine part of this runbook,
   named here so it is not missed.

**If the web surface cannot reach the endpoint** (a platform egress
block, not an auth or deploy problem — distinguishable because the
same call succeeds from the local surface and from `curl`): that is
**O5**, an allowlist or connector-routing change the platform
requires. Apply it and repeat this step; if the platform makes it
impossible rather than merely requiring configuration, stop and record
that as a finding against R11 rather than continuing.

## Step 8 — Cold and warm latency (G7)

With the endpoint deployed and idle for at least 10 minutes (Lambda
has scaled to zero), time the identity call twice in a row, then do
the same for `plan_read` (its GitHub round trips make it the more
latency-sensitive of the two — see `template.yaml`'s `Timeout` note):

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

# Let the function scale back to zero again before timing plan_read cold.
time curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$ENDPOINT/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plan_read","arguments":{}}}'
# repeat immediately — warm, and the installation token is now cached in memory too
time curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$ENDPOINT/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plan_read","arguments":{}}}'
```

Record all four measured numbers here, then set `.mcp.json`'s
`timeout` comfortably above the highest cold figure (the template
above ships a conservative placeholder of 30000 ms — treat it as
provisional until both tools have been measured):

| Measurement                    | Value                                                   | Measured |
| ------------------------------ | ------------------------------------------------------- | -------- |
| `service_identity` cold        | **~1.70 s**                                             | yes      |
| `service_identity` warm        | **~0.35–0.60 s**                                        | yes      |
| `plan_read` cold               | not yet measured (owner action O3 outstanding)          | no       |
| `plan_read` warm               | not yet measured (owner action O3 outstanding)          | no       |
| Configured `.mcp.json` timeout | 30000 ms (ample headroom above the ~1.70 s cold figure) | —        |

First measurements, taken from a cloud session against the deployed
endpoint **before** the `$default`-stage fix (node P2-N008 rework,
this document's "Why the endpoint has no stage segment" note) — every
call in that session 404d (Hono never matched the stage-prefixed
`rawPath`), but the round trip being timed here is API Gateway +
Lambda cold/warm start, which that fix does not touch, so these
figures still stand. Re-measure once the fix is redeployed if a more
precise number is wanted; the 30s enlistment timeout has ample
headroom over either figure regardless.

`plan_read`'s cold/warm figures cannot be measured without owner
action O3 (Step 2) and a redeploy (Step 3) — recorded here as a
Backlog item, not silently left blank.

## Running cost

Not yet measured — record the actual AWS Cost Explorer figure here
after the first billing period with this stack deployed (the plan's
design sketch expects cents per month at this volume).

## Troubleshooting

- **Every route, including `/health`, returns
  `{"message":"Internal Server Error"}` (API Gateway's own error body,
  not the app's)** — the function never initialized; check
  `aws logs tail /aws/lambda/<McpFunctionName>` for
  `Dynamic require of "..." is not supported`. This was the node
  P2-N010 rework outage — see "Why the bundle carries an esbuild
  banner" above. If the deployed function predates that fix, redeploy
  (Step 3) with the current `template.yaml`; if the error recurs after
  that, a newly added CommonJS dependency has reintroduced it and
  `test/lambdaBundle.test.ts` should already have failed locally before
  this was ever deployed.
- **`/health` never answers** — check `sam deploy`'s output for stack
  failure events (`aws cloudformation describe-stack-events`); the
  most common cause is the `AuthTokenSecretName` (or, once Step 2 is
  wired in, `GithubAppPrivateKeySecretName`) parameter not matching
  the secret created for it exactly (CloudFormation resolves the
  dynamic reference at deploy time and fails the deploy, not the
  runtime call, if it cannot).
- **`/mcp` returns 500 `server_misconfigured`** — `MCP_AUTH_TOKEN` did
  not resolve into the Lambda's environment; re-check the secret name
  and that the deploying principal has `secretsmanager:GetSecretValue`
  on it (CloudFormation resolves the dynamic reference using the
  deploying principal's permissions, not the Lambda's execution role —
  the Lambda never calls Secrets Manager itself).
- **`plan_read` returns a tool error naming missing `GITHUB_APP_*`
  variables** — see Step 6's troubleshooting note above.
- **`plan_lease_acquire` / `plan_update` / `plan_confirm` /
  `plan_lease_release` return a tool error naming `LEASE_TABLE_NAME`**
  — this should not happen from a stack deployed by `scripts/deploy.sh`
  (`template.yaml` always wires `LEASE_TABLE_NAME` from `LeaseTable`);
  if it does, the deployed function's environment does not match this
  template — re-run Step 3. A tool error citing an AWS/DynamoDB error
  instead (rather than naming the missing variable) means
  `LeaseTable` exists but the function's role cannot reach it — check
  `template.yaml`'s `McpFunction.Properties.Policies` (a
  `DynamoDBCrudPolicy` scoped to `LeaseTable`) actually deployed
  (`aws cloudformation describe-stack-resources`).
- **Local surface works, web surface does not** — this is O5, not a
  deploy defect; see Step 7.
