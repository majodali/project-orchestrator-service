import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/httpApp.js";

/**
 * P2-N069, criterion 2, and P2-N072 (its gateway-to-application
 * direction): a path only answers from the service at the production
 * endpoint when both sides agree it should route there. The
 * application-to-gateway direction (below) catches a path the
 * application registers but template.yaml does not route — API
 * Gateway's own 404 before the request ever reaches the Lambda (the
 * node's note, "what was observed", 2026-11-24). The
 * gateway-to-application direction catches the opposite: a route key
 * template.yaml declares that the application registers no path for,
 * which would forward a request to the Lambda for a path the
 * application itself then 404s. Both read what `src/httpApp.ts` (and,
 * through it, `src/view/routes.ts`) actually registers on the Hono
 * app, and template.yaml's own `RouteKey`s, so a path newly
 * registered or newly routed, on either side, without its
 * counterpart on the other, fails here instead of only in production.
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

/** Every exemption either direction's check takes, each naming the
 * side it exempts (an application route, a gateway route key, or
 * both as a pair) and the reason it stays — one place, consulted by
 * both describe blocks below (P2-N072, criterion 5). */
const EXEMPTIONS: { app?: string; gateway?: string; reason: string }[] = [
  {
    app: "GET /view/*",
    gateway: "GET /view/{proxy+}",
    reason:
      "the application's own fallback for any other /view path " +
      '(src/view/routes.ts, "No page here yet") and the gateway\'s ' +
      "route key for it (template.yaml's ViewCatchAllRoute, node " +
      "P2-N069 criterion 1) serve the same paths, but this check's " +
      "path matching treats a literal `*` and a greedy `{proxy+}` as " +
      "different shapes, so neither direction requires them to match " +
      "each other exactly.",
  },
];

describe("every path the application registers answers from a gateway route (P2-N069, criterion 2; P2-N072, the application-to-gateway direction)", () => {
  for (const { method, path: appPath } of appRoutes()) {
    const key = `${method} ${appPath}`;
    const exemption = EXEMPTIONS.find((e) => e.app === key);
    if (exemption !== undefined) {
      it.skip(`${key} — exempt: ${exemption.reason}`, () => {
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

describe("every route key in template.yaml routes to a path the application registers (P2-N072, the gateway-to-application direction)", () => {
  for (const { method, path: routePath } of templateRoutes()) {
    const key = `${method} ${routePath}`;
    const exemption = EXEMPTIONS.find((e) => e.gateway === key);
    if (exemption !== undefined) {
      it.skip(`${key} — exempt: ${exemption.reason}`, () => {
        /* not checked */
      });
      continue;
    }
    it(key, () => {
      const routes = appRoutes();
      const matched = routes.some(
        (route) =>
          methodMatches(route.method, method) &&
          pathsMatch(route.path, routePath),
      );
      expect(
        matched,
        `${key} is a route key in template.yaml but the application ` +
          `registers no path that matches it: at the production ` +
          `endpoint, API Gateway would forward the request to the ` +
          `Lambda, which would then answer its own 404.`,
      ).toBe(true);
    });
  }
});
