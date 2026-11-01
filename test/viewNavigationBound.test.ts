import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import {
  facetLine,
  parseProjectModel,
} from "../src/planRegister/vendored/project-model.js";
import type {
  FacetLabel,
  ModelEntry,
} from "../src/planRegister/vendored/project-model.js";
import {
  COMMIT_2DA1843,
  FILES_2DA1843,
  repository2da1843,
} from "./support/fixtures2da1843.js";
import {
  NOW,
  OWNER,
  REPO,
  unescapeHtml,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * V27, the navigation bound, per view (node P2-N021, task E3; the
 * specification of P2-N003, child 1). From the tree page, each of the
 * five answers for a resource is reached within three steps, a link
 * click counting as one (docs/process/project-model.md in the
 * coordinating repository, "The navigation bound"). Measured on the
 * instance at 2da1843, the head of `main` when task E3 started.
 *
 * The walk, from the tree page (step zero):
 *   - step 1: the map row's pointer opens the instance at the entry's
 *     heading. The entry's is, state and edge lines are then open:
 *     "what it is", "what state it is in" and "what it depends on, and
 *     what depends on it" are reached. Scrolling within an open
 *     document is not a step.
 *   - step 2: a spec or risks line that links a document is followed:
 *     "what specification it must meet" and "what risks attach to it"
 *     are reached. A line that reads `none` or `not yet derived` states
 *     its answer itself, at step 1.
 */

const MODEL = "docs/project-model.md";
const INSTANCE = FILES_2DA1843.get(MODEL)!;
const PARSED = parseProjectModel(INSTANCE);

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  viewEnv();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

type Steps = [
  slug: string,
  is: number,
  state: number,
  spec: number,
  risks: number,
  edges: number,
];

/** Steps to the answer a line states: 1 when the line states it, 2
 * when the line links the document that does. */
function linkedAnswer(entry: ModelEntry, label: FacetLabel): number {
  const items = facetLine(entry, label)?.items ?? [];
  const linked = items.some(
    (item) => item.form.kind === "link" || item.form.kind === "risk",
  );
  return linked ? 2 : 1;
}

/** The anchors GitHub gives the instance's headings, in file order,
 * by line: a repeat of an anchor takes `-1`, `-2` and so on, as
 * GitHub's renderer names them. Written here apart from the code under
 * test. */
function headingAnchors(text: string): Map<number, string> {
  const out = new Map<number, string>();
  const count = new Map<string, number>();
  text.split("\n").forEach((line, i) => {
    if (!/^#{1,6} /.test(line)) return;
    const base = line
      .replace(/^#{1,6} /, "")
      .toLowerCase()
      .replace(/[()`,.:'"]/g, "")
      .replace(/ /g, "-");
    const n = count.get(base) ?? 0;
    count.set(base, n + 1);
    out.set(i + 1, n === 0 ? base : `${base}-${n}`);
  });
  return out;
}

async function treePage(): Promise<string> {
  const app = createApp({
    view: { reader: repository2da1843(), now: () => NOW },
  });
  const res = await app.request("/view", {
    headers: { Cookie: validCookie() },
  });
  expect(res.status).toBe(200);
  return res.text();
}

/** Walks from the tree page to each answer for one entry. */
function walk(html: string, entry: ModelEntry): Steps {
  // Step 1: the pointer, on the entry's map row, opens the instance at
  // the entry's heading, at the page's SHA.
  const row = new RegExp(
    `<li data-map-row="${entry.slug}">[\\s\\S]*?data-pointer href="([^"]+)"`,
  ).exec(html);
  expect(row, entry.slug).not.toBeNull();
  const href = unescapeHtml(row![1]!);
  const anchors = headingAnchors(INSTANCE);
  const anchor = anchors.get(entry.line)!;
  expect(href).toBe(
    `https://github.com/${OWNER}/${REPO}/blob/${COMMIT_2DA1843}/${MODEL}#${anchor}`,
  );
  // The anchor names this entry's heading and no other.
  expect(
    [...anchors.values()].filter((a) => a === anchor),
    entry.slug,
  ).toHaveLength(1);
  for (const label of [
    "is",
    "state",
    "created-by",
    "modified-by",
    "used-by",
  ] as const) {
    const line = facetLine(entry, label)!;
    expect(line.line, `${entry.slug} ${label}`).toBeGreaterThan(entry.line);
    expect(line.line, `${entry.slug} ${label}`).toBeLessThanOrEqual(
      entry.endLine,
    );
  }
  return [
    entry.slug,
    1,
    1,
    linkedAnswer(entry, "spec"),
    linkedAnswer(entry, "risks"),
    1,
  ];
}

describe("V27 — the navigation bound, from the tree page, at 2da1843", () => {
  it("every fifth entry in file order, from the first: each of the five answers within three steps, as walked by hand", async () => {
    const html = await treePage();
    const sample = PARSED.entries.filter((_, i) => i % 5 === 0);
    // Walked by hand: the entry's position in file order, then the
    // steps to is, state, spec, risks and the edge lines.
    expect(sample.map((entry) => walk(html, entry))).toEqual([
      ["form-checker", 1, 1, 2, 2, 1], // 1st
      ["project-model", 1, 1, 1, 1, 1], // 6th: spec and risks not yet derived
      ["dispatch-rules", 1, 1, 1, 1, 1], // 11th
      ["RU-015", 1, 1, 1, 1, 1], // 16th
      ["risk-register", 1, 1, 1, 1, 1], // 21st
      ["RU-003", 1, 1, 1, 1, 1], // 26th
      ["project-orchestrator-service-repo", 1, 1, 1, 1, 1], // 31st
      ["task-tools", 1, 1, 1, 1, 1], // 36th
      ["session-handle", 1, 1, 1, 1, 1], // 41st
    ] satisfies Steps[]);
  });

  it("every entry, not only the sample, stays within the bound of three", async () => {
    const html = await treePage();
    for (const entry of PARSED.entries) {
      const [, ...steps] = walk(html, entry);
      expect(Math.max(...steps), entry.slug).toBeLessThanOrEqual(3);
    }
  });
});
