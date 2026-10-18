/**
 * JavaScript objects inherit these names, so a context lookup can find a value the
 * application never supplied. Dictionary based SDKs do not, which would make one
 * datafile evaluate differently across languages.
 */
export const INHERITED_PROPERTY_NAMES = new Set([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "prototype",
  "toLocaleString",
  "toString",
  "valueOf",
]);

export function getInheritedPropertyNameError(name: string, kind: string): string | null {
  return INHERITED_PROPERTY_NAMES.has(name)
    ? `${kind} "${name}" is reserved because JavaScript objects inherit it. Choose another name.`
    : null;
}

/** Declared property paths with reserved names, read from the raw parsed definition. */
export function findInheritedPropertyNames(
  schema: unknown,
  path: (string | number)[] = [],
): Array<{ name: string; path: (string | number)[] }> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const found: Array<{ name: string; path: (string | number)[] }> = [];
  const node = schema as Record<string, unknown>;
  const properties = node.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const name of Object.keys(properties)) {
      const propertyPath = [...path, "properties", name];
      if (INHERITED_PROPERTY_NAMES.has(name)) found.push({ name, path: propertyPath });
      found.push(
        ...findInheritedPropertyNames((properties as Record<string, unknown>)[name], propertyPath),
      );
    }
  }
  for (const key of ["items", "additionalProperties"])
    found.push(...findInheritedPropertyNames(node[key], [...path, key]));
  if (Array.isArray(node.oneOf))
    node.oneOf.forEach((branch, index) =>
      found.push(...findInheritedPropertyNames(branch, [...path, "oneOf", index])),
    );
  return found;
}
