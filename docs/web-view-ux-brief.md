# Brief: the web view's UX refinement (node P2-N023)

Status: superseded 2026-11-09 by the rebuild (the coordinating repository's `docs/plans/rebuild.md`, milestone 2), which replaced the pages this brief refined and dropped the phone-width target. Kept as the record of iterations 1 to 3.

Reader: the owner-attended Claude Code session that works node P2-N023 in this repository. The owner steers it; the Orchestrator records its results from the merged pull requests.

Purpose: refine how the web view's pages read and feel until the owner decides the view can replace the coordinating repository's `docs/plan.md`. The owner's decision at V30 on 2026-11-03: "The web view is showing promise, but is not ready to replace docs/plan.md - we need to do some UX refinement first." The node ends when the owner closes that decision the other way, or at ten iterations, whichever comes first.

## What the session may touch

Under the coordinating repository's rule RU-016 (repository reach), this node writes:

- `src/view/**` and `src/localServer.ts`;
- `test/view*.test.ts` and `test/fixtures/**`;
- `scripts/` for the preview and screenshot tooling of iteration 1;
- `package.json` scripts and dev dependencies that the tooling needs;
- `README.md`, the sections "HTTP routes" and "Trying it locally";
- `docs/runbook.md`, the section "The web view (node P2-N021)";
- `docs/backlog.md`, rows for this node's work.

It does not touch `template.yaml`, `scripts/deploy.sh`, `scripts/smoke-test.sh`, the workflows, the MCP routes, or any file in the coordinating repository. A change that needs any of those is a node decision: write it as an ask in the pull request body and stop at that boundary.

## What must stay true

- The smoke test's check 4 reads `/view` and requires `200` and a 40-character SHA in the page header. Every iteration keeps that header.
- Each page names the ref it read, the full commit SHA and the fetch time, and carries the line that it has no progress authority: the coordinating repository's Backlog stays the referent (specification decision 6 and the limit line).
- Document links stay pinned to the SHA the page read.
- The view cookie keeps its attributes (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/view`, 30 days) and the sign-in flow stays as it is.
- No browser storage beyond that cookie, no external scripts or stylesheets, no new routes and no new data sources without a node decision.
- Pages stay usable at phone width with no horizontal scroll, which is the width the owner uses.
- `npm test`, `npm run lint` and `npm run format` pass before every pull request.

## The loop, one iteration at a time

1. Branch from `main`: `ux-NN-<slug>`, where NN counts the iterations from 01.
2. Make one change, or one small coherent set, that the owner asked for or that a screenshot made obvious.
3. Render the tree page, the node page for `P2-N021` and the task page for `T094` before and after the change, at phone width (390 by 844) and at desktop width, with the preview tooling of iteration 1. Put the before and after screenshots in the pull request.
4. Run the three checks. Update the README or runbook section in the same commit when behaviour the reader can see changes (W-003).
5. Open the pull request to `main`. Its body states, in this order: what changed and why, the screenshots, the checks, and any ask for the owner. No model identifier anywhere in the commit or the body.
6. The owner merges. The push to `main` deploys, smoke-tests and promotes `live` in about three minutes. The owner checks the change on the phone and gives the next change.
7. The Orchestrator reads the merged pull request and records the iteration under the node's task. The session does not write to the coordinating repository.

## Iteration 1: the preview and screenshot tooling

The view reads its files from GitHub through the App installation, so today nothing can be previewed before a deploy. The view's tests already render pages from fixture files under `test/fixtures/` pinned to recorded commits. Iteration 1 turns that into a preview mode:

- **A fixture-backed read path.** When `VIEW_FIXTURE_DIR` is set, the local server (`npm run dev`) serves `/view`, `/view/node/:id` and `/view/task/:id` from the files in that directory instead of GitHub, at a fixed pretend SHA, so the header still carries a 40-character SHA. The production code path does not change when the variable is unset; a test proves that.
- **Local sign-in.** `VIEW_TOKEN` set in the local environment makes the existing sign-in flow work locally; the preview adds no bypass.
- **A screenshot script.** `npm run view:shots` starts the preview, signs in with Playwright (pre-installed in Claude Code sessions; `chromium.launch()` needs no options), loads the three pages at phone and desktop widths, and writes PNGs to a gitignored `shots/` directory with the iteration number in the file names.
- **Documentation.** The README section "Trying it locally" gains the preview commands; the runbook's web-view section gains one sentence pointing to them. Tests cover the fixture reader and the unchanged production path.
- **Deliverable.** One pull request, `ux-01-preview-tooling`, with its own before and after screenshots of the three pages, which also become the baseline for iteration 2.

## Reporting to the owner

Lead with the outcome. In each pull request body, state what changed, what the owner should look at on the phone, and any decision needed, in short sentences. When a change the owner asked for cannot be made within the reach above, say so in the body and stop. The owner takes it to the Orchestrator.

## Pointers

- The coordinating repository: node P2-N021's record and the specification `docs/specs/p2-n003-owner-questions-and-plan-view.md` (decisions 6 and 13, the limit line, V22 and V30).
- This repository: `src/view/` for the pages, `docs/runbook.md` "The web view (node P2-N021)" for the deploy and latency record, `README.md` "HTTP routes" for the routes.
