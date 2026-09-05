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

- [x] **Plan-state update with the advisory lease** (chunk 1 child D,
      node P2-N010) — `plan_lease_acquire` / `plan_update` / `plan_confirm`
      / `plan_lease_release` (`src/planWriteTools.ts`), the three-step
      git-authoritative write model: this service never writes git and
      holds no repository write credential (G4) — `plan_update`
      validates a requested stage transition against the node
      lifecycle and the register as it currently stands in git, and
      returns the exact edit (file, the line as it is, the line as it
      should be) for the calling session to apply, commit with its own
      documentation (W-003), and push itself; `plan_confirm` then
      checks the pushed commit actually carries it. The shared grammar
      unit is adopted (RU-012): the coordinating repository's canonical
      `plugin/scripts/lib/plan-register.ts` and its conformance corpus
      are vendored byte-for-byte into `src/planRegister/vendored/` via
      `sync_shared_unit.ts`, and this repository's own
      `src/planRegister/parser.ts` / `types.ts` — a hand-maintained
      second copy of the same grammar since node P2-N009 — are now thin
      re-exports of it (`README.md`'s "The vendored register grammar
      unit, and its drift check" records the re-vendor/`--check`
      command; `.prettierignore` and `eslint.config.js` exclude the
      vendored tree, generated, not authored here). The P2-N009
      stage-vocabulary finding (the parser passed an out-of-vocabulary
      stage like `[verifiying]` through as fact) is closed for the
      write path: `src/planRegister/transitions.ts`'s `isKnownStage`
      checks every current and requested stage against the vendored
      unit's `STAGES`, carried there as data (D5 — "no policy in the
      unit"), and refuses anything outside it, naming
      `docs/process/plan-model.md`; the read path (`plan_read`) is
      unchanged; that vocabulary is exported but only the write path
      enforces it, which is the first tool for which the question has
      a practical answer. The transition table itself
      (`src/planRegister/transitions.ts`, I2) cites
      `docs/process/plan-model.md`'s node-lifecycle table directly:
      every documented forward exit, backward moves to any earlier
      stage (rank-ordered, with `broken-down` and `executing` sharing
      one rank as parallel branches — a lateral hop between them is
      refused as neither the documented forward exit nor a move to an
      earlier stage, this node's own reading of a case the table does
      not spell out explicitly; see that file's doc comment), and the
      register-structure invariant (`checkStructural`, mirroring
      `plugin/scripts/lib/form-check-core.ts`'s `INTERIOR_OK` set) so a
      legalized transition can never immediately fail the coordinating
      repository's own `register-structure` check. The edit itself
      (`src/planRegister/updateEngine.ts`, I1) is the smallest possible
      text change — the stage bracket on one line, nothing else —
      located by the node-ID marker preceding it rather than by
      searching for the stage text, so a title or annotation repeating
      the stage word is never touched; proven byte-identical to a hand
      edit operationally, not by argument:
      `test/planUpdateGitExercise.test.ts` builds a real, throwaway
      local git repository (never the coordinating repository, which
      stayed read-only and untouched this whole node), applies the same
      transition on one branch by hand and on a second branch by taking
      `plan_update`'s returned edit verbatim, and asserts `git diff`
      between the two branches' `docs/plan-register.md` is empty — it
      is; the same file's second case is I3 — a deliberately induced
      divergence (a commit that never actually lands the edit) makes
      `plan_confirm` refuse, naming the file and the line and showing
      both the actual and expected stage, without releasing the lease —
      the R10 detection, exercised, not reasoned about (both
      transcripts are in task T024's report). The lease (decision 7):
      `src/planRegister/leaseBackend.ts`'s `LeaseBackend` interface, one
      fixed lease item (chunk 1 scope — this repository only),
      acquire/release as DynamoDB conditional writes
      (`src/planRegister/dynamoLeaseBackend.ts`); TTL expiry is enforced
      in application logic (`expiresAt < :now` in the
      `ConditionExpression`) rather than trusted from DynamoDB's own TTL
      sweep, which AWS documents as lagging real time by up to about 48
      hours — that attribute is set anyway, as best-effort cleanup, not
      the mechanism. `src/planRegister/inMemoryLeaseBackend.ts` is what
      every test, and a local `npm run dev` session with no AWS
      configured, uses instead (the same injectable-seam pattern
      `RegisterFetcher` established at P2-N009); it is never reachable
      from production wiring. `template.yaml` gained `LeaseTable`
      (`AWS::DynamoDB::Table`, pay-per-request, TTL on `ttl`) and a
      `DynamoDBCrudPolicy` scoped to it on `McpFunction`; no new owner
      action or secret — `LEASE_TABLE_NAME` is wired automatically by
      `sam deploy`. Verified this session: `npm run build`, `npm test`
      (123/123 passing — the pre-existing 60 unaltered, 63 new,
      including the two real-git I1/I3 exercises), `npm run lint`,
      `npm run format`, all clean. **Not verified**, needing a `sam` CLI
      this session did not have (the same gap node P2-N009's follow-up
      records): `sam validate --lint` and `sam build` against the
      `LeaseTable` addition — the template was checked only by parsing
      the YAML and reading the rendered structure. **Not verified**,
      needing the owner's deploy and a real session: the tools against
      the deployed service, and a real end-to-end transition through
      the gate demonstration itself (G3/G4) — chunk 1's remaining child
      (P2-N011) and the gate are still ahead. See task T024's report
      for the full account, including the packet-widening reads and the
      Backlog additions this session identified but did not execute.

- [x] **Rework: fix the lease-release reserved-word defect (post-deploy
      defect, node P2-N010)** — the chunk 1 gate demonstration moved a
      real node through a real stage transition against the deployed
      service; `plan_confirm` succeeded, then the first-ever production
      call into the lease table failed to release the lease:
      `confirmed, but could not release the lease: could not reach the
write-lease store: 1 validation error detected: Invalid
ConditionExpression: Attribute name is a reserved keyword;
reserved keyword: token`. Root cause:
      `src/planRegister/dynamoLeaseBackend.ts`'s `releaseLease` used
      `ConditionExpression: "token = :token"` — `token` is one of
      DynamoDB's reserved words, rejected unless aliased. `acquireLease`
      (`attribute_not_exists(pk) OR expiresAt < :now`) and `readLease`
      (no expression) use no reserved words, checked and confirmed
      unaffected. Fix: `#token = :token"` with
      `ExpressionAttributeNames: { "#token": "token" }`. The design is
      unchanged — same lease shape, same TTL semantics (still the
      authoritative expiry mechanism; not touched), same four tools; the
      lease was never at risk because this service holds no write
      credential and the lease self-releases by TTL when release fails.
      Why every one of the pre-existing 124 tests missed this: all of
      them run `InMemoryLeaseBackend`, and `DynamoLeaseBackend`'s own
      contract test (`test/leaseBackend.test.ts`) uses a fake client
      that reads `ExpressionAttributeValues` directly and never parses
      the expression string DynamoDB actually validates — the same
      "check that cannot fail in the environment the code runs in"
      shape as the ESM-bundle and `$default`-stage defects. New:
      `src/planRegister/dynamoReservedWords.ts` (a reconstruction —
      declared partial and why in its own doc comment; this session had
      no network access to AWS's reserved-word documentation page and
      declined an unverified, suspiciously well-timed third-party npm
      package offering "the complete list" instead) and
      `src/planRegister/dynamoExpressionSafety.ts`
      (`findUnaliasedReservedAttributeNames`, generalizing to any
      `ConditionExpression` / `KeyConditionExpression` /
      `ProjectionExpression` / `UpdateExpression` / `FilterExpression`
      this file builds, not just the one already found).
      `test/dynamoExpressionSafety.test.ts`: unit tests of that checker,
      plus one integration test that drives the real
      `DynamoLeaseBackend` through a recording fake client and asserts
      every command it actually sends is reserved-word-safe — proven to
      catch the defect by reverting the fix and watching it fail with
      `token` named, then restoring it and watching it pass (both
      transcripts in task T027's report), not merely written and
      assumed to work. `docs/runbook.md` gained a Troubleshooting entry
      recognizing this exact production error message. No existing test
      altered (W-002); 6 new tests, 130/130 passing. Verified this
      session: `npm run build`, `npm test` (130/130), `npm run lint`,
      all clean — still no AWS credentials or Docker, so the fix is
      verified against the reserved-word list and the real command
      shapes `DynamoLeaseBackend` builds, not against a real DynamoDB
      table. **Not verified**, needing the owner's redeploy: the fixed
      `releaseLease` against the real `LeaseTable` (the next
      `plan_lease_release` / `plan_confirm` call against the deployed
      service). See task T027's report for the full account.
- [x] **Rework: fix the ESM/CJS bundle outage — production 500s on
      every route (node P2-N010 rework)** — the owner merged and
      deployed the write path above; every route, including the
      unauthenticated `GET /health`, started returning API Gateway's
      own `{"message":"Internal Server Error"}`, meaning the Lambda
      function never initialized. Root cause: `@aws-sdk/client-dynamodb`
      (the write path's new dependency) reaches
      `@smithy/node-http-handler`, which is CommonJS and `require()`s
      Node builtins (`node:https`, etc.); `package.json`'s
      `bundle:lambda` and `template.yaml`'s `BuildProperties` (what
      `sam build` actually uses to bundle — the two are kept in sync,
      not one derived from the other) both build with `--format=esm`,
      under which there is no ambient `require`, so esbuild's own
      dynamic-require shim threw an error at import time — every cold
      start. Fix (option (a) of three considered): an esbuild banner,
      on both build paths, that defines a real `require` via
      `node:module`'s `createRequire` before any bundled code runs, in
      `package.json`'s script and the equivalent
      `BuildProperties.Banner` (a generic esbuild CLI passthrough SAM's
      Node.js esbuild workflow already supports, confirmed by reading
      `aws_lambda_builders`' own source, not assumed) in
      `template.yaml`. Chosen over (b) bundling as CommonJS (correct,
      but a larger change touching `template.yaml`'s `Handler`
      extension and the deployment surface for no benefit over (a)) and
      over (c) marking `@aws-sdk/*` external and relying on the managed
      Node 22 runtime to provide it (rejected: this session had no way
      to verify the runtime actually bundles a compatible
      `@aws-sdk/client-dynamodb`, and guessing wrong here reproduces
      this exact outage) — the AWS-documented remedy for CJS-dependency
      interop in an ESM esbuild bundle, and the smaller change of the
      two verified options. Nothing in `src/`, the lease, the
      transition table, or the vendored grammar unit changed — this was
      a build-configuration defect only. No deploy procedure or
      parameter changed (`docs/runbook.md`'s new "Why the bundle
      carries an esbuild banner" note and a new Troubleshooting entry);
      a stack deployed before this fix needs a redeploy of the existing
      Step 3 with the fixed `template.yaml`, nothing more. The second
      defect, which mattered as much: the check that should have caught
      this before it shipped, used on every prior task, was
      `node -e "import('...')"` against the built bundle — `node -e`
      evaluates in CommonJS mode, and Node attaches `require` to
      `globalThis` for that mode, so esbuild's shim finds it and the
      bundle loads without error, a false negative; the deployed Lambda
      loads the identical `.mjs` file through Node's real ESM loader,
      which has no such global. Fixed by shipping a committed
      regression test, `test/lambdaBundle.test.ts`, that builds the
      bundle fresh (running `package.json`'s own `bundle:lambda` script
      — one source of truth, not a second, copied esbuild invocation)
      and imports it from a real `node` subprocess in genuine ESM mode
      (`node --input-type=module -e`), asserting a callable `handler`
      export; proven by reverting the banner, watching the test fail
      with the exact production error, then restoring it and watching
      the test pass (both transcripts in task T025's report). A related
      discovery while building that test: a plain
      `await import(bundlePath)` from inside a Vitest test does not
      reproduce the failure either against the unfixed bundle —
      Vitest/Vite's own module runner is a second instance of the same
      false-negative trap, not fixed here (see "The false-negative
      artifact-validation trap, generalized" below). No other committed
      check in this repository validates a built artifact at all
      (`test/lambda.test.ts` imports `src/lambda.ts`, the TypeScript
      source, never a build output) — searched for and not found
      elsewhere in this session. `eslint.config.js`'s `ignores` also
      gained `dist-lambda/**` and `.aws-sam/**` (alongside the existing
      `dist/**`), since `test/lambdaBundle.test.ts` now leaves a real
      bundle in the working tree after every `npm test`, which
      `npm run lint` would otherwise trip over — a latent gap in the
      lint config that predates this node but was only now exercised.
      Verified this session: `npm run build`, `npm run lint`,
      `npm test` (124/124 passing — the pre-existing 123 unaltered, 1
      new), and `npm run format` (clean on every file this session
      touched; `docs/backlog.md` had a pre-existing Prettier violation
      on `main` before this session's edits, reformatted incidentally
      by this commit's own rewrite of it — not a change made to satisfy
      this node's own criteria). This session also had a working AWS
      SAM CLI available (not true of node P2-N009's or P2-N010's own
      sessions) and ran `sam build` and `sam validate --lint` against
      the fixed `template.yaml` directly — both succeeded, and the real
      `sam build` artifact (`.aws-sam/build/McpFunction/lambda.mjs`,
      not just `dist-lambda/lambda.mjs`) was independently confirmed to
      load under a real ESM subprocess and answer a synthetic
      `GET /health` event with `200`. This closes the two "no SAM CLI
      available" follow-up items below for the build/validate step
      specifically (not for a real `sam deploy`, which needs AWS
      credentials this session did not have) — see those entries,
      rewritten to record it, below.

- [x] **`sam validate --lint` / `sam build` for the GitHub App wiring**
      (node P2-N009 follow-up) — run this session (the node P2-N010
      ESM-bundle-outage rework above), which had a working AWS SAM CLI:
      both succeeded against the current `template.yaml`, including the
      `GithubAppId` / `GithubAppInstallationId` /
      `GithubAppPrivateKeySecretName` parameters and their environment
      wiring. Not run: a real `sam deploy` (needs AWS credentials this
      session did not have) and the owner action O3 prerequisites
      `plan_read`'s own re-verification entry (Upcoming) still needs.

- [x] **`sam validate --lint` / `sam build` for the `LeaseTable`
      addition** (node P2-N010 follow-up) — run this session (the same
      SAM CLI availability as the GitHub App wiring item above): both
      succeeded, including the `LeaseTable` resource, `LEASE_TABLE_NAME`
      environment wiring, and the `DynamoDBCrudPolicy` scoped to it, and
      the new `BuildProperties.Banner` this session's own rework added.
      Not run: a real `sam deploy` (needs AWS credentials this session
      did not have).

- [x] **Migrated to methodology v1.4.0** — 2026-08-31, following the
      coordinating repository
      ([majodali/project-orchestrator](https://github.com/majodali/project-orchestrator)
      PR #3) so the two repositories in this project do not declare
      different compliance targets. All four v1.4.0 amendments carry
      migration-note _none_ or _none mandatory_, so the pin bump and
      the Binding block are the whole migration. Two of them touch
      this repository's future rather than its present: the prose
      rules P-001–P-006 bind new and edited prose from adoption, and
      the **Workflow declaration format** now requires three parts
      (ordered stages, designated live stage, Backlog default rule)
      in a canonical form — this repository declares no Workflow
      today, so it carries no duty, but the format applies the moment
      the deploy workflow is declared. The multi-repo relationship
      field is **not** in v1.4.0, so the prose statement naming the
      coordinating repository in
      [docs/classification.md](classification.md) stays as it is.

- [x] **Alias-aware lease-table selection, failing closed** (chunk 2,
      node P2-N015, child C of
      [deploy from CI on merge](https://github.com/majodali/project-orchestrator/blob/main/docs/specs/p2-n012-deploy-from-ci-on-merge.md)) —
      one published Lambda version now answers two aliases, `live`
      (production) and `preprod`; the handler reads its own invoked
      qualifier from the Lambda context
      (`c.env.lambdaContext.invokedFunctionArn`, via `hono/aws-lambda`
      — the field and path child A's finding,
      `docs/findings/alias-assumptions.md`, names) and resolves the
      lease table from it: `live` → `LEASE_TABLE_NAME`, `preprod` →
      the new `PREPROD_LEASE_TABLE_NAME`. Any other qualifier —
      `$LATEST` included, and an unqualified invocation — is refused,
      naming the qualifier it saw
      (`src/planRegister/aliasLeaseTable.ts`,
      `UnrecognizedLambdaQualifierError`). Fail-closed is scoped to
      Lambda by construction, not by an environment check: the
      resolution only runs when `src/httpApp.ts` finds a Lambda
      context on the request; the local dev server and every test
      never populate that field, so they keep resolving
      `LEASE_TABLE_NAME` through the pre-existing, unchanged
      `getDefaultLeaseBackend` (I7 — the existing 131-test corpus
      passes unaltered; no test was rewritten). `service_identity`
      reports the invoked qualifier and the resolved lease table name
      (never an ARN or account identifier, S-001) — absent entirely
      (not `null`) when there is no Lambda context or when the
      qualifier was refused with no table resolved, which is what
      keeps the pre-existing four-field `toEqual` assertion on
      `service_identity`'s output in `test/httpApp.test.ts` passing
      unchanged even though the response shape grew two optional
      fields.
      `template.yaml`: `PreprodLeaseTable` (a second, permanent
      DynamoDB table, matching `LeaseTable`'s key schema and TTL
      configuration exactly); `LiveAlias` and `PreprodAlias`, both
      plain `AWS::Lambda::Alias` resources — deliberately **not**
      SAM's `AutoPublishAlias` sugar, which republishes and repoints
      its alias on every code-changing deploy and would defeat
      "deploy, then promote" the first time CI ran (child A's finding,
      assumption 5, sourced to AWS's own gradual-deployment
      documentation, which uses an alias literally named `live` in its
      own example of this exact trap). `LiveAlias.FunctionVersion`
      comes from a new `LiveVersion` parameter that
      `scripts/deploy.sh` reads back from the alias's real current
      state (`aws lambda get-alias --name live`) before every ordinary
      deploy and passes back unchanged, so CloudFormation sees no
      declared change and never touches the alias (I4) — promotion is
      a direct `aws lambda update-alias` call, outside CloudFormation,
      left to child D. `PreprodAlias.FunctionVersion` (a new
      `PreprodVersion` parameter) needs no such protection, since
      `preprod` is supposed to move on every deploy and child D
      repoints it directly as part of the deploy-and-smoke sequence.
      `PreprodFunctionUrl` (`AWS::Lambda::Url`, `Qualifier: preprod`,
      `AuthType: NONE` — the same application-level bearer-token auth
      the production endpoint carries, not IAM auth) plus the
      `AWS::Lambda::Permission` public-invoke grant it needs. The
      production HTTP API integration, route, and invoke permission
      are now declared explicitly (`AWS::ApiGatewayV2::Integration` /
      `Route` / `AWS::Lambda::Permission`) rather than through SAM's
      `Events:` sugar on `McpFunction` — sugar has no way to bind to
      an alias, and `IntegrationUri: !Ref LiveAlias` is what actually
      binds production traffic to `live` (I3 — the template exposes no
      third externally reachable path and no unqualified one; the two
      aliases' Function URL / HTTP API integration are the only
      routes). `McpFunction`'s execution role gained a second
      `DynamoDBCrudPolicy`, scoped to `PreprodLeaseTable` — one
      function serves both aliases, so its role needs both tables'
      worth of access; the qualifier read at request time, not a
      narrower IAM grant, is what keeps a `preprod` invocation from
      ever touching the production table. The
      `secretsmanager:GetSecretValue` grant the smoke test needs
      (plan, "The smoke test, and where its token comes from") is
      **not** added here: it belongs to the deploy role's own
      permissions, which this stack does not define and which O7
      already names as an owner attestation — see this task's report
      (T032) for the reasoning.
      No npm dependency added (R14). Tests:
      `test/aliasLeaseTable.test.ts` (pure-function coverage of the
      qualifier parse/resolve, every qualifier shape);
      `test/defaultLeaseBackend.aliasAware.test.ts` (the lazy backend
      and its cache, offline — constructing a real `DynamoDBClient`
      does no I/O, but no test here ever calls `.send()`);
      `test/httpApp.test.ts` and `test/lambda.test.ts` gained new
      blocks driving the _real_ handler wiring — the actual Hono app
      via `c.env` and the actual exported Lambda `handler` with a
      realistic `LambdaContext`, respectively — rather than calling
      the parsing helper directly with a string, per this task's own
      warning about checks that prove nothing about the deployed path.
      Each new assertion was proven able to fail: disabling the
      fail-closed refusal, and separately widening the Lambda-scoping
      to apply with no Lambda context at all, were each tried and
      watched break every dependent new test **and** the pre-existing
      `service_identity` shape test, then reverted; see T032's report
      for the exact failure messages. 167/167 tests passing (131
      pre-existing, unaltered; 36 new).
      Verified this session: `npm run build`, `npm run lint`,
      `npm test`, `npm run format`, `sam validate --lint`, and
      `sam build` (a working AWS SAM CLI was available this session) —
      all clean; the built bundle was also independently loaded under
      a real ESM subprocess and its `handler` export confirmed
      callable. **Not verified**, needing the owner's deploy (child D,
      node P2-N016, and O1/O2/O7): the alias binding actually holding
      in a real account, the Function URL's real event shape reaching
      `hono/aws-lambda` unmodified, and — the property this whole
      child exists to establish — that a second, template-changing
      deploy leaves `live` at whatever version was last promoted
      rather than resetting it (I4). See task T032's report for the
      full account, including the `scripts/deploy.sh` read-back
      reasoning and the proved/unproven split.

- [x] **Deploy prerequisites cleared: the deploy role's IAM policy and the `GITHUB_`-variable naming fix** (chunk 2 child D prep, node P2-N016, task T033) — the two owner actions that were blocking child D on contact with reality (O7's permissions being sized only for the promote step and never for `sam build && sam deploy`; O8's three required variable names starting with `GITHUB_`, which GitHub's repository-variable naming rule forbids) are now both documented and closed out, with no change to `scripts/deploy.sh` or `template.yaml`. `docs/deploy-role-permissions.md` is new: a complete IAM policy, derived resource by resource from `template.yaml` and cross-checked against the AWS SAM developer guide and the AWS Service Authorization Reference (both read and cited 2026-09-01), covering `sam deploy --resolve-s3 --capabilities CAPABILITY_IAM` end to end — including the second, SAM-managed CloudFormation stack `--resolve-s3` creates for its artifact bucket, which is easy to miss — plus the promote/smoke grants child D will need (`lambda:PublishVersion`/`UpdateAlias`/`GetAlias`, `secretsmanager:GetSecretValue` on both secrets `template.yaml` dynamically resolves, not only the one O7's plan text names). Every action that cannot be scoped to a specific resource ARN is named and cited rather than granted silently (`cloudformation:GetTemplateSummary` and all four `apigateway:POST`/`GET`/`PATCH`/`DELETE` authoring actions — the Service Authorization Reference's own "Resource types" table for Amazon API Gateway Management V2 is empty). The target OIDC trust policy is included for the owner to compare the live one against (I2 is owner-attested; no dispatched session holds AWS credentials to read it directly). `docs/runbook.md` gained a new "CI deploy prerequisites: owner actions O7 and O8" section: confirmed, against GitHub's own variables reference read 2026-09-01, that the `GITHUB_` prefix ban applies to configuration variables (the `vars` context) and not to environment variables generally — only to the specific, enumerated list of GitHub's own defaults, which the three `GITHUB_APP_*` names are not on — so the fix needed no `scripts/deploy.sh` change: three repository variables are stored under new, unprefixed names (`SERVICE_GITHUB_APP_ID`/`SERVICE_GITHUB_APP_INSTALLATION_ID`/`SERVICE_GITHUB_APP_PRIVATE_KEY_SECRET_NAME`, chosen and stated once) and an `env:` mapping block, given verbatim as the contract for child D to implement, translates them back to the names the script requires. Confirmed from `scripts/deploy.sh`'s own `${VAR:?message}` guards that it fails closed on an unset-or-empty value; recorded as a residual risk, not a defect, that it cannot distinguish "set to something unexpected" from "set correctly" if GitHub ever adds one of these three names to its own defaults list. No `.md` file outside `docs/deploy-role-permissions.md`, `docs/runbook.md`, and this Backlog was touched, and neither `scripts/deploy.sh` nor `template.yaml` changed.
- [x] **Pull-request checks that cannot deploy** (chunk 2 node
      P2-N012 child B, node P2-N014) — `.github/workflows/checks.yml`,
      the first workflow file in this repository. Triggers on the
      plain pull-request event only (never a push to `main`, and never
      the variant of the pull-request event that runs with
      base-branch permissions and secrets against untrusted head
      content); declares `permissions: contents: read` at the
      workflow level with no job-level override and no OIDC token
      permission anywhere in the file, so no job here can assume the
      deploy role (criteria G1, I2). Four independent jobs, each its
      own named check once branch protection requires it — see
      `docs/runbook.md`, "Pull-request checks (branch protection,
      O10)," for the exact names a repository admin selects: `Build`
      (`npm run build`), `Lint` (`npm run lint`), `Test` (`npm test`),
      and `SAM validate --lint` (via `aws-actions/setup-sam`). The
      three third-party actions used (`actions/checkout`,
      `actions/setup-node` — GitHub's own actions count as
      third-party for this purpose — and `aws-actions/setup-sam`) are
      pinned to full 40-character commit SHAs, each with the released
      version in a trailing comment, resolved from each project's own
      published tags at execute time (R14, I6). No npm dependency
      added. Closes the `.aws-sam/**` lint-hygiene gap this child was
      asked to check: `eslint.config.js` and `.gitignore` already
      carried the `.aws-sam/**` / `.aws-sam/` exclusion (added
      incidentally by the ESM-bundle-outage rework above, before this
      node existed); the one remaining gap was `.prettierignore`,
      which did not list it — `npm run format` already passed after a
      `sam build` regardless, because Prettier's CLI follows
      `.gitignore` by default, but the entry is now explicit rather
      than resting on that fallback. Verified this session: `npm run
build`, `npm run lint`, `npm test` (131/131 passing, unchanged),
      and `npm run format`, each re-run after a real `sam build`
      populated `.aws-sam/` to confirm the collision stays fixed;
      `sam validate --lint` and `sam build` both run locally against
      the unchanged `template.yaml` (this session had a working AWS
      SAM CLI available) and succeeded. **Not run:** the workflow
      itself — GitHub Actions does not execute on a branch without an
      open pull request, and none was opened this session, so the
      check names above and the workflow's first real run remain
      unproven until then.

## Upcoming

- [ ] **Degrade to git-only, and enlistment documentation** (chunk 1
      child E, node P2-N011) — the R12 exercise (dead endpoint and unset
      credential) and the enlistment runbook.
- [ ] **Deploy-on-merge CI for this repository** (chunk 2 node
      P2-N012 child D, not yet started) — pull-request checks
      (`npm run build`, `npm run lint`, `npm test`, `sam validate
--lint`) now run in CI on every pull request, landed as node
      P2-N014 above; `npm run format` still runs locally only, and is
      not one of child B's four required checks. Still upcoming: the
      `push`-to-`main` workflow that publishes a Lambda version behind
      the `preprod` alias, smoke-tests it, and promotes by repointing
      `live` — see the coordinating repository's
      `docs/specs/p2-n012-deploy-from-ci-on-merge.md`.
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
- [ ] **Keep `test/fixtures/plan-register.sample.md` current, or stop
      needing to** (node P2-N009 follow-up) — the round-trip test
      fixture is a byte-for-byte copy of the coordinating repository's
      `docs/plan-register.md` taken at implementation time; it will
      drift as that register grows. Either refresh it periodically (a
      one-line `cp` from a coordinating-repository checkout) or, if
      this repository ever gains CI that can reach the coordinating
      repository, fetch it there instead of committing a copy — out of
      scope for a C1 read tool today, worth a look once CI for this
      repository exists (see the CI item above). Still stale as of node
      P2-N010 (unchanged this session — refreshing it would touch
      `test/planRegisterParser.test.ts`'s node-count assertions, a
      W-002 question outside this node's scope); it does not exercise
      the write path, since P2-N010's own tests
      (`test/planUpdateGitExercise.test.ts`) build a throwaway fixture
      register of their own instead.
- [ ] **Automate the vendored shared unit's drift check** (node P2-N010
      follow-up, RU-012) — `README.md`'s "The vendored register grammar
      unit, and its drift check" documents the manual
      `sync_shared_unit.ts --check` command; nothing runs it
      automatically today, so `src/planRegister/vendored/` can drift
      from the coordinating repository's canonical copy unnoticed
      between manual runs. Natural fit once this repository gains CI
      (see the CI item above) and network access to the coordinating
      repository from that CI.
- [ ] **The false-negative artifact-validation trap, generalized**
      (found while building `test/lambdaBundle.test.ts`, node P2-N010
      rework) — `node -e "import('...')"` against a built ESM bundle is
      not the only environment that hides the CJS-dependency-under-ESM
      failure this rework fixed: a plain `await import(bundlePath)`
      from _inside a Vitest test_ was tried against the unfixed bundle
      while building that test, and it did not throw either —
      Vitest/Vite's own module runner is a second instance of the same
      trap. `test/lambdaBundle.test.ts` avoids it by spawning a real
      `node --input-type=module` subprocess instead, but nothing stops
      a future test from writing the natural-looking, silently-wrong
      `await import(...)` form directly. Worth either: documenting the
      trap prominently enough that it is not rediscovered by outage (a
      start — this Backlog entry, and the doc comment on
      `test/lambdaBundle.test.ts` itself), or building a small shared
      test helper that always spawns a real ESM subprocess for
      built-artifact checks, so the correct form is the easy one. No
      other committed check in this repository validates a built
      artifact today (searched this session; `test/lambda.test.ts`
      imports `src/lambda.ts` — TypeScript source, not a build output),
      so nothing else needs fixing now — but the next Lambda-bundling
      dependency this service adds could reintroduce this exact outage
      if whoever adds it reaches for the natural-looking check instead
      of the correct one.
- [ ] **A full end-to-end write-path exercise against the deployed
      service** (node P2-N010 follow-up) — this session verified the
      write path locally only (an in-process Hono app, an
      `InMemoryLeaseBackend`, and, for I1/I3, a real but throwaway
      local git repository — never the deployed Lambda, the real
      `LeaseTable`, or the coordinating repository's real register).
      That full exercise, against the real deployment and a pushed
      commit to the coordinating repository, is the gate demonstration
      itself (G3/G4) and needs owner actions O1/O2 (redeploy with this
      node's `template.yaml`) plus a session serving the Orchestrator
      role (p2-n002 specification, "How verification runs") — tracked
      here so it is not mistaken for something this node already did.
      The first attempt at this exercise ran the transition and
      `plan_confirm` successfully but hit the lease-release reserved-word
      defect above; a redeploy carrying that fix (this repository's
      `main`/this branch, once merged) is needed before re-attempting.
- [ ] **The `push`-triggered deploy, smoke, and promote workflow itself** (chunk 2 child D, node P2-N016) — `.github/workflows/deploy.yml` (or equivalent): OIDC assumption of the deploy role, the deploy step invoking `scripts/deploy.sh` with the repository variables per `docs/runbook.md`'s new "CI deploy prerequisites" section, the three-check smoke test against the preprod Function URL, the promote-by-alias-repoint step, `docs/runbook.md`'s rollback and smoke-failure procedures, and the service repository's Workflow declaration. O7 and O8, the two owner actions this task (T033) was blocked on, are now both documented in `docs/deploy-role-permissions.md` and `docs/runbook.md` — this item is what the owner applying them unblocks.
