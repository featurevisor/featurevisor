import * as path from "path";

import type { ParsedFeature, Schema } from "@featurevisor/types";
import { parsers } from "@featurevisor/parsers";

import type { ProjectConfig } from "../config";
import { getTargetSchemaKeys, targetIncludesSchema } from "../targeting";
import { buildDatafile } from "./buildDatafile";
import { generateHashForDatafile } from "./hashes";
import { buildSchemasSection, toDatafileSchema } from "./schemas";

const schemas: Record<string, Schema> = {
  signUp: {
    description: "A sign up form",
    tags: ["web", "mobile"],
    type: "object",
    properties: {
      email: { type: "string", description: "Their email" },
      address: { schema: "address" },
    },
    required: ["email"],
    messages: { email: { required: "Tell us your email address" } },
  },
  address: {
    description: "An address",
    type: "object",
    properties: { city: { type: "string", minLength: 1 } },
  },
  coupon: { description: "A coupon", tags: ["web"], type: "string", pattern: "^[A-Z0-9]{8}$" },
  legacyAddress: { description: "Old", tags: ["web"], type: "object" },
};
const keys = Object.keys(schemas);

describe("which schemas a target delivers", () => {
  test.each([
    [{}, []],
    [{ tag: "web" }, ["signUp", "address", "coupon", "legacyAddress"]],
    [{ tag: "mobile" }, ["signUp", "address"]],
    [{ tags: { and: ["web", "mobile"] } }, ["signUp", "address"]],
    [{ tag: "mobile", includeSchemas: ["coupon"] }, ["signUp", "address", "coupon"]],
    [{ includeSchemas: ["coupon"] }, ["coupon"]],
    [{ tag: "web", excludeSchemas: ["legacyAddress"] }, ["signUp", "address", "coupon"]],
    [
      { includeSchemas: "*" as const, excludeSchemas: ["coupon"] },
      keys.filter((k) => k !== "coupon"),
    ],
  ])("%j delivers %j", (target, expected) => {
    expect(getTargetSchemaKeys(target, keys, schemas)).toEqual(expected);
  });

  test("references come along, even excluded ones", () => {
    const target = { includeSchemas: ["signUp"], excludeSchemas: ["address"] };

    expect(targetIncludesSchema(target, "address", schemas.address)).toBe(false);
    expect(getTargetSchemaKeys(target, keys, schemas)).toEqual(["signUp", "address"]);
  });

  test("patterns select by key", () => {
    expect(getTargetSchemaKeys({ includeSchemas: ["sign*"] }, keys, schemas)).toEqual([
      "signUp",
      "address",
    ]);
  });
});

describe("the schemas section", () => {
  test("keeps rules, references and messages, without maintainer fields", () => {
    expect(toDatafileSchema(schemas.signUp)).toEqual({
      type: "object",
      properties: { email: { type: "string" }, address: { schema: "address" } },
      required: ["email"],
      messages: { email: { required: "Tell us your email address" } },
    });
  });

  test("a hash covers every schema an entry references", () => {
    const before = buildSchemasSection(["signUp", "address", "coupon"], schemas);
    const changed = {
      ...schemas,
      address: { ...schemas.address, properties: { city: { type: "string" as const } } },
    };
    const after = buildSchemasSection(["signUp", "address", "coupon"], changed);

    expect(after.address.hash).not.toBe(before.address.hash);
    expect(after.signUp.hash).not.toBe(before.signUp.hash);
    expect(after.coupon.hash).toBe(before.coupon.hash);
  });

  test("a description alone changes no hash", () => {
    const before = buildSchemasSection(["coupon"], schemas);
    const after = buildSchemasSection(["coupon"], {
      coupon: { ...schemas.coupon, description: "Printed on the receipt" },
    });

    expect(after.coupon.hash).toBe(before.coupon.hash);
  });

  test("schemas that reference each other hash without looping", () => {
    const tree: Record<string, Schema> = {
      node: {
        type: "object",
        properties: { children: { type: "array", items: { schema: "node" } } },
      },
    };

    expect(buildSchemasSection(["node"], tree).node.hash).toEqual(expect.any(String));
  });
});

describe("datafiles", () => {
  function projectConfig(): ProjectConfig {
    const root = "/project";
    return {
      featuresDirectoryPath: path.join(root, "features-missing"),
      segmentsDirectoryPath: path.join(root, "segments-missing"),
      attributesDirectoryPath: path.join(root, "attributes-missing"),
      schemasDirectoryPath: path.join(root, "schemas"),
      targetsDirectoryPath: path.join(root, "targets-missing"),
      variablesDirectoryPath: path.join(root, "variables-missing"),
      testsDirectoryPath: path.join(root, "tests-missing"),
      stateDirectoryPath: path.join(root, ".featurevisor"),
      datafilesDirectoryPath: path.join(root, "datafiles"),
      datafileNamePattern: "featurevisor-%s.json",
      revisionFileName: "REVISION",
      catalogDirectoryPath: path.join(root, "catalog"),
      setsDirectoryPath: path.join(root, "sets"),
      environments: false,
      sets: false,
      namespaceCharacter: ".",
      tags: ["web", "mobile"],
      adapter: {},
      plugins: [],
      defaultBucketBy: "userId",
      parser: parsers.yml,
      prettyState: true,
      prettyDatafile: false,
      stringify: true,
      enforceCatchAllRule: false,
    } as unknown as ProjectConfig;
  }

  const datasource = {
    listSchemas: async () => keys,
    readSchema: async (key: string) => schemas[key],
    listFeatures: async () => [],
    readFeature: async () => ({}) as ParsedFeature,
    listSegments: async () => [],
    readSegment: async () => ({}),
    listAttributes: async () => [],
    listVariables: async () => [],
    readState: async () => ({ features: {} }),
  } as any;

  const build = (options: Record<string, unknown>) =>
    buildDatafile(
      projectConfig(),
      datasource,
      { revision: "1", environment: false, ...options },
      { features: {} },
    );

  test("a target without schema selectors keeps its datafile as it was", async () => {
    const datafile = await build({});

    expect("schemas" in datafile).toBe(false);
  });

  test("a tag target delivers its schemas, hashed", async () => {
    const datafile = await build({ tag: "mobile" });

    expect(Object.keys(datafile.schemas!)).toEqual(["signUp", "address"]);
    expect(datafile.schemas!.signUp.hash).toEqual(expect.any(String));
    expect(datafile.schemas!.signUp.messages).toEqual({
      email: { required: "Tell us your email address" },
    });
  });

  test("schemas count towards a revision from hashes", async () => {
    const without = await build({});
    const withSchemas = await build({ includeSchemas: ["coupon"] });

    expect(generateHashForDatafile(withSchemas)).not.toBe(generateHashForDatafile(without));
  });

  test("withSchemas false delivers none", async () => {
    const datafile = await build({ tag: "web", withSchemas: false });

    expect("schemas" in datafile).toBe(false);
  });
});
