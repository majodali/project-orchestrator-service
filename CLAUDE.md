# CLAUDE.md

## Methodology — binding

This project follows majodali/methodology v1.6.0 as declared in
docs/classification.md. That file strictly defines this project's
document lifecycles and workflows. Read it before any work; nothing
in this file overrides it.

Classification: C1 / S1 / backend-service / serverless-aws
Deviations: K-003 (the Backlog is the single source of progress truth), recorded in docs/classification.md for the rebuild

## Reporting and writing — cached from W-008; do not edit here

Reports to the human owner carry four parts, in this order:

1. **Asks** — the decisions and actions requested of the reader.
2. **What is already covered** — the parts of the deliverable that
   encode decisions the conversation already settled.
3. **What changed** — the parts that are new, each with a named
   pointer into the deliverable and what to review there.
4. **Terms introduced** — each term the report or its deliverable
   uses with a meaning that neither the methodology vocabulary nor
   the project's vocabulary defines, with one sentence giving its
   meaning. The asks request its ratification or striking.

State an empty part; never drop it. In the parts' order: "No asks",
"We already covered everything in the document", "The content is all
new", "No terms introduced".

Lead with the outcome or the decision needed, never with the process
that produced it. Write short, direct sentences, one idea each. Cut
clauses that add tone but not content: dramatic accumulation,
aphorism, suspense. Name every identifier you cite.

Authority: majodali/methodology W-008 (reports map their
deliverables), the P- rules, and its style guide. This block is a
cache — amend it upstream, never here.

## What this project is

An MCP service that lets a Claude Code session read and update the
plan state of
[majodali/project-orchestrator](https://github.com/majodali/project-orchestrator),
the state file `orchestration/state.json` — deployed on AWS Lambda
and HTTP API, enlisted from a checked-in `.mcp.json`. Git remains the
only source of truth: the service validates every change and commits
it to the repository through its GitHub App; it holds no state of its
own. See
README.md for the full picture and the coordinating repository's
[orchestration-service plan](https://github.com/majodali/project-orchestrator/blob/main/docs/plans/orchestration-service.md)
for why it exists.

## Build / run / test

```
npm install
npm run build          # tsc -> dist/ (type-check)
npm run dev             # run the MCP server locally, port 8787
npm run bundle:lambda   # esbuild-bundle src/lambda.ts, same as `sam build`
npm test                # vitest run
npm run lint            # eslint .
npm run format           # prettier --check .
```

Node 22+. A real MCP server exists — `service_identity`, `plan_read`
and the five write tools over the state file, through an installed
GitHub App — runnable locally and deployable to Lambda — see README.md
"Build / run / test" and docs/runbook.md.
Nothing is deployed by cloning this repository; deployment is an owner
action (docs/runbook.md). See docs/backlog.md for what has shipped and
what is next.

## Architecture at a glance

`src/` holds the service implementation: `model/` (the state file's
schema, invariants, renderings, importer, store and the `plan-state`
CLI), `stateTools.ts` (the MCP tools over it), `mcpServer.ts`,
`httpApp.ts` (the Hono app: auth + `/mcp` + `/view` + `/health`,
shared by both entry points below), `planRegister/` (the GitHub App
reader and writer), `view/` (the web view), `auth.ts`,
`serviceInfo.ts`, `localServer.ts` (local dev entry point), `lambda.ts`
(AWS Lambda entry point). `template.yaml`
and `scripts/deploy.sh` are the infrastructure and the one-command
deploy. `docs/` holds this repository's own Classification, Backlog,
the deploy runbook, and the `.mcp.json` enlistment template. This
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
- This service writes git only under the allowlist in
  `src/model/store.ts`: the state file, its two renderings and the
  journal, one commit per change, on the default branch, as its
  GitHub App (the rebuild plan, decision 2). It never writes anything
  else, and nothing else holds state.

## Pointers

- docs/classification.md — the binding declaration, including this
  repository's relationship to its coordinating repository
- docs/backlog.md — what is done here and what is next
- [majodali/project-orchestrator](https://github.com/majodali/project-orchestrator) —
  the coordinating repository: the process spec, the Plan register,
  the Cost log, the Ruling register, and this service's plan and
  specification
