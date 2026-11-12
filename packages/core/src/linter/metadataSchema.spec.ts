import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config/projectConfig";
import type { MetadataSchema } from "../config/metadataSettings";
import { Datasource } from "../datasource";
import { lintProject } from "./lintProject";
import { lintMetadata } from "./metadataSchema";

const schema: MetadataSchema = {
  type: "object",
  properties: {
    owner: { type: "string", enum: ["checkout-team", "growth-team"] },
    jira: { type: "string", pattern: "^[A-Z]+-[0-9]+$" },
    launchedOn: { type: "string", format: "date-time" },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    links: { type: "object", additionalProperties: { type: "string" } },
    deadlines: {
      type: "object",
      properties: {
        review: { description: "Check the flag still earns its place" },
        remove: {
          properties: { ticket: { type: "string" } },
          required: ["ticket"],
        },
      },
      required: ["remove"],
    },
  },
  required: ["owner"],
};

function issues(value: unknown, withSchema?: MetadataSchema) {
  return lintMetadata(value, withSchema).map(({ code, path: at, message }) => ({
    code,
    at: at.join("."),
    message,
  }));
}

describe("lintMetadata without a schema", () => {
  it("accepts any JSON values, nested", () => {
    expect(
      issues({
        jira: "CHECKOUT-1",
        count: 3,
        flag: false,
        none: null,
        nested: { list: [1, "two", { three: true }] },
      }),
    ).toEqual([]);
  });

  it("refuses values with no JSON form, and anything but an object", () => {
    expect(issues({ a: undefined, b: () => 1, c: [Number.NaN], d: Infinity })).toEqual(
      ["a", "b", "c.0", "d"].map((at) => ({
        code: "invalid_metadata",
        at,
        message: "Expected a JSON value. Functions, undefined, NaN and Infinity have no JSON form.",
      })),
    );
    for (const value of ["text", 1, [1], null]) {
      expect(issues(value)).toEqual([
        {
          code: "invalid_metadata",
          at: "",
          message: "Expected `metadata` to be an object of keys and values.",
        },
      ]);
    }
  });

  it("reads a date object, as TOML gives, in its JSON form", () => {
    const toml = (json: string) =>
      Object.assign(Object.create(Date.prototype), { toJSON: () => json });
    expect(issues({ deadlines: { review: { by: toml("2027-01-15T09:00:00.000Z") } } })).toEqual([]);
    expect(issues({ deadlines: { review: { by: new Date("2027-01-15T09:00:00Z") } } })).toEqual([]);
    // a TOML local date has no time or timezone, as in YAML
    expect(issues({ deadlines: { review: { by: toml("2027-01-15") } } })).toEqual([
      expect.objectContaining({ at: "deadlines.review.by" }),
    ]);
  });

  it("takes an owner as a name or a list of different names", () => {
    expect(issues({ owner: "checkout-team" })).toEqual([]);
    expect(issues({ owner: ["checkout-team", "growth-team"] })).toEqual([]);
    for (const owner of ["", " ", [], [""], [1], { name: "x" }, 1]) {
      expect(issues({ owner })).toEqual([
        {
          code: "invalid_metadata",
          at: "owner",
          message: "Expected `owner` to be a name, or a list of one or more names.",
        },
      ]);
    }
    expect(issues({ owner: ["a", "a"] })).toEqual([
      { code: "invalid_metadata", at: "owner", message: "Expected every owner to be different." },
    ]);
  });

  it("checks every deadline's fields, timestamps and type", () => {
    expect(
      issues({
        deadlines: {
          review: { by: "2027-01-15T09:00:00Z", done: "2027-01-10T16:30:00Z", description: "Q1" },
          notifyCustomers: { by: "2027-03-01T09:00:00+01:00", done: false },
          "security-review": { by: "2027-03-01T00:00:00.000-05:00", done: true },
        },
      }),
    ).toEqual([]);

    expect(
      issues({
        deadlines: {
          a: { by: "2027-02-30T09:00:00Z" },
          b: { by: "2027-01-15T09:00:00" },
          c: {},
          d: { by: "2027-01-15T09:00:00Z", done: "soon", description: "" },
          e: { by: "2027-01-15T09:00:00Z", ticket: "X-1" },
          f: "2027-01-15T09:00:00Z",
          g: { by: "2027-03-01" },
          h: { by: "2027-03-01T09:00:00Z", done: "2027-02-27" },
          done: { by: "2027-01-15T09:00:00Z" },
          "1st": { by: "2027-01-15T09:00:00Z" },
        },
      }),
    ).toEqual([
      {
        code: "invalid_metadata",
        at: "deadlines.a.by",
        message:
          "Expected a timestamp with a timezone, such as 2027-01-15T09:00:00Z. Use YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm.",
      },
      expect.objectContaining({ at: "deadlines.b.by" }),
      {
        code: "invalid_metadata",
        at: "deadlines.c.by",
        message: "Missing `by`, the moment the deadline is due, such as 2027-01-15T09:00:00Z.",
      },
      {
        code: "invalid_metadata",
        at: "deadlines.d.done",
        message:
          "Expected true or false, or the timestamp it was done, such as 2027-01-15T09:00:00Z. Use YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm.",
      },
      {
        code: "invalid_metadata",
        at: "deadlines.d.description",
        message: "Expected a description in words.",
      },
      {
        code: "invalid_metadata",
        at: "deadlines.e.ticket",
        message:
          'Unknown field "ticket". A deadline has `by`, `done` and `description`. Declare any other field for its type in metadataSchema.',
      },
      {
        code: "invalid_metadata",
        at: "deadlines.f",
        message: "Expected a deadline, such as { by: 2027-01-15T09:00:00Z }.",
      },
      {
        code: "invalid_metadata",
        at: "deadlines.g.by",
        message:
          "Expected a timestamp with a timezone, such as 2027-03-01T09:00:00Z. A date alone has no time or timezone.",
      },
      {
        code: "invalid_metadata",
        at: "deadlines.h.done",
        message:
          "Expected true or false, or the timestamp it was done, such as 2027-02-27T09:00:00Z. A date alone has no time or timezone.",
      },
      {
        code: "invalid_metadata",
        at: "deadlines.done",
        message: '"done" is a deadline status, so it cannot name a deadline type.',
      },
      {
        code: "invalid_metadata",
        at: "deadlines.1st",
        message: "A deadline type starts with a letter, and has only letters, digits, _ and -.",
      },
    ]);
  });

  it("needs at least one deadline", () => {
    for (const deadlines of [{}, [], "2027-01-15T09:00:00Z"]) {
      expect(issues({ deadlines })).toEqual([
        expect.objectContaining({ code: "invalid_metadata", at: "deadlines" }),
      ]);
    }
  });

  it("needs metadata to record something, with or without a schema", () => {
    const empty = {
      code: "invalid_metadata",
      at: "",
      message:
        "Expected `metadata` to record something. Leave it out when there is nothing to record.",
    };
    expect(issues({})).toEqual([empty]);
    // the empty object alone, not every key the schema requires
    expect(issues({}, { type: "object", required: ["owner", "jira"] })).toEqual([empty]);
  });
});

describe("lintMetadata with a project schema", () => {
  const valid = {
    owner: "checkout-team",
    jira: "CHECKOUT-1",
    launchedOn: "2026-09-01T10:00:00Z",
    links: { design: "https://example.com" },
    deadlines: { remove: { by: "2027-01-15T09:00:00Z", ticket: "CHECKOUT-2" } },
  };

  it("accepts what the schema declares", () => {
    expect(issues(valid, schema)).toEqual([]);
    expect(issues({ ...valid, owner: ["checkout-team", "growth-team"] }, schema)).toEqual([]);
  });

  it("reports values the schema refuses, with suggestions", () => {
    expect(
      issues(
        {
          ...valid,
          owner: ["checkout-tem"],
          jira: "checkout 1",
          launchedOn: "2026-09-01",
          priority: 1,
          links: { design: 1 },
          ownr: "someone",
        },
        schema,
      ),
    ).toEqual([
      {
        code: "metadata_schema",
        at: "owner.0",
        message: 'Expected "checkout-team" or "growth-team". Did you mean "checkout-team"?',
      },
      {
        code: "metadata_schema",
        at: "jira",
        message: "Expected a value matching /^[A-Z]+-[0-9]+$/.",
      },
      {
        code: "metadata_schema",
        at: "launchedOn",
        message:
          "Expected a timestamp with a timezone, such as 2026-09-01T09:00:00Z. A date alone has no time or timezone.",
      },
      {
        code: "metadata_schema",
        at: "links.design",
        message: "Expected a string, but got a number.",
      },
      { code: "metadata_schema", at: "priority", message: 'Expected "low", "medium" or "high".' },
      {
        code: "metadata_schema",
        at: "ownr",
        message:
          'Unknown metadata key "ownr". This project\'s metadataSchema does not declare it. Did you mean "owner"?',
      },
    ]);
  });

  it("checks required keys, including owner and deadlines", () => {
    expect(issues({ jira: "CHECKOUT-1" }, schema)).toEqual([
      {
        code: "metadata_schema",
        at: "owner",
        message: "Missing `owner`, which this project's metadataSchema requires.",
      },
    ]);
    expect(
      issues({ owner: "checkout-team" }, { ...schema, required: ["owner", "deadlines"] }),
    ).toEqual([
      {
        code: "metadata_schema",
        at: "deadlines",
        message: "Missing `deadlines`, which this project's metadataSchema requires.",
      },
    ]);
  });

  it("allows only declared deadline types, with their own fields", () => {
    expect(
      issues(
        {
          owner: "checkout-team",
          deadlines: {
            review: { by: "2027-01-15T09:00:00Z", ticket: "X" },
            cleanup: { by: "2027-01-15T09:00:00Z" },
            remove: { by: "2027-01-15T09:00:00Z", tiket: "X" },
          },
        },
        schema,
      ),
    ).toEqual([
      {
        code: "invalid_metadata",
        at: "deadlines.review.ticket",
        message:
          'Unknown field "ticket". A deadline has `by`, `done` and `description`. Declare any other field for its type in metadataSchema.',
      },
      {
        code: "metadata_schema",
        at: "deadlines.cleanup",
        message: 'Unknown deadline type "cleanup". This project allows "review" and "remove".',
      },
      {
        code: "invalid_metadata",
        at: "deadlines.remove.tiket",
        message:
          'Unknown field "tiket". A deadline has `by`, `done` and `description`, and "remove" deadlines also have "ticket". Did you mean "ticket"?',
      },
      {
        code: "metadata_schema",
        at: "deadlines.remove.ticket",
        message: 'Missing "ticket", which "remove" deadlines require.',
      },
    ]);
  });

  it("requires deadline types only where deadlines are written", () => {
    expect(issues({ owner: "checkout-team" }, schema)).toEqual([]);
    expect(
      issues(
        { owner: "checkout-team", deadlines: { review: { by: "2027-01-15T09:00:00Z" } } },
        schema,
      ),
    ).toEqual([
      {
        code: "metadata_schema",
        at: "deadlines.remove",
        message: 'Missing a "remove" deadline, which this project requires.',
      },
    ]);
  });

  it("allows other types and keys through additionalProperties", () => {
    const open: MetadataSchema = {
      type: "object",
      properties: {
        deadlines: { properties: { review: {} }, additionalProperties: {} },
      },
      additionalProperties: {},
    };
    expect(
      issues(
        { anything: { at: [1] }, deadlines: { cleanup: { by: "2027-01-15T09:00:00Z" } } },
        open,
      ),
    ).toEqual([]);
  });

  it("checks nested values: lists, objects, numbers and oneOf", () => {
    const nested: MetadataSchema = {
      type: "object",
      properties: {
        reviewers: {
          type: "array",
          items: { type: "string", minLength: 2 },
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
        },
        budget: { type: "integer", minimum: 0, maximum: 10 },
        contact: {
          type: "object",
          properties: { email: { type: "string" } },
          required: ["email"],
        },
        idOrName: { oneOf: [{ type: "integer" }, { type: "string" }] },
        version: { type: "string", format: "semver" },
        at: { type: "string", format: "date-time" },
      },
    };
    expect(
      issues(
        {
          reviewers: ["a", "bb", "bb"],
          budget: 11.5,
          contact: { phone: "1" },
          idOrName: true,
          version: "five",
          at: "2027-01-15",
        },
        nested,
      ).map(({ at, message }) => `${at}: ${message}`),
    ).toEqual([
      "reviewers: Expected at most 2 items.",
      "reviewers: Expected every item to be different.",
      "reviewers.0: Expected at least 2 characters.",
      "budget: Expected a whole number, but got a number.",
      'contact.email: Missing "email".',
      'contact.phone: Unknown key "phone".',
      "idOrName: Expected a value matching exactly one of the schemas in `oneOf`.",
      "version: Expected a version such as 5.5.0.",
      "at: Expected a timestamp with a timezone, such as 2027-01-15T09:00:00Z. A date alone has no time or timezone.",
    ]);
  });
});

describe("metadata in lint", () => {
  let root: string;

  function write(file: string, content: string) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }

  async function lint() {
    const projectConfig = getProjectConfig(root);
    const datasource = new Datasource(projectConfig, root);
    const result = await lintProject(
      { rootDirectoryPath: root, projectConfig, datasource, options: {} } as any,
      { json: true },
    );
    return result.errors.map(({ code, entityType, key, path: at }) => ({
      code,
      entityType,
      key,
      at: at.join("."),
    }));
  }

  const owned = "metadata:\n  owner: checkout-team\n";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-metadata-"));
    write(
      "featurevisor.config.js",
      `module.exports = ${JSON.stringify({
        metadataSchema: {
          type: "object",
          properties: { owner: { type: "string", enum: ["checkout-team"] } },
        },
        requireMetadataIn: [
          "features",
          "variables",
          "segments",
          "attributes",
          "targets",
          "schemas",
        ],
      })};`,
    );
    write("attributes/userId.yml", `description: User\n${owned}type: string\n`);
    write("attributes/plain.yml", "description: Plain\ntype: string\n");
    write("attributes/old.yml", "archived: true\ndescription: Old\ntype: string\n");
    write("segments/everyone.yml", `description: Everyone\n${owned}conditions: "*"\n`);
    write("segments/plain.yml", 'description: Plain\nconditions: "*"\n');
    write("schemas/link.yml", `description: Link\n${owned}type: string\n`);
    write(
      "schemas/plain.yml",
      // metadata belongs to the schema definition, never to a schema nested in it
      "description: Plain\ntype: object\nproperties:\n  url:\n    type: string\n    metadata:\n      owner: checkout-team\n",
    );
    const rules = 'rules:\n  - key: everyone\n    conditions: "*"\n    percentage: 0\n';
    write("features/owned.yml", `description: Owned\n${owned}bucketBy: userId\n${rules}`);
    write(
      "features/wrong.yml",
      `description: Wrong owner\nmetadata:\n  owner: someone\nbucketBy: userId\n${rules}`,
    );
    write("features/plain.yml", `description: Plain\nbucketBy: userId\n${rules}`);
    write(
      "variables/ownedVariable.yml",
      `description: Owned\n${owned}type: string\ndefaultValue: x\n`,
    );
    write(
      "variables/composedVariable.yml",
      `description: Composed\n${owned}compose: ownedVariable\n`,
    );
    write("variables/plainVariable.yml", "description: Plain\ntype: string\ndefaultValue: x\n");
    write("targets/all.yml", `description: All\n${owned}tags:\n  - all\n`);
    write("targets/plain.yml", "description: Plain\ntags:\n  - all\n");
    write(
      "tests/features/owned.spec.yml",
      `feature: owned\n${owned}assertions:\n  - at: 50\n    expectedToBeEnabled: false\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("checks metadata on every kind, requires it where asked, and refuses it in tests", async () => {
    const errors = await lint();
    expect(errors.filter(({ code }) => code === "missing_metadata")).toEqual(
      [
        ["attribute", "plain"],
        ["segment", "plain"],
        ["feature", "plain"],
        ["variable", "plainVariable"],
        ["schema", "plain"],
        ["target", "plain"],
      ].map(([entityType, key]) => ({
        code: "missing_metadata",
        entityType,
        key,
        at: "metadata",
      })),
    );
    expect(errors.filter(({ code }) => code === "metadata_schema")).toEqual([
      { code: "metadata_schema", entityType: "feature", key: "wrong", at: "metadata.owner" },
    ]);
    // a nested schema and a test spec know no `metadata`
    expect(
      errors.filter(({ code }) => code !== "missing_metadata" && code !== "metadata_schema"),
    ).toEqual([
      expect.objectContaining({ entityType: "schema", key: "plain", at: "properties.url" }),
      expect.objectContaining({ entityType: "test", key: "features.owned", at: "" }),
    ]);
  });

  it("never takes empty metadata for the metadata a project requires", async () => {
    write(
      "features/empty.yml",
      'description: Empty\nmetadata: {}\nbucketBy: userId\nrules:\n  - key: everyone\n    conditions: "*"\n    percentage: 0\n',
    );
    expect((await lint()).filter(({ key }) => key === "empty")).toEqual([
      { code: "invalid_metadata", entityType: "feature", key: "empty", at: "metadata" },
    ]);
  });
});
