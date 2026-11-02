import * as path from "node:path";

import {
  describeTestKeyCollisions,
  findTestKeyCollisions,
  planTestRenames,
  testKeyFromRelativePath,
  TestKeyCollisionError,
} from "./testKeys";

describe("test keys", () => {
  it.each([
    ["checkout.spec.yml", ".", "checkout"],
    ["checkout.yml", ".", "checkout"],
    ["features/checkout.spec.yml", ".", "features.checkout"],
    ["features/checkout.spec.yml", "/", "features/checkout"],
    ["nested.spec/checkout.yml", ".", "nested.spec.checkout"],
    ["checkout.spec.spec.yml", ".", "checkout.spec"],
  ])("reads %s as %s with namespace %s", (relativePath, namespace, key) => {
    expect(testKeyFromRelativePath(relativePath, "yml", namespace)).toBe(key);
  });

  it("reads keys from any parser's extension and either path separator", () => {
    expect(testKeyFromRelativePath("features\\checkout.spec.json", "json", "/")).toBe(
      "features/checkout",
    );
    expect(testKeyFromRelativePath("checkout.toml", "toml", ".")).toBe("checkout");
  });

  it("groups every file that shares a key, the .spec name first", () => {
    expect(
      findTestKeyCollisions(
        [
          "pricing.yml",
          "checkout.yml",
          "nested/checkout.yml",
          "pricing.spec.yml",
          "checkout.spec.yml",
          "alone.yml",
        ],
        "yml",
        ".",
      ),
    ).toEqual([
      { key: "checkout", relativePaths: ["checkout.spec.yml", "checkout.yml"] },
      { key: "pricing", relativePaths: ["pricing.spec.yml", "pricing.yml"] },
    ]);
    expect(findTestKeyCollisions(["a.yml", "b.spec.yml"], "yml", ".")).toEqual([]);
  });
});

describe("planning test renames", () => {
  it("names a plain spec <name>.spec, and leaves .spec names alone", () => {
    expect(planTestRenames(["checkout.yml", "pricing.spec.yml"], "yml")).toEqual([
      { from: "checkout.yml", to: "checkout.spec.yml" },
    ]);
    expect(planTestRenames(["pricing.spec.yml"], "yml")).toEqual([]);
  });

  it("numbers a spec whose .spec name is taken, from 2", () => {
    expect(planTestRenames(["checkout.yml", "checkout.spec.yml"], "yml")).toEqual([
      { from: "checkout.yml", to: "checkout2.spec.yml", collidedWith: "checkout.spec.yml" },
    ]);
  });

  it("skips every number already taken", () => {
    expect(
      planTestRenames(
        ["checkout.yml", "checkout.spec.yml", "checkout2.spec.yml", "checkout3.spec.yml"],
        "yml",
      ),
    ).toEqual([
      { from: "checkout.yml", to: "checkout4.spec.yml", collidedWith: "checkout.spec.yml" },
    ]);
  });

  it("never numbers onto a name another plain spec takes", () => {
    // checkout2.yml becomes checkout2.spec.yml, so checkout.yml moves on to 3
    expect(planTestRenames(["checkout.yml", "checkout.spec.yml", "checkout2.yml"], "yml")).toEqual([
      { from: "checkout.yml", to: "checkout3.spec.yml", collidedWith: "checkout.spec.yml" },
      { from: "checkout2.yml", to: "checkout2.spec.yml" },
    ]);
  });

  it("plans within each directory and for any extension", () => {
    expect(
      planTestRenames(
        ["features/checkout.json", "features/checkout.spec.json", "segments/checkout.json"],
        "json",
      ),
    ).toEqual([
      {
        from: "features/checkout.json",
        to: "features/checkout2.spec.json",
        collidedWith: "features/checkout.spec.json",
      },
      { from: "segments/checkout.json", to: "segments/checkout.spec.json" },
    ]);
  });

  it("leaves no two files with one key, however the names fall", () => {
    const files = [
      "a.yml",
      "a.spec.yml",
      "a2.yml",
      "a2.spec.yml",
      "a3.spec.yml",
      "b.yml",
      "nested/a.yml",
      "nested/a.spec.yml",
    ];
    const renamed = new Map(planTestRenames(files, "yml").map(({ from, to }) => [from, to]));
    const after = files.map((file) => renamed.get(file) || file);
    expect(after.every((file) => file.endsWith(".spec.yml"))).toBe(true);
    expect(findTestKeyCollisions(after, "yml", ".")).toEqual([]);
    expect(new Set(after).size).toBe(files.length);
  });
});

describe("describing collisions", () => {
  const tests = path.join("/project", "tests");

  it("gives each colliding file a free name, beside the file it keeps", () => {
    expect(
      describeTestKeyCollisions(
        tests,
        ["checkout.yml", "checkout.spec.yml", "alone.yml"],
        "yml",
        ".",
      ),
    ).toEqual([
      {
        key: "checkout",
        filePaths: [path.join(tests, "checkout.spec.yml"), path.join(tests, "checkout.yml")],
        renames: [
          { from: path.join(tests, "checkout.yml"), to: path.join(tests, "checkout2.spec.yml") },
        ],
      },
    ]);
  });

  it("lists every collision in one readable message", () => {
    const collisions = describeTestKeyCollisions(
      tests,
      ["checkout.yml", "checkout.spec.yml", "nested/pricing.yml", "nested/pricing.spec.yml"],
      "yml",
      ".",
    );
    const error = new TestKeyCollisionError(collisions);
    expect(error.code).toBe("test_key_collision");
    const shown = (file: string) => path.relative(process.cwd(), path.join(tests, file));
    expect(error.message).toBe(
      [
        'Spec files share a test key in 2 places. A test key drops a final ".spec", so "<name>.spec" and "<name>" in one directory are the same test:',
        "",
        "  checkout",
        `    ${shown("checkout.spec.yml")}`,
        `    ${shown("checkout.yml")}`,
        `    Rename ${shown("checkout.yml")} to checkout2.spec.yml, for example.`,
        "",
        "  nested.pricing",
        `    ${shown("nested/pricing.spec.yml")}`,
        `    ${shown("nested/pricing.yml")}`,
        `    Rename ${shown("nested/pricing.yml")} to pricing2.spec.yml, for example.`,
        "",
        'Rename one file of each. In a project coming from v3, "featurevisor migrate" renames them.',
      ].join("\n"),
    );
    expect(error.details).toEqual({
      collisions: [
        {
          key: "checkout",
          files: [shown("checkout.spec.yml"), shown("checkout.yml")],
          renames: [{ from: shown("checkout.yml"), to: shown("checkout2.spec.yml") }],
        },
        {
          key: "nested.pricing",
          files: [shown("nested/pricing.spec.yml"), shown("nested/pricing.yml")],
          renames: [{ from: shown("nested/pricing.yml"), to: shown("nested/pricing2.spec.yml") }],
        },
      ],
    });
  });
});
