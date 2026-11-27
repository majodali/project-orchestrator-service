import { describe, expect, it } from "vitest";

import { MAX_FIRES_PER_WRITE, decideFires } from "../src/fire/decide.js";
import type {
  DecisionCloseLine,
  Fire429Line,
  FiredLine,
} from "../src/fire/ledger.js";
import {
  DISABLED_FIRE_SETTINGS,
  type FireSettings,
} from "../src/fire/settings.js";
import type { State } from "../src/model/schema.js";
import { decision, node, task } from "./support/states.js";

const NOW = new Date("2026-11-24T12:00:00Z");
const REPO = "majodali/project-orchestrator-service";
const REF = { trig: "trig_impl", secret: "fire/impl" };

function settingsWith(overrides: Partial<FireSettings> = {}): FireSettings {
  return {
    ...DISABLED_FIRE_SETTINGS,
    enabled: true,
    checkAfterMinutes: 45,
    repositories: new Map([[REPO, { implementer: REF }]]),
    ...overrides,
  };
}

/** One node offering `execute` (role implementer), in `REPO`, with no
 * open task and no close yet. */
function specifiedState(): State {
  return {
    schema: 0,
    project: REPO,
    nodes: [
      node({
        id: "P1-N001",
        title: "A node that offers execute",
        stage: "specified",
      }),
    ],
    tasks: [],
    decisions: [],
  };
}

describe("decideFires", () => {
  it("fires nothing when the settings are disabled", () => {
    const plan = decideFires(
      specifiedState(),
      DISABLED_FIRE_SETTINGS,
      [],
      [],
      NOW,
    );
    expect(plan.attempts).toEqual([]);
    expect(plan.reports).toEqual([]);
  });

  it("fires the one candidate when nothing has fired for it before", () => {
    const plan = decideFires(specifiedState(), settingsWith(), [], [], NOW);
    expect(plan.attempts).toHaveLength(1);
    expect(plan.attempts[0]).toMatchObject({
      node: { id: "P1-N001" },
      step: "execute",
      role: "implementer",
      repository: REPO,
      ref: REF,
    });
    expect(plan.reports).toEqual([]);
  });

  it("reports, rather than fires, a role and repository with no configured task", () => {
    const plan = decideFires(
      specifiedState(),
      settingsWith({ repositories: new Map() }),
      [],
      [],
      NOW,
    );
    expect(plan.attempts).toEqual([]);
    expect(plan.reports).toHaveLength(1);
    expect(plan.reports[0]).toMatchObject({
      node: { id: "P1-N001" },
      reason: "no-task-configured",
    });
  });

  it("does not fire again within checkAfterMinutes of the last fire for the same node and step", () => {
    const fired: FiredLine[] = [
      {
        ts: "2026-11-24T11:30:00Z", // 30 minutes ago; checkAfterMinutes is 45
        node: "P1-N001",
        step: "execute",
        task: REF.trig,
        session: null,
      },
    ];
    const plan = decideFires(specifiedState(), settingsWith(), fired, [], NOW);
    expect(plan.attempts).toEqual([]);
    expect(plan.reports).toEqual([]);
  });

  it("fires again once checkAfterMinutes has passed since the one earlier fire", () => {
    const fired: FiredLine[] = [
      {
        ts: "2026-11-24T11:00:00Z", // 60 minutes ago
        node: "P1-N001",
        step: "execute",
        task: REF.trig,
        session: null,
      },
    ];
    const plan = decideFires(specifiedState(), settingsWith(), fired, [], NOW);
    expect(plan.attempts).toHaveLength(1);
  });

  it("reports, rather than fires a third time, once two fires stand since the node's last close", () => {
    const fired: FiredLine[] = [
      {
        ts: "2026-11-24T09:00:00Z",
        node: "P1-N001",
        step: "execute",
        task: REF.trig,
        session: null,
      },
      {
        ts: "2026-11-24T10:00:00Z",
        node: "P1-N001",
        step: "execute",
        task: REF.trig,
        session: null,
      },
    ];
    const plan = decideFires(specifiedState(), settingsWith(), fired, [], NOW);
    expect(plan.attempts).toEqual([]);
    expect(plan.reports).toHaveLength(1);
    expect(plan.reports[0]?.reason).toBe("too-many-attempts");
  });

  it("only counts fires since the node's last close", () => {
    const state = specifiedState();
    state.tasks.push(
      task({
        id: "T001",
        node: "P1-N001",
        status: "closed",
        closed: "2026-11-24T10:30:00Z",
      }),
    );
    const fired: FiredLine[] = [
      // Both before the last close: stale attempts from an earlier round.
      {
        ts: "2026-11-24T09:00:00Z",
        node: "P1-N001",
        step: "execute",
        task: REF.trig,
        session: null,
      },
      {
        ts: "2026-11-24T09:30:00Z",
        node: "P1-N001",
        step: "execute",
        task: REF.trig,
        session: null,
      },
    ];
    const plan = decideFires(state, settingsWith(), fired, [], NOW);
    expect(plan.attempts).toHaveLength(1);
    expect(plan.reports).toEqual([]);
  });

  it("stops firing a task that has reached its per-task hourly cap", () => {
    const fired: FiredLine[] = Array.from({ length: 2 }, (_, i) => ({
      ts: `2026-11-24T11:${String(i).padStart(2, "0")}:00Z`,
      node: `P1-N00${i + 2}`,
      step: "execute",
      task: REF.trig,
      session: null,
    }));
    const plan = decideFires(
      specifiedState(),
      settingsWith({ perTaskHourlyCap: 2 }),
      fired,
      [],
      NOW,
    );
    expect(plan.attempts).toEqual([]);
  });

  it("stops firing once the per-account hourly cap is reached", () => {
    const fired: FiredLine[] = [
      {
        ts: "2026-11-24T11:50:00Z",
        node: "P9-N999",
        step: "plan",
        task: "trig_other",
        session: null,
      },
    ];
    const plan = decideFires(
      specifiedState(),
      settingsWith({ perAccountHourlyCap: 1 }),
      fired,
      [],
      NOW,
    );
    expect(plan.attempts).toEqual([]);
  });

  it("stops firing once the per-account daily cap is reached, even with the hourly caps unspent (design 4)", () => {
    // More than an hour ago, so the hourly caps are clear, but within
    // the last 24 hours, so the daily cap still counts it.
    const fired: FiredLine[] = [
      {
        ts: "2026-11-23T13:00:00Z",
        node: "P9-N999",
        step: "plan",
        task: "trig_other",
        session: null,
      },
    ];
    const plan = decideFires(
      specifiedState(),
      settingsWith({ perAccountDailyCap: 1 }),
      fired,
      [],
      NOW,
    );
    expect(plan.attempts).toEqual([]);
  });

  it("does not count a fire older than 24 hours against the daily cap", () => {
    const fired: FiredLine[] = [
      {
        ts: "2026-11-23T11:00:00Z", // just over 24 hours before NOW
        node: "P9-N999",
        step: "plan",
        task: "trig_other",
        session: null,
      },
    ];
    const plan = decideFires(
      specifiedState(),
      settingsWith({ perAccountDailyCap: 1 }),
      fired,
      [],
      NOW,
    );
    expect(plan.attempts).toHaveLength(1);
  });

  it("does not fire a task a 429 still blocks", () => {
    const fire429: Fire429Line[] = [
      {
        ts: "2026-11-24T11:00:00Z",
        task: REF.trig,
        retryAfter: "2026-11-24T12:30:00Z",
      },
    ];
    const plan = decideFires(
      specifiedState(),
      settingsWith(),
      [],
      fire429,
      NOW,
    );
    expect(plan.attempts).toEqual([]);
  });

  it("fires again once a 429's Retry-After has passed", () => {
    const fire429: Fire429Line[] = [
      {
        ts: "2026-11-24T11:00:00Z",
        task: REF.trig,
        retryAfter: "2026-11-24T11:30:00Z",
      },
    ];
    const plan = decideFires(
      specifiedState(),
      settingsWith(),
      [],
      fire429,
      NOW,
    );
    expect(plan.attempts).toHaveLength(1);
  });

  describe("recovery after an acknowledged report (P2-N082)", () => {
    // A separate clock from the file's own NOW (2026-11-24): these
    // fixtures replay P2-N033's own dates, 2026-11-27.
    const RECOVERY_NOW = new Date("2026-11-27T11:22:35Z");

    const REPORT_QUESTION =
      "Fire: too many bare attempts: P1-N001 execute has been fired twice since its last close with no task opened.";

    function stateWithClosedReport(chosen: string): State {
      const state = specifiedState();
      state.decisions.push(
        decision({
          id: "D173",
          node: "P1-N001",
          question: REPORT_QUESTION,
          chosen,
          decided: "2026-11-27",
        }),
      );
      return state;
    }

    const OLD_FIRES: FiredLine[] = [
      {
        ts: "2026-11-27T09:05:41Z",
        node: "P1-N001",
        step: "execute",
        task: REF.trig,
        session: null,
      },
      {
        ts: "2026-11-27T11:06:20Z",
        node: "P1-N001",
        step: "execute",
        task: REF.trig,
        session: null,
      },
    ];

    const REPORT_CLOSED: DecisionCloseLine = {
      ts: "2026-11-27T11:22:31Z",
      node: "P1-N001",
      decisionId: "D173",
      chosen: "acknowledge",
    };

    it("fires once, and opens no report, on the write that closes the report (criterion 2)", () => {
      const plan = decideFires(
        stateWithClosedReport("acknowledge"),
        settingsWith(),
        OLD_FIRES,
        [],
        RECOVERY_NOW,
        [REPORT_CLOSED],
        REPORT_CLOSED,
      );
      expect(plan.attempts).toHaveLength(1);
      expect(plan.reports).toEqual([]);
    });

    it("only counts fires since the report's closing, not since the node's last close", () => {
      // Two bare fires stood before the close; none since. Counting
      // them again would report right back rather than recovering.
      const plan = decideFires(
        stateWithClosedReport("acknowledge"),
        settingsWith(),
        OLD_FIRES,
        [],
        RECOVERY_NOW,
        [REPORT_CLOSED],
        null, // a later write, not the one that closed the report
      );
      expect(plan.attempts).toHaveLength(1);
      expect(plan.reports).toEqual([]);
    });

    it("reports again once two further bare fires stand since the restart (criterion 3)", () => {
      const fired: FiredLine[] = [
        ...OLD_FIRES,
        {
          ts: "2026-11-27T11:30:00Z", // after the report's closing
          node: "P1-N001",
          step: "execute",
          task: REF.trig,
          session: null,
        },
        {
          ts: "2026-11-27T12:15:00Z",
          node: "P1-N001",
          step: "execute",
          task: REF.trig,
          session: null,
        },
      ];
      const plan = decideFires(
        stateWithClosedReport("acknowledge"),
        settingsWith(),
        fired,
        [],
        new Date("2026-11-27T13:00:00Z"),
        [REPORT_CLOSED],
        null,
      );
      expect(plan.attempts).toEqual([]);
      expect(plan.reports).toHaveLength(1);
      expect(plan.reports[0]?.reason).toBe("too-many-attempts");
    });

    it('restarts the count the same way for "fire it by hand with Run now"', () => {
      const runNowClosed: DecisionCloseLine = {
        ...REPORT_CLOSED,
        chosen: "fire it by hand with Run now",
      };
      const plan = decideFires(
        stateWithClosedReport("fire it by hand with Run now"),
        settingsWith(),
        OLD_FIRES,
        [],
        RECOVERY_NOW,
        [runNowClosed],
        null, // a later write, not the one that closed the report
      );
      expect(plan.attempts).toHaveLength(1);
      expect(plan.reports).toEqual([]);
    });

    it('does not fire on the write that closes the report with "fire it by hand with Run now" (criterion 4)', () => {
      const runNowClosed: DecisionCloseLine = {
        ...REPORT_CLOSED,
        chosen: "fire it by hand with Run now",
      };
      const plan = decideFires(
        stateWithClosedReport("fire it by hand with Run now"),
        settingsWith(),
        OLD_FIRES,
        [],
        RECOVERY_NOW,
        [runNowClosed],
        runNowClosed, // this round's own trigger was that very write
      );
      expect(plan.attempts).toEqual([]);
      expect(plan.reports).toEqual([]);
    });

    it("fires normally on the next write after a Run-now hand-off", () => {
      const runNowClosed: DecisionCloseLine = {
        ...REPORT_CLOSED,
        chosen: "fire it by hand with Run now",
      };
      const plan = decideFires(
        stateWithClosedReport("fire it by hand with Run now"),
        settingsWith(),
        OLD_FIRES,
        [],
        RECOVERY_NOW,
        [runNowClosed],
        null, // the suppression only ever applies to its own write
      );
      expect(plan.attempts).toHaveLength(1);
    });

    it("does not restart the count when the journal cannot give the closing's time, and stays gated rather than guess", () => {
      // The decision is closed in the state, but its journal line
      // cannot be found (should not happen: defensive only). The count
      // then stays exactly as it stood before the close: the two old
      // fires are still counted, and reported again rather than fired
      // on a guessed boundary.
      const plan = decideFires(
        stateWithClosedReport("acknowledge"),
        settingsWith(),
        OLD_FIRES,
        [],
        RECOVERY_NOW,
        [], // no decision_close line at all for D173
        null,
      );
      expect(plan.attempts).toEqual([]);
      expect(plan.reports).toHaveLength(1);
      expect(plan.reports[0]?.reason).toBe("too-many-attempts");
    });
  });

  it("never plans more than two attempts from one write", () => {
    const state: State = {
      schema: 0,
      project: REPO,
      nodes: [
        node({ id: "P1-N001", title: "First offer", stage: "specified" }),
        node({ id: "P1-N002", title: "Second offer", stage: "specified" }),
        node({ id: "P1-N003", title: "Third offer", stage: "specified" }),
      ],
      tasks: [],
      decisions: [],
    };
    const plan = decideFires(state, settingsWith(), [], [], NOW);
    expect(plan.attempts).toHaveLength(MAX_FIRES_PER_WRITE);
    expect(plan.attempts.map((a) => a.node.id)).toEqual(["P1-N001", "P1-N002"]);
  });
});
