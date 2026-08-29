/**
 * The Plan register parser (chunk 1 child C, node P2-N009).
 *
 * Grammar cited to docs/process/plan-register.md in the coordinating
 * repository (majodali/project-orchestrator) — this module implements
 * it, it does not restate it. `NODE_LINE` and `NODE_LIKE_LINE` mirror
 * that repository's plugin/scripts/form_check.py `NODE_RE` /
 * `NODEISH_RE` line for line (same two-tier approach: a line-like-a-
 * node-entry test decides whether a non-matching line is reported as
 * malformed at all, versus ordinary register prose that was never
 * trying to be a node). See this node's task result for the
 * cross-check against that checker on the real register.
 */

import type {
  HoldMarker,
  PlanNode,
  RegisterLink,
  RegisterParseError,
  RegisterParseResult,
} from "./types.js";

// Entry anatomy: indent, "- ", node ID, "[stage]", optional
// "[gated: ...]"/"[blocked: ...]", then the rest of the line (name,
// optionally " — " + links). Named groups, with the shape below
// asserted explicitly rather than left to regex-literal inference:
// TS's inference for `groups` does not track per-group optionality
// precisely enough here to satisfy noUncheckedIndexedAccess cleanly.
const NODE_LINE =
  /^(?<indent>\s*)- (?<id>P\d+-N\d+) \[(?<stage>[a-z-]+)\](?: \[(?<holdKind>gated|blocked): (?<holdReason>[^\]]+)\])? (?<rest>.*)$/;

interface NodeLineGroups {
  indent: string;
  id: string;
  stage: string;
  holdKind: "gated" | "blocked" | undefined;
  holdReason: string | undefined;
  rest: string;
}

// A list-item line that is either a well-formed node ID, or carries
// *some* stage-shaped bracket — i.e. it is plausibly attempting to be
// a node entry, so a failure to match NODE_LINE below is reported
// rather than silently skipped as ordinary register prose.
const NODE_LIKE_LINE = /^\s*- (?:P\d+-N\d+\b|[^\s].*\[[a-z-]+\])/;

const EM_DASH_SEPARATOR = " — ";
const LINK_SEPARATOR = " · ";
const LINK_PAIR = /^(?<label>[^:]+): (?<target>.+)$/;

interface LinkPairGroups {
  label: string;
  target: string;
}

function splitTitleAndAnnotation(rest: string): {
  title: string;
  annotation: string | null;
  links: RegisterLink[];
} {
  const idx = rest.indexOf(EM_DASH_SEPARATOR);
  if (idx === -1) {
    return { title: rest.trim(), annotation: null, links: [] };
  }
  const title = rest.slice(0, idx).trim();
  const annotation = rest.slice(idx + EM_DASH_SEPARATOR.length).trim();
  const links: RegisterLink[] = [];
  for (const segment of annotation.split(LINK_SEPARATOR)) {
    const m = LINK_PAIR.exec(segment.trim());
    if (m?.groups) {
      const groups = m.groups as unknown as LinkPairGroups;
      links.push({ label: groups.label.trim(), target: groups.target.trim() });
    }
  }
  return { title, annotation, links };
}

/**
 * Parses register text into structured nodes. Never throws on
 * malformed input: a node-like line that does not parse, or a
 * duplicate node ID, is recorded in `errors` (naming the line and the
 * problem) and parsing continues — every other, well-formed node is
 * still returned. This is deliberate: the verification criterion is
 * "a malformed register line is a reported error … never a silently
 * dropped node," which requires the rest of a large register to
 * survive one bad line.
 */
export function parseRegister(text: string): RegisterParseResult {
  const nodes = new Map<string, PlanNode>();
  const order: string[] = [];
  const rootIds: string[] = [];
  const errors: RegisterParseError[] = [];
  const stack: Array<{ depth: number; id: string }> = [];

  const lines = text.split(/\r\n|\n/);
  for (const [i, line] of lines.entries()) {
    const lineno = i + 1;

    if (!NODE_LIKE_LINE.test(line)) {
      continue; // ordinary register prose — never a node, never an error
    }

    const m = NODE_LINE.exec(line);
    if (!m?.groups) {
      errors.push({
        line: lineno,
        raw: line,
        reason:
          "node-like line does not match the register grammar " +
          "(docs/process/plan-register.md)",
      });
      continue;
    }

    const { indent, id, stage, holdKind, holdReason, rest } =
      m.groups as unknown as NodeLineGroups;
    const depth = indent.length;

    if (nodes.has(id)) {
      errors.push({
        line: lineno,
        raw: line,
        reason: `duplicate node ID ${id}; first seen at line ${nodes.get(id)!.line}`,
      });
      continue;
    }

    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
      stack.pop();
    }
    const parentId = stack.length > 0 ? stack[stack.length - 1]!.id : null;

    // holdReason is always present when holdKind is (they come from the
    // same optional regex group), so the non-null assertion here is
    // sound, not a bypass.
    const hold: HoldMarker | null =
      holdKind === "gated" || holdKind === "blocked"
        ? { kind: holdKind, reason: holdReason!.trim() }
        : null;

    const { title, annotation, links } = splitTitleAndAnnotation(rest);

    const node: PlanNode = {
      id,
      stage,
      hold,
      title,
      annotation,
      links,
      parentId,
      childIds: [],
      line: lineno,
    };

    nodes.set(id, node);
    order.push(id);
    if (parentId) {
      nodes.get(parentId)!.childIds.push(id);
    } else {
      rootIds.push(id);
    }
    stack.push({ depth, id });
  }

  return { nodes, order, rootIds, errors };
}

/**
 * IDs of `nodeId` and every descendant, in document (pre-order) order
 * — "that node and its descendants, nothing above, nothing sideways."
 * Returns `null` if `nodeId` is not in the parsed register at all.
 */
export function subtreeIds(
  result: RegisterParseResult,
  nodeId: string,
): string[] | null {
  if (!result.nodes.has(nodeId)) {
    return null;
  }
  const out: string[] = [];
  const visit = (id: string): void => {
    out.push(id);
    for (const childId of result.nodes.get(id)!.childIds) {
      visit(childId);
    }
  };
  visit(nodeId);
  return out;
}
