import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parsers } from "@featurevisor/parsers";

import { getProjectConfig } from "../config";
import { formatFeaturevisorCLIError } from "../error";
import { FilesystemAdapter } from "./filesystemAdapter";
import { describeParseError, EntityParseError } from "./parseError";

describe("datasource parse diagnostics", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-parse-error-"));
    fs.writeFileSync(path.join(root, "featurevisor.config.js"), "module.exports = {};");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("includes YAML source and position in the message consumed by CLI commands", async () => {
    const file = path.join(root, "features", "broken.yml");
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, "description: Broken\nrules:\n  - key: a\n broken: value\n");
    const adapter = new FilesystemAdapter(getProjectConfig(root), root);
    const error = await adapter.readEntity("feature", "broken").catch((error) => error);
    expect(error).toBeInstanceOf(EntityParseError);
    if (!(error instanceof EntityParseError)) throw error;
    expect(error.featurevisorFilePath).toBe(file);
    expect(error.message).toMatch(/broken\.yml:4:\d+:/);
    expect(error.cause).toBeInstanceOf(Error);
    expect(formatFeaturevisorCLIError(error)).toBe(error.message);
    expect(JSON.parse(formatFeaturevisorCLIError(error, { json: true })).error.message).toBe(
      error.message,
    );
    expect(error.message).not.toContain("\n");
    expect(error.message.startsWith("features/broken.yml:")).toBe(true);
    expect(error.message).not.toContain(root);
  });

  it("retains cached parse failures and retries only when test content changes", async () => {
    const config = getProjectConfig(root);
    const parse = jest.fn(parsers.yml.parse);
    config.parser = { ...parsers.yml, parse: parse as typeof parsers.yml.parse };
    const file = path.join(root, "tests", "broken.spec.yml");
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, "feature: : broken\n");
    const adapter = new FilesystemAdapter(config, root);
    expect(await adapter.listEntities("test")).toEqual(["broken"]);
    const first = await adapter.readEntity("test", "broken").catch((error) => error);
    expect(first).toBeInstanceOf(EntityParseError);
    if (!(first instanceof EntityParseError)) throw first;
    expect(first.message).toContain("broken.spec.yml:1:");
    const second = await adapter.readEntity("test", "broken").catch((error) => error);
    expect(second).toBe(first);
    expect(parse).toHaveBeenCalledTimes(1);

    fs.writeFileSync(file, "feature: checkout\nassertions: []\n");
    const repaired = await adapter.readEntity<{ assertions: unknown[] }>("test", "broken");
    repaired.assertions.push("changed");
    expect(await adapter.readEntity("test", "broken")).toEqual({
      feature: "checkout",
      assertions: [],
    });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("does not turn read or clone failures into cached parse errors", async () => {
    const config = getProjectConfig(root);
    const adapter = new FilesystemAdapter(config, root);
    await expect(adapter.readEntity("feature", "missing")).rejects.toMatchObject({
      code: "ENOENT",
    });
    config.parser = {
      ...parsers.yml,
      parse: (() => ({ feature: "checkout", fn: () => {} })) as typeof parsers.yml.parse,
    };
    const file = path.join(root, "tests", "invalid.spec.yml");
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, "content");
    const uncloneable = new FilesystemAdapter(config, root);
    const error = await uncloneable.readEntity("test", "invalid").catch((error) => error);
    expect(error).toMatchObject({ name: "DataCloneError" });
    expect(error).not.toBeInstanceOf(EntityParseError);
  });

  it("preserves custom parser causes without mutating frozen errors", () => {
    const cause = Object.freeze(new Error("Custom parse failure"));
    const error = new EntityParseError("features/custom.toml", cause);
    expect(error.message).toBe("features/custom.toml: Custom parse failure");
    expect(error.cause).toBe(cause);
    expect(new EntityParseError("features/custom.toml", null).message).toContain("null");
  });

  it("retains custom multiline explanations and ignores malformed position metadata", () => {
    for (const linePos of [
      null,
      1,
      "unknown",
      {},
      [null],
      [true],
      [{ line: 0, col: 0 }],
      [{ line: "1", col: 3 }],
    ]) {
      const cause = Object.assign(new Error("Invalid TOML\nExpected a closing bracket"), {
        linePos,
      });
      const error = new EntityParseError("features/custom.toml", cause);
      expect(error.message).toBe("features/custom.toml: Invalid TOML Expected a closing bracket");
      expect(error.cause).toBe(cause);
    }
    for (const cause of [undefined, null, false, 123, BigInt(42), Symbol("failure")]) {
      expect(new EntityParseError("features/custom.toml", cause).message).toContain(String(cause));
    }
    const positioned = Object.assign(new Error("Invalid TOML\nExpected a closing bracket"), {
      linePos: [{ line: 2, col: 4 }],
    });
    expect(new EntityParseError("features/custom.toml", positioned).message).toBe(
      "features/custom.toml:2:4: Invalid TOML Expected a closing bracket",
    );
  });

  it("reads a position given as line and column, as smol-toml gives it", () => {
    const cause = Object.assign(new Error("Invalid TOML document: invalid value"), {
      line: 1,
      column: 5,
    });
    expect(new EntityParseError("features/custom.toml", cause).message).toBe(
      "features/custom.toml:1:5: Invalid TOML document: invalid value",
    );
    expect(describeParseError(Object.assign(new Error("x"), { line: 0, column: 5 }))).toEqual({
      message: "x",
    });
  });
});
