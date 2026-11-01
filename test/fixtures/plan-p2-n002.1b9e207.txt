# Service skeleton and plan state

Status: closed → Backlog entry

<!-- K-007 contract: Status transitions draft → active → (superseded by
     X, because Y | closed → Backlog entry). Flips `active` when the
     owner accepts the breakdown at this node's gate. Node P2-N002,
     chunk 1 of [orchestration-service](orchestration-service.md). -->

Outcome under development: a deployed orchestration service that a
Claude Code session enlists from a checked-in `.mcp.json` and uses to
read this project's plan state and to move a node through a stage
transition — with git still the only place that state lives, and with
the session still able to do the same work when the service is
unreachable.

Gate (from the parent plan): **the owner sees a session read and
update real plan state.**

The code lives in
[majodali/project-orchestrator-service](https://github.com/majodali/project-orchestrator-service)
(created by the owner 2026-08-26, empty); this plan lives here with
the rest of the plan hierarchy. Cross-repo scope for the service
repository was granted for this chunk (dispatch's cross-repo-reach
rule).

## What this chunk must prove

Three things, in order of how much they are in doubt:

1. **That a Claude Code session can reach an authenticated,
   AWS-hosted MCP server at all** — on the local surface and on the
   web surface. [R11](../open-risks.md) records the unknowns: cloud
   egress may need the domain allowlisted or connector routing, and
   the client-side secret has to reach the session without entering
   git. Nothing else in the chunk matters if this fails.
2. **That the service can be a projection and still be useful** —
   that "update plan state" through the service produces exactly the
   commit the v1 process would have produced, and that a divergence
   between service and git is a reported error rather than a silent
   second truth ([R10](../open-risks.md)).
3. **That the fallback is real** — a session whose service is down
   completes the same stage transition by the v1 process, and a
   checked-in `.mcp.json` pointing at a dead endpoint does not
   degrade session startup ([R12](../open-risks.md)).

Everything else in the chunk (register parsing, tool shapes, the
repository's own scaffolding) is ordinary work whose risk is cost,
not feasibility.

## What this environment can deliver, and what is the owner's

Stated plainly, because it shapes the breakdown: **this session has
no AWS credentials and cannot deploy.** Standing constraint —
agent sessions do not hold the owner's cloud credentials — and this
chunk plans around it rather than waiting on it.

Deliverable and verifiable by agent sessions:

- the service repository's methodology scaffolding and its project
  skeleton;
- the service implementation and its infrastructure-as-code
  definition;
- the register parser and the tool contracts, verified against this
  repository's real `docs/plan-register.md`;
- end-to-end proof against a **locally run** instance: a local Claude
  Code session enlisted by a local `.mcp.json`, reading and updating
  real plan state;
- the degrade-to-git-only exercise (it needs an unreachable endpoint,
  which is free);
- every document, in the same commits (W-003).

Owner actions, each named here so none is discovered late:

- **O1** — choose the AWS account and region; hold the deploy
  credentials.
- **O2** — run the first deploy from the documented one-command
  script and report the resulting endpoint URL.
- **O3** — create and install the GitHub App the service reads
  through, and store its private key in the secret store (decision 6).
- **O4** — mint the client bearer token and make it available as an
  environment variable on each surface the owner enlists (decision 5).
- **O5** — if the web surface cannot reach the endpoint, apply the
  allowlist or connector configuration that platform requires
  (decision 8).
- **O6** — the gate demo itself.

O1–O4 are a single sitting with the documented runbook; the plan
requires that runbook to exist before any of them is asked for.

## Approach

### Transport and the enlistment file

MCP over HTTP (streamable HTTP), enlisted by a `.mcp.json` checked
into the managed repository — the same mechanism that already carries
the role-agent mirror. Verified transport facts that bind the design:

- The default MCP tool-call timeout is **5 seconds**; the enlistment
  file therefore sets an explicit per-server timeout. Every chunk-1
  tool is a small read or a small write and is specified to answer
  well inside it.
- Calls past **two minutes** auto-background. No chunk-1 tool may
  approach this; a tool that would is a design error, not a timeout
  to raise.
- **Elicitation** is supported natively (chunk 2 uses it); there is
  **no sampling** — which is consistent with standing constraint 4,
  since the service performs no model inference.
- The client secret is supplied by environment expansion in the
  enlistment file; **no token ever enters git**.

### The write model — git stays the only source of truth

The service never becomes a second writer. An update is three fast
round-trips:

1. `plan_lease_acquire` — the session takes the project's advisory
   write lease (TTL-expiring; decision 7).
2. `plan_update` — the session names the node, the transition, and
   the reason. The service validates the transition against the node
   lifecycle **and against the register as it currently stands in
   git**, then returns *the exact edit to make*: file, the line as it
   is, the line as it should be. The service does not touch the
   repository.
3. The session applies the edit, commits it with its work (W-003),
   pushes, and calls `plan_confirm` with the commit SHA. The service
   fetches the file at that SHA, verifies the line, updates its
   projection, and releases the lease.

This is what makes the service worth its keep without violating
constraint 1: the service is the authority on whether a transition is
*legal*, git is the authority on what the state *is*. Every read
answer carries the commit SHA it was computed from, so staleness is
visible rather than assumed. If a session commits and never confirms,
the next read reconciles from git and the lease expires — the failure
mode is a slow projection, never a wrong one.

Reads reconcile from git on every call (short cache, SHA reported).
[R10](../open-risks.md) is thereby closed by construction rather than
by discipline: the service has no state that git cannot correct.

### Fallback

The v1 process is the fallback, unchanged: the session edits the
register and commits, as it does today. The chunk delivers (a) a
documented rule for what a session does when the server is
unreachable — proceed, do not retry, do not wait — and (b) evidence
that a checked-in `.mcp.json` naming a dead endpoint leaves session
startup and unrelated tool use unharmed. Constraint 3 is exercised,
not asserted.

### Shape of the service

One Lambda behind an HTTP API, one DynamoDB table (advisory leases,
with TTL, plus the cached projection), read access to GitHub through
an installed App, secrets in the platform secret store, defined in
one infrastructure template the owner can deploy with one command.
No custom domain in this chunk — the default endpoint URL is enough
to enlist against, and a domain is deferred to the Backlog. Running
cost at this volume is expected to be cents per month; the deploy
runbook states the actual figure once it exists.

## Dependencies

- **P2-N001** — parent plan approved and broken down (done,
  2026-08-26). Constraints 1–5 and rulings RU-006/RU-007 bind this
  node.
- **Owner actions O1–O5** above. Only the deployment child blocks on
  them; the rest of the chunk proceeds in parallel.
- **Not** a dependency: the methodology's multi-repo update. The
  coordinating-repo relationship cannot yet be declared in either
  Classification; until it lands, the service repository declares
  family membership under v1.3.0's Family field alone and names the
  coordinating repo in prose. The coordinating repository's Backlog
  already tracks the declaration ("Declare the multi-repo
  relationship").

## Leaf or interior

**Interior.** The chunk spans a repository bootstrap, a deployment
whose feasibility is unverified, two features (read, update), and a
fallback exercise; no one of these validates the others, and the
deployment carries an owner-action dependency the rest must not wait
behind.

Decomposition is feature-first: iteration-zero setup, then a thin
end-to-end slice that runs the riskiest path with the least content
in it, then the two plan-state features, then the fallback. The
slice leads because [R11](../open-risks.md), not register parsing, is
what could invalidate the design ([plan-model](../process/plan-model.md)
thin-slice-first, [R8](../open-risks.md)).

### Proposed children, in dependency order

IDs are the Orchestrator's to issue.

**Child A — Service repository bootstrap.** Iteration zero for
`project-orchestrator-service`: README, `CLAUDE.md` Binding block,
`docs/classification.md` (decision 1), `docs/backlog.md`, the
project skeleton (language, layout, dependency manifest, local run
and test commands), and the repository's first commit. Criteria: the
Classification declares C1 / S1 / backend-service / serverless-aws,
methodology v1.3.0, family `methodology` (member), naming
`project-orchestrator` as coordinating repo in prose with the
multi-repo caveat; the Binding block matches it; the Plan register
and Cost log are declared by citation to the coordinating repo's
instances (decision 2); the repo's own Backlog exists with its
completed-and-upcoming shape; `mtool` form audit and link check pass
clean on the new tree; the skeleton runs and its test command
succeeds on an empty suite.

**Child B — Reachability slice: a deployed MCP server a session can
call.** The thin end-to-end slice, deliberately near-empty of
content: one tool that returns the service's identity and version,
the infrastructure template, the auth path, the deploy runbook, and
the `.mcp.json` enlistment file in the coordinating repository.
Criteria: the server speaks streamable HTTP MCP and answers
`initialize` and `tools/list`; an unauthenticated call is rejected;
a local Claude Code session enlisted by `.mcp.json` lists and calls
the tool against a locally run instance; the runbook takes the owner
from empty account to endpoint URL in one documented command
sequence (O1–O4); the deployed endpoint answers the same tool call
from a local session and from a web session (O5 if egress needs it);
the enlistment file sets an explicit per-server timeout; no secret
appears in either repository. Blocking dependency on the owner is
expected here and is the point: it surfaces at the start of the
chunk, not the end.

**Child C — Plan-state read.** `plan_read` over the real register:
fetch at a ref through the GitHub App, parse to structured nodes (ID,
title, stage, hold markers, plan and specification document links,
parent/child edges), answer whole-tree or subtree queries, and report
the commit SHA and fetch time with every answer. Criteria: the parse
round-trips this repository's current `docs/plan-register.md` with
every node, stage and hold marker preserved; a subtree query returns
exactly that subtree; a malformed register line is a reported error
naming the line, never a silently dropped node; every response
carries its source SHA; the tool answers inside the configured
timeout; a session reads P2 nodes and their stages through it.
Independent of child B's deployment — verified locally, re-verified
against the deployment once it exists.

**Child D — Plan-state update, git-authoritative, with the advisory
lease.** `plan_lease_acquire` / `plan_update` / `plan_confirm` /
`plan_lease_release` as described above. Criteria: a legal
transition returns an exact edit that applies cleanly to the register
at the stated SHA; an illegal transition is refused with the reason;
an edit computed against a stale SHA is refused rather than applied;
`plan_confirm` with a SHA whose file does not carry the edit is a
reported divergence (the R10 detection, exercised deliberately); the
lease is held by one holder, expires by TTL, and a second acquirer is
refused while it is live; the resulting commit is
indistinguishable from what the v1 process would have produced; a
session moves a real node through a real stage transition end to
end. This child, with C, is what the gate demonstrates.

**Child E — Degrade to git-only, and enlistment documentation.**
The [R12](../open-risks.md) exercise plus the documents that make
enlistment repeatable. Criteria: with the endpoint unreachable, a
Claude Code session starts normally, its unrelated tool use is
unaffected, and it completes the same stage transition through the
v1 process; the session does not retry or wait on the server; the
documented fallback rule says so explicitly; the enlistment
documentation takes a repository from "not enlisted" to "enlisted"
in steps a session can follow; the exercise's outcome is recorded
against R12 in the Risk register.

**Parallelism.** Children C and D depend on A but not on B's
deployment; B's owner-action wait may overlap them. This
independence is stated here as a planning product so that parallel
dispatch is available at the gate's discretion
([dispatch](../process/dispatch.md)).

## Verification criteria for this node

Refined into checkable form by the
[specification](../specs/p2-n002-service-skeleton.md), which is
authoritative for verification; the list below is the plan-stage
statement it grew from. The specification also carries decisions
10–12, continuing this document's numbering.

The chunk is complete when:

1. `project-orchestrator-service` is an enrolled methodology project:
   Classification, Binding block, README, Backlog, and a clean
   `mtool` form audit and link check.
2. A deployed service answers MCP tool calls over HTTPS, authenticated,
   from a Claude Code session enlisted by a checked-in `.mcp.json` —
   on the local surface and on the web surface (decision 8 governs
   the web case if the platform blocks it).
3. A session reads this repository's real plan state through the
   service, with the source commit SHA in the answer.
4. A session moves a real node through a real stage transition
   through the service, and the resulting register commit is what
   the v1 process would have produced.
5. A deliberately induced service/git divergence is reported as an
   error (R10 detection exercised).
6. With the service unreachable, a session starts cleanly and
   completes the same transition by the v1 process; the R12 entry is
   updated with the result.
7. No secret appears in either repository's history; the enlistment
   file carries no token.
8. Both repositories' Backlogs and this repository's registers are
   current in the same commits as the work (W-003).
9. `node plugin/scripts/form_check.ts` passes clean in the
   coordinating repository. (Command renamed at P1-N009's cutover,
   node P1-N013, decision 14 — the Python it named was retired and
   ported to TypeScript/Node; nothing about this criterion's
   substance changed.)

Criterion 4 is the owner-facing gate; the rest are the conditions
that make it mean something.

## Monotonicity

No planned non-monotonicity is proposed. Every later chunk's addition
to this surface — the question queue, topics, the lease under real
contention, multi-project state — is additive to the tool set and to
the write model defined here. If chunk 4 finds the advisory lease
insufficient under real contention, tightening it changes the lease's
behavior but not the functional tests written here; should that turn
out to be wrong, it returns to the owner as W-002 rather than being
absorbed.

## Decisions for the gate

Numbered per [dispatch](../process/dispatch.md)'s owner-decision
economics; the owner's go-ahead adopts every default not overridden
by number. RU-006 (a separately deployable, secret-holding capability
gets its own repository, the originator coordinating) and RU-007
(C2 promotion at chunk 5) already decide the questions they cover and
are not re-raised.

1. **Service repository enrollment.** Default: Classification
   **C1 / S1 / backend-service / serverless-aws**, methodology
   v1.3.0, family `methodology` (member), with
   `project-orchestrator` named as coordinating repo in prose and
   the multi-repo declaration left to the Backlog item that already
   tracks it. Rationale: C1 matches the work's judgment load, S1 is
   forced by internet exposure and held secrets, and the family
   field is the only relationship v1.3.0 can express today.
2. **Registers of the service repository.** Default: it keeps its
   **own Backlog** (K-003 is per-project) and declares its **Plan
   register and Cost log by citation** to this repository's
   instances rather than creating second ones. Rationale: one plan
   hierarchy — a second register would be exactly the duplicated
   truth this plan's constraint 1 forbids.
3. **The write model.** Default: **sessions write git; the service
   validates transitions and never holds repository write
   credentials** (the three-step update above). Rationale: it keeps
   git literally authoritative, keeps the service's blast radius
   read-only, and makes the fallback free — while the service still
   owns whether a transition is legal.
4. **Scope of "plan state" in chunk 1.** Default: the **Plan
   register only** — nodes, stages, hold markers, document links —
   for **this repository only**. Backlog, Cost log, rulings and
   journal stay out, and multi-project state waits for chunk 5.
   Rationale: the gate asks for plan state; widening the write
   surface before the write model is proven multiplies the ways it
   can be wrong.
5. **Client authentication.** Default: a **bearer token supplied by
   environment expansion** in the checked-in `.mcp.json`, minted and
   held by the owner (O4); OAuth deferred to the Backlog and
   reconsidered immediately if environment expansion proves
   unusable on the web surface. Rationale: the smallest auth that
   deploys and keeps the secret out of git; OAuth is a chunk of work
   this chunk should not carry.
6. **How the service reads GitHub.** Default: a **GitHub App
   installation with `contents: read`**, its private key in the
   platform secret store (O3) — not a personal access token.
   Rationale: scoped, revocable, works whether the repositories are
   public or private, and it is the same mechanism any later write
   capability would need.
7. **The write lease in chunk 1.** Default: a **minimal advisory
   lease** — acquire, TTL expiry, release — with contention
   behavior under multiple live sessions deferred to chunk 4 as the
   parent plan places it. Rationale: the update contract is
   incoherent without a single writer, and the minimal form costs
   little; either way chunk 4's work is additive.
8. **If the web surface cannot reach the service.** Default: the
   parent plan's both-surface requirement **stands**; a blocked web
   surface becomes owner action O5 (allowlist or connector
   configuration), and only a platform-level impossibility converts
   the requirement into a recorded finding, a Backlog item, and a
   `blocked` escalation. Rationale: the requirement is
   owner-approved and the likely cause is configuration, not a wall;
   relaxing it pre-emptively would hide a real constraint.
9. **Implementation stack.** Default: **Python** with the official
   MCP SDK, on **AWS Lambda behind an HTTP API**, one **DynamoDB**
   table, defined in **AWS SAM**, deployed to the default endpoint
   URL with no custom domain. Rationale: Python matches the
   portfolio's existing tooling, and SAM is the least machinery
   between the owner and a one-command deploy; a custom domain buys
   nothing until the endpoint is shared.

## References

- [orchestration-service](orchestration-service.md) — the parent
  plan, whose chunk 1 this node is, and its five standing constraints
- [Risk register](../open-risks.md) — R10 (second source of truth),
  R11 (MCP surface constraints), R12 (outage stops work)
- [docs/process/](../process/README.md) — the v1 process this chunk
  is the fallback for and does not change
- [Ruling register](../rulings.md) — RU-006, RU-007

## Gate outcome, 2026-08-26

All twelve staged decisions settled at the P2-N002 gate. Eleven
adopted as defaulted; **decision 4 overridden by the owner**: the
service is **TypeScript/Node** (MCP SDK) on Lambda / HTTP API /
DynamoDB via SAM, not Python — TypeScript is common across current
portfolio projects, and matching this repo's Python helper scripts
was a weak reason across a repo boundary. Recorded as
[RU-008](../rulings.md), which also minted the `stack` ruling type.

The owner's fallback questions — how a session claims a task when the
service is unreachable (proposed: the task ID in the branch name,
first to create it wins), how a claim is released when a session dies,
and how the service reconciles when it returns — are recorded as
Backlog items and shape child E and chunk 4 rather than this
document.
