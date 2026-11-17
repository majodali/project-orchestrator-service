/**
 * The check a done decision runs before it merges (P4-N031,
 * 2026-11-17). A task that moves a linked document names the path the
 * document will have once its pull request merges; the service sets
 * that path when the node is done. If the pull request does not bring
 * a file to that path, the state file would name a document that does
 * not exist and `plan-state check` would fail on the default branch.
 * So the path is looked for first, at the head of the node's pull
 * requests in the project's repository, or on the default branch when
 * the node has none there. A path that is missing refuses the
 * decision: nothing is merged and nothing is committed.
 *
 * `pullRequests` is the getter, called only when a path is pending: a
 * surface with no pull request access configured still decides a node
 * that moves no document.
 */

import { pendingDocs, pullRequestsOf } from "./model/loop.js";
import type { State } from "./model/schema.js";
import { NotFoundError, type StateStore } from "./model/store.js";
import type { PullRequests } from "./planRegister/pullRequests.js";

export async function requirePendingDocs(
  store: StateStore,
  pullRequests: () => PullRequests,
  state: State,
  nodeId: string,
): Promise<void> {
  const pending = pendingDocs(state, nodeId);
  if (pending.length === 0) return;
  const shas: string[] = [];
  for (const ref of pullRequestsOf(state, nodeId)) {
    if (!ref.startsWith(`${state.project}#`)) continue;
    shas.push((await pullRequests().get(ref)).headSha);
  }
  if (shas.length === 0) shas.push(await store.headSha());
  const found = await Promise.all(
    pending.map(async ({ path }) => {
      for (const sha of shas) {
        if (await store.fileExistsAt(sha, path)) return true;
      }
      return false;
    }),
  );
  const missing = pending.filter((_, i) => !found[i]);
  if (missing.length > 0) {
    throw new NotFoundError(
      `refused: ${nodeId} names document paths for the time its pull requests merge, and no pull request of it brings a file there: ${missing
        .map((m) => `${m.path} (${m.node} ${m.kind})`)
        .join(
          ", ",
        )}. Nothing was merged or committed. Move the file in the pull request, or name the right path with node_update under a new task.`,
    );
  }
}
