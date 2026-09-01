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
procedure. The HTTP API's stage is pinned to the reserved name
`$default` (not a named stage like `prod`) so the deployed `rawPath`
matches what the app routes locally — see `template.yaml`'s `Stage`
parameter and `docs/runbook.md`'s "Why the endpoint has no stage
segment" for why (node P2-N008's post-deploy rework); do not change it
to a named stage.

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

This repository ships a real MCP server, served over streamable HTTP
with bearer-token auth, runnable locally (`npm run dev`) and
deployable to Lambda behind an HTTP API (`template.yaml`,
`scripts/deploy.sh`, [`docs/runbook.md`](docs/runbook.md)). Six tools
so far:

- `service_identity` (chunk 1 child B, node P2-N008, the reachability
  slice) — name, version, build commit, configured project;
  deliberately near-empty of content, to prove the round trip before
  any plan-state logic existed.
- `plan_read` (chunk 1 child C, node P2-N009) — reads the coordinating
  repository's real Plan register (`docs/plan-register.md`) at a git
  ref, through an installed GitHub App (`contents: read`, never a
  personal access token — decision 6 of the p2-n002 plan), and answers
  whole-tree or subtree queries with the source commit SHA and fetch
  time on every response. See `src/planReadTool.ts` and
  `src/planRegister/`.
- `plan_lease_acquire` / `plan_update` / `plan_confirm` /
  `plan_lease_release` (chunk 1 child D, node P2-N010) — the
  git-authoritative write path: acquire the project's single advisory
  write lease (TTL-expiring; decision 7), get back the _exact_ register
  edit for a legal stage transition (never applied by this service,
  which holds no repository write credential — G4), apply it and push
  it yourself, then confirm the commit actually carries it — a mismatch
  is reported as a divergence naming the file and the line (I3, the R10
  detection), not silently accepted. See `src/planWriteTools.ts` and
  `src/planRegister/transitions.ts` / `updateEngine.ts` /
  `leaseBackend.ts`.

### The vendored register grammar unit, and its drift check

`src/planRegister/vendored/` (`plan-register.ts` plus its conformance
corpus) is vendored, byte-for-byte, from the coordinating repository's
canonical copy at `plugin/scripts/lib/plan-register.ts` — ruling
[RU-012](https://github.com/majodali/project-orchestrator/blob/main/docs/rulings.md):
one canonical copy, vendored outward by a generator with a `--check`
drift mode, the consumer never edits its copy. This repository's own
`src/planRegister/parser.ts` and `types.ts` are thin re-exports of it
(they used to carry a second, hand-maintained copy of the same grammar
— node P2-N009 — until node P2-N010 adopted the shared unit instead);
`src/planRegister/transitions.ts` (the node-lifecycle table, chunk 1
child D) is built on the same unit's `STAGES` vocabulary, so the write
path enforces the exact stage set the grammar carries rather than a
second guess at it — see that file's doc comment for the P2-N009
stage-vocabulary finding this closes (`STAGES`
carries the vocabulary as data; nothing in `src/` accepts a stage
outside it).

`src/planRegister/vendored/` is excluded from this repository's own
ESLint and Prettier configs (`eslint.config.js`'s `ignores`,
`.prettierignore`) — it is generated, not authored here, and
reformatting it would make it drift from the canonical copy for no
reason but this repository's own style. To re-vendor after the
canonical copy changes, or to check for drift without changing
anything, run from a checkout of
[majodali/project-orchestrator](https://github.com/majodali/project-orchestrator):

```sh
# from a checkout of majodali/project-orchestrator:
node plugin/scripts/sync_shared_unit.ts --check /path/to/project-orchestrator-service/src/planRegister/vendored
# drop --check to actually re-vendor
```

Exit 0 (`"in sync"`) confirms nothing has drifted; this repository has
no CI that runs it automatically today (see the coordinating
repository's Backlog, "CI for project-orchestrator-service" /
"Automate the vendored shared unit's drift check").

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

### Trying the write path locally

The write-path tools need a lease backend and a register fetcher; a
plain `npm run dev` has neither `LEASE_TABLE_NAME` nor the
`GITHUB_APP_*` variables set, so `plan_lease_acquire` and `plan_read`
both answer with a clear tool error rather than a crash. Every
automated test in `test/` instead injects
`src/planRegister/inMemoryLeaseBackend.ts` and a stub/fake
`RegisterFetcher` through `createApp`'s `planLeaseBackend` /
`planRegisterFetcher` options (`src/httpApp.ts` → `src/mcpServer.ts`)
— see `test/planWriteTools.test.ts` for the MCP-level tool contract
and `test/planUpdateGitExercise.test.ts` for the full
lease-acquire → update → apply → commit → confirm round trip against a
real, throwaway local git repository (the I1/I3 exercises,
[docs/specs/p2-n002-service-skeleton.md](https://github.com/majodali/project-orchestrator/blob/main/docs/specs/p2-n002-service-skeleton.md)
in the coordinating repository). There is no production code path that
uses either injected implementation — `src/planRegister/defaultLeaseBackend.ts`
and `src/planRegister/defaultFetcher.ts` are what a real deployment
gets.

## Configuration and secrets

| Variable                     | Required                | Meaning                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_AUTH_TOKEN`             | yes                     | The bearer token clients must present. No default — the server refuses every `/mcp` call with 500 if this is unset, rather than accepting all callers.                                                                                                                                                                                                                                                           |
| `PORT`                       | no (local only)         | Port `npm run dev` listens on. Default `8787`.                                                                                                                                                                                                                                                                                                                                                                   |
| `SERVICE_COMMIT`             | no                      | Reported by `service_identity`. Set by `scripts/deploy.sh` from `git rev-parse HEAD`; unset locally defaults to `"unknown"`.                                                                                                                                                                                                                                                                                     |
| `MCP_PROJECT`                | no                      | Reported by `service_identity`; also which `<owner>/<repo>` `plan_read` reads. Defaults to `majodali/project-orchestrator`.                                                                                                                                                                                                                                                                                      |
| `GITHUB_APP_ID`              | yes, for `plan_read`    | The installed GitHub App's numeric ID (owner action O3). Not secret. `plan_read` fails with a clear tool error, not a crash, if unset.                                                                                                                                                                                                                                                                           |
| `GITHUB_APP_INSTALLATION_ID` | yes, for `plan_read`    | The App's installation ID for `MCP_PROJECT` (owner action O3). Not secret.                                                                                                                                                                                                                                                                                                                                       |
| `GITHUB_APP_PRIVATE_KEY`     | yes, for `plan_read`    | The App's PEM private key (owner action O3). A real secret — resolved from Secrets Manager at deploy time, see `template.yaml`.                                                                                                                                                                                                                                                                                  |
| `LEASE_TABLE_NAME`           | yes, for the write path | The advisory write-lease DynamoDB table's name. Not secret — wired automatically by `template.yaml`'s `LeaseTable` resource on every deploy (node P2-N010); no owner action. `plan_lease_acquire` / `plan_update` / `plan_confirm` / `plan_lease_release` fail with a clear tool error, not a crash, if unset (e.g. a local `npm run dev` session with no override — see "Trying the write path locally" below). |

`service_identity` alone (chunk 1 child B) needs none of the three
`GITHUB_APP_*` variables, nor `LEASE_TABLE_NAME`; a deployment made
before owner action O3 is complete still serves it, and `plan_read` /
the write-path tools report a tool error naming what is missing rather
than crashing the server. The convention, fixed from the start:

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
