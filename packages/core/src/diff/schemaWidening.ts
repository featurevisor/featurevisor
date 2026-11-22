type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function label(path: string[], keyword?: string): string {
  const parts = keyword ? [...path, keyword] : path;
  return parts.length ? parts.join(".") : "the schema";
}

function show(value: unknown): string {
  return JSON.stringify(value);
}

/** A lower bound that dropped or fell, such as `minLength`. */
function lowered(before: Node, after: Node, keyword: string, path: string[], reasons: string[]) {
  const was = before[keyword];
  const now = after[keyword];
  if (typeof was !== "number") return;
  if (typeof now !== "number") reasons.push(`${label(path, keyword)} ${was} removed`);
  else if (now < was) reasons.push(`${label(path, keyword)} lowered from ${was} to ${now}`);
}

/** An upper bound that dropped or rose, such as `maxLength`. */
function raised(before: Node, after: Node, keyword: string, path: string[], reasons: string[]) {
  const was = before[keyword];
  const now = after[keyword];
  if (typeof was !== "number") return;
  if (typeof now !== "number") reasons.push(`${label(path, keyword)} ${was} removed`);
  else if (now > was) reasons.push(`${label(path, keyword)} raised from ${was} to ${now}`);
}

const STRINGS = { type: "string" };

const ANY = "any";
const REJECTED = "rejected";
const PRIMITIVE = "primitive";
type Rule = Node | typeof ANY | typeof REJECTED | typeof PRIMITIVE;

/** What an object schema does with the value of a key it does not list. */
function otherKeysRule(node: Node): Rule {
  if (node.additionalProperties === true) return ANY;
  if (isNode(node.additionalProperties)) return node.additionalProperties;
  // Without `properties` or `additionalProperties`, an object is flat.
  return isNode(node.properties) ? REJECTED : PRIMITIVE;
}

/** What an object schema does with a key's value. */
function ruleFor(node: Node, key: string): Rule {
  const properties = node.properties;
  if (isNode(properties) && Object.prototype.hasOwnProperty.call(properties, key)) {
    return isNode(properties[key]) ? properties[key] : ANY;
  }
  return otherKeysRule(node);
}

/** How one key's rule widened, from what the schema did with it before to what it does now. */
function describeRuleWidening(
  was: Rule,
  now: Rule,
  at: string[],
  allowed: string,
  who: string,
): string[] {
  if (now === REJECTED || was === ANY) return [];
  if (was === REJECTED) return [allowed];
  if (now === ANY) return [`${who} any value`];
  if (was === PRIMITIVE) {
    return now !== PRIMITIVE && (now.type === "object" || now.type === "array")
      ? [`${who} an ${now.type}`]
      : [];
  }
  if (now === PRIMITIVE) return [`${who} any primitive value`];
  return describeSchemaWidening(was, now, at);
}

function describeObjectWidening(before: Node, after: Node, path: string[]): string[] {
  const reasons: string[] = [];
  const beforeProperties = isNode(before.properties) ? before.properties : {};
  const afterProperties = isNode(after.properties) ? after.properties : {};
  const keys = Object.keys(beforeProperties);
  for (const key of Object.keys(afterProperties)) {
    if (!Object.prototype.hasOwnProperty.call(beforeProperties, key)) keys.push(key);
  }

  for (const key of keys) {
    const at = [...path, key];
    reasons.push(
      ...describeRuleWidening(
        ruleFor(before, key),
        ruleFor(after, key),
        at,
        `${label(at)} is allowed`,
        `${label(at)} accepts`,
      ),
    );
  }

  // Keys neither schema lists, ruled by `additionalProperties`.
  const now = otherKeysRule(after);
  reasons.push(
    ...describeRuleWidening(
      otherKeysRule(before),
      now,
      [...path, "*"],
      now === ANY ? `${label(path)} allows any other key` : `${label(path)} allows other keys`,
      `other keys of ${label(path)} accept`,
    ),
  );

  return reasons;
}

/** The value kind a branch takes, used to pair it with a branch from before. */
function branchKind(branch: unknown): string | undefined {
  if (!isNode(branch)) return undefined;
  if (typeof branch.schema === "string") return `schema:${branch.schema}`;
  if (typeof branch.type === "string") return `type:${branch.type}`;
  if ("const" in branch) return `const:${show(branch.const)}`;
  return undefined;
}

/**
 * A branch widens a `oneOf` unless some branch from before took everything it
 * does. Branches are paired by what they take, so reordering them is no change.
 */
function describeBranchWidening(
  before: unknown[],
  branch: unknown,
  path: string[],
  gained: string,
): string[] {
  let closest: string[] | undefined;
  for (const earlier of before) {
    const reasons = describeSchemaWidening(earlier, branch, path);
    if (!reasons.length) return [];
    if (branchKind(earlier) === branchKind(branch) && (!closest || reasons.length < closest.length))
      closest = reasons;
  }
  return closest ?? [gained];
}

/**
 * How a schema change lets values through that the schema rejected before,
 * such as a higher `maxLength`, a new `enum` value or a key that is no longer
 * required. Narrowing changes, which only reject more, are not listed. A
 * change it cannot weigh, such as a new `pattern`, is listed as a change.
 */
export function describeSchemaWidening(
  before: unknown,
  after: unknown,
  path: string[] = [],
): string[] {
  const reasons: string[] = [];
  if (!isNode(before) || !isNode(after)) {
    if (JSON.stringify(before) !== JSON.stringify(after)) reasons.push(`${label(path)} changed`);
    return reasons;
  }

  if (before.schema !== after.schema) {
    if (typeof after.schema === "string") {
      reasons.push(
        typeof before.schema === "string"
          ? `${label(path)} references "${after.schema}" instead of "${before.schema}"`
          : `${label(path)} references "${after.schema}" instead of its own rules`,
      );
      return reasons;
    }
    if (typeof before.schema === "string") {
      reasons.push(`${label(path)} has its own rules instead of referencing "${before.schema}"`);
      return reasons;
    }
  }

  const beforeBranches = Array.isArray(before.oneOf) ? before.oneOf : undefined;
  const afterBranches = Array.isArray(after.oneOf) ? after.oneOf : undefined;
  if (beforeBranches || afterBranches) {
    // A schema without `oneOf` is one branch, so adding or removing `oneOf` compares branches.
    const was = beforeBranches ?? [before];
    if (!afterBranches) {
      return describeBranchWidening(
        was,
        after,
        path,
        `${label(path)} takes a kind of value none of its branches took`,
      );
    }
    afterBranches.forEach((branch, index) =>
      reasons.push(
        ...describeBranchWidening(
          was,
          branch,
          [...path, `oneOf[${index}]`],
          `${label(path, "oneOf")} gains a branch`,
        ),
      ),
    );
    return reasons;
  }

  if (before.type !== undefined && before.type !== after.type) {
    // The other type's keywords weigh other values, so the change of type is the whole story.
    reasons.push(
      after.type === undefined
        ? `${label(path, "type")} ${show(before.type)} removed`
        : `${label(path, "type")} changed from ${show(before.type)} to ${show(after.type)}`,
    );
    return reasons;
  }

  if ("const" in before && (!("const" in after) || show(before.const) !== show(after.const))) {
    reasons.push(
      "const" in after
        ? `${label(path, "const")} changed from ${show(before.const)} to ${show(after.const)}`
        : `${label(path, "const")} removed`,
    );
  }

  if (Array.isArray(before.enum)) {
    if (!Array.isArray(after.enum)) {
      reasons.push(`${label(path, "enum")} removed`);
    } else {
      const known = new Set(before.enum.map(show));
      const added = after.enum.filter((value) => !known.has(show(value)));
      if (added.length) reasons.push(`${label(path, "enum")} gains ${added.map(show).join(", ")}`);
    }
  }

  lowered(before, after, "minimum", path, reasons);
  raised(before, after, "maximum", path, reasons);
  lowered(before, after, "minLength", path, reasons);
  raised(before, after, "maxLength", path, reasons);
  lowered(before, after, "minItems", path, reasons);
  raised(before, after, "maxItems", path, reasons);

  if (typeof before.pattern === "string" && before.pattern !== after.pattern) {
    reasons.push(
      typeof after.pattern === "string"
        ? `${label(path, "pattern")} changed`
        : `${label(path, "pattern")} removed`,
    );
  }
  if (typeof before.format === "string" && before.format !== after.format) {
    reasons.push(
      typeof after.format === "string"
        ? `${label(path, "format")} changed from ${show(before.format)} to ${show(after.format)}`
        : `${label(path, "format")} ${show(before.format)} removed`,
    );
  }
  if (before.uniqueItems === true && after.uniqueItems !== true) {
    reasons.push(`${label(path, "uniqueItems")} removed`);
  }

  if (Array.isArray(before.required)) {
    const still = new Set(Array.isArray(after.required) ? (after.required as string[]) : []);
    for (const key of before.required as string[]) {
      if (!still.has(key)) reasons.push(`${label([...path, key])} is no longer required`);
    }
  }

  if (before.type === "object" && after.type === "object") {
    reasons.push(...describeObjectWidening(before, after, path));
  }

  if (before.type === "array" && after.type === "array") {
    // An array without `items` holds strings only.
    reasons.push(
      ...describeSchemaWidening(before.items ?? STRINGS, after.items ?? STRINGS, [...path, "[]"]),
    );
  }

  return reasons;
}
