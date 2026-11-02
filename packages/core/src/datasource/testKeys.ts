import * as path from "node:path";

import { FeaturevisorCLIError } from "../error";

/**
 * A spec's test key is its path under the tests directory, without the extension and without a
 * final `.spec`, so `checkout.yml` and `checkout.spec.yml` in one directory are the same test.
 * v3 kept `.spec` in keys, so a v3 project can hold both, and migration renames them apart.
 */

/** A spec file's test key, from its path relative to the tests directory */
export function testKeyFromRelativePath(
  relativePath: string,
  extension: string,
  namespaceCharacter: string,
): string {
  const parts = relativePath.slice(0, -(extension.length + 1)).split(/[\\/]/);
  parts[parts.length - 1] = parts[parts.length - 1].replace(/\.spec$/, "");
  return parts.join(namespaceCharacter);
}

/** Whether a spec file is named the conventional way, `<name>.spec.<extension>` */
function isSpecName(relativePath: string, extension: string): boolean {
  return relativePath.endsWith(`.spec.${extension}`);
}

export interface TestKeyCollision {
  key: string;
  /** Every file with this key, relative to the tests directory, the `.spec` name first */
  relativePaths: string[];
}

/** Spec files that share a test key with another, grouped by key in key order */
export function findTestKeyCollisions(
  relativePaths: string[],
  extension: string,
  namespaceCharacter: string,
): TestKeyCollision[] {
  const byKey = new Map<string, string[]>();
  for (const relativePath of relativePaths) {
    const key = testKeyFromRelativePath(relativePath, extension, namespaceCharacter);
    byKey.set(key, [...(byKey.get(key) || []), relativePath]);
  }
  return Array.from(byKey)
    .filter(([, paths]) => paths.length > 1)
    .map(([key, paths]) => ({
      key,
      relativePaths: [...paths].sort(
        (a, b) =>
          Number(isSpecName(b, extension)) - Number(isSpecName(a, extension)) || a.localeCompare(b),
      ),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export interface TestRename {
  /** Relative to the tests directory */
  from: string;
  to: string;
  /** The test key `from` shared with a `.spec` file, when that is why it is numbered */
  collidedWith?: string;
}

/**
 * Names every spec file `<name>.spec.<extension>`. A file already named so keeps its name. Any
 * other takes its `.spec` name when that is free, or else the first free of `<name>2.spec`,
 * `<name>3.spec` and so on, so no two files share a test key afterwards. A rename never changes
 * a key unless it had to: only files that collided are numbered.
 */
export function planTestRenames(relativePaths: string[], extension: string): TestRename[] {
  const spec = (base: string) => `${base}.spec.${extension}`;
  const taken = new Set(relativePaths.filter((file) => isSpecName(file, extension)));
  const plain = relativePaths
    .filter((file) => !isSpecName(file, extension))
    .sort((a, b) => a.localeCompare(b));
  const baseOf = (file: string) => file.slice(0, -(extension.length + 1));

  // every plain file takes its own .spec name first, so numbering never lands on one of them
  const renames = new Map<string, TestRename>();
  for (const file of plain) {
    const to = spec(baseOf(file));
    if (taken.has(to)) continue;
    taken.add(to);
    renames.set(file, { from: file, to });
  }
  for (const file of plain) {
    if (renames.has(file)) continue;
    const base = baseOf(file);
    let number = 2;
    while (taken.has(spec(`${base}${number}`))) number++;
    const to = spec(`${base}${number}`);
    taken.add(to);
    renames.set(file, { from: file, to, collidedWith: spec(base) });
  }
  return plain.map((file) => renames.get(file)!);
}

export interface TestKeyCollisionDetail {
  key: string;
  /** Every file with this key, the one to keep first */
  filePaths: string[];
  /** A free name for each of the others */
  renames: { from: string; to: string }[];
}

/** The collisions among the spec files of one tests directory, with a free name for each */
export function describeTestKeyCollisions(
  testsDirectoryPath: string,
  relativePaths: string[],
  extension: string,
  namespaceCharacter: string,
): TestKeyCollisionDetail[] {
  const collisions = findTestKeyCollisions(relativePaths, extension, namespaceCharacter);
  if (collisions.length === 0) return [];
  const absolute = (relativePath: string) =>
    path.join(testsDirectoryPath, ...relativePath.split(/[\\/]/));
  const renameOf = new Map(
    planTestRenames(relativePaths, extension)
      .filter((rename) => rename.collidedWith)
      .map((rename) => [rename.from, rename.to]),
  );
  return collisions.map(({ key, relativePaths: paths }) => ({
    key,
    filePaths: paths.map(absolute),
    renames: paths.slice(1).flatMap((from) => {
      const to = renameOf.get(from);
      return to ? [{ from: absolute(from), to: absolute(to) }] : [];
    }),
  }));
}

const shown = (filePath: string) => path.relative(process.cwd(), filePath) || filePath;

/** Thrown when spec files share a test key, listing every collision at once */
export class TestKeyCollisionError extends FeaturevisorCLIError {
  collisions: TestKeyCollisionDetail[];

  constructor(collisions: TestKeyCollisionDetail[]) {
    const places = collisions.length === 1 ? "1 place" : `${collisions.length} places`;
    const lines = [
      `Spec files share a test key in ${places}. A test key drops a final ".spec", so "<name>.spec" and "<name>" in one directory are the same test:`,
    ];
    for (const collision of collisions) {
      lines.push("", `  ${collision.key}`);
      for (const filePath of collision.filePaths) lines.push(`    ${shown(filePath)}`);
      for (const rename of collision.renames) {
        lines.push(`    Rename ${shown(rename.from)} to ${path.basename(rename.to)}, for example.`);
      }
    }
    lines.push(
      "",
      'Rename one file of each. In a project coming from v3, "featurevisor migrate" renames them.',
    );
    super(lines.join("\n"), {
      code: "test_key_collision",
      details: {
        collisions: collisions.map((collision) => ({
          key: collision.key,
          files: collision.filePaths.map(shown),
          renames: collision.renames.map((rename) => ({
            from: shown(rename.from),
            to: shown(rename.to),
          })),
        })),
      },
    });
    this.name = "TestKeyCollisionError";
    this.collisions = collisions;
  }
}
