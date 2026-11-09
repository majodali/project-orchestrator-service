#!/usr/bin/env node
/**
 * `plan-state`: the state file's command line.
 *
 *   plan-state import --repo <path> [--overrides <file>] [--accepted <plan>=<date>]... [--write]
 *   plan-state check  --repo <path>
 *   plan-state render --repo <path> [--write]
 *
 * Exit 0 when clean, 1 on a violation or a failure, 2 on usage.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  PLAN_PATH,
  REGISTER_PATH,
  STATE_PATH,
  checkRepository,
  checkState,
  formatFinding,
  type Finding,
} from "./check.js";
import {
  importState,
  renderImportRecord,
  type Overrides,
} from "./importState.js";
import { renderPlan, renderRegister } from "./render.js";
import { formatState } from "./schema.js";

const RECORD_PATH = "orchestration/import-record.md";

function usage(): never {
  console.error(
    [
      "usage: plan-state <command> --repo <path> [options]",
      "",
      "commands:",
      "  import   read the frozen registers and write the state file and its import record (--write)",
      "  check    validate the state file and its renderings in the repository",
      "  render   write docs/plan-register.md and docs/plan.md from the state file (--write)",
      "",
      "options:",
      "  --repo <path>            the managed repository (default: cwd)",
      "  --project <owner/name>   import: the project name (default: from the git remote)",
      "  --overrides <file>       import: hand corrections, applied last",
      "  --accepted <plan>=<date> import: a plan whose decisions the owner accepted together",
      "  --write                  import, render: write the files instead of printing",
    ].join("\n"),
  );
  process.exit(2);
}

function readOptional(root: string, rel: string): string | null {
  const p = path.join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf-8") : null;
}

function projectFromRemote(root: string): string | null {
  const config = readOptional(root, ".git/config");
  const m = config
    ? /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/m.exec(config)
    : null;
  return m ? m[1]! : null;
}

function report(findings: Finding[]): number {
  for (const f of findings) console.log(formatFinding(f));
  const violations = findings.filter((f) => f.severity === "violation").length;
  const warnings = findings.length - violations;
  console.log(
    `plan-state: ${violations} violation(s), ${warnings} warning(s).`,
  );
  return violations > 0 ? 1 : 0;
}

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      project: { type: "string" },
      overrides: { type: "string" },
      accepted: { type: "string", multiple: true },
      write: { type: "boolean" },
    },
  });
  const command = positionals[0];
  if (!command) usage();
  const root = path.resolve(values.repo ?? process.cwd());

  if (command === "import") {
    const register = readOptional(root, REGISTER_PATH);
    if (register === null) {
      console.error(`plan-state: ${REGISTER_PATH} not found under ${root}`);
      return 1;
    }
    const project = values.project ?? projectFromRemote(root);
    if (!project) {
      console.error("plan-state: --project is needed; no GitHub remote found");
      return 1;
    }
    const plans = new Map<string, string>();
    const plansDir = path.join(root, "docs", "plans");
    if (existsSync(plansDir)) {
      for (const f of readdirSync(plansDir).sort()) {
        if (f.endsWith(".md"))
          plans.set(
            `docs/plans/${f}`,
            readFileSync(path.join(plansDir, f), "utf-8"),
          );
      }
    }
    const acceptedPlans: Record<string, string> = {};
    for (const a of values.accepted ?? []) {
      const [p, d] = a.split("=");
      if (!p || !d) usage();
      acceptedPlans[p] = d;
    }
    const overrides = values.overrides
      ? (JSON.parse(
          readFileSync(path.resolve(values.overrides), "utf-8"),
        ) as Overrides)
      : null;
    const { state, record } = importState({
      project,
      register,
      costLog: readOptional(root, "docs/cost-log.md"),
      journal: readOptional(root, "orchestration/journal.jsonl"),
      rulings: readOptional(root, "docs/rulings.md"),
      plans,
      acceptedPlans,
      exists: (rel) => existsSync(path.join(root, rel)),
      overrides,
    });
    const today = new Date().toISOString().slice(0, 10);
    const recordText = renderImportRecord(record, today);
    if (values.write) {
      writeFileSync(path.join(root, STATE_PATH), formatState(state));
      writeFileSync(path.join(root, RECORD_PATH), recordText);
      console.log(`plan-state: wrote ${STATE_PATH} and ${RECORD_PATH}`);
    } else {
      console.log(recordText);
    }
    const { findings } = checkState(state);
    return report(findings);
  }

  const stateText = readOptional(root, STATE_PATH);
  if (stateText === null) {
    console.error(`plan-state: ${STATE_PATH} not found under ${root}`);
    return 1;
  }
  let value: unknown;
  try {
    value = JSON.parse(stateText);
  } catch (err) {
    console.error(
      `plan-state: ${STATE_PATH} is not JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  const { state, findings } = checkState(value);
  if (state === null) return report(findings);

  if (command === "check") {
    if (formatState(state) !== stateText) {
      findings.push({
        severity: "warning",
        invariant: 1,
        subject: null,
        message: `${STATE_PATH} is not in the canonical format; rewrite it with plan-state render --write`,
      });
    }
    findings.push(
      ...checkRepository(state, root, (rel) => readOptional(root, rel)),
    );
    return report(findings);
  }

  if (command === "render") {
    const register = renderRegister(state);
    const plan = renderPlan(state);
    if (values.write) {
      writeFileSync(path.join(root, STATE_PATH), formatState(state));
      writeFileSync(path.join(root, REGISTER_PATH), register);
      writeFileSync(path.join(root, PLAN_PATH), plan);
      console.log(`plan-state: wrote ${REGISTER_PATH} and ${PLAN_PATH}`);
    } else {
      console.log(register);
      console.log(plan);
    }
    return report(findings);
  }

  usage();
}

process.exit(main(process.argv.slice(2)));
