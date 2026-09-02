# Classification

<!-- The binding declaration (methodology vocabulary: Classification).
     Omitted optional fields declare their omission defaults, subject to
     the declaration-accuracy MUST (Constitution Article 4). -->

- **C-tier**: C1
- **Pinned methodology version**: 1.5.0 (compliance target;
  migrated from 1.4.0 on 2026-09-02 — v1.5.0 carries one migration
  note: a project with an Agent bootstrap copies W-008's prescribed
  block into it verbatim, done in `CLAUDE.md` in the same commit. The
  other five amendments ship migration-note `none`.)
- **S-level**: S1
- **Type**: backend-service
- **Target**: serverless-aws
- **Workflow**: none declared (⇒ deployed is false) — set once a
  deploy workflow exists (chunk 1 child B, owner action O2 of the
  [orchestration-service plan](https://github.com/majodali/project-orchestrator/blob/main/docs/plans/orchestration-service.md))
- **Family**: methodology (member) — lead:
  [majodali/methodology](https://github.com/majodali/methodology)

Adopted at bootstrap, 2026-08-27 (node P2-N007, chunk 1 child A of the
[orchestration-service plan](https://github.com/majodali/project-orchestrator/blob/main/docs/plans/orchestration-service.md)),
per the owner-ratified defaults recorded in that plan's decision 1 and
this chunk's
[specification](https://github.com/majodali/project-orchestrator/blob/main/docs/specs/p2-n002-service-skeleton.md).
S1 is forced by this service's internet exposure and held secrets
(a GitHub App private key, a client bearer token) once later children
land; C1 matches the judgment load of a small, owner-supervised
service.

## Coordinating repository

This repository does not yet declare a formal multi-repo relationship
field — the methodology's multi-repo update has not landed (v1.3.0
expresses only the Family field above). Until it does, this is stated
here in prose:

**[majodali/project-orchestrator](https://github.com/majodali/project-orchestrator)
is this repository's coordinating repository.** It originated this
service (ruling
[RU-006](https://github.com/majodali/project-orchestrator/blob/main/docs/rulings.md):
a capability that is separately deployable or holds secrets gets its
own repository, and the originating repository coordinates it), holds
the single plan hierarchy both repositories work against, and is where
this repository's Plan register and Cost log entries live (below).
The coordinating repository's Backlog tracks formalizing this
relationship once the methodology can express it ("Declare the
multi-repo relationship").

## Deviation register

No deviations recorded.

## Custom definitions

This repository keeps its **own Backlog** (methodology K-003 is
per-project) but declares its **Plan register** and **Cost log** by
citation to the coordinating repository's instances rather than
creating second ones (decision 2 of the
[orchestration-service plan](https://github.com/majodali/project-orchestrator/blob/main/docs/plans/orchestration-service.md)) —
one plan hierarchy, not a duplicated one. The same follows for the
**Ruling register**: gate decisions that bind this repository's work
are recorded where the gate happens, in the coordinating repository.

- **Backlog** (Document) — cites
  [docs/process/plan-model.md § Relationship to the Backlog (K-003)](https://github.com/majodali/project-orchestrator/blob/main/docs/process/plan-model.md);
  instance: [docs/backlog.md](backlog.md) (this repository, local).
- **Plan register** (Document) — cites
  [docs/process/plan-register.md](https://github.com/majodali/project-orchestrator/blob/main/docs/process/plan-register.md);
  instance:
  [majodali/project-orchestrator docs/plan-register.md](https://github.com/majodali/project-orchestrator/blob/main/docs/plan-register.md)
  (external — no local instance; this repository's nodes, e.g.
  P2-N007, are entries in that register).
- **Cost log** (Document) — cites
  [docs/process/cost-log.md](https://github.com/majodali/project-orchestrator/blob/main/docs/process/cost-log.md);
  instance:
  [majodali/project-orchestrator docs/cost-log.md](https://github.com/majodali/project-orchestrator/blob/main/docs/cost-log.md)
  (external — no local instance).
- **Ruling register** (Document) — cites
  [docs/process/rulings.md](https://github.com/majodali/project-orchestrator/blob/main/docs/process/rulings.md);
  instance:
  [majodali/project-orchestrator docs/rulings.md](https://github.com/majodali/project-orchestrator/blob/main/docs/rulings.md)
  (external — no local instance; see RU-006, RU-007, RU-008, which
  already bind this repository's shape and stack).
