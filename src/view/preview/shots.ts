/**
 * `npm run view:shots` (node P2-N023, iteration 1): screenshots of the
 * web view's three reference pages, at phone and desktop widths, from
 * the preview.
 *
 *   npm run view:shots -- --iteration 2 --label before
 *
 * It starts the local server in preview mode on a free port, signs in
 * through the real sign-in form with Playwright, loads the tree page,
 * the node page for P2-N021 and the task page for T094, and writes
 * full-page PNGs to the gitignored `shots/` directory, named
 * `ux-<NN>-<label>-<page>-<width>.png`. A page wider than its viewport
 * (a horizontal scroll) is reported and fails the run.
 *
 * Playwright is not a dependency of this repository: Claude Code
 * sessions have it pre-installed, and elsewhere `npm install
 * --no-save playwright && npx playwright install chromium` provides it.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";

import { REPO_ROOT, assembleFixtureSet } from "./fixtureSet.js";

export const SHOT_PAGES = [
  { name: "tree", path: "/view" },
  { name: "node-P2-N021", path: "/view/node/P2-N021" },
  { name: "task-T094", path: "/view/task/T094" },
] as const;

export const SHOT_WIDTHS = [
  { name: "phone", width: 390, height: 844, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
] as const;

/** `ux-01-after-tree-phone.png`. */
export function shotFileName(
  iteration: number,
  label: string,
  page: string,
  width: string,
): string {
  return `ux-${String(iteration).padStart(2, "0")}-${label}-${page}-${width}.png`;
}

/** The part of Playwright's API this script uses; Playwright is not a
 * dependency, so its types are not available here. */
interface Chromium {
  launch(): Promise<Browser>;
}
interface Browser {
  newContext(options: object): Promise<BrowserContext>;
  close(): Promise<void>;
}
interface BrowserContext {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}
interface Page {
  goto(url: string): Promise<{ status(): number } | null>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  waitForURL(url: string): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

async function waitForHealth(base: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the preview did not answer ${base}/health within 30 s`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      iteration: { type: "string", default: "1" },
      label: { type: "string", default: "after" },
    },
  });
  const iteration = Number.parseInt(values.iteration, 10);
  if (!Number.isInteger(iteration) || iteration < 1 || iteration > 99) {
    throw new Error(`--iteration must be 1 to 99, got ${values.iteration}`);
  }
  const label = values.label;
  if (!/^[a-z0-9-]+$/.test(label)) {
    throw new Error(`--label must be lower-case letters, digits and dashes`);
  }

  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright") as { chromium: Chromium };

  // A fresh local token per run, used only to sign in below.
  const viewToken = `local-shots-${randomBytes(12).toString("hex")}`;
  const env: NodeJS.ProcessEnv = { ...process.env, VIEW_TOKEN: viewToken };
  delete env.MCP_AUTH_TOKEN;
  if (!env.VIEW_FIXTURE_DIR) {
    const set = assembleFixtureSet();
    env.VIEW_FIXTURE_DIR = set.dir;
    env.VIEW_FIXTURE_SHA ??= set.sha;
  }
  const port = await freePort();
  env.PORT = String(port);
  const base = `http://localhost:${port}`;

  const server = spawn(
    process.execPath,
    [
      path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(REPO_ROOT, "src", "localServer.ts"),
    ],
    { env, stdio: ["ignore", "ignore", "inherit"] },
  );
  const outDir = path.join(REPO_ROOT, "shots");
  mkdirSync(outDir, { recursive: true });
  const overflows: string[] = [];
  const browser = await chromium.launch();
  try {
    await waitForHealth(base);
    for (const size of SHOT_WIDTHS) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.isMobile ? 2 : 1,
        isMobile: size.isMobile,
        hasTouch: size.isMobile,
      });
      const page = await context.newPage();
      await page.goto(`${base}/view/sign-in`);
      await page.fill("#token", viewToken);
      await Promise.all([
        page.waitForURL(`${base}/view`),
        page.click('button[type="submit"]'),
      ]);
      for (const target of SHOT_PAGES) {
        const res = await page.goto(`${base}${target.path}`);
        if (res === null || res.status() !== 200) {
          throw new Error(
            `${target.path} answered ${res?.status() ?? "nothing"} at ${size.name} width`,
          );
        }
        const widths = (await page.evaluate(
          "({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })",
        )) as { scroll: number; client: number };
        if (widths.scroll > widths.client) {
          overflows.push(
            `${target.path} at ${size.name} width: ${widths.scroll} px wide in a ${widths.client} px viewport`,
          );
        }
        const file = path.join(
          outDir,
          shotFileName(iteration, label, target.name, size.name),
        );
        await page.screenshot({ path: file, fullPage: true });
        console.log(path.relative(REPO_ROOT, file));
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
  if (overflows.length > 0) {
    console.error(`Horizontal scroll:\n  ${overflows.join("\n  ")}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
