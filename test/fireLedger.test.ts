import { describe, expect, it } from "vitest";

import { parseJournal } from "../src/fire/ledger.js";

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
