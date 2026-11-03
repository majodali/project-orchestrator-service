import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";
import { parseRegister } from "../src/planRegister/parser.js";
import { modelAtPage } from "../src/view/projectModel.js";
import { placeResources, treeStatuses } from "../src/view/treeModel.js";
import {
  FakeRepository,
  NOW,
  SHA_A,
  attributeText,
  expectLinksPinned,
  expectPhoneWidth,
  textOf,
  validCookie,
  viewEnv,
} from "./support/view.js";

/**
 * The tree page's aggregate status and resource placement (node
 * P2-N023, iteration 2, by the owner's rules of 2026-11-03). Expected
 * values are written by hand from the rules in src/view/treeModel.ts.
 */

const F = "from [Backlog](backlog.md)";

function entry(
  heading: string,
  created: string,
  modified: string,
  used: string,
  state = "built",
): string {
  return `## ${heading}

- **is:** A part (${F})
- **state:** ${state} (derived; from [Plan register](plan-register.md))
- **spec:** not yet derived (${F})
- **risks:** not yet derived (${F})
- **created-by:** ${created}
- **modified-by:** ${modified}
- **used-by:** ${used}
`;
}

describe("aggregate status: the first rule that holds over the node and its subtree", () => {
  const REGISTER = [
    "# Plan register",
    "",
    "- P5-N001 [done] All done",
    "  - P5-N002 [done] Done child",
    "- P5-N003 [broken-down] Holds an owner gate below",
    "  - P5-N004 [executing] Running",
    "  - P5-N005 [planned] [gated: owner review of the plan] Gated",
    "- P5-N006 [identified] Mixed: one child done",
    "  - P5-N007 [done] Done",
    "  - P5-N008 [identified] Not started",
    "- P5-N009 [identified] Blocked below",
    "  - P5-N010 [identified] [blocked: waiting on a vendor] Blocked",
    "- P5-N011 [specified] Waits on a recorded dependency",
    "- P5-N012 [identified] Nothing in the way",
    "- P5-N013 [identified] Creates what P5-N011 uses",
    "",
  ].join("\n");
  const INSTANCE = [
    "# Project model\n",
    entry(
      "needed",
      `P5-N013 (Creates; ${F})`,
      `none (nothing; ${F})`,
      `P5-N011 (Waits; ${F})`,
      "planned",
    ),
  ].join("\n");

  it("gives done, owner, progress, pending and ready as written by hand", () => {
    const statuses = treeStatuses(
      parseRegister(REGISTER),
      modelAtPage(SHA_A, INSTANCE),
    );
    expect(Object.fromEntries(statuses)).toEqual({
      "P5-N001": "done",
      "P5-N002": "done",
      "P5-N003": "owner",
      "P5-N004": "progress",
      "P5-N005": "owner",
      "P5-N006": "progress",
      "P5-N007": "done",
      "P5-N008": "ready",
      "P5-N009": "pending",
      "P5-N010": "pending",
      "P5-N011": "pending",
      "P5-N012": "ready",
      "P5-N013": "ready",
    });
  });

  it("reads no dependency when the instance is absent: a node not started is ready unless blocked", () => {
    const statuses = treeStatuses(parseRegister(REGISTER), {
      kind: "absent",
      sha: SHA_A,
    });
    expect(statuses.get("P5-N011")).toBe("ready");
    expect(statuses.get("P5-N010")).toBe("pending");
  });
});

describe("resource placement: under the highest of creator, modifier and the parent of a user", () => {
  const REGISTER = [
    "# Plan register",
    "",
    "- P6-N001 [broken-down] Root A",
    "  - P6-N002 [broken-down] Middle",
    "    - P6-N003 [identified] Deep creator",
    "    - P6-N004 [identified] Deep user",
    "  - P6-N005 [done] Shallow modifier",
    "- P6-N006 [identified] Root B, a user at the root",
    "",
  ].join("\n");
  const INSTANCE = [
    "# Project model\n",
    entry(
      "by-modifier",
      `P6-N003 (Deep; ${F})`,
      `P6-N005 (Shallow; ${F})`,
      `none (nothing; ${F})`,
      "planned",
    ),
    entry(
      "by-user-parent",
      `P6-N003 (Deep; ${F})`,
      `none (nothing; ${F})`,
      `P6-N004 (Deep user; ${F})`,
      "planned",
    ),
    entry(
      "by-root-user",
      `P6-N003 (Deep; ${F})`,
      `none (nothing; ${F})`,
      `P6-N006 (Root B; ${F})`,
      "planned",
    ),
    entry(
      "by-creator",
      `P6-N003 (Deep; ${F})`,
      `none (nothing; ${F})`,
      `none (nothing; ${F})`,
      "planned",
    ),
    entry(
      "unplaced",
      `not yet derived (${F})`,
      `none (nothing; ${F})`,
      `P9-N999 (Gone; ${F})`,
    ),
    entry(
      "gate-only",
      `P6-N001 gate (Root A; ${F})`,
      `none (nothing; ${F})`,
      `none (nothing; ${F})`,
    ),
  ].join("\n");

  it("places each entry as written by hand, and lists the rest with the reason", () => {
    const placed = placeResources(
      parseRegister(REGISTER),
      modelAtPage(SHA_A, INSTANCE),
    );
    expect(placed.map((p) => [p.row.entry.slug, p.nodeId, p.reason])).toEqual([
      // P6-N005 (depth 1) is higher than P6-N003 (depth 2).
      ["by-modifier", "P6-N005", null],
      // P6-N004's parent, P6-N002 (depth 1), is higher than P6-N003.
      ["by-user-parent", "P6-N002", null],
      // A user at the root counts as itself, at depth 0.
      ["by-root-user", "P6-N006", null],
      ["by-creator", "P6-N003", null],
      [
        "unplaced",
        null,
        "No node in the register creates, modifies or uses it (created-by: not yet derived; modified-by: none; used-by: P9-N999 (not in the register)).",
      ],
      [
        "gate-only",
        null,
        "No node in the register creates, modifies or uses it (created-by: P6-N001 gate; modified-by: none; used-by: none).",
      ],
    ]);
  });

  it("breaks a tie by register order", () => {
    const placed = placeResources(
      parseRegister(REGISTER),
      modelAtPage(
        SHA_A,
        [
          "# Project model\n",
          entry(
            "tie",
            `P6-N006 (Root B; ${F})`,
            `P6-N001 (Root A; ${F})`,
            `none (nothing; ${F})`,
            "planned",
          ),
        ].join("\n"),
      ),
    );
    expect(placed.map((p) => p.nodeId)).toEqual(["P6-N001"]);
  });

  it("places nothing when the instance is absent", () => {
    expect(
      placeResources(parseRegister(REGISTER), { kind: "absent", sha: SHA_A }),
    ).toEqual([]);
  });
});

describe("the tree page, node P2-N023 iteration 3: resource icons, dates and the problems section", () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    viewEnv();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const REGISTER = [
    "# Plan register",
    "",
    "- P7-N001 [broken-down] Root",
    "  - P7-N002 [executing] Building it",
    "  - P7-N003 [done] Built it",
    "- P7-N004 [Not A Stage] this line is not a register line",
    "",
  ].join("\n");
  const DATED = `P7-N003 (Built it; done 2026-10-01; from [Cost log](cost-log.md))`;
  const INSTANCE = [
    "# Project model\n",
    entry(
      "in-progress",
      `P7-N002 (Building it; ${F})`,
      `none (nothing; ${F})`,
      `none (nothing; ${F})`,
      "building",
    ),
    entry("finished", DATED, `none (nothing; ${F})`, `none (nothing; ${F})`),
    entry(
      "nowhere",
      `not yet derived (${F})`,
      `none (nothing; ${F})`,
      `none (nothing; ${F})`,
    ),
  ].join("\n");

  async function page(files: Record<string, string>): Promise<string> {
    const repo = new FakeRepository();
    repo.heads.set("main", SHA_A);
    for (const [path, content] of Object.entries(files)) {
      repo.setFile(SHA_A, path, content);
    }
    const res = await createApp({
      view: { reader: repo, now: () => NOW },
    }).request("/view", { headers: { Cookie: validCookie() } });
    expect(res.status).toBe(200);
    return res.text();
  }

  it("gives building its own icon, and drops the When clause of a row with no date", async () => {
    const html = await page({
      "docs/plan-register.md": REGISTER,
      "docs/project-model.md": INSTANCE,
    });
    const row = (slug: string): string => {
      const m = new RegExp(
        `<li[^>]*data-map-row="${slug}"[\\s\\S]*?</li>`,
      ).exec(html);
      expect(m, slug).not.toBeNull();
      return m![0];
    };
    expect(row("in-progress")).toContain('data-resource-icon="building"');
    expect(row("in-progress")).toContain('data-value="building"');
    expect(textOf(row("in-progress"))).not.toContain("When:");
    expect(row("finished")).toContain('data-resource-icon="built"');
    expect(textOf(row("finished"))).toContain("When: 2026-10-01");
    expect(html).toContain(".r-building{color:var(--progress)}");
    expectLinksPinned(html, undefined);
    expectPhoneWidth(html);
  });

  it("lists register lines that did not parse and unplaced resources in one problems section at the bottom", async () => {
    const html = await page({
      "docs/plan-register.md": REGISTER,
      "docs/project-model.md": INSTANCE,
    });
    const at = html.indexOf('<section class="problems" data-problems>');
    expect(at).toBeGreaterThan(html.indexOf('<ul class="tree">'));
    const problems = html.slice(at, html.indexOf("</main>"));
    expect(problems).toContain('data-problem="register"');
    expect(textOf(problems)).toContain("this line is not a register line");
    expect(problems).toContain('data-problem="unplaced"');
    expect(problems).toContain('data-map-row="nowhere"');
    expect(attributeText(problems, "data-unplaced-reason")).toBe(
      "No node in the register creates, modifies or uses it (created-by: not yet derived; modified-by: none; used-by: none).",
    );
    // The tree holds the two placed rows and not the unplaced one.
    const tree = html.slice(html.indexOf('<ul class="tree">'), at);
    expect(tree).toContain('data-map-row="in-progress"');
    expect(tree).not.toContain('data-map-row="nowhere"');
  });

  it("says the instance is absent there, and shows no problems section when nothing is wrong", async () => {
    const absent = await page({ "docs/plan-register.md": REGISTER });
    expect(absent).toContain('data-problem="model-absent"');
    const clean = await page({
      "docs/plan-register.md": "- P7-N001 [done] Root",
      "docs/project-model.md": "# Project model\n",
    });
    expect(clean).not.toContain("data-problems");
  });
});
