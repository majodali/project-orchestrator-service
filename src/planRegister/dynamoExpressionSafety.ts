/**
 * A network-free check for the exact shape of the production defect
 * T027 fixed (node P2-N010 rework): `dynamoLeaseBackend.ts`'s
 * `releaseLease` sent DynamoDB a `ConditionExpression` naming the
 * reserved word `token` without an `ExpressionAttributeNames` alias,
 * and DynamoDB rejected it at call time. No test ever exercised a
 * real (or emulated-strict) DynamoDB client's expression validation —
 * `test/leaseBackend.test.ts`'s `FakeDynamoTable` reads
 * `ExpressionAttributeValues` directly and never parses the
 * expression string at all, so it could not have caught this.
 *
 * This module inspects an expression *string* directly: every bare
 * (unaliased, i.e. not prefixed `:` for a value placeholder or `#`
 * for an existing alias) identifier that is also a DynamoDB reserved
 * word (./dynamoReservedWords.ts) is unsafe — DynamoDB will reject it
 * at call time exactly as it rejected `token = :token`. This needs no
 * AWS credentials, no network, and generalizes to any expression this
 * file (or a future one) writes, not just the one already found.
 *
 * What this does not cover: reserved words this session's necessarily
 * partial word list does not know about (see that file's doc
 * comment), and anything DynamoDB validates beyond reserved-word
 * collisions (expression syntax errors, type mismatches, and the
 * like) — this is a targeted check for one defect shape, not a
 * DynamoDB expression parser.
 */

import { isDynamoReservedWord } from "./dynamoReservedWords.js";

export interface ExpressionBearingCommandInput {
  ConditionExpression?: string;
  KeyConditionExpression?: string;
  ProjectionExpression?: string;
  UpdateExpression?: string;
  FilterExpression?: string;
}

// DynamoDB expression-language syntax — function names and connective
// keywords that appear as bare identifiers in a valid expression but
// are never themselves attribute names, so they must not be flagged
// as unaliased attribute names even though several (AND, OR, SIZE,
// ...) also happen to be reserved words when used *as* an attribute
// name.
const EXPRESSION_SYNTAX_WORDS: ReadonlySet<string> = new Set([
  "AND",
  "OR",
  "NOT",
  "IN",
  "BETWEEN",
  "ATTRIBUTE_EXISTS",
  "ATTRIBUTE_NOT_EXISTS",
  "ATTRIBUTE_TYPE",
  "BEGINS_WITH",
  "CONTAINS",
  "SIZE",
  "SET",
  "REMOVE",
  "ADD",
  "DELETE",
  "IF_NOT_EXISTS",
  "LIST_APPEND",
]);

/**
 * Every identifier in `expression` written bare — not as a `:value`
 * placeholder and not as an already-aliased `#name` — in source
 * order, excluding DynamoDB's own expression-syntax words.
 */
function bareIdentifiers(expression: string): string[] {
  const out: string[] = [];
  const re = /([:#]?)([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression)) !== null) {
    const prefix = m[1];
    const word = m[2]!;
    if (prefix) continue; // ":value" placeholder or "#alias" — not bare
    if (EXPRESSION_SYNTAX_WORDS.has(word.toUpperCase())) continue;
    out.push(word);
  }
  return out;
}

/**
 * Every bare attribute name, across all of `input`'s expression
 * fields, that is a DynamoDB reserved word — i.e. every name DynamoDB
 * will reject at call time with "Attribute name is a reserved
 * keyword" unless it is aliased through `ExpressionAttributeNames`
 * instead. Empty means every expression field is safe by this check.
 * `ExpressionAttributeNames` itself is not consulted: an identifier
 * only reaches this list if it was written bare in the expression
 * text in the first place, which by construction means it was not
 * aliased.
 */
export function findUnaliasedReservedAttributeNames(
  input: ExpressionBearingCommandInput,
): string[] {
  const fields = [
    input.ConditionExpression,
    input.KeyConditionExpression,
    input.ProjectionExpression,
    input.UpdateExpression,
    input.FilterExpression,
  ].filter((s): s is string => typeof s === "string");

  const unsafe = new Set<string>();
  for (const expr of fields) {
    for (const name of bareIdentifiers(expr)) {
      if (isDynamoReservedWord(name)) {
        unsafe.add(name);
      }
    }
  }
  return [...unsafe];
}
