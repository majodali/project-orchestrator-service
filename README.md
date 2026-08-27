# project-orchestrator-service

An MCP (Model Context Protocol) service that lets a Claude Code
session read and update the plan state of
[majodali/project-orchestrator](https://github.com/majodali/project-orchestrator)
without leaving the session: a checked-in `.mcp.json` enlists it, and
it turns "read the register" and "move a node through a stage
transition" into a handful of fast, authenticated tool calls — while
git stays the only place that state actually lives.

## Who this is for

Anyone enlisting a Claude Code session (local or web) into
`project-orchestrator`, and anyone extending this service itself. If
you are looking for the _process_ this service accelerates — roles,
the node lifecycle, gates, the Backlog and Plan register — that lives
in the coordinating repository, not here.

## What this is, and what it deliberately is not

- **A projection, not a second source of truth.** Every read
  reconciles from git through an installed GitHub App; every write is
  the session's own git commit, which this service validates but never
  makes. See the coordinating repository's
  [orchestration-service plan](https://github.com/majodali/project-orchestrator/blob/main/docs/plans/orchestration-service.md)
  for the full design.
- **No model inference.** This service never calls a model; every
  inference happens inside the Claude Code session that calls it, so
  subscription billing (never API credits) is unaffected by this
  service's existence.
- **Not the only way to work.** A session with this service
  unreachable falls back to the v1 process (edit the register, commit,
  as always). Degrading to git-only is a standing constraint of the
  parent plan, not an afterthought.

## Where the docs live

This repository is enrolled as a **methodology-managed project**
(majodali/methodology v1.3.0) in its own right, but it is **not** a
second plan hierarchy:

- [`docs/classification.md`](docs/classification.md) — this
  repository's binding Classification, including how it relates to its
  **coordinating repository**.
- [`docs/backlog.md`](docs/backlog.md) — this repository's own
  Backlog (completed and upcoming work), per methodology K-003.
- **Plan register and Cost log** are _not_ duplicated here. This
  repository's work is planned, dispatched, and recorded against
  [majodali/project-orchestrator](https://github.com/majodali/project-orchestrator)'s
  [Plan register](https://github.com/majodali/project-orchestrator/blob/main/docs/plan-register.md)
  and
  [Cost log](https://github.com/majodali/project-orchestrator/blob/main/docs/cost-log.md)
  — see `docs/classification.md` for the citation.

## Build / run / test

Stack: **TypeScript / Node** on AWS Lambda / HTTP API via AWS SAM
(`template.yaml`). Nothing is deployed by cloning this repository —
see [`docs/runbook.md`](docs/runbook.md) for the owner's deploy
procedure.

```
npm install
npm run build          # tsc -> dist/ (type-checks; not what ships to Lambda)
npm run dev             # runs the MCP server locally (Hono + @hono/node-server), port 8787
npm run bundle:lambda   # esbuild-bundles src/lambda.ts -> dist-lambda/lambda.mjs, the same bundle `sam build` produces
npm test                # vitest run
npm run lint            # eslint .
npm run format           # prettier --check .
```

Node 22+ is required (`engines.node` in `package.json`). `esbuild` is
a `dependencies` entry rather than a `devDependencies` one, even
though it is only ever used as a build tool: `sam build`'s Node.js
esbuild builder runs its own `npm install` inside an isolated build
sandbox that installs only `dependencies`, so an `esbuild` that lives
in `devDependencies` is invisible to it there (confirmed by running
`sam build` locally — see this repository's Backlog, node P2-N008)
even though it is present for every other command run directly in
this checkout.

As of node P2-N008 (chunk 1 child B, the reachability slice), this
repository ships a real MCP server: one tool, `service_identity`
(name, version, build commit, configured project — deliberately
near-empty of content, to prove the round trip before any plan-state
logic exists), served over streamable HTTP with bearer-token auth,
runnable locally (`npm run dev`) and deployable to Lambda behind an
HTTP API (`template.yaml`, `scripts/deploy.sh`,
[`docs/runbook.md`](docs/runbook.md)). `plan_read` /
`plan_lease_acquire` / `plan_update` / `plan_confirm` — the actual
plan-state tools — are later children; see `docs/backlog.md`.

### Trying it locally

```
MCP_AUTH_TOKEN=dev-secret npm run dev
curl -i http://localhost:8787/health                                    # unauthenticated
curl -i -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer dev-secret' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"service_identity","arguments":{}}}'
```

The `.mcp.json` shape a Claude Code session enlists with — including
where it goes and why it is not committed here or in the coordinating
repository by this task — is documented in
[`docs/mcp-enlistment.md`](docs/mcp-enlistment.md).

## Configuration and secrets

| Variable         | Required        | Meaning                                                                                                                                                |
| ---------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MCP_AUTH_TOKEN` | yes             | The bearer token clients must present. No default — the server refuses every `/mcp` call with 500 if this is unset, rather than accepting all callers. |
| `PORT`           | no (local only) | Port `npm run dev` listens on. Default `8787`.                                                                                                         |
| `SERVICE_COMMIT` | no              | Reported by `service_identity`. Set by `scripts/deploy.sh` from `git rev-parse HEAD`; unset locally defaults to `"unknown"`.                           |
| `MCP_PROJECT`    | no              | Reported by `service_identity`. Defaults to `majodali/project-orchestrator`.                                                                           |

A GitHub App private key arrives with chunk 1 child C (this slice does
no git reads). The convention, fixed from the start:

- **Configuration and credentials are supplied only through
  environment variables**, never through a committed file.
- `.gitignore` excludes `.env*` and common credential file shapes
  (`*.pem`, `*.key`, `credentials.json`, `secrets.json`) so a
  credential file dropped in the working tree by habit cannot be
  committed by accident.
- No secret, credential, or `.env` file exists anywhere in this
  repository's history. Each child that introduces a real credential
  documents its required environment variable in the deploy runbook,
  not in code or in git.

## Relationship to majodali/project-orchestrator

This repository is the **coordinating repository**'s designated
service repository (ruling
[RU-006](https://github.com/majodali/project-orchestrator/blob/main/docs/rulings.md)):
separately deployable and holding secrets, so it lives apart from the
C1/S0 documentation-and-tooling repository that plans it. The
methodology's multi-repo update has not yet landed, so this
relationship cannot be declared as a Classification field on either
side; it is recorded here in prose, in
`docs/classification.md`'s Family section, and tracked as a Backlog
item in the coordinating repository ("Declare the multi-repo
relationship") until it can be.
