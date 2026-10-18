import * as path from "node:path";

export const ATTRIBUTE_NAMESPACE_MESSAGE =
  "Attribute definitions cannot be namespaced, and attribute names cannot contain dots. Keep each definition directly in the attributes directory, or declare an object attribute with nested properties.";

export interface InvalidAttributePath {
  key: string;
  filePath: string;
}

/** Discovery errors retain valid keys so lint can report every invalid source and continue. */
export class AttributeNamespaceError extends Error {
  constructor(
    readonly invalidAttributes: InvalidAttributePath[],
    readonly validKeys: string[] = [],
  ) {
    super(
      `${ATTRIBUTE_NAMESPACE_MESSAGE} Invalid definitions: ${invalidAttributes.map(({ filePath }) => filePath).join(", ")}`,
    );
    this.name = "AttributeNamespaceError";
  }
}

export function isFlatAttributeKey(key: string, namespaceCharacter: string): boolean {
  return !key.includes(namespaceCharacter) && !/[.\\/]/.test(key);
}

export function attributeSourcePath(directory: string, key: string, extension: string): string {
  // Attribute names are literal basenames, never reconstructed namespace paths.
  return path.join(directory, key) + `.${extension}`;
}

export function assertFlatAttributeKeys(
  keys: string[],
  directory: string,
  namespaceCharacter: string,
  extension: string,
): void {
  const invalidAttributes = keys
    .filter((key) => !isFlatAttributeKey(key, namespaceCharacter))
    .map((key) => ({
      key,
      filePath: attributeSourcePath(directory, key, extension),
    }));
  if (invalidAttributes.length) {
    throw new AttributeNamespaceError(
      invalidAttributes,
      keys.filter((key) => isFlatAttributeKey(key, namespaceCharacter)),
    );
  }
}
