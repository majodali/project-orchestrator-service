/**
 * Small pieces the view's pages share: page paths, the class badge and
 * the pull request link. Kept apart so that the tree, node and task
 * pages import downward and never each other.
 */

import { NODE_CLASS_LABELS, type NodeClass } from "../model/check.js";
import { escapeHtml, viewLink } from "./html.js";

export function nodePagePath(id: string): string {
  return `/view/node/${encodeURIComponent(id)}`;
}

export function taskPagePath(id: string): string {
  return `/view/task/${encodeURIComponent(id)}`;
}

export function nodeHref(id: string, requestedRef: string | undefined): string {
  return viewLink(nodePagePath(id), requestedRef);
}

/** The badge's short text; the full label is its title. */
const BADGE_TEXT: Readonly<Record<NodeClass, string>> = {
  gated: "waiting on the owner",
  blocked: "blocked",
  "in-flight": "in flight",
  "in-progress": "in progress",
  waiting: "waiting on a dependency",
  actionable: "ready",
  done: "done",
  parked: "parked",
};

/** The badge naming a node's class, with the full label as its title. */
export function classBadge(cls: NodeClass): string {
  return `<span class="badge c-${cls}" data-class="${cls}" title="${escapeHtml(NODE_CLASS_LABELS[cls])}">${escapeHtml(BADGE_TEXT[cls])}</span>`;
}

/** A GitHub pull request link from `owner/repo#number`, or null. */
export function pullRequestUrl(pr: string): string | null {
  const m = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(pr);
  return m ? `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` : null;
}
