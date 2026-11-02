# Project model

Reader: RD-4 (a fresh agent session) in the methodology's [reader
catalog](https://github.com/majodali/methodology/blob/v1.6.0/docs/style.md#readers). It assumes the methodology at this project's
pinned version, 1.6.0 ([Classification](classification.md)), and the
[process specification](process/README.md).

This document is the instance of the [Project model
type](process/project-model.md). [Node](process/README.md#def-node)
P3-N006 (the thin end-to-end slice) built its first five entries. The
entries after the fifth were opened by transcribing [held
edges](process/project-model.md#def-held-edge), as decision 8 of the
plan of P3-N007 directed at the acceptance of that node's first
execute task (E1). Later entries were opened by transcribing the edges
a breakdown states, when the Orchestrator entered its children.
This document is not yet the populated instance. Node P3-N008 (the
instance over this repository) populates it.

## What this document does not claim

- No final grammar for these five entries. The type is declared: the
  [Classification](classification.md) lists this document as the
  instance of the [Project model type](process/project-model.md), its
  fifth custom definition. Node P3-N007 (the type declared, the
  arguments written, the K-003 amendment drafted) wrote both. The five
  slice entries predate the type's grammar. Node P3-N008 conforms them.
  The entries opened since follow the type's grammar.
- No progress authority. Under [K-003 (the Backlog is the single source
  of progress
  truth)](https://github.com/majodali/methodology/blob/v1.6.0/docs/rules/knowledge.md#k-003--the-backlog-is-the-single-source-of-progress-truth)
  as released at methodology 1.6.0, the [Backlog](backlog.md) is the
  referent for what is done and what is next. This is option (a) of
  decision 13 (whether this repository acts on the amended rule before
  its release) in the [specification of the comprehension
  model](specs/p3-n002-comprehension-model.md).
- No complete edge set. The five slice entries hold the edges that
  records of nodes done before P3-N006 state. The entries also hold the
  edges of P3-N006 to P3-N009 that three records state. The records are
  the [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  section *Edges stated at this breakdown*, and the *Dependencies*
  sections of the [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md) and the [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md). The
  entries also hold the children's edges that two breakdowns state:
  P2-N021 and P2-N022 in the [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), and
  P2-N017 to P2-N020 in the [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), each in its section *Edges
  stated at this breakdown*. Edges that other
  records state are still held. An item reading `not yet derived`
  marks a facet no record has filled yet. Each `state:` line reads what
  the edges the entries hold give.

## How an entry reads

An entry is a second-level heading holding the resource's slug. A
[resource](plans/p3-n002-comprehension-model.md#two-entities-one-edge-kind)
is an abstract part of the project that nodes create, modify or use. A
slug is its stable name.

The [entry grammar](process/project-model.md#the-entry-grammar) of the
type is authoritative. This section describes the slice's reading of
it.

An entry carries five facets as labelled lines. A facet is one of the
five questions the entry answers:

- `is:` names what the resource is.
- `state:` names what state it is in.
- `spec:` names the specification it must meet.
- `risks:` names the risks attached to it.
- `created-by:`, `modified-by:` and `used-by:` name what it depends on
  and what depends on it.

A line may hold several items, separated by ` · `. Each item ends with a
parenthetical that names its source documents after the word `from`. A
facet with nothing to state reads `none` and links the document where a
verifier confirms the absence. A node is written with its identifier and
a shortened name from the [Plan register](plan-register.md). A `state:`
line may carry a second item, the status the resource has in another
register. An optional **formerly:** line names a predecessor of the
resource.

The entry's reasoning is not here. The [slice
record](project-model-slice-record.md) holds it.

## form-checker

- **is:** The tool that enforces the Plan register grammar and the
  cross-register invariants. The Orchestrator runs it before every
  dispatch and at every acceptance. The entry point is
  `plugin/scripts/form_check.ts`. The checks are in
  `plugin/scripts/lib/form-check-core.ts`. It imports the grammar from
  [plan-register-grammar](#plan-register-grammar) (from
  [form_check.ts](../plugin/scripts/form_check.ts); [Backlog, entry for
  P1-N012](backlog.md); [Risk register](open-risks.md), R13 (the
  tooling's runtime assumption moves from python3 to node))
- **state:** built, changing (derived from the stages of the nodes on
  the created-by and modified-by lines: the creating nodes done, P3-N007
  done, P3-N009 identified, P2-N021 executing; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** [Plugin tooling on the portfolio stack,
  specification](specs/p1-n009-plugin-tooling-portfolio-stack.md) (node
  specification, closed; from [Backlog, entry for P1-N009](backlog.md))
  · [Auditing](process/auditing.md) (process specification; from
  [form_check.ts](../plugin/scripts/form_check.ts))
- **risks:** [R13](open-risks.md) (the tooling's runtime assumption
  moves from python3 to node; from [Risk register](open-risks.md))
- **created-by:** P1-N005 (Plugin v1 with self-hosted trial; created the
  Python form; from [Backlog, entry for P1-N005](backlog.md)) · P1-N012
  (The form checker on the shared unit; created the TypeScript form;
  from [Backlog, entry for P1-N012](backlog.md))
- **modified-by:** P1-N013 (The cutover; deleted the Python form and
  corrected the provenance comments in both TypeScript files; from
  [Backlog, entry for P1-N013](backlog.md)) · P3-N007 (The type
  declared, the K-003 amendment drafted; from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown; [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) · P3-N009 (Sibling ordering retired; from [specification
  of P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at
  this breakdown) ·
  P2-N021 (The web view's first version; task E2 (T095) moved the Cost
  log and journal parsing out of the core into the shared unit; recorded
  at T095's result, before its acceptance, because the specification
  already stated the edge; from
  [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown; [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), The model
  parser and shared parsing, under RU-012; [Backlog, entry for
  P2-N021](backlog.md))
- **used-by:** P1-N008 (mtool checker extension-point proposal; its
  criterion E5 (checks clean) requires the checker to pass; from
  [specification of
  P1-N008](specs/p1-n008-mtool-checker-extension-point.md)) · P1-N010
  (Node toolchain and the shared register grammar; ran the checker at
  every commit; from [Backlog, entry for P1-N010](backlog.md)) · P1-N011
  (The travelling package; ran the checker at every commit; from
  [Backlog, entry for P1-N011](backlog.md)) · P1-N014 (Role contracts
  adopt the methodology's conduct rules; its criterion G2 (the checker
  reports no violations) requires the checker to pass; from
  [specification of
  P1-N014](specs/p1-n014-role-contracts-adopt-conduct-rules.md)) ·
  P1-N015 (Methodology amendments for delegated, multi-agent work; its
  criterion G7 (checks clean) requires the checker to pass; from
  [specification of
  P1-N015](specs/p1-n015-methodology-amendments-delegated-work.md)) ·
  P2-N002 (Service skeleton and plan state; its criterion P2 (this
  repository is clean) requires the checker to pass; from [specification
  of P2-N002](specs/p2-n002-service-skeleton.md)) · P2-N009 (Plan-state
  read; compared the service's parser with the Python form on the live
  register; from [Backlog, entry for P2-N009](backlog.md)) · P2-N012
  (Deploy the service from CI on merge; its criterion P3 (this
  repository is clean) requires the checker to pass; from [specification
  of P2-N012](specs/p2-n012-deploy-from-ci-on-merge.md)) · P3-N006 (The
  thin end-to-end slice; its criterion A9 runs the checker; from [plan
  of P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies) ·
  P3-N007 (The type declared, the K-003 amendment drafted; its criterion
  B17 runs the checker; from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **formerly:** `plugin/scripts/form_check.py`, the Python form, retired
  at P1-N013 (The cutover) (from [Backlog, entry for
  P1-N013](backlog.md))

## plan-register-grammar

- **is:** The one canonical implementation of the Plan register grammar
  and the node lifecycle stage vocabulary, in
  `plugin/scripts/lib/plan-register.ts`. It is one file with no imports
  and no input or output. It reports parse-level facts and carries no
  policy. The service repository holds a vendored copy (from
  [plan-register.ts](../plugin/scripts/lib/plan-register.ts); [Backlog,
  entry for P1-N010](backlog.md))
- **state:** built (derived from the stages of the nodes on the
  created-by and modified-by lines, all done; from [Plan
  register](plan-register.md))
- **spec:** [Plugin tooling on the portfolio stack,
  specification](specs/p1-n009-plugin-tooling-portfolio-stack.md) (node
  specification, closed; from
  [plan-register.ts](../plugin/scripts/lib/plan-register.ts)) · [Plan
  register type](process/plan-register.md) (process specification, the
  grammar; from
  [plan-register.ts](../plugin/scripts/lib/plan-register.ts)) · [Plan
  model](process/plan-model.md) (process specification, the stage
  vocabulary; from
  [plan-register.ts](../plugin/scripts/lib/plan-register.ts))
- **risks:** none (the [Risk register](open-risks.md) has no entry that
  names the grammar as at risk; from [Risk register](open-risks.md))
- **created-by:** P1-N010 (Node toolchain and the shared register
  grammar; from [Backlog, entry for P1-N010](backlog.md))
- **modified-by:** P1-N013 (The cutover; corrected the provenance
  comment that named the Python checker as current; from [Backlog, entry
  for P1-N013](backlog.md))
- **used-by:** P1-N011 (The travelling package; the vendoring generator
  carries the file and the corpus runs on it; from [Backlog, entry for
  P1-N011](backlog.md)) · P1-N012 (The form checker on the shared unit;
  imports `parseRegister` and `STAGES`; from [Backlog, entry for
  P1-N012](backlog.md)) · P2-N010 (Plan-state update; the service
  repository adopted the grammar by vendoring; from [Backlog, entry for
  the service-side adoption](backlog.md)) · the repository
  majodali/project-orchestrator-service (outside the Plan register: a
  consuming repository; it holds a vendored copy in
  `src/planRegister/vendored/`, kept in step by
  `plugin/scripts/sync_shared_unit.ts --check`; from [Backlog, entry for
  the service-side adoption](backlog.md); [RU-012 (how two repositories
  share one unit of code)](rulings.md)) ·
  P2-N021 (The web view's first version; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **formerly:** the service repository's `src/planRegister/parser.ts`
  and `types.ts`, merged and adapted into this file at P1-N010 (from
  [Backlog, entry for P1-N010](backlog.md);
  [plan-register.ts](../plugin/scripts/lib/plan-register.ts))

## run-journal

- **is:** The append-only feed of orchestration operation, one JSON
  event per line, in `orchestration/journal.jsonl`. It is telemetry and
  never authoritative. The Orchestrator writes it inside the acceptance,
  stage-change and gate commits it already makes (from
  [Observability](process/observability.md))
- **state:** built (derived from the stages of the nodes on the
  created-by and modified-by lines, all done; from [Plan
  register](plan-register.md))
- **spec:** [Observability](process/observability.md) (process
  specification) (from [Classification](classification.md), the Run
  journal definition)
- **risks:** none (the [Risk register](open-risks.md) has no entry that
  names the journal as at risk; from [Risk register](open-risks.md))
- **created-by:** P1-N005 (Plugin v1 with self-hosted trial; began the
  journal at enrollment; from [Backlog, entry for P1-N005](backlog.md))
- **modified-by:** none (appending events is the Orchestrator's standing
  act, not a node's work; a verifier confirms it in
  [Observability](process/observability.md), the write and read rules;
  from [Observability](process/observability.md))
- **used-by:** P1-N010 (Node toolchain and the shared register grammar;
  the `journal_tail` port reads the journal; from [Backlog, entry for
  P1-N010](backlog.md)) · P1-N012 (The form checker on the shared unit;
  the checker parses the journal and cross-checks it against the Plan
  register and the Cost log; from [Backlog, entry for
  P1-N012](backlog.md)) ·
  P2-N021 (The web view's first version; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## RU-016 (repository reach)


- **is:** The ruling (RU-016, who decides which repositories a node's
  work may write to) that the Planner declares the repository access a
  node needs, in the node's plan. The Orchestrator grants it and records
  the grant. The owner is asked only when a repository is new to the
  project. The approved scope permanently includes
  majodali/project-orchestrator-service (from [Ruling
  register](rulings.md))
- **state:** built (derived from the stage of the node on the created-by
  line, done; from [Plan register](plan-register.md)) · own status
  active (from [Ruling register](rulings.md))
- **spec:** [Ruling register type](process/rulings.md) (process
  specification, the entry shape and the lifecycle of a ruling) (from
  [Classification](classification.md), the Ruling register definition)
- **risks:** none (the [Risk register](open-risks.md) has no entry that
  names the ruling; from [Risk register](open-risks.md))
- **created-by:** P2-N012 (Deploy the service from CI on merge; at its
  gate on 2026-09-01, by the owner's decision and not by a task's work;
  from [Ruling register](rulings.md), the Source field of RU-016)
- **modified-by:** none (a ruling is append-only: it is superseded,
  never edited; a verifier confirms it in [Ruling register
  type](process/rulings.md), the entry shape; from [Ruling register
  type](process/rulings.md))
- **used-by:** P3-N001 (Project comprehension and continuous
  implementation; task T039 (the specify task of P3-N001) applied it;
  from [Ruling register](rulings.md), the Applied field of RU-016; [Cost
  log](cost-log.md), the row of T039) · P3-N002 (The comprehension
  model; task T043 (the specify task of P3-N002) applied it; from
  [Ruling register](rulings.md), the Applied field of RU-016; [Cost
  log](cost-log.md), the row of T043) · P3-N006 (The thin end-to-end
  slice; from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown; [plan of P3-N006](plans/p3-n006-thin-end-to-end-slice.md),
  Dependencies) · P3-N007 (The type declared, the K-003 amendment
  drafted; from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) ·
  P2-N021 (The web view's first version; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## project-orchestrator-repo

- **is:** This repository, majodali/project-orchestrator, the
  coordinating repository of the orchestration project. It holds the
  process specification, the registers, the plugin and the role
  contracts. It is classified C1 / S0 / component/library (from
  [README](../README.md); [Classification](classification.md))
- **state:** built (derived from the stage of P1-N002, done, on the
  created-by line; the modifying nodes of a standing resource are not
  counted; from [Plan register](plan-register.md); [Project model
  type](process/project-model.md), State derivation) · standing (a
  repository; from [Project model type](process/project-model.md),
  Standing resources)
- **spec:** [Classification](classification.md) (the binding declaration
  the repository must match; from [Classification](classification.md)) ·
  [Process specification](process/README.md) (process specification;
  from [README](../README.md))
- **risks:** none (the [Risk register](open-risks.md) has no entry that
  names the repository as at risk; from [Risk register](open-risks.md))
- **created-by:** P1-N002 (Bootstrap and founding plan; from [Backlog,
  entry for the bootstrap](backlog.md))
- **modified-by:** P1-N005 (Plugin v1 with self-hosted trial; enrolled
  the repository for orchestration; from [Backlog, entry for
  P1-N005](backlog.md)) · P1-N009 (Plugin tooling on the portfolio
  stack; its plan scopes the node to this repository only; from [plan of
  P1-N009](plans/p1-n009-plugin-tooling-portfolio-stack.md), the section
  Scope: this repository only) · P1-N014 (Role contracts adopt the
  methodology's conduct rules; changed `docs/process/` and the six role
  contracts; from [Backlog, entry for P1-N014](backlog.md)) · P3-N006
  (The thin end-to-end slice; its repository reach, write; from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies) ·
  P3-N007 (The type declared, the K-003 amendment drafted; its
  repository reach, write; from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) · P2-N021 (The web view's first version; its
  repository reach, write; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown) · P2-N017 (The platform facts, verified; its
  probe branches and the finding; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown) · P2-N018 (The loop in git alone; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown) · no record before RU-016 (2026-09-01) names the
  repository a node wrote, so this list is partial (from [Ruling
  register](rulings.md), RU-016 (repository reach))
- **used-by:** P2-N009 (Plan-state read; reads this repository's Plan
  register at a pinned commit; from [plan of
  P2-N002](plans/p2-n002-service-skeleton.md), decision 4 (the scope of
  plan state in chunk 1); [Backlog, entry for P2-N009](backlog.md)) ·
  P2-N010 (Plan-state update; its edits are committed here; from [plan
  of P2-N002](plans/p2-n002-service-skeleton.md), decision 4 (the scope
  of plan state in chunk 1); [Backlog, entry for P2-N010](backlog.md))

## project-model

- **is:** The instance, `docs/project-model.md` (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown, the slugs used; [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **state:** built (derived from the created-by line, where P3-N006 is
  done, and the modified-by line, where P3-N007 is done and P3-N008
  planned; from [Plan register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** P3-N006 (The thin end-to-end slice; the instance; from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown; [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **modified-by:** P3-N007 (The type declared, the K-003 amendment
  drafted; its header bullet on the type; from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) · P3-N008 (The instance, over this repository; from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown)
- **used-by:** P3-N007 (The type declared, the K-003 amendment drafted;
  at commit 86a1330; from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown; [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) · P3-N009 after P3-N008 (Sibling ordering retired; the
  after qualifier is the meaning the parent states; from [specification
  of P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at
  this breakdown; [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md), decision
  8) ·
  P2-N021 (The web view's first version; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## project-model-type

- **is:** The type spec, `docs/process/project-model.md` (from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown, the slugs used; [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **state:** built (derived from the created-by line, where P3-N007 is
  done; the modified-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** P3-N007 (The type declared, the K-003 amendment
  drafted; the type spec; from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown; [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **modified-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **used-by:** P3-N008 (The instance, over this repository; from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown) · P3-N009 (Sibling ordering retired;
  from [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown) ·
  P2-N021 (The web view's first version; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## k-003-amendment

- **is:** The proposal under `docs/proposals/`, with its IR and its
  review record (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown, the slugs used; [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **state:** built (derived from the created-by line, where P3-N007 is
  done; the modified-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** P3-N007 (The type declared, the K-003 amendment
  drafted; the proposal, its IR and its review record; from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown; [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **modified-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **used-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)

## classification

- **is:** The Classification, `docs/classification.md` (from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown, the slugs used)
- **state:** built (derived from the modified-by line, where P3-N007 is
  done; the created-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **modified-by:** P3-N007 (The type declared, the K-003 amendment
  drafted; from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown; [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **used-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)

## observability-vocabulary

- **is:** The observability process document,
  `docs/process/observability.md` (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown, the slugs used)
- **state:** built (derived from the modified-by line, where P3-N007 is
  done and P2-N018 is identified; the created-by line reads not yet
  derived; from [Plan register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **modified-by:** P3-N007 (The type declared, the K-003 amendment
  drafted; from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown; [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) ·
  P2-N018 (The loop in git alone; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **used-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)

## dispatch-rules

- **is:** The dispatch process document, `docs/process/dispatch.md`
  (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown, the slugs used)
- **state:** built (derived from the modified-by line, where P3-N007 is
  done and P3-N009 and P2-N018 are identified; the created-by line reads
  not yet derived; from [Plan register](plan-register.md); [Project
  model type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **modified-by:** P3-N007 (The type declared, the K-003 amendment
  drafted; its handoff contract only, criterion B4; from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) · P3-N009 (Sibling ordering retired; from [specification
  of P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at
  this breakdown) ·
  P2-N018 (The loop in git alone; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **used-by:** P2-N018 after P3-N014 (The loop in git alone; the after
  qualifier is the record's; no record yet states P3-N014's modifies
  edge on this resource, a Backlog entry holds it; from [specification
  of P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)

## plan-model-spec

- **is:** The plan model process document, `docs/process/plan-model.md`
  (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown, the slugs used)
- **state:** built (derived from the modified-by line, where P3-N007 is
  done and P3-N009 identified; the created-by line reads not yet
  derived; from [Plan register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **modified-by:** P3-N007 (The type declared, the K-003 amendment
  drafted; criterion B5; from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) · P3-N009 (Sibling ordering retired; from [specification
  of P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at
  this breakdown)
- **used-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)

## plan-register-type

- **is:** The Plan register type spec, `docs/process/plan-register.md`
  (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown, the slugs used)
- **state:** built (derived from the modified-by line, where P3-N009 is
  identified; the created-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **modified-by:** P3-N009 (Sibling ordering retired; from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown)
- **used-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)

## plan-register

- **is:** The Plan register, `docs/plan-register.md` (from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown, the slugs used)
- **state:** built (derived from the modified-by line, where P3-N009 is
  identified; the created-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **modified-by:** P3-N009 (Sibling ordering retired; from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown)
- **used-by:** P3-N006 (The thin end-to-end slice; a document the slice
  derives from; from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies) ·
  P3-N007 (The type declared, the K-003 amendment drafted; read for the
  count of criterion B10; from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) · P3-N008 (The instance, over this repository; from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown) ·
  P2-N021 (The web view's first version; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## backlog

- **is:** The Backlog, `docs/backlog.md` (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown, the slugs used)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the modifying nodes of a standing resource are
  not counted; the created-by line reads not yet derived; from [Project
  model type](process/project-model.md), State derivation) · standing (a
  register that a methodology rule makes every node change, the Backlog
  under K-003 (the Backlog is the single source of progress truth) and
  W-003 (documentation moves in the same commit as the work); from
  [Project model type](process/project-model.md), Standing resources)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **modified-by:** P3-N006 (The thin end-to-end slice; its header line
  and its own entry; from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown; [plan of P3-N006](plans/p3-n006-thin-end-to-end-slice.md),
  Dependencies) · P3-N007 (The type declared, the K-003 amendment
  drafted; from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown; [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) · P3-N008 (The instance, over this repository; from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown) · P3-N009 (Sibling ordering retired;
  from [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown) ·
  P2-N021 (The web view's first version; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown) ·
  P2-N017 (The platform facts, verified; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown) ·
  P2-N018 (The loop in git alone; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **used-by:** P3-N006 (The thin end-to-end slice; a document the slice
  derives from; from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies) ·
  P3-N007 (The type declared, the K-003 amendment drafted; read for the
  count of criterion B10; from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) · P3-N008 (The instance, over this repository; from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown)

## RU-015 (upstream delivery form)

- **is:** A ruling (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown, the slugs used)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the created-by and modified-by lines read not
  yet derived; from [Project model type](process/project-model.md),
  State derivation)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **modified-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **used-by:** P3-N007 (The type declared, the K-003 amendment drafted;
  from [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown; [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)

## RU-018 (a child is not queued behind a sibling it does not depend on)

- **is:** A ruling (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown, the slugs used)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the created-by and modified-by lines read not
  yet derived; from [Project model type](process/project-model.md),
  State derivation)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **modified-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **used-by:** P3-N009 (Sibling ordering retired; from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)

## RU-021 (the source of progress truth)

- **is:** A ruling (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown, the slugs used)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the created-by and modified-by lines read not
  yet derived; from [Project model type](process/project-model.md),
  State derivation)
- **spec:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **created-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **modified-by:** not yet derived (from [specification of
  P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at this
  breakdown)
- **used-by:** P3-N006 (The thin end-to-end slice; from [specification
  of P3-N002](specs/p3-n002-comprehension-model.md), Edges stated at
  this breakdown; [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies) ·
  P3-N007 (The type declared, the K-003 amendment drafted; from
  [specification of P3-N002](specs/p3-n002-comprehension-model.md),
  Edges stated at this breakdown; [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) ·
  P2-N021 (The web view's first version; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## project-model-slice-record

- **is:** The record of the slice, `docs/project-model-slice-record.md`
  (from [plan of P3-N006](plans/p3-n006-thin-end-to-end-slice.md),
  Dependencies; [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), The slice record)
- **state:** built (derived from the created-by line, where P3-N006 is
  done; the modified-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **risks:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **created-by:** P3-N006 (The thin end-to-end slice; the record; from
  [plan of P3-N006](plans/p3-n006-thin-end-to-end-slice.md),
  Dependencies)
- **modified-by:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **used-by:** P3-N007 (The type declared, the K-003 amendment drafted;
  at commit 86a1330; from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)

## p1-n009-specification

- **is:** The specification of P1-N009 (Plugin tooling on the portfolio
  stack), `docs/specs/p1-n009-plugin-tooling-portfolio-stack.md` (from
  [plan of P3-N006](plans/p3-n006-thin-end-to-end-slice.md),
  Dependencies)
- **state:** built (derived from the modified-by line, where P3-N006 is
  done; the created-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **risks:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **created-by:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **modified-by:** P3-N006 (The thin end-to-end slice; the
  specification's header; from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **used-by:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)

## risk-register

- **is:** The Risk register, `docs/open-risks.md` (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the created-by and modified-by lines read not
  yet derived; from [Project model type](process/project-model.md),
  State derivation)
- **spec:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **risks:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **created-by:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **modified-by:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **used-by:** P3-N006 (The thin end-to-end slice; a document the slice
  derives from; from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)

## ruling-register

- **is:** The Ruling register, `docs/rulings.md` (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the created-by and modified-by lines read not
  yet derived; from [Project model type](process/project-model.md),
  State derivation)
- **spec:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **risks:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **created-by:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **modified-by:** not yet derived (from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)
- **used-by:** P3-N006 (The thin end-to-end slice; a document the slice
  derives from; from [plan of
  P3-N006](plans/p3-n006-thin-end-to-end-slice.md), Dependencies)

## ruling-register-type

- **is:** The Ruling register type spec, `docs/process/rulings.md` (from
  [plan of P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **state:** built (derived from the modified-by line, where P3-N007 is
  done; the created-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **risks:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **created-by:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **modified-by:** P3-N007 (The type declared, the K-003 amendment
  drafted; criterion B7; from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **used-by:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)

## role-contracts

- **is:** The role contracts, `.claude/agents/` and `plugin/agents/`
  (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **state:** built (derived from the modified-by line, where P3-N007 is
  done and P2-N018 is identified; the created-by line reads not yet
  derived; from [Plan register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **risks:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **created-by:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **modified-by:** P3-N007 (The type declared, the K-003 amendment
  drafted; criterion B4; from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies) ·
  P2-N018 (The loop in git alone; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **used-by:** P2-N018 after P3-N014 (The loop in git alone; the after
  qualifier is the record's; no record yet states P3-N014's modifies
  edge on this resource, a Backlog entry holds it; from [specification
  of P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)

## RU-002 (upstream output is hand-carried)

- **is:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the created-by and modified-by lines read not
  yet derived; from [Project model type](process/project-model.md),
  State derivation)
- **spec:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **risks:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **created-by:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **modified-by:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **used-by:** P3-N007 (The type declared, the K-003 amendment drafted;
  from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)

## RU-003 (a node completes at the artifact)

- **is:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the created-by and modified-by lines read not
  yet derived; from [Project model type](process/project-model.md),
  State derivation)
- **spec:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **risks:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **created-by:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **modified-by:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **used-by:** P3-N007 (The type declared, the K-003 amendment drafted;
  from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)

## RU-005 (proposal-class nodes gate at verifying)

- **is:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the created-by and modified-by lines read not
  yet derived; from [Project model type](process/project-model.md),
  State derivation)
- **spec:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **risks:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **created-by:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **modified-by:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **used-by:** P3-N007 (The type declared, the K-003 amendment drafted;
  from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)

## RU-022 (corpus-bound documents are written IR first)

- **is:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the created-by and modified-by lines read not
  yet derived; from [Project model type](process/project-model.md),
  State derivation)
- **spec:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **risks:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **created-by:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **modified-by:** not yet derived (from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)
- **used-by:** P3-N007 (The type declared, the K-003 amendment drafted;
  from [plan of
  P3-N007](plans/p3-n007-type-declared-amendment-drafted.md),
  Dependencies)

## web-view

- **is:** The service's `/view` routes, their pages and sign-in, in
  majodali/project-orchestrator-service (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **state:** building (derived from the created-by line, where P2-N021
  is executing; the modified-by line, where P2-N022 is identified, does
  not change the value; from [Plan register](plan-register.md); [Project
  model type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **risks:** [R18](open-risks.md) (the view cookie, a standing read
  credential for the whole plan; from [Risk register](open-risks.md))
- **created-by:** P2-N021 (The web view's first version; task E1 (T094)
  built the sign-in routes and the tree page in
  majodali/project-orchestrator-service commit bf8f1b5, its pull request
  not yet merged; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown; [Backlog, entry for P2-N021](backlog.md))
- **modified-by:** P2-N022 (The owner question queue; its answering
  action; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **used-by:** P2-N022 (The owner question queue; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## project-model-parser

- **is:** The parser of the Project model instance, under
  `plugin/scripts/lib/`, vendored to the service (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **state:** building (derived from the created-by line, where P2-N021
  is executing; the modified-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **risks:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **created-by:** P2-N021 (The web view's first version; under decision
  7 the edge becomes a uses edge if P3-N009 has written the parser when
  task E3 starts; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **modified-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **used-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## project-orchestrator-service-repo

- **is:** The repository majodali/project-orchestrator-service, a
  standing resource (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the modifying nodes of a standing resource are
  not counted; the created-by line reads not yet derived; from [Project
  model type](process/project-model.md), State derivation) · standing (a
  repository; from [Project model type](process/project-model.md),
  Standing resources)
- **spec:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **risks:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **created-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **modified-by:** P2-N021 (The web view's first version; its repository
  reach, write; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown; [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Child 1's
  repository reach) ·
  P2-N019 (Role-aware identity; its repository reach, write; from
  [specification of P2-N005](specs/p2-n005-task-pull-loop.md), Edges
  stated at this breakdown) ·
  P2-N020 (The task tools; its repository reach, write; from
  [specification of P2-N005](specs/p2-n005-task-pull-loop.md), Edges
  stated at this breakdown)
- **used-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## vendoring-generator

- **is:** The shared-unit generator,
  `plugin/scripts/sync_shared_unit.ts` (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **state:** built, changing (derived from the modified-by line, where
  P2-N021 is executing; the created-by line reads not yet derived; from
  [Plan register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **risks:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **created-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **modified-by:** P2-N021 (The web view's first version; its travelling
  set; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **used-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## cost-log

- **is:** The Cost log, `docs/cost-log.md` (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the created-by and modified-by lines read not
  yet derived; from [Project model type](process/project-model.md),
  State derivation)
- **spec:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **risks:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **created-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **modified-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **used-by:** P2-N021 (The web view's first version; from
  [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## RU-012 (how two repositories share one unit of code)

- **is:** A ruling: how two repositories share one unit of code (from
  [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; the created-by and modified-by lines read not
  yet derived; from [Project model type](process/project-model.md),
  State derivation)
- **spec:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **risks:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **created-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **modified-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **used-by:** P2-N021 (The web view's first version; from
  [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## owner-question-queue

- **is:** The queue of owner questions and answers in the service, and
  its answering action in the web view (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **state:** planned (derived from the created-by line, where P2-N022 is
  identified; the modified-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **risks:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **created-by:** P2-N022 (The owner question queue; from [specification
  of P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges
  stated at this breakdown)
- **modified-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **used-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## task-tools

- **is:** The five task tools P2-N005 creates, in the service's `src/`
  (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown; [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **state:** planned (derived from the created-by line, where P2-N020 is
  identified; the modified-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **risks:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **created-by:** P2-N020 (The task tools; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **modified-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **used-by:** P2-N022 (The owner question queue; the record writes the
  slug `task-pull-loop` and directs the slug of P2-N005's specification;
  from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)
- **alias:** `task-pull-loop` (2026-10-30; the slug the specification of
  P2-N003 wrote for this resource; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown)

## p2-n005-platform-facts

- **is:** The finding, `docs/findings/p2-n005-platform-facts.md` (from
  [specification of P2-N005](specs/p2-n005-task-pull-loop.md), Edges
  stated at this breakdown)
- **state:** planned (derived from the created-by line, where P2-N017 is
  identified; the modified-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **created-by:** P2-N017 (The platform facts, verified; from
  [specification of P2-N005](specs/p2-n005-task-pull-loop.md), Edges
  stated at this breakdown)
- **modified-by:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **used-by:** P2-N018 (The loop in git alone; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown) · P2-N019 (Role-aware identity; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown) · P2-N020 (The task tools; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)

## pull-run-protocol

- **is:** The *Pull runs* section of `docs/process/dispatch.md`: the
  forms and the steps (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **state:** planned (derived from the created-by line, where P2-N018 is
  identified; the modified-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **created-by:** P2-N018 (The loop in git alone; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **modified-by:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **used-by:** P2-N020 (The task tools; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)

## enlistment-spec

- **is:** The enlistment process document, `docs/process/enlistment.md`
  (from [specification of P2-N005](specs/p2-n005-task-pull-loop.md),
  Edges stated at this breakdown)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; P2-N018 on the modified-by line is identified;
  the created-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **created-by:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **modified-by:** P2-N018 (The loop in git alone; from [specification
  of P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **used-by:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)

## roles-spec

- **is:** The roles process document, `docs/process/roles.md` (from
  [specification of P2-N005](specs/p2-n005-task-pull-loop.md), Edges
  stated at this breakdown)
- **state:** built (derived by row 4 of the table: no creating or
  counted modifying node; P2-N018 on the modified-by line is identified;
  the created-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **created-by:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **modified-by:** P2-N018 (The loop in git alone; from [specification
  of P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **used-by:** P2-N019 (Role-aware identity; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)

## session-handle

- **is:** `session_register`, the handle store and the lease's role
  check, in the service's `src/` (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **state:** planned (derived from the created-by line, where P2-N019 is
  identified; the modified-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **risks:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **created-by:** P2-N019 (Role-aware identity; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **modified-by:** not yet derived (from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)
- **used-by:** P2-N020 (The task tools; from [specification of
  P2-N005](specs/p2-n005-task-pull-loop.md), Edges stated at this
  breakdown)

## cost-log-and-journal-grammar

- **is:** The shared unit that parses Cost log rows and run journal
  lines, `plugin/scripts/lib/cost-log-and-journal.ts`, imported by the
  form checker's core and vendored to the service (from [specification
  of P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges
  stated at this breakdown; [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), The model
  parser and shared parsing, under RU-012; [Backlog, entry for
  P2-N021](backlog.md))
- **state:** building (derived from the created-by line, where P2-N021
  is executing; the modified-by line reads not yet derived; from [Plan
  register](plan-register.md); [Project model
  type](process/project-model.md), State derivation)
- **spec:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown; [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), The model
  parser and shared parsing, under RU-012; [Backlog, entry for
  P2-N021](backlog.md))
- **risks:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown; [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), The model
  parser and shared parsing, under RU-012; [Backlog, entry for
  P2-N021](backlog.md))
- **created-by:** P2-N021 (The web view's first version; task E2 (T095),
  majodali/project-orchestrator commit 3259736, its pull request not yet
  merged; recorded at T095's result, before its acceptance, because the
  specification already stated the edge; from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown; [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), The model
  parser and shared parsing, under RU-012; [Backlog, entry for
  P2-N021](backlog.md))
- **modified-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown; [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), The model
  parser and shared parsing, under RU-012; [Backlog, entry for
  P2-N021](backlog.md))
- **used-by:** not yet derived (from [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), Edges stated
  at this breakdown; [specification of
  P2-N003](specs/p2-n003-owner-questions-and-plan-view.md), The model
  parser and shared parsing, under RU-012; [Backlog, entry for
  P2-N021](backlog.md))
