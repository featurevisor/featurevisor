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

  describe("stringify() with filePath argument (merging with existing YAML file)", () => {
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

    it("should merge new object into existing YAML file, preserving unrelated fields", () => {
      fs.writeFileSync(tempFile, `
foo: 1
extra: keepthis
nested:
  a: x
  b: y
array:
  - one
  - two
`.trim() + "\n");

      // New content: update foo, add new bar, update nested.b, add nested.c, replace array
      const newContent = {
        foo: 42,
        bar: "new",
        nested: { b: "updated", c: "added" },
        array: [3, 4],
      };
      const output = ymlParser.stringify(newContent, tempFile);

      // Parse the resulting YAML for assertions
      const parsed = ymlParser.parse<any>(output);

      // Unrelated fields are preserved, updated fields are changed, new fields added
      expect(parsed.foo).toBe(42);
      expect(parsed.bar).toBe("new");
      expect(parsed.extra).toBe("keepthis");
      expect(parsed.nested.a).toBe("x");
      expect(parsed.nested.b).toBe("updated");
      expect(parsed.nested.c).toBe("added");
      expect(parsed.array).toEqual([3, 4]);
    });

    it("should replace the root if YAML file is empty", () => {
      fs.writeFileSync(tempFile, "");

      const obj = { hello: "world", test: [1, 2, 3] };
      const output = ymlParser.stringify(obj, tempFile);

      expect(output.trim()).toBe(`hello: world
test:
  - 1
  - 2
  - 3`);
    });

    it("should throw if trying to set YAML document root to a primitive", () => {
      fs.writeFileSync(tempFile, `
foo: bar
`.trim() + "\n");
      // Deep merging tries to set root to string: should throw from yml.ts check
      expect(() => {
        ymlParser.stringify("primitive", tempFile);
      }).toThrow(/Cannot set root document to a primitive value/);
    });

    it("should fall back to simple stringify if filePath does not exist", () => {
      const fakeFilePath = path.join(os.tmpdir(), `notfound_${Math.random()}.yml`);
      const obj = { only: "in-memory" };
      const output = ymlParser.stringify(obj, fakeFilePath);

      expect(output.trim()).toBe(`only: in-memory`);
      expect(fs.existsSync(fakeFilePath)).toBe(false); // should not create the file
    });

    it("should not mutate the original YAML file", () => {
      fs.writeFileSync(tempFile, `
foo: unchanged
bar: before
`.trim() + "\n");
      const before = fs.readFileSync(tempFile, "utf8");

      const obj = { bar: "after" };
      ymlParser.stringify(obj, tempFile);
      // File on disk is unchanged
      const after = fs.readFileSync(tempFile, "utf8");
      expect(before).toBe(after);
    });
  });
});
