/**
 * The advisory write lease's storage seam (chunk 1 child D, node
 * P2-N010, decision 7 — "a minimal advisory lease: acquire, TTL
 * expiry, release", contention under multiple *live* sessions
 * deferred to chunk 4).
 *
 * `LeaseBackend` is the injectable storage seam, the same pattern
 * `RegisterFetcher` establishes for reads: one production
 * implementation (`DynamoLeaseBackend`, ./dynamoLeaseBackend.ts, the
 * DynamoDB table this child's `template.yaml` change adds), one
 * in-memory implementation (`./inMemoryLeaseBackend.ts`) used by every
 * test and by a local `npm run dev` session with no AWS configured.
 *
 * Chunk 1 scope (plan decision 4): plan state for *this* repository
 * only — there is exactly one lease, not one per project or per node.
 * `LEASE_KEY` below is the fixed identifier both backends use for it.
 */

export const LEASE_KEY = "project-orchestrator";

export interface LeaseInfo {
  /** Free-text identifying who holds the lease (e.g. a task or session ID). */
  holder: string;
  /** The secret `plan_update` / `plan_confirm` / `plan_lease_release` must present. */
  token: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface LeaseBackend {
  /**
   * The current lease, or `null` if none is held or the held one has
   * expired as of `now` (an expired lease is reported as absent —
   * TTL expiry is enforced here, in application logic, never assumed
   * from the backing store's own cleanup, which for DynamoDB's native
   * TTL attribute can lag real time by minutes).
   */
  readLease(now: Date): Promise<LeaseInfo | null>;
  /**
   * Attempts to write `candidate` as the lease, succeeding only if no
   * live lease currently exists (`now` decides "live" the same way
   * `readLease` does). Returns whether it was acquired.
   */
  acquireLease(candidate: LeaseInfo, now: Date): Promise<boolean>;
  /**
   * Attempts to clear the lease, succeeding only if `token` matches
   * the currently held lease's token. Returns whether it was released.
   */
  releaseLease(token: string): Promise<boolean>;
}
