# CLAUDE.md

## Methodology — binding

This project follows majodali/methodology v1.3.0 as declared in
docs/classification.md. That file strictly defines this project's
document lifecycles and workflows. Read it before any work; nothing
in this file overrides it.

Classification: C1 / S1 / backend-service / serverless-aws
Deviations: none

## What this project is

An MCP service that lets a Claude Code session read and update the
plan state of
[majodali/project-orchestrator](https://github.com/majodali/project-orchestrator) —
deployed on AWS Lambda / HTTP API / DynamoDB, enlisted from a
checked-in `.mcp.json`. Git remains the only source of truth; this
service is a projection and a validator, never a second writer. See
README.md for the full picture and the coordinating repository's
[orchestration-service plan](https://github.com/majodali/project-orchestrator/blob/main/docs/plans/orchestration-service.md)
for why it exists.

## Build / run / test

```
npm install
npm run build   # tsc -> dist/
npm test        # vitest run
npm run lint    # eslint .
npm run format  # prettier --check .
```

Node 22+. No deployed service exists yet at the current state of this
repository (node P2-N007, chunk 1 child A: methodology scaffolding and
project skeleton only) — see docs/backlog.md for what has shipped and
what is next.

## Architecture at a glance

`src/` holds the service implementation (currently a skeleton only);
`docs/` holds this repository's own Classification and Backlog. This
repository has **no `docs/plan-register.md`, `docs/cost-log.md`, or
`docs/process/`, and no `.claude/agents/`** — it is planned and
dispatched from majodali/project-orchestrator under owner-granted
cross-repo scope, and its Plan register / Cost log / Ruling register
entries live there (docs/classification.md § Custom definitions).

## Conventions

- No model inference in this service; every model call happens inside
  the calling Claude Code session on a subscription-billed surface
  (standing constraint of the
  [orchestration-service plan](https://github.com/majodali/project-orchestrator/blob/main/docs/plans/orchestration-service.md)).
- No secret is ever committed. Configuration and credentials arrive
  only through environment variables (README.md "Configuration and
  secrets").
- This service never writes git. A session with the service
  unreachable degrades to the v1 process cleanly (standing constraint
  of the parent plan).

## Pointers

- docs/classification.md — the binding declaration, including this
  repository's relationship to its coordinating repository
- docs/backlog.md — what is done here and what is next
- [majodali/project-orchestrator](https://github.com/majodali/project-orchestrator) —
  the coordinating repository: the process spec, the Plan register,
  the Cost log, the Ruling register, and this service's plan and
  specification
