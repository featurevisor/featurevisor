import { ymlParser } from "./yml";

describe("core :: parser :: ymlParser", () => {
  it("should parse YAML string into object", () => {
    const yamlString = `
foo: 1
bar: baz
arr:
  - 1
  - 2
`;
    const result = ymlParser.parse<{ foo: number; bar: string; arr: number[] }>(yamlString);
    expect(result).toEqual({ foo: 1, bar: "baz", arr: [1, 2] });
  });

  it("should stringify object into YAML string", () => {
    const obj = { foo: 1, bar: "baz", arr: [1, 2] };
    const yamlString = ymlParser.stringify(obj);
    expect(yamlString.trim()).toBe(`foo: 1
bar: baz
arr:
  - 1
  - 2`);
  });

  it("should parse and then stringify to preserve YAML content semantically", () => {
    const original = {
      alpha: "a",
      num: 42,
      bool: true,
      nullish: null,
      nested: { z: "x", y: [1, 2] },
    };
    const str = ymlParser.stringify(original);
    const reparsed = ymlParser.parse<typeof original>(str);
    expect(reparsed).toEqual(original);
  });

  it("should throw if invalid YAML string is provided to parse", () => {
    expect(() => {
      ymlParser.parse("foo: : bar");
    }).toThrow();
  });

  describe("stringify() with filePath argument (existing file for ordering/comments only)", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    let tempFile: string;

    beforeEach(() => {
      tempFile = path.join(os.tmpdir(), `test_${Math.random()}.yml`);
    });

    afterEach(() => {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });

    it("should save exactly the new object; existing file is only for ordering/comments", () => {
      const beforeYaml =
        `
foo: 1 # foo comment here
extra: blah
nested:
  a: x
  b: y
array:
  - one
  - two
`.trim() + "\n";

      const afterYaml =
        `
foo: 42 # foo comment here
bar: new
nested:
  b: updated
  c: added
array:
  - 3
  - 4
`.trim() + "\n";

      fs.writeFileSync(tempFile, beforeYaml);

      const newContent = {
        foo: 42,
        bar: "new",
        nested: { b: "updated", c: "added" },
        array: [3, 4],
      };
      const output = ymlParser.stringify(newContent, tempFile);

      expect(output).toBe(afterYaml);
    });

    it("should replace the root if YAML file is empty", () => {
      const beforeYaml = "";
      const afterYaml =
        `
hello: world
test:
  - 1
  - 2
  - 3
`.trim() + "\n";

      fs.writeFileSync(tempFile, beforeYaml);

      const obj = { hello: "world", test: [1, 2, 3] };
      const output = ymlParser.stringify(obj, tempFile);

      expect(output).toBe(afterYaml);
    });

    it("should throw if trying to set YAML document root to a primitive", () => {
      const beforeYaml =
        `
foo: bar
`.trim() + "\n";

      fs.writeFileSync(tempFile, beforeYaml);

      // Root must be an object when using filePath; primitives throw
      expect(() => {
        ymlParser.stringify("primitive", tempFile);
      }).toThrow(/Cannot set root document to a primitive value/);
    });

    it("should fall back to simple stringify if filePath does not exist", () => {
      const fakeFilePath = path.join(os.tmpdir(), `notfound_${Math.random()}.yml`);
      const afterYaml =
        `
only: in-memory
`.trim() + "\n";

      const obj = { only: "in-memory" };
      const output = ymlParser.stringify(obj, fakeFilePath);

      expect(output).toBe(afterYaml);
      expect(fs.existsSync(fakeFilePath)).toBe(false); // should not create the file
    });

    it("should not mutate the original YAML file", () => {
      const beforeYaml =
        `
foo: unchanged
bar: before
`.trim() + "\n";

      fs.writeFileSync(tempFile, beforeYaml);
      const onDiskBefore = fs.readFileSync(tempFile, "utf8");

      const obj = { bar: "after" };
      ymlParser.stringify(obj, tempFile);

      const onDiskAfter = fs.readFileSync(tempFile, "utf8");
      expect(onDiskAfter).toBe(onDiskBefore); // file on disk unchanged
    });
  });
});
