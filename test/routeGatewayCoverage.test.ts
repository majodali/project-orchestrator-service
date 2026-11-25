import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";

/**
 * P2-N069, criterion 2: a path only answers from the service at the
 * production endpoint when API Gateway itself routes it — a path the
 * application registers but template.yaml does not route answers API
 * Gateway's own 404 before the request ever reaches the Lambda (the
 * node's note, "what was observed", 2026-11-24). This reads what
 * `src/httpApp.ts` (and, through it, `src/view/routes.ts`) actually
 * registers on the Hono app, and template.yaml's own `RouteKey`s, so
 * a path newly registered but left unrouted fails here instead of
 * only in production.
 */

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const TEMPLATE = readFileSync(path.join(REPO_ROOT, "template.yaml"), "utf-8");

/** One path segment: a literal, or a parameter — of either the
 * application's own syntax (`:id`) or the gateway's (`{id}`). Only
 * the position carries meaning for a parameter; the name does not. */
type Segment = { literal: string } | { param: true };

function segmentsOf(urlPath: string): Segment[] {
  return urlPath
    .split("/")
    .filter((s) => s.length > 0)
    .map((s): Segment => {
      if (s.startsWith(":")) return { param: true };
      if (/^\{[A-Za-z0-9_]+\}$/.test(s)) return { param: true };
      return { literal: s };
    });
}

function pathsMatch(appPath: string, routePath: string): boolean {
  const a = segmentsOf(appPath);
  const r = segmentsOf(routePath);
  if (a.length !== r.length) return false;
  return a.every((seg, i) => {
    const other = r[i]!;
    if ("literal" in seg || "literal" in other) {
      return (
        "literal" in seg && "literal" in other && seg.literal === other.literal
      );
    }
    return true;
  });
}

/** Every route key in template.yaml, split into its method (a literal
 * verb, or `ANY`) and path. */
function templateRoutes(): { method: string; path: string }[] {
  return [...TEMPLATE.matchAll(/RouteKey: "([A-Z]+) ([^"]+)"/g)].map((m) => ({
    method: m[1]!,
    path: m[2]!,
  }));
}

function methodMatches(appMethod: string, routeMethod: string): boolean {
  // An application route that answers every method (Hono's `app.all`,
  // recorded as method `ALL`) needs the gateway's own every-method
  // route key, `ANY`: a route key naming one verb would 404 the rest.
  if (appMethod === "ALL") return routeMethod === "ANY";
  return routeMethod === "ANY" || routeMethod === appMethod;
}

/** The application's own registered routes (`app.routes`),
 * deduplicated and stripped of the global middleware Hono records in
 * the same list (`app.use("*", ...)`: method `ALL`, path `/*`,
 * matching every path rather than naming one the application serves). */
function appRoutes(): { method: string; path: string }[] {
  const app = createApp();
  const seen = new Set<string>();
  const out: { method: string; path: string }[] = [];
  for (const r of app.routes) {
    if (r.path === "/*") continue;
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method: r.method, path: r.path });
  }
  return out;
}

/** Paths the application registers that this test does not require a
 * gateway route for, each with why (criterion 2: "An exemption, if
 * any is needed, is named in the test with its reason"). */
const EXEMPT = new Map<string, string>([
  [
    "GET /view/*",
    "the application's own fallback for any other /view path " +
      '(src/view/routes.ts, "No page here yet"); whether it is also ' +
      "routed at the gateway, so the gateway's own 404 never shows " +
      "instead, is the implementer's choice (node P2-N069, criterion " +
      "1), not a requirement this test enforces.",
  ],
]);

describe("every path the application registers answers from a gateway route (P2-N069, criterion 2)", () => {
  for (const { method, path: appPath } of appRoutes()) {
    const key = `${method} ${appPath}`;
    const exemption = EXEMPT.get(key);
    if (exemption !== undefined) {
      it.skip(`${key} — exempt: ${exemption}`, () => {
        /* not checked */
      });
      continue;
    }
    it(key, () => {
      const routes = templateRoutes();
      const matched = routes.some(
        (route) =>
          methodMatches(method, route.method) &&
          pathsMatch(appPath, route.path),
      );
      expect(
        matched,
        `${key} is registered by the application but no route key in ` +
          `template.yaml matches it: at the production endpoint, API ` +
          `Gateway would answer its own 404 before the request reaches ` +
          `the service.`,
      ).toBe(true);
    });
  }
});
