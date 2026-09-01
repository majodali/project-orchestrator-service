/**
 * Structured shape of a Plan register.
 *
 * Re-exported from `./vendored/plan-register.ts`, the canonical shared
 * grammar/lifecycle unit vendored from majodali/project-orchestrator's
 * `plugin/scripts/lib/plan-register.ts` (ruling RU-012, node P2-N010
 * — chunk 1 child D). Before this node, this file duplicated that
 * grammar by hand (node P2-N009); RU-012 settled that two
 * repositories share one canonical copy, vendored outward by a
 * generator with a `--check` drift mode, rather than maintaining a
 * second implementation here. See `./vendored/GENERATED.md` for
 * provenance and `README.md`'s "Keeping the vendored grammar unit in
 * sync" for how to re-vendor.
 *
 * `Stage` / `STAGES` (the node-lifecycle vocabulary, cited to
 * `docs/process/plan-model.md` in the coordinating repository) travel
 * with the same unit and are re-exported here too — the write path
 * (`src/planRegister/transitions.ts`) is what actually enforces that
 * vocabulary; this module, like the vendored unit itself, carries it
 * only as data (D5 — "no policy in the unit").
 */

export type {
  HoldMarker,
  PlanNode,
  RegisterLink,
  RegisterParseError,
  RegisterParseResult,
  Stage,
} from "./vendored/plan-register.js";
export { STAGES } from "./vendored/plan-register.js";
