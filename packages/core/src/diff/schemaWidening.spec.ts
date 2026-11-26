import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getProjectConfig } from "../config";
import { diffDefinitions } from "./index";
import { describeSchemaWidening } from "./schemaWidening";

const signUp = {
  type: "object",
  properties: {
    email: { type: "string", pattern: "^.+@.+$" },
    displayName: { type: "string", minLength: 2, maxLength: 40 },
    country: { type: "string", enum: ["GB", "NL"] },
    tags: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  required: ["email", "displayName"],
};

describe("describeSchemaWidening", () => {
  test("lists what lets more values through", () => {
    const widened = {
      ...signUp,
      properties: {
        ...signUp.properties,
        displayName: { type: "string", minLength: 1, maxLength: 60 },
        country: { type: "string", enum: ["GB", "NL", "BE"] },
        tags: { type: "array", items: { type: "string" } },
        nickname: { type: "string" },
      },
      required: ["email"],
    };

    expect(describeSchemaWidening(signUp, widened)).toEqual([
      "displayName is no longer required",
      "displayName.minLength lowered from 2 to 1",
      "displayName.maxLength raised from 40 to 60",
      'country.enum gains "BE"',
      "tags.maxItems 3 removed",
      "nickname is allowed",
    ]);
  });

  test("lists nothing for a change that only narrows", () => {
    const narrowed = {
      ...signUp,
      properties: {
        ...signUp.properties,
        displayName: { type: "string", minLength: 3, maxLength: 30 },
        country: { type: "string", enum: ["NL"] },
      },
      required: ["email", "displayName", "country"],
      messages: { email: { required: "Tell us your email address" } },
    };

    expect(describeSchemaWidening(signUp, narrowed)).toEqual([]);
  });

  test("names changes it cannot weigh, and extra keys", () => {
    expect(
      describeSchemaWidening(
        { type: "object", properties: { code: { type: "string", pattern: "^[A-Z]+$" } } },
        {
          type: "object",
          properties: { code: { type: "string", pattern: "^[A-Z0-9]+$" } },
          additionalProperties: true,
        },
      ),
    ).toEqual(["code.pattern changed", "the schema allows any other key"]);
    expect(
      describeSchemaWidening(
        { oneOf: [{ type: "string" }, { const: null }] },
        { oneOf: [{ type: "string" }, { const: null }, { type: "integer" }] },
      ),
    ).toEqual(["oneOf gains a branch"]);
    expect(describeSchemaWidening({ schema: "address" }, { schema: "addressV2" })).toEqual([
      'the schema references "addressV2" instead of "address"',
    ]);
    expect(
      describeSchemaWidening(
        { type: "string", format: "date-time" },
        { type: "string", format: "semver" },
      ),
    ).toEqual(['format changed from "date-time" to "semver"']);
  });

  test("pairs oneOf branches by what they take, so reordering or dropping one is no widening", () => {
    const nullable = { oneOf: [{ type: "string", maxLength: 5 }, { const: null }] };

    expect(
      describeSchemaWidening(nullable, {
        oneOf: [{ const: null }, { type: "string", maxLength: 5 }],
      }),
    ).toEqual([]);
    expect(describeSchemaWidening(nullable, { type: "string", maxLength: 3 })).toEqual([]);
    expect(
      describeSchemaWidening(nullable, {
        oneOf: [{ const: null }, { type: "string", maxLength: 9 }],
      }),
    ).toEqual(["oneOf[1].maxLength raised from 5 to 9"]);
    expect(describeSchemaWidening(nullable, { type: "integer" })).toEqual([
      "the schema takes a kind of value none of its branches took",
    ]);
  });

  test("a schema that becomes nullable gains a branch", () => {
    expect(
      describeSchemaWidening(
        { type: "string", maxLength: 5 },
        { oneOf: [{ type: "string", maxLength: 5 }, { const: null }] },
      ),
    ).toEqual(["oneOf gains a branch"]);
  });

  test("an array without items holds strings", () => {
    const tags = { type: "array" };

    expect(
      describeSchemaWidening(tags, { type: "array", items: { type: "string", maxLength: 9 } }),
    ).toEqual([]);
    expect(describeSchemaWidening(tags, { type: "array", items: { type: "integer" } })).toEqual([
      '[].type changed from "string" to "integer"',
    ]);
    expect(
      describeSchemaWidening({ type: "array", items: { type: "string", maxLength: 9 } }, tags),
    ).toEqual(["[].maxLength 9 removed"]);
  });

  test("weighs each key by what both schemas do with it", () => {
    const open = {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: { type: "string", maxLength: 5 },
    };

    // A listed key that the other keys' rules took already is no widening.
    expect(
      describeSchemaWidening(open, {
        ...open,
        properties: { ...open.properties, code: { type: "string", maxLength: 3 } },
      }),
    ).toEqual([]);
    expect(
      describeSchemaWidening(open, {
        ...open,
        properties: { ...open.properties, count: { type: "integer" } },
      }),
    ).toEqual(['count.type changed from "string" to "integer"']);
    // An unlisted key falls to the rules for other keys.
    expect(
      describeSchemaWidening(open, { ...open, properties: {}, additionalProperties: true }),
    ).toEqual(["name accepts any value", "other keys of the schema accept any value"]);
  });

  test("a flat object takes primitive values, so listing keys narrows it and dropping them widens it", () => {
    const flat = { type: "object" };
    const listed = { type: "object", properties: { name: { type: "string" } } };

    expect(describeSchemaWidening(flat, listed)).toEqual([]);
    expect(
      describeSchemaWidening(flat, {
        type: "object",
        properties: { address: { type: "object", properties: {} } },
      }),
    ).toEqual(["address accepts an object"]);
    expect(describeSchemaWidening(listed, flat)).toEqual([
      "name accepts any primitive value",
      "the schema allows other keys",
    ]);
    // `properties: {}` lists no keys, and so takes none.
    expect(describeSchemaWidening(listed, { type: "object", properties: {} })).toEqual([]);
  });
});

describe("diff: widening a delivered schema", () => {
  let root: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull },
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const commit = () => {
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  };

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-widening-")));
    git("init", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    write("featurevisor.config.js", 'module.exports = { tags: ["web"] };\n');
    write(
      "schemas/address.yml",
      "description: Address\ntype: object\nproperties:\n  city:\n    type: string\n    maxLength: 20\n",
    );
    write(
      "schemas/signUp.yml",
      "description: Sign up\ntags: [web]\ntype: object\nproperties:\n  address:\n    schema: address\n",
    );
    write("schemas/internal.yml", "description: Internal\ntype: string\nmaxLength: 5\n");
    write("targets/web.yml", "description: Web\ntag: web\n");
    write("targets/all.yml", "description: All\n");
    commit();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test("warns for a schema a target delivers, even through a reference, and names the targets", () => {
    const from = git("rev-parse", "HEAD");
    write(
      "schemas/address.yml",
      "description: Address\ntype: object\nproperties:\n  city:\n    type: string\n    maxLength: 50\n",
    );
    write("schemas/internal.yml", "description: Internal\ntype: string\nmaxLength: 50\n");
    const to = commit();

    const result = diffDefinitions(root, getProjectConfig(root), { from, to });

    expect(result.warnings).toEqual([
      'Schema "address" now accepts values it rejected before: city.maxLength raised from 20 to 50. Target "web" delivers it to applications, whose code may not expect them. Regenerate their types and release them before this change.',
    ]);
  });
});
