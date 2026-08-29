/**
 * Structured shape of a Plan register (chunk 1 child C, node P2-N009).
 * The grammar this module's parser implements is
 * docs/process/plan-register.md in the coordinating repository
 * (majodali/project-orchestrator) — "Entry anatomy" and "Hierarchy is
 * expressed by list nesting" — cited, not restated here. `stage`'s
 * vocabulary is the node lifecycle in docs/process/plan-model.md,
 * also cited rather than re-declared: this module reports whatever
 * stage string the register carries and does not itself validate it
 * against the lifecycle (that is a verifier's/auditor's job, not a
 * read tool's — see I2, "legality is not a second truth").
 */

export interface HoldMarker {
  kind: "gated" | "blocked";
  reason: string;
}

/** A `label: target` pair parsed out of a node's post-em-dash text. */
export interface RegisterLink {
  label: string;
  target: string;
}

export interface PlanNode {
  id: string;
  stage: string;
  hold: HoldMarker | null;
  title: string;
  /**
   * Verbatim text after the entry's em dash, if any — kept in full so
   * nothing is lost even when it does not fit the `label: target`
   * link grammar (e.g. the real register's P1-N006 line, which
   * carries plain prose there instead of a link). `links` below is a
   * best-effort structured read of this same text.
   */
  annotation: string | null;
  links: RegisterLink[];
  parentId: string | null;
  /** Document order, not creation order (register nodes are never
   * reordered by this parser). */
  childIds: string[];
  /** 1-based line number in the source register text. */
  line: number;
}

/**
 * A register line that looked like it was trying to be a node entry
 * (matched the node-*like* shape) but did not parse as one, or a
 * structural problem (a duplicate ID) discovered while parsing one
 * that did. Always reported, never silently dropped — see this
 * node's verification criteria.
 */
export interface RegisterParseError {
  line: number;
  /** The literal source line, untouched. */
  raw: string;
  reason: string;
}

export interface RegisterParseResult {
  nodes: Map<string, PlanNode>;
  /** Node IDs in document (source-line) order. */
  order: string[];
  /** IDs of nodes with no parent — the register's top-level entries. */
  rootIds: string[];
  errors: RegisterParseError[];
}
