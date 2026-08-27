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

## Upcoming

- [ ] **Reachability slice** (chunk 1 child B, node P2-N008 in the
      coordinating repository) — the first real MCP tool (service
      identity/version), the SAM infrastructure template, the auth path,
      the deploy runbook, and the `.mcp.json` enlistment file (in the
      coordinating repository). Adds the first real dependencies
      (`@modelcontextprotocol/sdk`, AWS Lambda types) to this skeleton.
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
