/**
 * The web view reads one file, `orchestration/state.json`, at the
 * page's commit (the rebuild plan, milestone 2). This module turns its
 * text into the state the pages render, plus the findings `check`
 * would report, which the pages list under "Problems found". A file
 * that is not JSON, or fails the schema, yields no state and one
 * problem per failure; the pages then show the problems and nothing
 * else.
 */

import { checkState, type Finding } from "../model/check.js";
import type { State } from "../model/schema.js";

export const STATE_PATH = "orchestration/state.json";

export interface StateAtPage {
  state: State | null;
  findings: Finding[];
}

export function stateAtPage(text: string): StateAtPage {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return {
      state: null,
      findings: [
        {
          severity: "violation",
          invariant: 1,
          subject: null,
          message: `${STATE_PATH} is not JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
  return checkState(value);
}
