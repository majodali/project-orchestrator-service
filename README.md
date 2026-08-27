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

Stack: **TypeScript / Node** (targeting AWS Lambda / HTTP API /
DynamoDB via AWS SAM — see the chunk plan; nothing is deployed by this
skeleton).

```
npm install
npm run build     # tsc -> dist/
npm test          # vitest run
npm run lint       # eslint .
npm run format     # prettier --check .
```

Node 22+ is required (`engines.node` in `package.json`). There is no
service to run yet: this repository currently ships only the
methodology scaffolding and project skeleton (node P2-N007). The MCP
server, its tools, the Lambda handler, and the deploy runbook arrive
in the chunk's later children — see `docs/backlog.md`.

## Configuration and secrets

This service will hold real credentials once later children land (a
GitHub App private key to read the coordinating repository, a bearer
token clients present). The convention, fixed from the start:

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
