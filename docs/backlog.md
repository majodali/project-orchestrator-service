# Backlog

<!-- The single source of progress truth for this repository
     (methodology K-003): one dependency-ordered register of completed
     and upcoming work. Rewrite checked entries to describe what
     actually shipped — the completed section doubles as the
     implementation map. Update in the same commit as the work
     (W-003). This repository has no Plan register or Cost log of its
     own; those entries live in majodali/project-orchestrator's
     instances (docs/classification.md § Custom definitions) under
     node IDs from that repository's Plan register (e.g. P2-N007). -->

## Completed

- [x] **Methodology scaffolding and project skeleton** (node P2-N007,
      chunk 1 child A of
      [orchestration-service](https://github.com/majodali/project-orchestrator/blob/main/docs/plans/orchestration-service.md)) —
      README, `CLAUDE.md` Binding block, `docs/classification.md`
      (C1 / S1 / backend-service / serverless-aws, methodology v1.3.0,
      family `methodology` (member), `project-orchestrator` named as
      coordinating repository in prose pending the methodology's
      multi-repo update), this Backlog. Project skeleton: TypeScript/Node
      (`package.json`, `tsconfig.json`), a minimal `src/index.ts` entry
      point, a Vitest test setup with one smoke test, ESLint (flat config,
      typescript-eslint) and Prettier. Secret-hygiene baseline: `.gitignore`
      covers `.env*` and common credential file shapes, no secrets or
      environment files committed, and the environment-variable
      configuration convention is documented in README.md ahead of any
      real credential landing with later children. No service code yet —
      the MCP server, its tools, and the Lambda handler are chunk 1
      children B–E.

- [x] **Reachability slice** (chunk 1 child B, node P2-N008 in the
      coordinating repository) — a real MCP server over streamable
      HTTP: one tool, `service_identity` (name, version, build commit
      from `SERVICE_COMMIT`, configured project from `MCP_PROJECT`),
      served by a Hono app (`src/httpApp.ts`) shared byte-for-byte
      between the local dev entry point (`src/localServer.ts`,
      `npm run dev`) and the AWS Lambda entry point (`src/lambda.ts`,
      via `hono/aws-lambda`). Bearer-token auth on the transport
      (`src/auth.ts`; constant-time comparison; a server with no
      `MCP_AUTH_TOKEN` configured fails closed with 500 rather than
      accepting all callers). Stateless streamable HTTP
      (`WebStandardStreamableHTTPServerTransport`,
      `enableJsonResponse: true`) — a fresh server/transport per
      request, single JSON response per call, no session store,
      matching a Lambda-proxy-integration's request/response shape.
      Infrastructure: `template.yaml` (SAM: one Lambda behind an HTTP
      API, esbuild TypeScript bundling, no DynamoDB — this slice
      carries no plan-state logic, so none is provisioned; that lands
      with children C/D), `scripts/deploy.sh` (the one-command deploy:
      `sam build && sam deploy` with the auth token resolved from
      Secrets Manager via a CloudFormation dynamic reference, never a
      template literal). `docs/runbook.md` — deploy procedure, written
      before any owner action was requested, naming every human step as
      one of O1/O2/O4/O5 (O3, the GitHub App, is out of scope for this
      child). `docs/mcp-enlistment.md` +
      `docs/mcp-enlistment.template.json` — the `.mcp.json` shape and
      where it goes, proposed rather than committed to the coordinating
      repository (that commit is the Orchestrator's/owner's to make).
      Local verification only (this session held no AWS credentials):
      `npm test` (unit + integration tests against the Hono app
      in-process), a real local process (`npm run dev`) exercised over
      real HTTP with curl — `/health` unauthenticated, `/mcp` rejecting
      no-token and wrong-token calls with 401, accepting the correct
      token and answering `tools/list` and `tools/call service_identity`
      correctly, and the `initialize` handshake exercised too — and the
      exact Lambda bundle (`sam build`,
      validated with `sam validate --lint`) invoked directly against a
      synthetic API Gateway v2 event with the same results. **Not
      verified**, and blocking the gate's G2/G7/I6 criteria: an actual
      AWS deployment, the deployed endpoint's cold/warm latency
      (`docs/runbook.md` Step 7 records placeholders pending this), and
      enlistment from a real local and web Claude Code session against
      that deployment — each needs owner actions O1/O2/O4 (and O5 if
      the web surface needs it) this session cannot perform. See task
      T008's report for the full account.

## Upcoming

- [ ] **Plan-state read** (chunk 1 child C, node P2-N009) —
      `plan_read` over the coordinating repository's real Plan register,
      fetched through the GitHub App, SHA-stamped, taking an explicit
      `ref`.
- [ ] **Plan-state update with the advisory lease** (chunk 1 child D,
      node P2-N010) — `plan_lease_acquire` / `plan_update` / `plan_confirm`
      / `plan_lease_release`, the three-step git-authoritative write model.
- [ ] **Degrade to git-only, and enlistment documentation** (chunk 1
      child E, node P2-N011) — the R12 exercise (dead endpoint and unset
      credential) and the enlistment runbook.
- [ ] **CI for this repository** — `npm run build`, `npm test`,
      `npm run lint`, and `npm run format` are run locally only as of this
      entry; a CI workflow is out of scope for chunk 1 (see the
      coordinating repository's Backlog, "CI for
      project-orchestrator-service").
- [ ] **Declare the multi-repo relationship formally** — replace this
      repository's prose statement of its coordinating repository (this
      Backlog entry and `docs/classification.md` § Coordinating
      repository) with a Classification field once the methodology's
      multi-repo update lands (tracked in the coordinating repository's
      Backlog).
