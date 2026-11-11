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
(majodali/methodology, at the version
[`docs/classification.md`](docs/classification.md) pins) in its own
right, but it is **not** a second plan hierarchy:

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
`scripts/deploy.sh`, [`docs/runbook.md`](docs/runbook.md)). Seven
tools, all over `orchestration/state.json` of the coordinating
repository, the state file (the rebuild plan there,
`docs/plans/rebuild.md`, milestone 3):

- `service_identity` — name, version, build commit, configured
  project, and the Lambda alias that answered.
- `plan_read` — the state file at a ref (default: the default
  branch): every node with its class, the open decisions and tasks,
  and the commit SHA; or one node in full with its tasks and
  decisions.
- `node_update`, `node_add`, `node_remove`, `task_open`, `task_close`,
  `decision_open`, `decision_close` — the writes. Each applies one change to the state
  read at the branch head, checks the result against the model's
  invariants and refuses a violation with nothing committed, renders
  `docs/plan-register.md` and `docs/plan.md` from the new state,
  appends one `state-written` event to `orchestration/journal.jsonl`,
  and makes one commit on the default branch through the GitHub App,
  with the head it read as the parent. The branch moving meanwhile
  is the concurrency check: the ref update is refused, the store
  reads again and retries once (`src/model/store.ts`,
  `src/planRegister/gitWriter.ts`, `src/stateTools.ts`). The service
  writes only those four paths; nothing else holds state, and there
  is no lease.
- `task_next`, `task_open`, `task_close` — the task loop (the rebuild
  plan, "The loop and the close-out"; `src/model/loop.ts`).
  `task_next(role?)` answers the first node in tree order that offers
  a step, with its documents at the commit, its ancestors, the tasks
  that ran on it and the decisions to read first; it closes tasks
  open past the time limit as stale first. `task_open` is the claim,
  one conditional commit, refused with the reason when the node does
  not offer the step. `task_close` records the result and runs the
  close-out: a closed step moves the node on (an executed node enters
  verifying with a hidden check node; a verified check node completes
  its parent and climbs), blocked and needs-judgment hold the node
  for the owner, each ask becomes an open decision on the node, and a
  scope that changed since the task opened closes it as
  needs-judgment. The answer's `stop` says when the session returns
  to the owner. Check nodes (`kind: "check"`) are hidden in the view
  and the plan unless they fail, are in flight or are selected, and
  count in no total.
- What the first real use changed (owner, 2026-11-11):
  - A session is told the protocol when it connects: the server's MCP
    `instructions` carry it (`SERVER_INSTRUCTIONS` in
    `src/stateTools.ts`).
  - A node is done only when its pull requests are merged, and the
    service merges them itself, so no merge waits on a person
    (`src/planRegister/pullRequests.ts`): a planning step's at its
    close, an execute step's when its verification closes, and on the
    owner's acceptance in the view. A pull request that cannot be
    merged (checks failing or running, a conflict, protection not
    satisfied) refuses the close with nothing committed. `task_close`
    with `branch` opens the pull request.
  - `node_remove` removes an obsolete node with its subtree, tasks and
    decisions; git keeps the history, and `highWater` in the state
    file keeps a removed identifier from being minted again.
  - A hold or a park on a node pauses everything below it: the class
    `paused`.
  - Every standing decision reaches a task, compact, wherever it
    arose (`standing` in the answer of `task_next` and `task_open`).
  - The view's header shows the check status of the commit it reads
    (`src/planRegister/commitChecks.ts`).

### HTTP routes

| Method and path                           | Auth                        | Answers                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                             | none                        | liveness, as JSON                                                                                                                                                                                                                                                                                                               |
| `ANY /mcp`                                | `Authorization: Bearer`     | the MCP endpoint and its ten tools                                                                                                                                                                                                                                                                                              |
| `GET /view/sign-in`                       | none                        | the web view's sign-in form                                                                                                                                                                                                                                                                                                     |
| `POST /view/sign-in`                      | the view token, in the form | `303` to `/view` with the view cookie, or `401`                                                                                                                                                                                                                                                                                 |
| `GET /view`                               | the view cookie             | the plan of the coordinating repository at one commit, from `orchestration/state.json`: every node in its tree with its class and outcome, what waits on the owner marked in context and unfolded, and the problems `check` reports; `?ref=` picks a branch, tag or SHA; `?open=` picks what is unfolded                        |
| `GET /view/node/<node ID>`                | the view cookie             | a node page: class and stage, outcome, position in the tree, what it waits on and what waits on it, documents at the SHA, decisions and tasks; `404` for an ID the state file lacks                                                                                                                                             |
| `GET /view/task/<task ID>`                | the view cookie             | a task page: the task's fields and notes from the state file; `404` for an ID it lacks                                                                                                                                                                                                                                          |
| `POST /view/decision/<decision ID>/close` | the view cookie             | the owner's answer to an open decision, from the form under it: one commit through the store, then `303` back to the page naming the commit; `400`, `404`, `409`, `422` or `502` with nothing committed when the answer is empty, the decision unknown or closed, the branch moved twice, the invariants refuse, or GitHub does |
| `POST /view/node/<node ID>/action`        | the view cookie             | one lifecycle action on a node, `approve-start`, `lift-hold` or `accept-review`, each a `node_update`: one commit, then `303` back to the node page naming the commit; the same refusals as above                                                                                                                               |

The `/view` routes are the web view: server-rendered HTML with no
script, for a desktop browser (the rebuild plan, decision 9). Since
the rebuild's milestone 2 every page reads one file,
`orchestration/state.json`, at one commit, through the GitHub App, and
renders the planning/execution model it holds (`src/model/`); the
Markdown registers are no longer read. Each page resolves its ref to
one commit SHA, names the ref, the SHA and the fetch time, and links
documents to GitHub's file view at that SHA. The view has its own
credential, the view token, which `/mcp` refuses, and the MCP bearer
token does not open `/view`. Only sign-in and the two write routes
accept `POST`; a `POST` the browser marks cross-site is refused, and
the cookie's `SameSite=Strict` keeps a cross-site request from
carrying it at all. See `src/view/` and `docs/runbook.md`, "The web
view".

Since the rebuild's milestone 4 the view also writes (`src/view/actions.ts`,
the write routes in `src/view/routes.ts`). An open decision carries
the form that closes it, on its node page, or on the tree page for a
project decision: the options as radio buttons with the default
preselected, another answer as free text, a one-line note, and the
standing flag. The lifecycle actions open on a node are one click
each on its page: approve a start that waits on the owner, lift a
hold, accept a review (the node is done with today's date). Each
goes through the same store as the tools, as the journal's session
"the owner, in the view", and the browser returns to the page, which
names the commit and says whether it already reads it. Nothing is
held outside git.

The tree page is the plan hierarchy, the primary view (owner,
2026-11-10): every node in its tree, read in the context of its parent
and siblings, each row a badge for its class (waiting on the owner,
blocked, in flight, in progress, waiting on a dependency, ready, done,
parked), its title, its identifier and its one-sentence outcome. What
needs attention shows in that context: a node waiting on the owner is
highlighted with its reason, every ancestor carries a flag counting
such nodes below it, and open decisions sit under their node. The
paths to those nodes are unfolded on load and everything else is
folded; `?open=active` also unfolds what is in flight, `?open=all`
everything, `?open=roots` nothing below the roots. A line of counts
opens the page. "Ready" is not a category: a ready node starts
automatically unless its `start` is `approve`, and then it waits on
the owner. A "Problems found" section at the bottom lists what
`plan-state check` reports for the file at that commit; a file that
fails the schema shows the problems and nothing else. Each page's
source line names the state file at the SHA as the progress truth
during the rebuild, under the deviation from K-003 recorded in the
coordinating repository's Classification.

A file above 1 MB, the contents endpoint's base64 limit, is read again
with the raw media type, in full; one above the endpoint's 100 MB
limit, or one whose raw read comes back short, is refused by name and
size (`src/planRegister/registerFetcher.ts`).

### The shared grammar unit, now this repository's own

`src/planRegister/vendored/` holds `plan-register.ts` (the Plan
register grammar and the stage vocabulary), `cost-log-and-journal.ts`
(the Cost log row and run-journal line grammar) and `project-model.ts`
(the Project model parser), with the conformance corpus they travel
with. Until the rebuild's milestone 1 these were vendored
byte-for-byte from the coordinating repository by a generator; the
generator is retired and these files are now owned and edited here.
The coordinating repository's plugin keeps its own copies for its form
checker until that checker is retired at milestone 6
(docs/plans/rebuild.md there). The directory keeps its name so that no
import moves; it stays excluded from this repository's ESLint and
Prettier configs so that the diff against the plugin's copies stays
readable while both exist.

### The state file and `plan-state`

`src/model/` is the planning/execution model of the rebuild
(majodali/project-orchestrator `docs/plans/rebuild.md`, "The data
model"): a `zod` schema (`schema.ts`) for one file per managed
project, `orchestration/state.json`, holding nodes, tasks and
decisions; the invariants over it (`check.ts`); the renderings of it
to `docs/plan-register.md` and `docs/plan.md` (`render.ts`); and a
one-time importer from the frozen Markdown registers
(`importState.ts`). The schema is the type's definition; the Markdown
files are renderings and are never hand-edited.

The command line, `plan-state`, is this package's `bin`:

```sh
plan-state check  --repo /path/to/managed/repo          # schema, invariants, documents exist, renderings current
plan-state render --repo /path/to/managed/repo --write  # rewrite docs/plan-register.md and docs/plan.md
plan-state import --repo /path/to/managed/repo --project owner/name \
  --accepted docs/plans/rebuild.md=2026-11-09 --overrides orchestration/import-overrides.json --write
```

A managed repository depends on this package by commit, through npm's
git support (`"project-orchestrator-service":
"github:majodali/project-orchestrator-service#<sha>"`), and runs
`plan-state check` in its CI. `npm install` of a git dependency runs
this package's `prepare` script, which builds `dist/`.

### Trying it locally

```
MCP_AUTH_TOKEN=dev-secret npm run dev
curl -i http://localhost:8787/health                                    # unauthenticated
curl -i -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer dev-secret' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"service_identity","arguments":{}}}'
```

#### Previewing the web view

The web view normally reads the coordinating repository through the
GitHub App. With `VIEW_FIXTURE_DIR` set, `npm run dev` reads that
directory instead: `orchestration/state.json` at its repository path.
A local checkout of the coordinating repository works. Every ref
resolves to one pretend SHA, or to `VIEW_FIXTURE_SHA` when set, so the
page header still carries a 40-character SHA. Sign-in is unchanged:
sign in with the local `VIEW_TOKEN`.

```
VIEW_TOKEN=local-preview npm run view:preview   # the 325c502 fixture, at http://localhost:8787/view
VIEW_TOKEN=local-preview VIEW_FIXTURE_DIR=../project-orchestrator npm run dev
npm run view:shots -- --iteration 4 --label after
```

`npm run view:preview` assembles the test fixture at commit 325c502
into the gitignored `.preview/` directory and serves it.
`npm run view:shots` starts that preview on a free port, signs in with
Playwright, and writes full-page PNGs of the tree page, the node page
for `P2-N021` and the task page for `T094` at 1440 by 900 to
`src/view/preview/shots/`, named `ux-<NN>-<label>-<page>-desktop.png`,
as 64-colour palette PNGs. That directory is committed, so each pull
request's body can show its before and after shots. Playwright is not
a dependency: Claude Code sessions have it installed; elsewhere,
`npm install --no-save playwright` and `npx playwright install
chromium` provide it. Lambda never reads `VIEW_FIXTURE_DIR`; only
`src/localServer.ts` does.

The `.mcp.json` shape a Claude Code session enlists with — including
where it goes and why it is not committed here or in the coordinating
repository by this task — is documented in
[`docs/mcp-enlistment.md`](docs/mcp-enlistment.md).

### Trying the write path locally

The write tools need the GitHub App; a plain `npm run dev` has no
`GITHUB_APP_*` variables set, so `plan_read` and the writes answer
with a clear tool error rather than a crash. Every automated test in
`test/` instead injects a `StateStore` over a fake repository through
`createApp`'s `state` option (`test/stateTools.test.ts` for the tool
contract and the store's conflict retry; `test/gitWriter.test.ts` for
the Git Data API sequence against a fake GitHub). There is no
production code path that uses the fake: a deployment gets
`src/planRegister/defaultFetcher.ts`'s reader and writer over the
App.

## Configuration and secrets

| Variable                     | Required             | Meaning                                                                                                                                                                                                       |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_AUTH_TOKEN`             | yes                  | The bearer token clients must present. No default — the server refuses every `/mcp` call with 500 if this is unset, rather than accepting all callers.                                                        |
| `VIEW_TOKEN`                 | yes, for `/view`     | The web view's token (owner action O-view-1). A real secret, resolved from Secrets Manager at deploy time. Every `/view` route answers 500 if it is unset or equal to `MCP_AUTH_TOKEN`; `/mcp` is unaffected. |
| `PORT`                       | no (local only)      | Port `npm run dev` listens on. Default `8787`.                                                                                                                                                                |
| `SERVICE_COMMIT`             | no                   | Reported by `service_identity`. Set by `scripts/deploy.sh` from `git rev-parse HEAD`; unset locally defaults to `"unknown"`.                                                                                  |
| `MCP_PROJECT`                | no                   | Reported by `service_identity`; also which `<owner>/<repo>` `plan_read` reads. Defaults to `majodali/project-orchestrator`.                                                                                   |
| `GITHUB_APP_ID`              | yes, for `plan_read` | The installed GitHub App's numeric ID (owner action O3). Not secret. `plan_read` fails with a clear tool error, not a crash, if unset.                                                                        |
| `GITHUB_APP_INSTALLATION_ID` | yes, for `plan_read` | The App's installation ID for `MCP_PROJECT` (owner action O3). Not secret.                                                                                                                                    |
| `GITHUB_APP_PRIVATE_KEY`     | yes, for `plan_read` | The App's PEM private key (owner action O3). A real secret — resolved from Secrets Manager at deploy time, see `template.yaml`.                                                                               |

`service_identity` alone (chunk 1 child B) needs none of the three
`GITHUB_APP_*` variables; a deployment made
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
