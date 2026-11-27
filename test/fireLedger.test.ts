import { describe, expect, it } from "vitest";

import {
  lastLineDecisionClose,
  parseDecisionCloses,
  parseJournal,
} from "../src/fire/ledger.js";

/** The fire ledger's two line shapes in `orchestration/journal.jsonl`
 * (P2-N048, design 3), alongside the store's own `state-written`
 * lines, which this parser ignores. */
describe("parseJournal", () => {
  it("reads fired, fire-429 and fired-session lines, skipping everything else", () => {
    const text = [
      '{"ts":"2026-11-20T10:00:00Z","event":"state-written","task":"T100","node":"P1-N001","note":"x"}',
      '{"ts":"2026-11-20T10:00:01Z","event":"fired","node":"P1-N002","step":"execute","task":"trig_impl","session":"session_abc"}',
      '{"ts":"2026-11-20T10:00:01Z","event":"fired-session","node":"P1-N002","step":"execute","task":"trig_impl","sessionId":"session_fired","sessionUrl":"https://claude.ai/code/session_fired"}',
      '{"ts":"2026-11-20T10:00:02Z","event":"fire-429","task":"trig_impl","retryAfter":"2026-11-20T11:00:00Z"}',
      "not json at all",
      "",
      '{"ts":"2026-11-20T10:00:03Z","event":"fired","node":"P1-N003","step":"plan"}',
    ].join("\n");

    const { fired, fire429, firedSession } = parseJournal(text);
    expect(fired).toEqual([
      {
        ts: "2026-11-20T10:00:01Z",
        node: "P1-N002",
        step: "execute",
        task: "trig_impl",
        session: "session_abc",
      },
    ]);
    expect(fire429).toEqual([
      {
        ts: "2026-11-20T10:00:02Z",
        task: "trig_impl",
        retryAfter: "2026-11-20T11:00:00Z",
      },
    ]);
    expect(firedSession).toEqual([
      {
        ts: "2026-11-20T10:00:01Z",
        node: "P1-N002",
        step: "execute",
        task: "trig_impl",
        sessionId: "session_fired",
        sessionUrl: "https://claude.ai/code/session_fired",
      },
    ]);
  });

  it("reads an empty journal as nothing fired", () => {
    expect(parseJournal("")).toEqual({
      fired: [],
      fire429: [],
      firedSession: [],
    });
  });

  it("skips a fired-session line missing a field either shape needs", () => {
    const { firedSession } = parseJournal(
      '{"ts":"2026-11-20T10:00:01Z","event":"fired-session","node":"P1-N002","step":"execute","task":"trig_impl","sessionId":"session_fired"}',
    );
    expect(firedSession).toEqual([]);
  });

  it("defaults a fired line's session to null when absent", () => {
    const { fired } = parseJournal(
      '{"ts":"2026-11-20T10:00:03Z","event":"fired","node":"P1-N003","step":"plan","task":"trig_x"}',
    );
    expect(fired[0]?.session).toBeNull();
  });
});

/** The `decision_close` lines the fire check's recovery rule reads
 * back (P2-N082, criterion 1 and 4), alongside the store's own
 * `state-written` lines for an ordinary task close, which neither
 * function treats as one. */
describe("parseDecisionCloses", () => {
  it("reads every decision_close line's ts, node, decision id and answer", () => {
    const text = [
      '{"ts":"2026-11-27T09:05:41Z","event":"fired","node":"P2-N033","step":"execute","task":"trig_impl"}',
      '{"ts":"2026-11-27T11:06:20Z","event":"state-written","task":"T001","node":"P2-N033","note":"task_open T001 on P2-N033, execute"}',
      '{"ts":"2026-11-27T11:22:31Z","event":"state-written","task":null,"node":"P2-N033","note":"decision_close D173: acknowledge"}',
      '{"ts":"2026-11-27T12:00:00Z","event":"state-written","task":null,"node":"P2-N033","note":"decision_close D175: fire it by hand with Run now"}',
    ].join("\n");
    expect(parseDecisionCloses(text)).toEqual([
      {
        ts: "2026-11-27T11:22:31Z",
        node: "P2-N033",
        decisionId: "D173",
        chosen: "acknowledge",
      },
      {
        ts: "2026-11-27T12:00:00Z",
        node: "P2-N033",
        decisionId: "D175",
        chosen: "fire it by hand with Run now",
      },
    ]);
  });

  it("reads none from an empty journal or one with no decision_close line", () => {
    expect(parseDecisionCloses("")).toEqual([]);
    expect(
      parseDecisionCloses(
        '{"ts":"2026-11-20T10:00:00Z","event":"state-written","task":"T001","node":"P1-N001","note":"task_open T001 on P1-N001, execute"}',
      ),
    ).toEqual([]);
  });
});

describe("lastLineDecisionClose", () => {
  it("reads the journal's last line when it is a decision_close", () => {
    const text = [
      '{"ts":"2026-11-27T09:05:41Z","event":"fired","node":"P2-N033","step":"execute","task":"trig_impl"}',
      '{"ts":"2026-11-27T11:22:31Z","event":"state-written","task":null,"node":"P2-N033","note":"decision_close D173: acknowledge"}',
    ].join("\n");
    expect(lastLineDecisionClose(text)).toEqual({
      ts: "2026-11-27T11:22:31Z",
      node: "P2-N033",
      decisionId: "D173",
      chosen: "acknowledge",
    });
  });

  it("reads null when the last line is something else, or the journal is empty", () => {
    expect(lastLineDecisionClose("")).toBeNull();
    const text = [
      '{"ts":"2026-11-27T11:22:31Z","event":"state-written","task":null,"node":"P2-N033","note":"decision_close D173: acknowledge"}',
      '{"ts":"2026-11-27T11:22:40Z","event":"fired","node":"P2-N033","step":"execute","task":"trig_impl"}',
    ].join("\n");
    expect(lastLineDecisionClose(text)).toBeNull();
  });
});
