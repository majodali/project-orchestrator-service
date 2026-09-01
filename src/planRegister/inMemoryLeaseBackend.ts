/**
 * In-memory `LeaseBackend` (chunk 1 child D, node P2-N010) — used by
 * every unit/contract test in this repository and by a local
 * `npm run dev` session (see ./defaultLeaseBackend.ts), where a single
 * Node process is the whole deployment and there is nothing to share
 * state across. **Not** the production implementation: a warm Lambda
 * container is one of potentially several, so only a backend with a
 * real shared store (./dynamoLeaseBackend.ts) can hold the lease
 * across separate invocations. `getDefaultLeaseBackend` in
 * ./defaultLeaseBackend.ts never returns this class — production
 * wiring reaches it only through an explicit test/dev override, the
 * same seam `RegisterFetcher` overrides use.
 */

import type { LeaseBackend, LeaseInfo } from "./leaseBackend.js";

export class InMemoryLeaseBackend implements LeaseBackend {
  private current: LeaseInfo | null = null;

  private live(now: Date): LeaseInfo | null {
    if (this.current && new Date(this.current.expiresAt) > now) {
      return this.current;
    }
    return null;
  }

  async readLease(now: Date): Promise<LeaseInfo | null> {
    return this.live(now);
  }

  async acquireLease(candidate: LeaseInfo, now: Date): Promise<boolean> {
    if (this.live(now)) {
      return false;
    }
    this.current = candidate;
    return true;
  }

  async releaseLease(token: string): Promise<boolean> {
    if (this.current && this.current.token === token) {
      this.current = null;
      return true;
    }
    return false;
  }
}
