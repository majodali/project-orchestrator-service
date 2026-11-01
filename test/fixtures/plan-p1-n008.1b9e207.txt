# `mtool` custom-type checker extension point — upstream proposal

Status: closed → Backlog entry

<!-- K-007 contract: Status transitions draft → active → (superseded by
     X, because Y | closed → Backlog entry). Anything unmarked here is a
     live claim of current intent. This is the plan document for node
     P1-N008; it goes `active` when the owner approves it at the gate,
     and `closed → Backlog entry` when the node reaches `done`. -->

Node **P1-N008**, child of P1-N001
([orchestrator-v1](orchestrator-v1.md)). Not one of that plan's
enumerated chunks 1–6: a Backlog-discovered node, raised by the
transitional arrangement recorded in
[auditing.md](../process/auditing.md) and bound by the founding
plan's standing constraints — above all constraint 4, "`mtool` is
upstream", and constraint 1's rule that a gap exposed by refinement
is fixed by a proposal upstream, never by local divergence.

## Outcome

A transportable, decision-ready proposal to
[methodology-tools](https://github.com/majodali/methodology-tools)
for **one generic upstream capability**: a custom type defined by
citation (Article 7) may declare a checker with its defining
project, and `mtool audit form` discovers that checker through the
citation, runs it, and merges its findings into the standard audit
and delivery pipeline.

The proposal is written for a maintainer who does not know this
project: it argues the general problem (family-defined custom types
have no mechanical form checking anywhere in the audit pipeline),
specifies a candidate contract precisely enough to be accepted,
amended, or rejected on its merits, names the design questions the
maintainer must settle, and offers this repository's orchestration
form checker as the worked example rather than as the requirement.

Success is a proposal the upstream maintainer can act on in one
sitting. It is explicitly **not** the upstream feature, and not
upstream acceptance (see Scope boundary).

## Why this node exists

Three facts meet here:

1. **Custom types are the family's growth path.** The methodology's
   Article 7 definition-by-citation lets a defining project publish
   a document type that member projects adopt by citation — this
   repo already publishes two (Plan register, Cost log).
2. **`mtool audit form` knows only standard types.** A cited custom
   type is invisible to it, so every defining project that wants its
   type mechanically checked ships its own checker and runs it
   *beside* the audit — findings outside the delivery pipeline,
   invariants outside the audit record.
3. **`mtool` must not learn our formats.** Constraint 4 forbids
   pushing orchestrator-specific knowledge upstream. The only fix
   that respects it is a generic discovery mechanism that serves
   every future family-defined type, ours among them.

Until that capability lands, the Auditor's side-by-side checker run
is the transitional discharge of the duty; this node's product is
what ends the transition, and the Backlog item is its record.

## Approach

One authored artifact, produced by a single working session in this
repository: `docs/proposals/mtool-custom-type-checker.md` (new
directory; statused per K-007), plus a one-paragraph pointer added
to [auditing.md](../process/auditing.md)'s extension-point section in
the same commit (W-003). The transitional arrangement itself does not
change — it stays in force until the upstream capability exists.

The proposal is expected to carry, at minimum:

- **Problem statement, upstream-framed.** Stated over Article 7
  custom types in general, with no orchestrator vocabulary assumed;
  the cost of the status quo (per-project checkers, findings outside
  the pipeline) stated as the thing being fixed.
- **The proposed capability.** How a defining project declares a
  checker alongside its type definition; how `mtool` resolves the
  citation to that declaration; how it invokes the checker; how
  findings re-enter the standard result set.
- **The design questions the maintainer must settle**, each with a
  recommended answer and the trade-off behind it — at least:
  *discovery* (declared in the defining repo, or registered in the
  consuming project's Classification?); *execution and trust*
  (running a checker fetched from another repository is a security
  surface — vendored? already-cloned-only? opt-in per project?);
  *finding schema* (how a foreign checker's output maps onto
  `mtool`'s result kinds and severities); *versioning* (citations
  are version-pinned; what happens when checker and type version
  drift); *unavailability* (audit degrades with a notice, or fails).
- **Evidence.** This repo's `form_check.py` as the worked example:
  which invariants it checks, what it caught in practice, and the
  trial record showing it earning its keep under real orchestration
  — the "proven itself" claim, stated with its dates and outcomes.
- **A conformance sketch, not an implementation.** What
  `form_check.py` would look like as a declared checker under the
  proposed contract — enough to show the contract is satisfiable,
  no more (see decision 4).
- **The explicit ask.** What the maintainer is being asked to
  decide, and what this project will do under each answer.

The artifact must be readable standing alone: every reference into
this repository either quoted inline or linked with enough context
that the maintainer never needs orchestration knowledge to judge the
proposal.

## Scope boundary

This node completes at the artifact. It does **not** include:

- writing the upstream feature, or any code in methodology-tools;
- upstream acceptance or disposition — outside this project's
  control, and a node whose `done` waits on another maintainer's
  judgment can never be verified here (decision 3);
- retiring the transitional side-by-side arrangement, or adapting
  `form_check.py` to the accepted contract — both are Backlog items
  that fire when the capability lands.

Delivery of the artifact upstream is a separate, scope-gated step
(decision 2).

## Dependencies and ordering

- **P1-N005 (chunk 4, `executing`, demo gate pending)** is the
  proving ground the Backlog item names. In substance the
  precondition is met: the checker shipped, ran self-hosted, and
  caught real defects across the trials. What P1-N005's gate has not
  yet done is *ratify* that record — which matters here only because
  the proposal's evidence section cites it. The register-order
  default in [dispatch.md](../process/dispatch.md) gates `execute`
  on earlier siblings being `done`; overriding that default is the
  owner's call, put as decision 1. Planning and specification of
  this node need no such override (dispatch's dependency rule asks
  only for plan-recorded dependencies at those stages), which is why
  they run now.
- **methodology-tools is a separate repository**, outside this
  project's approved scope. Under dispatch.md's "cross-repo reach is
  scope" rule, no role may touch it — read or write — until it is
  named in a scope grant. The plan is therefore deliberately shaped
  so that nothing in the node's execution requires that reach: the
  proposal is written from this repository's own evidence and from
  `mtool`'s publicly documented behavior as already recorded here.
  If the specify or execute stage finds it genuinely cannot state
  the contract without reading upstream source, that is a `blocked`
  return and an immediate-class scope question — not a workaround.
- **No dependency on P1-N006/N007.** Those consume this node's
  outcome at most indirectly; neither blocks nor is blocked by it.

## Leaf or interior

**Leaf.** One authored artifact, one working session. The candidate
sub-behaviors were examined and rejected: *drafting* and *delivering
upstream* do validate separately, but delivery is excluded from the
node's scope by decision 3, so no second child remains; *contract*
and *evidence* are sections of one argument that do not stand up
independently — an evidence section validates nothing without the
contract it is evidence for. Per the C1 profile, breakdown is
required only above single-session size, and this is not.

If decision 2 or 3 is overridden at the gate such that upstream
delivery joins the node, the node becomes interior with two
dependency-ordered children (draft, then deliver) — that is a
backward transition to `plan` with the owner's ruling as its
recorded reason, not something to improvise at execution.

## Monotonicity

Trivially monotonic: the node adds documentation and rewrites no
previously defined functional test. No planned non-monotonicity is
proposed.

## Decisions for the gate

Numbered per [dispatch.md](../process/dispatch.md)'s owner-decision
economics; a go-ahead adopts every default not overridden by number.

1. **Execute the draft before P1-N005's demo gate closes?**
   Default: **yes** — the evidence the proposal cites already
   exists; holding costs a full orchestration cycle for a
   ratification that changes wording, not substance. (This overrides
   dispatch.md's earlier-siblings-`done` default for this node only;
   the proposal stays `draft` and undelivered regardless, so nothing
   leaves the repo on unratified evidence.)
2. **How does the proposal reach methodology-tools?** Options: (a)
   the owner carries the artifact upstream himself — he maintains
   that repo and leads the family; (b) grant additional-repository
   scope (write) so a role opens the issue or PR; (c) (a) now, (b)
   later if the volume warrants. Default: **(a)** — no cross-repo
   scope grant is needed for a single hand-carried document, and
   scope expansion is an immediate-class interrupt best not spent
   here.
3. **Does P1-N008 complete at the artifact, or at upstream
   disposition?** Default: **at the artifact** — upstream acceptance
   is another maintainer's judgment and cannot be a verification
   criterion here; disposition is tracked as a Backlog item.
4. **Does the proposal ship a working reference implementation?**
   Options: full adaptation of `form_check.py` to the proposed
   contract, or a conformance sketch showing the contract is
   satisfiable. Default: **sketch only** — the contract is what is
   under discussion, so an implementation built before the
   maintainer chooses a design is rework by construction, and it
   would push the node past single-session size.
5. **Is P1-N008 an owner-gated node?** Default: **yes — gate at
   `verifying`** — the artifact is outward-facing and the owner is
   its recipient, so one short review is both the cheapest and the
   only meaningful acceptance; the C1 profile's chunk-gates-only rule
   leaves gate designation to the owner, which is why it is asked.

## References

- [orchestrator-v1](orchestrator-v1.md) — parent plan; standing
  constraints 1 and 4
- [auditing.md](../process/auditing.md) — the transitional
  side-by-side arrangement and the intended end-state this node
  proposes
- [dispatch.md](../process/dispatch.md) — dependency default,
  cross-repo reach as scope, owner-decision economics
- [profiles.md](../process/profiles.md) — C1 profile (breakdown
  above single-session size; criteria-list specifications)
- [methodology-tools](https://github.com/majodali/methodology-tools)
  — the upstream recipient
