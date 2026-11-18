# Backlog

The single source of progress truth for this repo (methodology K-003);
entries update in the same commit as the work they describe (W-003).
Chunk entries below are seeded from the founding plan,
[methodology-tools-v1](plans/methodology-tools-v1.md) (status: active
since the owner's build green-light, 2026-08-19).

## Completed

- [x] **Bootstrap** — repo governed under majodali/methodology v1.0.0:
  founding plan imported as
  [plans/methodology-tools-v1.md](plans/methodology-tools-v1.md)
  (status: draft), [Classification](classification.md) declared
  (component/library, C1, S0, package registry, pinned 1.0.0), Binding
  block in `CLAUDE.md`, README stating the Article 3 relationship
  (documents are the spec; the tool has the bug). Cross-registered in
  the methodology's
  [Portfolio register](https://github.com/majodali/methodology/blob/main/docs/registers/portfolio.md)
  (M-001).
- [x] **Migrated to methodology 1.1.0** — pin and Binding block bumped
  (v1.1.0 migration notes: none for either amendment, so the pin bump
  is the whole migration — release process step 5). The 1.1.0 content
  matters here directly: the audit-log register unblocks `mtool
  status` delta-ratio (chunk 1), and M-004 becomes a checkable rule
  for `mtool audit` (chunk 3).

- [x] **Chunk 1 — markdown model, applicability engine, `status`** —
  shipped: line-based markdown model (`src/markdown.ts`),
  Classification parsing with the vocabulary's omission defaults and
  implicit-C0 handling (`src/classification.ts`), rule-corpus parsing
  of applicability tags with Article 5 defaults (`src/rules.ts`), the
  Article 4 stage 1 + stage 2.3 engine over effective constraining
  conditions (`src/applicability.ts`), and `mtool status` with
  `--json`/`--brief` reporting in-play rules, deviations, version lag,
  sandbox ages, and delta-ratio (`src/status.ts`, `src/cli.ts`).
  Delta-ratio reports *unavailable* pending the audit-log register
  amendment — proposed via the standard channel
  ([methodology PR #3](https://github.com/majodali/methodology/pull/3),
  adjudication at a review round), never self-applied (Article 8). Workflow declarations are recognized but unparseable
  until the methodology defines the declaration format (its open
  item); `deployed` stays false with a finding. Gate evidence: 19
  passing tests — implicit-C0 / minimal-C0 / full-C2 fixtures, the
  constitution's own precedence tie-break examples, real-corpus parse
  (21 rules, no findings), and the methodology repo itself reporting
  its 14 in-play rules. **Gate review pending.**

- [x] **Chunk 1 completion: delta-ratio wired to the Audit log** —
  `mtool status` now reads the project's `docs/audits.md` (available
  since methodology 1.1.0): computes the change ratio since the newest
  semantic-audit entry (git numstat over current tracked lines, scoped
  to the repo), or reports honestly "no semantic audit recorded yet" /
  "no Audit log". The stale amendment-pending message is gone. The
  repo's own sandbox scan excludes `fixtures/` (test data is not the
  project's sandbox). Real-corpus tests track the 1.1.0 corpus —
  exact-count assertion replaced by clean-parse + expected-IDs
  including M-004 (owner-approved change to an existing assertion,
  W-002, 2026-08-20).

- [x] **Chunk 2 — `classify` and `links check`** — shipped:
  `mtool links check` (`src/links.ts`) — deterministic link integrity
  (files + GitHub-slug anchors) across a repo, findings citing
  Articles 10/9, nonzero exit on findings; `mtool classify`
  (`src/classify.ts`) — adoption in one run, writing the
  Classification, Binding block, and governance docs from the corpus's
  own `skeletons/`, driven by the declared classification's in-play
  rules (each written file cites the rule requiring it; K-005: no
  empty-ceremony registers; never overwrites; pin auto-resolves to the
  corpus's latest release tag; C0 omits the pin per the omission
  default). Shared git/walker helpers refactored to `src/git.ts` /
  `src/markdown.ts`; `fixtures/` excluded from a repo's own material by
  default. Gate evidence: 27 passing tests — broken-links fixture
  (dangling file + anchor, Article 10 citations), fresh-repo
  classify-to-form-clean (C2 and C0-baseline cases, second run
  overwrites nothing), self- and real-corpus link checks (144 relative
  links, matching the retired ad-hoc script exactly). Closes
  methodology Risk R2 (companion PR there). **Gate review pending.**

- [x] **Migrated to methodology 1.2.0** — pin and Binding block bumped
  (v1.2.0 migration notes: none — release process step 5). The 1.2.0
  content bears on this repo directly: the delta-scope calibration is
  what `mtool audit form` implements, and the audit delivery process
  (with transitional Risk R5) is chunk 4's compare-and-deliver spec.
- [x] **Chunk 3 — `audit form` and hook installation** — shipped:
  `mtool audit form` (`src/audit.ts`) runs the mechanically checkable
  subset of in-play rules — existence rules (K-002/K-003/K-004/W-007/
  M-001, with the canonical-home check catching root-level Backlogs),
  Binding-block declaration consistency (Article 4 accuracy), K-002
  length, K-004 entry statuses, K-007 plan Status lines (blockquote/
  emphasis dress accepted; TEMPLATE and README exempt), S-001 secret
  hygiene (credential-shaped filenames + key patterns), Article 7
  sandbox ages, Article 10 link integrity, and the Article 8 lag/
  deviation call-outs every audit MUST make. Delta modes `--staged`
  (the W-003 same-commit guard) and `--changed-since`; scoping per the
  proposed delta-scope calibration amendment — per-file content checks
  delta-scoped, repo-wide invariants always full-tree. `mtool hooks
  install` (`src/hooks.ts`) writes the git pre-commit mirror
  (absolute-path embedding documented as a pre-package limitation).
  Gate evidence: 33 tests (fixture audit, classify→audit-clean loop,
  staged W-003 guard both ways, S-001 catches, hook install) and the
  first audit of reality: allegro's findings match its own
  adoption-transition notes exactly (root BACKLOG.md relocation
  pending, 1.0.0 lag, Workflow-format open item), in-real-life shows
  one real W-007 gap (no README), template/ops/org audit clean at
  implicit C0, and both governed repos self-audit clean — after the
  run corrected two tool bugs (blockquoted Status lines are compliant
  dress; the scanner flagged its own test literal). Closes methodology
  Risk R1 (companion PR there). **Gate review pending.**

- [x] **Chunk 4 — `census`, `audit deliver`, `audit semantic`** —
  shipped: `mtool census` (`src/census.ts`) reconciles the Portfolio
  register against observed repositories (GitHub API when reachable,
  `--observed` file otherwise — enumeration-unavailable is itself a
  finding) and local checkouts, emitting M-001 completeness
  violations, unobservable-row warnings, summary-drift refresh
  proposals, and implicit-C0 spot-check candidates; `mtool audit
  deliver` (`src/deliver.ts`) mechanizes the audit process — current
  finding fingerprint vs the project's own newest same-kind Audit-log
  entry (machine digests compared on rule/severity/file, prose
  baselines degraded honestly to rule/file or outcome counts with a
  parse note), verdicts deliver-first / deliver-transition /
  no-change, `--write` appends the formatted entry creating the
  register on first delivery (PR-raising stays with the operator);
  `mtool audit semantic` (`src/semantic.ts`) assembles the
  adjudication packet — Article 8 call-outs, changes since the last
  semantic audit, in-play checklist, document inventory, link/sandbox
  state, Article 9 prompts — judgment-free by design. Gate evidence:
  39 tests, and the first real census caught a live drift (allegro's
  register row said pinned 1.0.0; the observed declaration is 1.1.0)
  while `audit deliver` correctly read the day's delivered entries as
  baselines (allegro: no-change) and drafted the tools repo's own
  first entry. Closes methodology Risks R3 and R5 (companion PR
  there). **Gate: census output awaits owner adjudication.**

- [x] **Chunk 5 — `links move` and plugin wiring** — shipped:
  `mtool links move <from> <to>` (`src/move.ts`) — moves a document
  with git following, rewrites every inbound link across the repo
  (anchors preserved), re-bases the moved document's own relative
  links, warns on heavy linkage (≥5 inbound — Article 10: a heavily
  linked move is a de facto decision review), leaves a `--tombstone`
  stub on request, and verifies with a full post-move link check.
  Whether a document is externally referenced is operator-supplied
  knowledge until the census maintains an external-reference index —
  the documented limitation, proposed as the plan's second amendment
  (methodology Risk R6). Claude Code plugin (`plugin/`, served from
  `.claude-plugin/marketplace.json`): SessionStart injects `mtool
  status --brief` (the binding contract read every session by
  construction), a PreToolUse guard runs `audit form --staged` on
  `git commit` (blocking on MUST violations — the W-003 guard as a
  Claude Code hook, dual-track with `hooks install`'s git mirror), and
  three skills (status / audit / classify) shell to mtool — no rule
  implemented twice. Pre-package limitation: the plugin resolves an
  mtool checkout via `MTOOL_HOME` (dev layout auto-detected). Gate
  evidence: 43 tests, including the gate literally — a
  classify-scaffolded project's staged audit driven entirely through
  the plugin's hook path (clean commit passes; source-without-docs
  blocked exit 2). Plan closed (K-007): all five chunks delivered;
  this Backlog is the record. Closes methodology Risk R4 (companion
  PR there). **Gate review pending.**

- [x] **Migrated to 1.3.0 and joined the `methodology` family** —
  v1.3.0 tagged 2026-08-25 (project families, template type and
  Q-001, custom definitions by citation, links-move limitation); all
  four amendments ship migration-note: none, so the pin bump is the
  whole migration. The Classification now declares
  `Family: methodology (member)` — the grouping this project's own
  chunk-3 access ruling motivated: family cohesion via the lead's
  corpus and change process, shared constructs adopted by citation,
  this repo's Classification and audits staying its own. The
  amendment-controlled type enum gains `template` in `src/types.ts`
  (the clean-parse gate flagged Q-001's `[type: template]` tag as the
  correct signal — Article 3: the documents are the spec), and the
  real-corpus expected-IDs assertion now includes Q-001.

- [x] **Migrated to methodology 1.4.0** — 2026-08-30; migration
  notes none mandatory, so the pin bump is the whole migration.
  The v1.4.0 content lands here as queued work: style checks (P-
  rules), supersession-marker greps (K-010), Workflow parser.

- [x] **Link checker skips inline code spans** — spans are literal
  text, not markup; motivating instance: Allegro syntax in prose
  (`apply[e: Effect](…)`) read as two dangling links in allegro's
  CHANGELOG and concepts.md. Spans are blanked before link
  extraction (columns preserved); regression test added.

- [x] **S-001 scanner: key headers need a body** — the private-key
  pattern now requires a base64-shaped body after the header;
  motivating instance: two false positives on
  project-orchestrator-service (a runbook documenting a verify
  command's output; a test placeholder body). Regression test
  added; a real-shaped body still flags. 44 tests pass.

- [x] **Migrated to methodology 1.5.0** — 2026-09-02; the pin bump
  plus this release's one migration note: `CLAUDE.md` now carries
  W-008's prescribed reporting block verbatim, copied from the rule
  and verified byte-identical. The other five amendments ship
  migration-note `none`. The v1.5.0 content lands here as queued
  work: the bootstrap-cache drift check, below.

- [x] **Style and IR checks, W-008 block drift** — `mtool style`
  (`src/style.ts`) runs the P- rules' mechanical part and W-008's
  report shape, ported from the communication pipeline's
  `scripts/lint.mjs` with every finding citing its methodology rule;
  `mtool ir check` (`src/ir.ts`) runs the IR schema's CK-01..CK-11 and
  counts unratified terms; vocabulary lookup reads the pipeline's
  table rows and the methodology's list entries (`src/vocabulary.ts`);
  `mtool audit form` compares the bootstrap's W-008 block with the
  rule's fenced block and reports drift or absence as a W-008 warning
  (skipped when the corpus prescribes no block). Parity with the
  pipeline lint on its own tree: identical findings per file and line
  (27 files, 98 warnings, 0 violations; 3 IRs clean). 65 tests pass.

- [ ] **Custom-type checker extension point** (inbound proposal,
  awaiting adjudication) —
  [proposals/custom-type-checker-extension.md](proposals/custom-type-checker-extension.md):
  project-orchestrator asks that `mtool audit form` discover, run, and
  fold in a checker a defining project declares alongside its
  Article-7 custom type, so citation-defined types get the same
  mechanical checking as standard ones. Five design questions to
  settle (discovery, execution trust, finding schema, versioning,
  unavailability), each with the proposer's recommendation. No code
  written pending the maintainer's answers.

## Upcoming

- [x] **Stale Workflow-format claims in tool output and comments** —
  the `Workflow declared` info finding told readers "the declaration
  format is undefined (methodology backlog open item)", and two source
  comments said the same. Methodology v1.4.0 defined the canonical
  format; only this tool's parser is missing. Corrected at the 1.5.0
  migration to say exactly that. Found by running the form audit on
  in-real-life, whose Classification declares a Workflow.

- [ ] **Workflow declaration parser** — parse the canonical format the
  v1.4.0 candidate's Workflow-declaration-format amendment defines
  (`stages: a → b → c; live = <stage>; backlog default: checked ⇒ <s1>,
  unchecked ⇒ <s2>`), derive `deployed` from Classification + Backlog
  designations, and clear the standing tool-unreadable info finding
  for conforming declarations (non-conforming declarations keep it).

- [x] **W-008 bootstrap-cache drift check** (shipped; see the Completed
  entry *Style and IR checks, W-008 block drift*) — `mtool audit form`
  compares a project's `CLAUDE.md` copy of W-008's prescribed
  reporting block against the fenced block in the rule's **Required
  bootstrap text** field, and reports any difference as drift. W-008
  names the check as an audit duty; every migrated project now
  carries a copy, so the check has real inputs. Scope: presence,
  byte-equality, and the surrounding heading; a project with no Agent
  bootstrap owes nothing.

- [ ] **Links inside verbatim quotations of foreign text** — the link
  checker resolves every relative link it finds, including links
  carried inside a blockquote that quotes another repository's
  document byte-exactly. project-orchestrator's `docs/proposals/`
  quote methodology rule text verbatim, so six methodology-relative
  links (`../style.md`, `working-agreement.md#w-003-…`,
  `prose.md#p-004-…`) resolve nowhere in that repo and the form audit
  reports six Article 10 violations there. Rewriting the links would
  break the byte-exactness the quoting documents assert, so the fix
  belongs on this side: either skip links inside a verbatim-quotation
  region, as extraction already skips inline code spans, or agree a
  house convention for quoting foreign text and check against it.
  Owner decision pending; the finding is tracked in
  project-orchestrator's Backlog meanwhile.

- [ ] **Deviation parser splits a fielded entry into several entries**
  — a deviation recorded as a heading plus labeled field bullets
  (**Rule**, **Deviating practice**, **Rationale**, **Recorded**,
  **Disposition**) parses as one deviation per bullet, and every
  bullet whose *first line* does not carry a rule id draws
  "deviation entry lacks the rule it overrides". allegro's D-1 is
  recorded that way and produces three spurious Article 4 violations
  at every audit. The fielded shape is the one the style guide asks
  for (rule bodies are labeled), so the parser should read a
  deviation as a heading and its following bullets, taking the rule
  id from the **Rule** field. Found at allegro's 1.5.0 migration;
  tracked there as B-133.
