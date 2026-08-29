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
      carries no plan-state logic, so none is provisioned; child C
      (node P2-N009) turned out not to need one either — reads
      reconcile from GitHub on every call, nothing cached in AWS — so
      DynamoDB now lands with child D alone, the advisory lease),
      `scripts/deploy.sh` (the one-command deploy:
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
      (`docs/runbook.md` Step 8 records placeholders pending this), and
      enlistment from a real local and web Claude Code session against
      that deployment — each needs owner actions O1/O2/O4 (and O5 if
      the web surface needs it) this session cannot perform. See task
      T008's report for the full account.

- [x] **Rework: fix the deployed 404 (post-deploy defect, node
      P2-N008)** — the owner deployed the reachability slice above and
      every path returned 404. Root cause: `template.yaml`'s HttpApi
      had `StageName: !Ref Stage` (`prod`), so the invoke URL carried a
      `/prod` segment and API Gateway handed Lambda `rawPath =
/prod/health` / `/prod/mcp`; `src/httpApp.ts` only ever registers
      `/health` and `/mcp`, so Hono 404d before auth was ever reached
      (confirmed live: `/health`, `/mcp` unauthenticated, and `/mcp`
      with a bad token all 404d with Hono's plain-text body, not API
      Gateway's own JSON 404 — the function was being invoked; only the
      path failed to match). Fix: `template.yaml`'s `HttpApi` now pins
      `StageName` to the API Gateway reserved name `$default` (a
      literal, not `!Ref Stage`) so the invoke URL and `rawPath` carry
      no stage segment, identical to local — the one-Hono-app,
      no-local/deployed-drift design's deliberate property, preserved
      rather than routing around it with a stage-named Hono basePath.
      `Stage` is kept (still referenced by `scripts/deploy.sh`) but now
      only labels a deployment as a resource tag (`Tags: Stage: !Ref
Stage` on `McpFunction` and `HttpApi`) rather than selecting the
      API's stage; its parameter description, `scripts/deploy.sh`'s
      comment, and `docs/runbook.md`'s new "Why the endpoint has no
      stage segment" note all say so, so it is not "tidied" back to
      `!Ref Stage` later. The `Endpoint` output no longer appends
      `/${Stage}`. Regression test added — `test/lambda.test.ts` — that
      invokes the real exported `handler` (the same `hono/aws-lambda`
      wrapper the deployed function runs) with a synthetic API Gateway
      v2 event shaped like what the deployed HTTP API actually sends
      (`rawPath: "/health"` / `"/mcp"`, no stage segment) and asserts
      200; a companion test with `rawPath: "/prod/health"` documents
      the original defect (404), and both are new tests — no existing
      test was weakened or changed. `docs/runbook.md` Step 8's latency
      table now records the first real measurement from a cloud session
      against the (pre-fix) live endpoint — cold ~1.70s, warm
      ~0.35–0.60s — noted as taken before this fix but still valid
      (they measure the API Gateway + Lambda round trip, which the fix
      does not change), with the 30s `.mcp.json` timeout noted as ample
      headroom. `README.md`'s Build/run/test section and the runbook
      both flag the `$default` pinning so it is not undone by a future
      "tidy the template" pass.
      Verified this session: `npm run build`, `npm test` (18/18
      passing, including the 3 new regression tests), `npm run lint`,
      `npm run format`, `sam validate --lint`, and `sam build` (rendered
      `.aws-sam/build/template.yaml` confirmed `StageName: $default`
      and the `Stage` tag on both resources) — all clean. **Not
      verified**, needing the owner's redeploy: that the live endpoint
      actually answers `/health` and `/mcp` post-fix, and a fresh
      cold/warm latency measurement if a more precise number than the
      pre-fix one is wanted (not required — the pre-fix figures still
      hold per the note above). See task T009's report for the full
      account.

- [x] **Plan-state read** (chunk 1 child C, node P2-N009) — `plan_read`,
      the first real plan-state MCP tool. `src/planRegister/parser.ts`
      parses `docs/plan-register.md`'s grammar (cited to
      `docs/process/plan-register.md` in the coordinating repository,
      not restated) into structured nodes: ID, stage, hold marker,
      title, best-effort `label: target` links (plus the verbatim
      post-em-dash `annotation`, so a non-link annotation like the real
      register's P1-N006 line is never lost), and parent/child edges
      from list nesting. A node-like line that fails to parse, or a
      duplicate ID, is recorded in a structured `errors` list naming
      the line and reason — never a silently dropped node — while
      every other node still parses. `subtreeIds` answers subtree
      queries (a node and its descendants only). Round-trip-tested
      against a byte-for-byte copy of the coordinating repository's
      real register (`test/fixtures/plan-register.sample.md`, 19
      nodes, 0 parse errors — matching
      `plugin/scripts/form_check.py`'s independent count on the same
      text there) plus constructed malformed-line, duplicate-ID, and
      hold-marker cases. GitHub access:
      `src/planRegister/registerFetcher.ts` (`GithubAppRegisterFetcher`)
      resolves a ref (or the repository's default branch, when none is
      given) to a commit SHA via the GitHub Commits API, then fetches
      `docs/plan-register.md`'s content pinned to that exact SHA via
      the Contents API — so the SHA an answer reports is always the
      commit its content came from. `src/planRegister/githubAppAuth.ts`
      mints the installation access token: an App JWT via
      `universal-github-app-jwt` (a small, official octokit-org,
      zero-dependency package — chosen over the full
      `@octokit/auth-app`, which also pulls in OAuth strategies this
      service never uses, and over hand-rolled JWT signing), exchanged
      for an installation token, cached in memory until shortly before
      expiry so a warm Lambda container reuses it instead of minting
      fresh on every call. `RegisterFetcher` is the injectable seam I5
      calls for: every test above and the tool's own contract tests
      (`test/planRead.test.ts`) run against a stubbed fetcher or an
      injected fake `fetch` — no real GitHub credentials anywhere in
      this repository. There is no local-disk or unauthenticated-URL
      fallback for register content anywhere in `src/` —
      `GithubAppRegisterFetcher` is the only production implementation
      of `RegisterFetcher` (I5: "no tool derives plan state from
      anything but repository content fetched through the GitHub
      App"). `src/planReadTool.ts` registers `plan_read` (input:
      optional `ref`, optional `nodeId` for a subtree query; output:
      `ref`, `sha`, `fetchedAt`, `rootIds`, `nodes`, `errors` — every
      response carries its source SHA and fetch time, never optional).
      Wired into `src/mcpServer.ts` / `src/httpApp.ts` via an optional
      `planRegisterFetcher` override threaded through both (test-only;
      production call sites omit it and get
      `src/planRegister/defaultFetcher.ts`'s real, lazily-built,
      GitHub-App-backed fetcher — built from environment configuration
      only when the tool is actually called, so a server with no
      GitHub App configured still starts and lists `plan_read` cleanly,
      and only the call itself reports the missing `GITHUB_APP_*`
      variable(s) by name). `src/githubAppConfig.ts` reuses the
      existing `MCP_PROJECT` variable for which repository to read
      rather than adding a second one that could disagree with it.
      `template.yaml`: three new parameters (`GithubAppId`,
      `GithubAppInstallationId` — not secret; the private key
      resolved via a CloudFormation dynamic reference at deploy time,
      the same pattern as `AuthTokenSecretName`, never a literal),
      wired into the Lambda's environment as `GITHUB_APP_ID` /
      `GITHUB_APP_INSTALLATION_ID` / `GITHUB_APP_PRIVATE_KEY`. The
      function `Timeout` moved from 10s to 20s (`plan_read` can make up
      to four sequential GitHub API round trips; still comfortable
      headroom under the enlistment file's 30s per-server timeout — not
      yet measured against a real deployment, see below).
      `scripts/deploy.sh` now requires `GITHUB_APP_ID` /
      `GITHUB_APP_INSTALLATION_ID` /
      `GITHUB_APP_PRIVATE_KEY_SECRET_NAME` alongside the existing
      required variables. `docs/runbook.md` gained Step 2 ("Configure
      GitHub App access (O3)" — create, install, and record the App's
      ID and installation ID, store its private key in Secrets Manager
      the same way Step 1 stores the bearer token) and a `plan_read`
      verification call in what is now Step 6, both filed under owner
      action **O3** (already named by the parent plan — not a new
      action outside O1–O6); Steps 2–7 renumbered to 3–8 and every
      cross-repository-internal reference to a step number
      (`docs/mcp-enlistment.md`, this Backlog's own Step-8 references
      above) updated in this same commit so no link goes stale.
      Verified this session: `npm run build`, `npm test` (60/60
      passing — the pre-existing 18 unaltered, 42 new), `npm run lint`,
      `npm run format`, all clean; `template.yaml` checked for valid
      YAML and correct parameter/environment wiring (no `sam` CLI
      available in this session, so `sam validate --lint` and
      `sam build` were **not** run — unlike node P2-N008, which had
      it). **Not verified**, and blocking this criterion until owner
      action **O3** (create and install the GitHub App, store its
      private key) is complete: `plan_read` against the real, deployed
      service — "a session reads P2 nodes and their stages through it"
      — and `plan_read`'s actual cold/warm latency (`docs/runbook.md`
      Step 8). See task T010's report for the full account, including
      the cross-check against `plugin/scripts/form_check.py` and the
      Backlog additions this session identified but did not execute.

## Upcoming

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
- [ ] **Re-verify `plan_read` against the deployed service and record
      its cold/warm latency** (node P2-N009 follow-up) — owner action
      O3 (create and install the GitHub App, store its private key,
      redeploy per `docs/runbook.md` Steps 2–3) is outstanding; once
      done, run `docs/runbook.md` Step 8's `plan_read` timing and
      confirm a real session reads P2 nodes and their stages through
      the deployed endpoint (the one criterion this node's local
      verification could not reach). Revisit the `template.yaml`
      `Timeout: 20` figure against the measurement.
- [ ] **`sam validate --lint` / `sam build` for the GitHub App wiring**
      (node P2-N009 follow-up) — this session had no AWS SAM CLI
      available, so `template.yaml`'s new parameters and environment
      wiring were checked only by parsing the YAML and reading the
      rendered structure, not by SAM's own validator or a real
      esbuild-bundle build (node P2-N008 had both). Run both once SAM
      is available, the same way node P2-N008's rework did.
- [ ] **Keep `test/fixtures/plan-register.sample.md` current, or stop
      needing to** (node P2-N009 follow-up) — the round-trip test
      fixture is a byte-for-byte copy of the coordinating repository's
      `docs/plan-register.md` taken at implementation time; it will
      drift as that register grows. Either refresh it periodically (a
      one-line `cp` from a coordinating-repository checkout) or, if
      this repository ever gains CI that can reach the coordinating
      repository, fetch it there instead of committing a copy — out of
      scope for a C1 read tool today, worth a look once CI for this
      repository exists (see the CI item above).
