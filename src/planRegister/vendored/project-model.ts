/**
 * The Project model instance's entry grammar — a shared unit (node
 * P2-N021, the web view's first version, task E3; the specification of
 * P2-N003, decision 7, and RU-012, how two repositories share one unit
 * of code).
 *
 * Canonical here, beside ./plan-register.ts and
 * ./cost-log-and-journal.ts. The web view in
 * majodali/project-orchestrator-service reads a vendored copy, which
 * the generator ../sync_shared_unit.ts wrote, since retired: this
 * repository owns this file since the rebuild's milestone 1. P3-N009 (sibling ordering retired, and
 * the checks that replace it) imports this file when it adds the
 * instance's rules to the form checker.
 *
 * The type specification stays authoritative:
 * docs/process/project-model.md, "The instance: one file, a preamble,
 * then entries" and "The entry grammar" with its subsections "Lines,
 * items and sources" and "What each line's items hold". This module
 * implements them, it does not restate them (Constitution Article 3:
 * where checker and spec disagree, the spec is right).
 *
 * Like ./plan-register.ts, it is a single file with zero imports and no
 * I/O: instance text in, entries and errors out. A direct-run Node tool
 * here and the service's NodeNext build can then both consume it
 * unedited (./plan-register.ts's doc comment says why a relative
 * import would break one of the two).
 *
 * It carries no policy. It parses each entry and reports each place
 * the text departs from the grammar, by line, and parsing continues:
 * every entry is returned, with or without errors. It derives nothing:
 * the state derivation, the node-to-node dependency rule, the two
 * renderings and the checker's rules belong to the readers.
 */

// Owned here since 2026-11-09 (the rebuild, milestone 1); the
// generator that used to copy this file is retired. See GENERATED.md.

// ---- Vocabulary, as data ---------------------------------------------

/** The labelled lines of an entry, in the grammar's order. */
export const FACET_LABELS = [
  "is",
  "state",
  "spec",
  "risks",
  "created-by",
  "modified-by",
  "used-by",
  "formerly",
  "alias",
] as const;

export type FacetLabel = (typeof FACET_LABELS)[number];

/** The seven lines every entry carries; `formerly` and `alias` are
 * optional. */
export const REQUIRED_LABELS: readonly FacetLabel[] = FACET_LABELS.slice(0, 7);

/** The three edge lines, which together carry the fifth facet. */
export const EDGE_LABELS = ["created-by", "modified-by", "used-by"] as const;

export type EdgeLabel = (typeof EDGE_LABELS)[number];

/** The values the first item of a `state:` line may take. */
export const DERIVED_VALUES = [
  "planned",
  "building",
  "built",
  "built, changing",
] as const;

export type DerivedValue = (typeof DERIVED_VALUES)[number];

/** The path of the instance in a repository that declares the type. */
export const PROJECT_MODEL_PATH = "docs/project-model.md";

// ---- Structured shape -------------------------------------------------

/** A source: a Markdown link to a document, optionally followed by
 * `, ` and words naming the part of it. */
export interface ModelSource {
  /** The source as written. */
  text: string;
  /** The link's text and target, when the source opens with a link. */
  link: { text: string; target: string } | null;
  /** The words after the link and `, `, if any. */
  part: string | null;
}

/** What an item's body is, by the form the grammar gives it. */
export type ItemForm =
  | { kind: "none" }
  | { kind: "not-yet-derived" }
  /** Free text: the body of an `is:` or `formerly:` item. */
  | { kind: "text" }
  | { kind: "derived-value"; value: DerivedValue }
  | { kind: "standing" }
  | { kind: "own-status"; status: string }
  /** A `spec:` item: a link to a specification document. */
  | { kind: "link"; text: string; target: string }
  /** A `risks:` item: a link with the risk's identifier as its text. */
  | { kind: "risk"; id: string; target: string }
  /** A node item; `after` holds the after qualifier's nodes, `used-by:`
   * only. */
  | { kind: "node"; node: string; after: string[] }
  | { kind: "gate"; node: string }
  | { kind: "outside"; party: string }
  | { kind: "partial"; reason: string }
  | { kind: "alias"; slug: string }
  /** A body the grammar does not give this line; an error names it. */
  | { kind: "malformed" };

export interface ModelItem {
  /** 1-based line of the file where the item starts. */
  line: number;
  /** The item as written, continuation lines joined by one space. */
  text: string;
  /** The text before the closing parenthetical, or the whole item when
   * it has none. */
  body: string;
  /** The parts of the closing parenthetical before the sources. */
  notes: string[];
  sources: ModelSource[];
  /** The date of a date note, `done <YYYY-MM-DD>`, on a node item or a
   * gate item. */
  dateNote: string | null;
  form: ItemForm;
}

export interface FacetLine {
  label: FacetLabel;
  /** 1-based line of the label. */
  line: number;
  /** 1-based last line, continuation lines included. */
  endLine: number;
  /** The value: its first physical line joined to each continuation
   * line by one space. */
  value: string;
  items: ModelItem[];
}

export interface ModelEntry {
  /** The slug as the heading writes it. */
  slug: string;
  /** The resource's name in words, from the heading, if any. */
  name: string | null;
  /** The heading's text after `## `. */
  heading: string;
  /** 1-based line of the heading. */
  line: number;
  /** 1-based last line of the entry. */
  endLine: number;
  /** The labelled lines, in file order. */
  lines: FacetLine[];
}

/**
 * A place where the text departs from the entry grammar. Always
 * reported, never dropped. `label` names the line the error lies in;
 * it is null when the error is the entry's own, such as its heading.
 */
export interface ModelParseError {
  line: number;
  slug: string | null;
  label: FacetLabel | null;
  reason: string;
  /** The literal source line, untouched. */
  raw: string;
}

export interface ModelParseResult {
  entries: ModelEntry[];
  errors: ModelParseError[];
}

// ---- Grammar ----------------------------------------------------------

const HEADING = /^## (?<rest>.*)$/;
const HEADING_PARTS = /^(?<slug>\S+)(?: \((?<name>.+)\))?$/;
const WORD_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9][a-z0-9]*)*$/;
const RULING_SLUG = /^RU-\d{3,}$/;
const LABELLED_LINE = /^- \*\*(?<label>[a-z-]+):\*\*(?<rest>.*)$/;
const IS_LINE_START = /^- \*\*is:\*\*/;
const CONTINUATION = /^ {2}/;

const NODE_ID = "P\\d+-N\\d+";
const NODE_BODY = new RegExp(`^(${NODE_ID})$`);
const NODE_AFTER_BODY = new RegExp(
  `^(${NODE_ID}) after (${NODE_ID}(?:, ${NODE_ID})*)$`,
);
const GATE_BODY = new RegExp(`^(${NODE_ID}) gate$`);
const OUTSIDE_BODY = /^outside: (.+)$/;
const PARTIAL_BODY = /^partial: (.+)$/;
const OWN_STATUS_BODY = /^own status (.+)$/;
const LINK_BODY = /^\[([^\]]+)\]\(([^()\s]+)\)$/;
const RISK_BODY = /^\[(R\d+)\]\(([^()\s]+)\)$/;
const ALIAS_BODY = /^`([^`]+)`$/;
const DATE_NOTE = /^done (\d{4}-\d{2}-\d{2})$/;
const SOURCE = /^\[([^\]]+)\]\(([^()\s]+)\)(?:, (.+))?$/;

const ITEM_SEPARATOR = " · ";
const NOTE_SEPARATOR = "; ";
const FROM = "from ";

/** True when `slug` matches the grammar's `slug` production. */
export function isSlug(slug: string): boolean {
  return WORD_SLUG.test(slug) || RULING_SLUG.test(slug);
}

/** Splits `text` at each `separator` that stands outside every
 * parenthesis, returning each part with its offset in `text`. */
function splitOutsideParens(
  text: string,
  separator: string,
): Array<{ part: string; offset: number }> {
  const parts: Array<{ part: string; offset: number }> = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(separator, i)) {
      parts.push({ part: text.slice(start, i), offset: start });
      start = i + separator.length;
      i = start - 1;
    }
  }
  parts.push({ part: text.slice(start), offset: start });
  return parts;
}

/**
 * The closing parenthetical: the last parenthesized group of the item,
 * preceded by a space and ending the item. A link target after `]` is
 * not one. Returns the index of its `(`, or -1 when the item has none.
 */
function closingParenthetical(item: string): number {
  if (!item.endsWith(")")) return -1;
  let depth = 0;
  for (let i = item.length - 1; i >= 0; i--) {
    const ch = item[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      depth--;
      if (depth === 0) {
        return i > 0 && item[i - 1] === " " ? i : -1;
      }
    }
  }
  return -1;
}

function parseSource(text: string): ModelSource {
  const m = SOURCE.exec(text);
  if (!m) return { text, link: null, part: null };
  return {
    text,
    link: { text: m[1]!, target: m[2]! },
    part: m[3] ?? null,
  };
}

interface Located {
  line: number;
  raw: string;
}

/** The physical line an offset into a joined value falls on. */
function locate(
  offset: number,
  physical: Array<{ offset: number; line: number; raw: string }>,
): Located {
  let found = physical[0]!;
  for (const p of physical) {
    if (p.offset <= offset) found = p;
  }
  return { line: found.line, raw: found.raw };
}

/** What the grammar says a line's items hold, for error messages. */
const LINE_HOLDS: Record<FacetLabel, string> = {
  is: "free text stating what the resource is now",
  state:
    "the derived value, then optionally `standing`, then optionally `own status <status>`",
  spec: "a link to a specification document, or `none`",
  risks:
    "a link to a Risk register entry, with the risk's identifier as link text, or `none`",
  "created-by": "node items, gate items and outside items, or `none`",
  "modified-by":
    "node items and outside items, then optionally a partial item; or `none`",
  "used-by":
    "node items, with or without an after qualifier, and outside items, then optionally a partial item; or `none`",
  formerly: "free text naming a predecessor implementation",
  alias: "an earlier slug, in backticks",
};

/** The form of one item's body on a line, or `malformed`. */
function formOf(label: FacetLabel, body: string): ItemForm {
  if (body === "none") return { kind: "none" };
  if (body === "not yet derived") return { kind: "not-yet-derived" };
  let m: RegExpExecArray | null;
  switch (label) {
    case "is":
    case "formerly":
      return body.trim() === "" ? { kind: "malformed" } : { kind: "text" };
    case "state":
      if ((DERIVED_VALUES as readonly string[]).includes(body)) {
        return { kind: "derived-value", value: body as DerivedValue };
      }
      if (body === "standing") return { kind: "standing" };
      m = OWN_STATUS_BODY.exec(body);
      if (m) return { kind: "own-status", status: m[1]! };
      return { kind: "malformed" };
    case "spec":
      m = LINK_BODY.exec(body);
      return m
        ? { kind: "link", text: m[1]!, target: m[2]! }
        : { kind: "malformed" };
    case "risks":
      m = RISK_BODY.exec(body);
      return m
        ? { kind: "risk", id: m[1]!, target: m[2]! }
        : { kind: "malformed" };
    case "created-by":
    case "modified-by":
    case "used-by":
      m = NODE_BODY.exec(body);
      if (m) return { kind: "node", node: m[1]!, after: [] };
      if (label === "used-by") {
        m = NODE_AFTER_BODY.exec(body);
        if (m) return { kind: "node", node: m[1]!, after: m[2]!.split(", ") };
      }
      if (label === "created-by") {
        m = GATE_BODY.exec(body);
        if (m) return { kind: "gate", node: m[1]! };
      }
      m = OUTSIDE_BODY.exec(body);
      if (m) return { kind: "outside", party: m[1]! };
      if (label !== "created-by") {
        m = PARTIAL_BODY.exec(body);
        if (m) return { kind: "partial", reason: m[1]! };
      }
      return { kind: "malformed" };
    case "alias":
      m = ALIAS_BODY.exec(body);
      return m && isSlug(m[1]!)
        ? { kind: "alias", slug: m[1]! }
        : { kind: "malformed" };
  }
}

/** Parses one labelled line's value into items, reporting each
 * departure from "Lines, items and sources" and "What each line's
 * items hold". */
function parseItems(
  label: FacetLabel,
  value: string,
  physical: Array<{ offset: number; line: number; raw: string }>,
  report: (at: Located, reason: string) => void,
): ModelItem[] {
  const items: ModelItem[] = [];
  for (const { part, offset } of splitOutsideParens(value, ITEM_SEPARATOR)) {
    const at = locate(offset, physical);
    const text = part.trim();
    const open = closingParenthetical(text);
    let body = text;
    const notes: string[] = [];
    const sources: ModelSource[] = [];
    if (open === -1) {
      report(
        at,
        `the ${label} line's item "${text}" does not end with a closing parenthetical`,
      );
    } else {
      body = text.slice(0, open - 1).trim();
      const inner = text.slice(open + 1, -1);
      let inSources = false;
      for (const { part: piece } of splitOutsideParens(inner, NOTE_SEPARATOR)) {
        if (!inSources && piece.startsWith(FROM)) {
          inSources = true;
          sources.push(parseSource(piece.slice(FROM.length)));
        } else if (inSources) {
          sources.push(parseSource(piece));
        } else {
          notes.push(piece);
        }
      }
      if (sources.length === 0) {
        report(at, `the ${label} line's item "${body}" names no source`);
      }
      for (const source of sources) {
        if (source.link === null) {
          report(
            at,
            `the ${label} line's item "${body}" has a source that is not a Markdown link: "${source.text}"`,
          );
        }
      }
    }
    const form = formOf(label, body);
    if (form.kind === "malformed") {
      report(
        at,
        `the ${label} line's item body "${body}" is not one this line holds (${LINE_HOLDS[label]})`,
      );
    }
    let dateNote: string | null = null;
    if (form.kind === "node" || form.kind === "gate") {
      for (const note of notes) {
        const d = DATE_NOTE.exec(note);
        if (d) dateNote = d[1]!;
      }
    }
    items.push({ line: at.line, text, body, notes, sources, dateNote, form });
  }

  // Item counts and order, by line.
  const first = items[0]!;
  const sole = (kind: ItemForm["kind"]): boolean =>
    items.some((item) => item.form.kind === kind);
  for (const kind of ["none", "not-yet-derived"] as const) {
    if (sole(kind) && items.length > 1) {
      report(
        { line: first.line, raw: physical[0]!.raw },
        `the ${label} line holds ${kind === "none" ? "`none`" : "`not yet derived`"} beside other items; it must be the line's only item`,
      );
    }
  }
  if (label === "state" && sole("not-yet-derived")) {
    report(
      { line: first.line, raw: physical[0]!.raw },
      "the state line may not read `not yet derived`",
    );
  }
  if (label === "state" && sole("none")) {
    report(
      { line: first.line, raw: physical[0]!.raw },
      "the state line may not read `none`; its first item is the derived value",
    );
  }
  if (label === "is" && items.length !== 1) {
    report(
      { line: first.line, raw: physical[0]!.raw },
      `the is line holds ${items.length} items; it holds exactly one`,
    );
  }
  if (label === "state" && items.length > 0) {
    const kinds = items.map((item) => item.form.kind);
    const order = ["derived-value", "standing", "own-status"];
    let ok = kinds[0] === "derived-value" && kinds.length <= 3;
    let last = 0;
    for (const kind of kinds.slice(1)) {
      const at = order.indexOf(kind);
      if (at <= last) ok = false;
      last = at;
    }
    const reported = ["malformed", "none", "not-yet-derived"];
    if (!ok && !kinds.some((kind) => reported.includes(kind))) {
      report(
        { line: first.line, raw: physical[0]!.raw },
        "the state line's items are not, in order, the derived value, optionally `standing`, and optionally `own status <status>`",
      );
    }
  }
  if (label === "modified-by" || label === "used-by") {
    items.forEach((item, i) => {
      if (item.form.kind === "partial" && i !== items.length - 1) {
        report(
          {
            line: item.line,
            raw: physical.find((p) => p.line === item.line)?.raw ?? "",
          },
          `the ${label} line's partial item is not its last item`,
        );
      }
    });
  }
  return items;
}

/** A labelled line being read, before its items are parsed. */
interface OpenLine {
  label: FacetLabel;
  known: boolean;
  line: number;
  endLine: number;
  physical: Array<{ offset: number; line: number; raw: string }>;
  value: string;
}

/** Collects the entries' line ranges: the headings that start entries,
 * by "The instance: one file, a preamble, then entries". */
function entryStarts(lines: string[]): number[] {
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!HEADING.test(lines[i]!)) continue;
    if (starts.length > 0) {
      starts.push(i);
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j++;
    if (j < lines.length && IS_LINE_START.test(lines[j]!)) starts.push(i);
  }
  return starts;
}

/**
 * Parses instance text into entries. Never throws on malformed input:
 * each departure from the entry grammar is recorded in `errors`, naming
 * its line, and parsing continues. Every entry is returned, in file
 * order, whatever its errors.
 */
export function parseProjectModel(text: string): ModelParseResult {
  const lines = text.split(/\r\n|\n/);
  const entries: ModelEntry[] = [];
  const errors: ModelParseError[] = [];
  const starts = entryStarts(lines);
  const seen = new Map<string, number>();

  starts.forEach((start, n) => {
    const end = (starts[n + 1] ?? lines.length) - 1;
    const headingRaw = lines[start]!;
    const headingText = HEADING.exec(headingRaw)!.groups!.rest!;
    const parts = HEADING_PARTS.exec(headingText);
    const slug = parts?.groups?.slug ?? headingText;
    const name = parts?.groups?.name ?? null;
    const report = (
      label: FacetLabel | null,
      at: Located,
      reason: string,
    ): void => {
      errors.push({ line: at.line, slug, label, reason, raw: at.raw });
    };
    const headingAt = { line: start + 1, raw: headingRaw };
    if (!parts || !isSlug(slug)) {
      report(
        null,
        headingAt,
        `the heading "${headingRaw}" is not "## " and a slug, then optionally " (" and a name and ")"`,
      );
    }
    const firstSeen = seen.get(slug);
    if (firstSeen !== undefined) {
      report(
        null,
        headingAt,
        `duplicate slug ${slug}; first seen at line ${firstSeen}`,
      );
    } else {
      seen.set(slug, start + 1);
    }

    // The facet list: labelled lines and their continuation lines,
    // after any blank lines that follow the heading.
    const facetLines: FacetLine[] = [];
    let current: OpenLine | null = null;
    let listEnded = false;
    let i = start + 1;
    while (i <= end && lines[i]!.trim() === "") i++;

    const close = (): void => {
      if (current === null) return;
      if (current.known) {
        const label = current.label;
        const items = parseItems(
          label,
          current.value,
          current.physical,
          (at, reason) => report(label, at, reason),
        );
        facetLines.push({
          label,
          line: current.line,
          endLine: current.endLine,
          value: current.value,
          items,
        });
      }
      current = null;
    };

    for (; i <= end; i++) {
      const raw = lines[i]!;
      const lineno = i + 1;
      if (raw.trim() === "") {
        close();
        listEnded = true;
        continue;
      }
      if (listEnded) {
        report(
          null,
          { line: lineno, raw },
          "text after the facet list's end; an entry is a heading and one unbroken list of labelled lines",
        );
        continue;
      }
      const labelled = LABELLED_LINE.exec(raw);
      if (labelled) {
        close();
        const label = labelled.groups!.label!;
        const rest = labelled.groups!.rest!;
        const known = (FACET_LABELS as readonly string[]).includes(label);
        if (!known) {
          report(
            null,
            { line: lineno, raw },
            `unknown line label "${label}:"; an entry's lines are ${FACET_LABELS.join(", ")}`,
          );
        } else if (!rest.startsWith(" ") || rest.trim() === "") {
          report(
            label as FacetLabel,
            { line: lineno, raw },
            `the ${label} line holds no value`,
          );
        }
        const value = rest.startsWith(" ") ? rest.slice(1).trimEnd() : rest;
        current = {
          label: label as FacetLabel,
          known: known && rest.trim() !== "",
          line: lineno,
          endLine: lineno,
          physical: [{ offset: 0, line: lineno, raw }],
          value,
        };
        continue;
      }
      if (CONTINUATION.test(raw) && current !== null) {
        const c: OpenLine = current;
        const piece = raw.slice(2).trimEnd();
        c.physical.push({ offset: c.value.length + 1, line: lineno, raw });
        c.value = `${c.value} ${piece}`;
        c.endLine = lineno;
        continue;
      }
      report(
        null,
        { line: lineno, raw },
        "a line in the facet list that is neither a labelled line nor a continuation line",
      );
    }
    close();

    // The lines' order: each label once, in the grammar's order.
    let lastIndex = -1;
    const present = new Set<FacetLabel>();
    for (const facet of facetLines) {
      const index = FACET_LABELS.indexOf(facet.label);
      if (present.has(facet.label)) {
        report(
          facet.label,
          { line: facet.line, raw: lines[facet.line - 1]! },
          `a second ${facet.label} line`,
        );
      } else if (index < lastIndex) {
        report(
          facet.label,
          { line: facet.line, raw: lines[facet.line - 1]! },
          `the ${facet.label} line is out of order; the lines run ${FACET_LABELS.join(", ")}`,
        );
      }
      present.add(facet.label);
      lastIndex = Math.max(lastIndex, index);
    }
    for (const label of REQUIRED_LABELS) {
      if (!present.has(label)) {
        report(label, headingAt, `the entry has no ${label} line`);
      }
    }

    entries.push({
      slug,
      name,
      heading: headingText,
      line: start + 1,
      endLine: end + 1,
      lines: facetLines,
    });
  });

  errors.sort((a, b) => a.line - b.line);
  return { entries, errors };
}

/** The entry's first line with `label`, if it has one. */
export function facetLine(
  entry: ModelEntry,
  label: FacetLabel,
): FacetLine | undefined {
  return entry.lines.find((line) => line.label === label);
}

/**
 * The entry a slug names: the entry whose heading writes it, or the
 * entry whose alias line lists it ("Slugs are stable"). Undefined when
 * no entry does.
 */
export function entryBySlug(
  result: ModelParseResult,
  slug: string,
): ModelEntry | undefined {
  const byHeading = result.entries.find((entry) => entry.slug === slug);
  if (byHeading) return byHeading;
  return result.entries.find((entry) =>
    facetLine(entry, "alias")?.items.some(
      (item) => item.form.kind === "alias" && item.form.slug === slug,
    ),
  );
}
