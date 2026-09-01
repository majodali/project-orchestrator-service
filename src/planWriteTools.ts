/**
 * `plan_lease_acquire` / `plan_update` / `plan_confirm` /
 * `plan_lease_release` — chunk 1 child D, node P2-N010 of
 * docs/plans/p2-n002-service-skeleton.md in the coordinating
 * repository (majodali/project-orchestrator). The three-step,
 * git-authoritative write model that child's plan describes:
 *
 *   1. `plan_lease_acquire` — take the project's advisory write lease
 *      (TTL-expiring; decision 7). One holder at a time; a second
 *      acquirer is refused while the first is live.
 *   2. `plan_update` — name the node, the target stage, and the
 *      reason. Validated against the node lifecycle
 *      (docs/process/plan-model.md, ./planRegister/transitions.ts)
 *      and against the register as it currently stands in git
 *      (./planRegister/updateEngine.ts) — never against a cached
 *      answer. Returns the *exact* edit to make: file, the line as it
 *      is, the line as it should be. This service never applies it
 *      and holds no repository write credential (G4).
 *   3. The calling session applies the edit, commits it with its
 *      documentation in the same commit (W-003), pushes, and calls
 *      `plan_confirm` with the resulting SHA. The service fetches the
 *      register at that SHA and checks it actually carries the edit —
 *      a mismatch is a divergence, reported loudly, naming the file
 *      and the line (I3, the R10 detection) — then releases the
 *      lease. `plan_lease_release` releases it early instead, for a
 *      session that acquired but did not finish.
 *
 * Every one of the four takes an explicit `ref` (`plan_update` /
 * `plan_confirm` also a `sha`) and never derives plan state from
 * anything but a fresh fetch through the GitHub App (I5) — there is
 * no cache of register content anywhere in this service, on the read
 * path or this one; every call re-fetches (R10 is "closed by
 * construction" per the parent plan, not by discipline this module
 * has to uphold on its own).
 *
 * Test/dev wiring mirrors src/planReadTool.ts exactly:
 * `fetcherOverride` / `leaseBackendOverride` are the injectable seams;
 * production call sites (src/mcpServer.ts) leave them unset and get
 * ./planRegister/defaultFetcher.ts and
 * ./planRegister/defaultLeaseBackend.ts's real, lazily-built
 * implementations instead.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { GithubAppAuthError } from "./planRegister/githubAppAuth.js";
import {
  GithubAppNotConfiguredError,
  getDefaultRegisterFetcher,
} from "./planRegister/defaultFetcher.js";
import type { RegisterFetcher } from "./planRegister/registerFetcher.js";
import { GithubFetchError } from "./planRegister/registerFetcher.js";
import {
  LeaseBackendNotConfiguredError,
  getDefaultLeaseBackend,
} from "./planRegister/defaultLeaseBackend.js";
import type { LeaseBackend, LeaseInfo } from "./planRegister/leaseBackend.js";
import {
  checkConfirmed,
  planTransitionEdit,
} from "./planRegister/updateEngine.js";

const DEFAULT_TTL_SECONDS = 600; // 10 minutes — ample for read/edit/commit/push/confirm
const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 3600; // decision 7: minimal, not tuned for contention (chunk 4)

export interface PlanWriteToolsOptions {
  /** Forwarded from src/mcpServer.ts's CreateMcpServerOptions — test-only. */
  fetcherOverride?: RegisterFetcher;
  /** Test/local-dev-only override for the lease backend (see
   * src/planRegister/inMemoryLeaseBackend.ts). */
  leaseBackendOverride?: LeaseBackend;
}

function toolError(text: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { content: [{ type: "text", text }], isError: true };
}

function describeFetchError(err: unknown): string {
  if (err instanceof GithubAppNotConfiguredError) {
    return err.message;
  }
  if (err instanceof GithubAppAuthError || err instanceof GithubFetchError) {
    return `${err.message} (HTTP ${err.status}): ${err.body}`;
  }
  if (err instanceof Error) {
    return `could not reach GitHub: ${err.message}`;
  }
  return `could not reach GitHub: ${String(err)}`;
}

function describeLeaseBackendError(err: unknown): string {
  if (err instanceof LeaseBackendNotConfiguredError) {
    return err.message;
  }
  if (err instanceof Error) {
    return `could not reach the write-lease store: ${err.message}`;
  }
  return `could not reach the write-lease store: ${String(err)}`;
}

function clampTtl(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.max(requested, MIN_TTL_SECONDS), MAX_TTL_SECONDS);
}

interface HeldLease {
  ok: true;
  lease: LeaseInfo;
}
interface RefusedLease {
  ok: false;
  reason: string;
}

async function requireHeldLease(
  backend: LeaseBackend,
  leaseToken: string,
  now: Date,
): Promise<HeldLease | RefusedLease> {
  const current = await backend.readLease(now);
  if (!current) {
    return {
      ok: false,
      reason:
        "no active write lease (none held, or the held one has expired); " +
        "call plan_lease_acquire first",
    };
  }
  if (current.token !== leaseToken) {
    return {
      ok: false,
      reason: "leaseToken does not match the current write-lease holder",
    };
  }
  return { ok: true, lease: current };
}

// ---- plan_lease_acquire -----------------------------------------------

const leaseAcquireInputShape = {
  holder: z
    .string()
    .min(1)
    .describe(
      "Free-text identifying who is acquiring the lease (e.g. a task ID).",
    ),
  ttlSeconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `How long the lease lasts before it expires and becomes acquirable again ` +
        `(default ${DEFAULT_TTL_SECONDS}s, clamped to [${MIN_TTL_SECONDS}, ${MAX_TTL_SECONDS}]).`,
    ),
} as const;

const leaseAcquireOutputShape = {
  holder: z.string(),
  token: z
    .string()
    .describe(
      "Present the lease on every plan_update / plan_confirm / plan_lease_release call.",
    ),
  acquiredAt: z.string(),
  expiresAt: z.string(),
} as const;
const leaseAcquireOutputSchema = z.object(leaseAcquireOutputShape);

// ---- plan_update --------------------------------------------------------

const planUpdateInputShape = {
  nodeId: z.string().describe("The node to move (e.g. P2-N010)."),
  toStage: z
    .string()
    .describe("The requested stage (node-lifecycle vocabulary)."),
  reason: z
    .string()
    .min(1)
    .describe(
      "Why this transition is happening now — echoed back for the session's own " +
        "commit documentation (W-003); the service does not store it.",
    ),
  ref: z
    .string()
    .optional()
    .describe(
      "Git ref to read the register at. Defaults to the default branch.",
    ),
  sha: z
    .string()
    .min(1)
    .describe(
      "The commit SHA this edit is expected to be computed against (from a prior " +
        "plan_read or plan_update). If the register at `ref` has moved past it, the " +
        "edit is refused as stale rather than computed against outdated content (I5).",
    ),
  leaseToken: z.string().min(1).describe("The token from plan_lease_acquire."),
} as const;

const registerEditOutputShape = z.object({
  file: z.string(),
  line: z.number().int(),
  oldLine: z.string(),
  newLine: z.string(),
});

const planUpdateOutputShape = {
  nodeId: z.string(),
  fromStage: z.string(),
  toStage: z.string(),
  ref: z.string(),
  sha: z
    .string()
    .describe(
      "The commit SHA this edit was computed against (matches the input `sha`).",
    ),
  reason: z.string(),
  edit: registerEditOutputShape.describe(
    "The exact edit to apply. The service never applies it and never touches git.",
  ),
} as const;
const planUpdateOutputSchema = z.object(planUpdateOutputShape);

// ---- plan_confirm ---------------------------------------------------------

const planConfirmInputShape = {
  nodeId: z.string(),
  toStage: z
    .string()
    .describe("The stage plan_update's edit moved this node to."),
  sha: z
    .string()
    .min(1)
    .describe(
      "The commit SHA the session pushed after applying and committing the edit — " +
        "the register is fetched pinned to exactly this SHA (I5); no separate `ref` " +
        "is needed, a SHA already names the exact content being confirmed.",
    ),
  leaseToken: z.string().min(1).describe("The token from plan_lease_acquire."),
} as const;

const planConfirmOutputShape = {
  nodeId: z.string(),
  toStage: z.string(),
  ref: z.string(),
  sha: z.string(),
  file: z.string(),
  line: z.number().int(),
} as const;
const planConfirmOutputSchema = z.object(planConfirmOutputShape);

// ---- plan_lease_release ----------------------------------------------------

const leaseReleaseInputShape = {
  leaseToken: z.string().min(1),
} as const;
const leaseReleaseOutputShape = { released: z.literal(true) } as const;
const leaseReleaseOutputSchema = z.object(leaseReleaseOutputShape);

export function registerPlanWriteTools(
  server: McpServer,
  options: PlanWriteToolsOptions = {},
): void {
  const fetcher = () => options.fetcherOverride ?? getDefaultRegisterFetcher();
  const backend = () =>
    options.leaseBackendOverride ?? getDefaultLeaseBackend();

  server.registerTool(
    "plan_lease_acquire",
    {
      title: "Acquire the plan-state write lease",
      description:
        "Takes the project's single advisory write lease (decision 7 — acquire, TTL " +
        "expiry, release; no contention handling beyond this in chunk 1). Required " +
        "before plan_update will accept a transition. A second acquirer is refused " +
        "while the first holder's lease is still live.",
      inputSchema: leaseAcquireInputShape,
      outputSchema: leaseAcquireOutputShape,
    },
    async ({ holder, ttlSeconds }) => {
      let store: LeaseBackend;
      try {
        store = backend();
      } catch (err) {
        return toolError(describeLeaseBackendError(err));
      }

      const now = new Date();
      const ttl = clampTtl(ttlSeconds);
      const candidate: LeaseInfo = {
        holder,
        token: randomUUID(),
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
      };

      let granted: boolean;
      try {
        granted = await store.acquireLease(candidate, now);
      } catch (err) {
        return toolError(describeLeaseBackendError(err));
      }

      if (!granted) {
        let currentDescription = "another session";
        try {
          const current = await store.readLease(now);
          if (current) {
            currentDescription = `${current.holder} (expires ${current.expiresAt})`;
          }
        } catch {
          // best-effort only — the refusal below is correct either way
        }
        return toolError(
          `the write lease is already held by ${currentDescription}; it must expire ` +
            "or be released before a new acquire can succeed",
        );
      }

      const structuredContent = leaseAcquireOutputSchema.parse(candidate);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "plan_update",
    {
      title: "Compute a plan-state stage-transition edit",
      description:
        "Validates a requested stage transition for one node against the node " +
        "lifecycle (docs/process/plan-model.md) and the register as it currently " +
        "stands in git, and returns the exact edit to make — never applies it, " +
        "never touches git (G4). Requires an active write lease (plan_lease_acquire) " +
        "and the baseline `sha` the edit is computed against; a register that has " +
        "moved past that `sha` refuses the edit as stale rather than computing it " +
        "against outdated content.",
      inputSchema: planUpdateInputShape,
      outputSchema: planUpdateOutputShape,
    },
    async ({ nodeId, toStage, reason, ref, sha, leaseToken }) => {
      let store: LeaseBackend;
      try {
        store = backend();
      } catch (err) {
        return toolError(describeLeaseBackendError(err));
      }

      const now = new Date();
      const held = await requireHeldLease(store, leaseToken, now);
      if (!held.ok) {
        return toolError(held.reason);
      }

      let fetched;
      try {
        fetched = await fetcher().fetchPlanRegister(ref);
      } catch (err) {
        return toolError(describeFetchError(err));
      }

      if (fetched.sha !== sha) {
        return toolError(
          `stale baseline: ${fetched.ref} has moved from ${sha} to ${fetched.sha} since this ` +
            "edit was computed against it; re-read the register and retry",
        );
      }

      const plan = planTransitionEdit(fetched.content, nodeId, toStage);
      if (!plan.ok) {
        return toolError(plan.reason);
      }

      const structuredContent = planUpdateOutputSchema.parse({
        nodeId,
        fromStage: plan.fromStage,
        toStage: plan.toStage,
        ref: fetched.ref,
        sha: fetched.sha,
        reason,
        edit: plan.edit,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "plan_confirm",
    {
      title: "Confirm a plan-state edit landed in git",
      description:
        "Fetches the register at the pushed commit `sha` and checks it actually " +
        "carries the transition plan_update described — a mismatch is reported as a " +
        "divergence, naming the file and the line (I3, the R10 detection), and the " +
        "lease is left held so the session can investigate. On success the lease is " +
        "released.",
      inputSchema: planConfirmInputShape,
      outputSchema: planConfirmOutputShape,
    },
    async ({ nodeId, toStage, sha, leaseToken }) => {
      let store: LeaseBackend;
      try {
        store = backend();
      } catch (err) {
        return toolError(describeLeaseBackendError(err));
      }

      const now = new Date();
      const held = await requireHeldLease(store, leaseToken, now);
      if (!held.ok) {
        return toolError(held.reason);
      }

      let fetched;
      try {
        fetched = await fetcher().fetchPlanRegister(sha);
      } catch (err) {
        return toolError(describeFetchError(err));
      }

      const confirmed = checkConfirmed(fetched.content, nodeId, toStage);
      if (!confirmed.ok) {
        // Deliberately does not release the lease — see the tool description.
        return toolError(confirmed.reason);
      }

      try {
        await store.releaseLease(leaseToken);
      } catch (err) {
        // The confirmation itself succeeded; a failure to release is
        // reported but does not undo that — the lease will still
        // expire by TTL if it cannot be released explicitly.
        return toolError(
          `confirmed, but could not release the lease: ${describeLeaseBackendError(err)}`,
        );
      }

      const structuredContent = planConfirmOutputSchema.parse({
        nodeId,
        toStage,
        ref: fetched.ref,
        sha: fetched.sha,
        file: "docs/plan-register.md",
        line: confirmed.line,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "plan_lease_release",
    {
      title: "Release the plan-state write lease",
      description:
        "Releases the write lease early (a session that acquired it but is not " +
        "going to finish). plan_confirm already releases it on success; this is for " +
        "every other case.",
      inputSchema: leaseReleaseInputShape,
      outputSchema: leaseReleaseOutputShape,
    },
    async ({ leaseToken }) => {
      let store: LeaseBackend;
      try {
        store = backend();
      } catch (err) {
        return toolError(describeLeaseBackendError(err));
      }

      let released: boolean;
      try {
        released = await store.releaseLease(leaseToken);
      } catch (err) {
        return toolError(describeLeaseBackendError(err));
      }

      if (!released) {
        return toolError(
          "no active lease matches this token (already released, expired, or never held)",
        );
      }

      const structuredContent = leaseReleaseOutputSchema.parse({
        released: true,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );
}
