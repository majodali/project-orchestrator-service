/**
 * The Plan register parser.
 *
 * Re-exported from `./vendored/plan-register.ts` — see `./types.ts`'s
 * doc comment for why this file no longer carries its own copy of the
 * grammar (RU-012, node P2-N010). `parseRegister` and `subtreeIds`
 * keep their exact prior signatures and behavior; every existing
 * caller and test in this repository imports them from this path
 * unchanged.
 */

export { parseRegister, subtreeIds } from "./vendored/plan-register.js";
