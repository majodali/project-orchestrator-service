# Plan register

Instance of the *Plan register* type, defined by citation in the
[Classification](classification.md)
([type spec](process/plan-register.md)). Single writer: the
Orchestrator role. Sibling order is dependency order; node IDs are
stable forever. Stages predating enrollment reflect current state
honestly; chunks 1–3 completed before this register existed.

- P1-N001 [broken-down] Orchestrator v1 — plan: plans/orchestrator-v1.md
  - P1-N002 [done] Bootstrap and founding plan (chunk 1)
  - P1-N003 [done] Process specification v1 (chunk 2)
  - P1-N004 [done] Role definitions v1 (chunk 3)
  - P1-N005 [done] Plugin v1 with self-hosted trial (chunk 4)
  - P1-N008 [done] mtool checker extension-point proposal — plan: plans/p1-n008-mtool-checker-extension-point.md · spec: specs/p1-n008-mtool-checker-extension-point.md
  - P1-N009 [done] Plugin tooling on the portfolio stack — plan: plans/p1-n009-plugin-tooling-portfolio-stack.md · spec: specs/p1-n009-plugin-tooling-portfolio-stack.md
    - P1-N010 [done] Node toolchain and the shared register grammar, proven by journal_tail
    - P1-N011 [done] The travelling package: conformance corpus, recorded expectations, vendoring generator
    - P1-N012 [done] The form checker on the shared unit, proven finding-for-finding
    - P1-N013 [done] The cutover: sync_agents ported, every invocation site moved, the Python retired
  - P1-N014 [done] Role contracts adopt the methodology's conduct rules — plan: plans/p1-n014-role-contracts-adopt-v140-rules.md · spec: specs/p1-n014-role-contracts-adopt-conduct-rules.md
  - P1-N015 [done] Methodology amendments for delegated, multi-agent work — plan: plans/p1-n015-methodology-amendments-delegated-work.md · spec: specs/p1-n015-methodology-amendments-delegated-work.md
  - P1-N016 [planned] [gated: owner review of the plan] Process spec maintenance: branch lifecycle, PR citation, packet table — the plan proposes no wait on P3-N009 (decision 3); its execute task E1 follows P3-N007's E1, done 2026-10-30 — plan: plans/p1-n016-process-spec-maintenance.md
  - P1-N006 [identified] Pilot on a real project (chunk 5) — superseded in place by P2-N006; kept until the founding plan closes out
  - P1-N007 [identified] Cost reporting v1 and close-out (chunk 6)
- P2-N001 [broken-down] Orchestration service — plan: plans/orchestration-service.md
  - P2-N002 [done] Service skeleton and plan state (chunk 1) — plan: plans/p2-n002-service-skeleton.md · spec: specs/p2-n002-service-skeleton.md
    - P2-N007 [done] Service repository bootstrap
    - P2-N008 [done] Reachability slice: a deployed MCP server a session can call
    - P2-N009 [done] Plan-state read
    - P2-N010 [done] Plan-state update, git-authoritative, with the advisory lease
    - P2-N011 [done] Degrade to git-only, and enlistment documentation
  - P2-N012 [done] Deploy the service from CI on merge — plan: plans/p2-n012-deploy-from-ci-on-merge.md · spec: specs/p2-n012-deploy-from-ci-on-merge.md
    - P2-N013 [done] Alias assumptions verified against AWS documentation
    - P2-N014 [done] Pull-request checks that cannot deploy
    - P2-N015 [done] Alias-aware lease-table selection, failing closed
    - P2-N016 [done] Deploy, smoke and promote on merge to main
  - P2-N003 [broken-down] Owner questions and the plan view (chunk 2) — split into the web view's first version and the owner question queue (owner, 2026-10-29) — plan: plans/p2-n003-owner-questions-and-plan-view.md · spec: specs/p2-n003-owner-questions-and-plan-view.md
    - P2-N021 [identified] The web view's first version: the plan tree from commits, drilling to node and task — independent of P2-N005 and P2-N004 (RU-018; owner, 2026-10-29); its task E3 waits on P3-N007 done, its tasks E1 and E2 do not (plan decision 8) — spec: specs/p2-n003-owner-questions-and-plan-view.md
    - P2-N022 [identified] The owner question queue: gate decisions answered in the web view, picked up through the task-pull loop — depends on P2-N021 and P2-N005, and follows P2-N006 (owner, 2026-10-29) — spec: specs/p2-n003-owner-questions-and-plan-view.md
  - P2-N004 [identified] Topics and coordination (chunk 3) — after P2-N006, built only on a shown need (owner, 2026-10-29)
  - P2-N005 [broken-down] The task-pull loop (chunk 4) — independent of P2-N003 and P2-N004 (RU-018; owner, 2026-10-29) — plan: plans/p2-n005-task-pull-loop.md · spec: specs/p2-n005-task-pull-loop.md
    - P2-N017 [identified] The platform facts, verified — spec: specs/p2-n005-task-pull-loop.md
    - P2-N018 [identified] The loop in git alone — depends on P2-N017 — spec: specs/p2-n005-task-pull-loop.md
    - P2-N019 [identified] Role-aware identity — depends on P2-N017; independent of P2-N018 (RU-018) — spec: specs/p2-n005-task-pull-loop.md
    - P2-N020 [identified] The task tools — depends on P2-N018 and P2-N019 — spec: specs/p2-n005-task-pull-loop.md
  - P2-N006 [identified] Migration and pilot (chunk 5) — depends on P2-N005 and on P2-N021, the web view's first version, not on P2-N003 as a whole (owner, 2026-10-29)
- P3-N001 [broken-down] Project comprehension and continuous implementation — plan: plans/comprehension-and-continuous-implementation.md · spec: specs/p3-n001-comprehension-and-continuous-implementation.md
  - P3-N002 [broken-down] The comprehension model (chunk 1) — plan: plans/p3-n002-comprehension-model.md · spec: specs/p3-n002-comprehension-model.md
    - P3-N006 [done] The thin end-to-end slice: five real parts all the way through, and both renderings — plan: plans/p3-n006-thin-end-to-end-slice.md · spec: specs/p3-n002-comprehension-model.md
    - P3-N007 [done] The type declared, the arguments written, the K-003 amendment drafted — depends on P3-N006 — plan: plans/p3-n007-type-declared-amendment-drafted.md · spec: specs/p3-n002-comprehension-model.md
    - P3-N008 [planned] [gated: owner review of the plan] The instance, over this repository — depends on P3-N007 for its executing stage (P3-N007 decision 9), done 2026-10-30 — plan: plans/p3-n008-instance-over-this-repository.md · spec: specs/p3-n002-comprehension-model.md
    - P3-N009 [identified] Sibling ordering retired, and the checks that replace it — depends on P3-N008
  - P3-N003 [broken-down] The common risk catalogue (chunk 2) — independent of P3-N002 (RU-018) — plan: plans/p3-n003-common-risk-catalogue.md · spec: specs/p3-n003-common-risk-catalogue.md
    - P3-N010 [done] One class, carried end to end — plan: plans/p3-n010-one-class-end-to-end.md · spec: specs/p3-n003-common-risk-catalogue.md
    - P3-N011 [verifying] [gated: owner rulings on the omission list, the three weaker Class lines, scope arguments and closed entries] The sweep, the rest of the catalogue, and the omission list — depends on P3-N010 — plan: plans/p3-n011-sweep-and-omission-list.md · spec: specs/p3-n003-common-risk-catalogue.md
    - P3-N012 [identified] The Article 8 proposal, written IR first and reviewed — depends on P3-N011
  - P3-N004 [identified] Reversibility, and the measurement that says whether it pays (chunk 3) — depends on P3-N002
  - P3-N005 [broken-down] Sequence mode: run W-001's pre-ratified mode, and determine whether it needs specialising (chunk 4) — independent of P3-N002 (RU-018) — plan: plans/p3-n005-sequence-mode.md · spec: specs/p3-n005-sequence-mode.md
    - P3-N013 [done] The four stop conditions, decidable, evidenced, and related to the meta-review signals — plan: plans/p3-n013-stop-conditions-decidable.md · spec: specs/p3-n005-sequence-mode.md
    - P3-N014 [done] The loop runs sequence mode, and the roles meet the conditions without looking — depends on P3-N013 and on P1-N014's execute — plan: plans/p3-n014-loop-runs-sequence-mode.md · spec: specs/p3-n005-sequence-mode.md
    - P3-N015 [planned] [gated: owner review of the plan and explicit ratification of the sequence] The demonstration: a ratified sequence lands two chunks and stops on asks — depends on P3-N014 — plan: plans/p3-n015-sequence-demonstration.md · spec: specs/p3-n005-sequence-mode.md
    - P3-N016 [identified] The determination on W-001, and the artifact or the argument — depends on P3-N015
