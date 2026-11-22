import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { lintProject } from "./lintProject";

function createProject(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-schemas-lint-"));
  const all: Record<string, string> = {
    "featurevisor.config.js": `module.exports = ${JSON.stringify({ tags: ["web", "mobile"] })};`,
    "attributes/userId.yml": "description: User\ntype: string\n",
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

async function lint(files: Record<string, string>) {
  const root = createProject(files);
  try {
    const projectConfig = getProjectConfig(root);
    const deps = {
      rootDirectoryPath: root,
      projectConfig,
      datasource: new Datasource(projectConfig, root),
      options: {},
    };
    const result = await lintProject(deps as any, { json: true });
    return result.errors.map(({ code, key, message, path: at }) => ({ code, key, message, at }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const signUp = `description: A sign up form

tags:
  - web

type: object

properties:
  email:
    type: string
  displayName:
    type: string
    minLength: 2
  address:
    schema: address
  items:
    type: array
    items:
      type: object
      properties:
        quantity:
          type: integer

required: [email]

messages:
  additionalProperties: "{key} is not part of a sign up"
  email:
    required: Tell us your email address
  displayName:
    minLength: Use at least {minLength} characters
  address:
    city:
      required: Which city should we deliver to?
  items:
    "[]":
      quantity:
        minimum: Order at least {minimum}
`;

const address = `description: An address

type: object

properties:
  city:
    type: string

required: [city]
`;

const webTarget = "description: Web\n\ntag: web\n";

describe("lint: schemas delivered to applications", () => {
  test("a schema with tags, messages and a delivering target lints clean", async () => {
    expect(
      await lint({
        "schemas/signUp.yml": signUp,
        "schemas/address.yml": address,
        "targets/web.yml": webTarget,
      }),
    ).toEqual([]);
  });

  test("tags must be declared and given once", async () => {
    const errors = await lint({
      "schemas/coupon.yml":
        "description: A coupon\n\ntags:\n  - web\n  - desktop\n  - web\n\ntype: string\n",
    });

    expect(errors.map(({ message }) => message)).toEqual(
      expect.arrayContaining(['Unknown tag "desktop"', 'Duplicate tag "web".']),
    );
  });

  test("messages name issue codes, fields and their params", async () => {
    const errors = await lint({
      "schemas/coupon.yml": `description: A coupon

type: object

properties:
  code:
    type: string

messages:
  code:
    tooLong: Too long
    maxLength: Keep it to {max} characters
  missing:
    required: Gone
  "[]":
    required: Not an array
`,
    });

    expect(errors.map(({ message }) => message)).toEqual([
      expect.stringContaining('Unknown issue code "tooLong"'),
      expect.stringContaining('Placeholder "{max}" is not a param of "maxLength"'),
      expect.stringContaining('Unknown field "missing" in messages'),
      expect.stringContaining('"[]" holds the messages of an array\'s items'),
    ]);
  });

  test("an empty message is an error", async () => {
    const errors = await lint({
      "schemas/coupon.yml": 'description: A coupon\n\ntype: string\n\nmessages:\n  pattern: " "\n',
    });

    expect(errors.map(({ message }) => message)).toEqual(["A message cannot be empty."]);
  });

  test("additionalProperties true lints, for schemas and variables", async () => {
    expect(
      await lint({
        "schemas/request.yml":
          "description: A request\n\ntype: object\n\nproperties:\n  email:\n    type: string\n\nadditionalProperties: true\n",
        "variables/payload.yml":
          "description: Payload\n\nschema: request\n\ndefaultValue:\n  email: ada@example.com\n  extra:\n    nested: [1, 2]\n",
      }),
    ).toEqual([]);
  });

  test("selector patterns must match a schema", async () => {
    const errors = await lint({
      "schemas/address.yml": address,
      "targets/web.yml":
        "description: Web\n\nincludeSchemas:\n  - address\n  - signUp\n\nexcludeSchemas:\n  - legacy*\n",
    });

    expect(errors).toEqual([
      {
        code: "unknown_schema",
        key: "web",
        message: '"signUp" in `includeSchemas` matches no schema.',
        at: ["includeSchemas", 1],
      },
      {
        code: "unknown_schema",
        key: "web",
        message: '"legacy*" in `excludeSchemas` matches no schema.',
        at: ["excludeSchemas", 0],
      },
    ]);
  });

  test("a schema 2 target cannot deliver schemas", async () => {
    const errors = await lint({
      "schemas/signUp.yml": signUp,
      "schemas/address.yml": address,
      "targets/legacy.yml": 'description: Legacy\n\ntag: web\n\nschemaVersion: "2"\n',
    });

    expect(errors).toEqual([
      expect.objectContaining({
        code: "schema_v2_unsupported",
        key: "legacy",
        at: ["schemaVersion"],
      }),
    ]);
  });

  test("delivered patterns must be portable and safe, others need not be", async () => {
    const risky = `description: Risky

type: object

properties:
  slug:
    type: string
    pattern: "(a+)+$"
  word:
    type: string
    pattern: "(?=x)y"
`;
    expect(await lint({ "schemas/risky.yml": risky })).toEqual([]);

    const errors = await lint({
      "schemas/risky.yml": risky,
      "targets/web.yml": "description: Web\n\nincludeSchemas: [risky]\n",
    });
    expect(errors.map(({ code, at }) => ({ code, at }))).toEqual([
      { code: "regex_backtracking", at: ["properties", "slug", "pattern"] },
      { code: "unportable_regex", at: ["properties", "word", "pattern"] },
    ]);
  });

  test("lengths count code points, so an emoji counts one", async () => {
    expect(
      await lint({
        "schemas/reaction.yml":
          'description: A reaction\n\ntype: string\n\nmaxLength: 1\n\nenum: ["😀"]\n',
      }),
    ).toEqual([]);
  });

  test("a nullable field is a oneOf with const null, in schemas and variables", async () => {
    expect(
      await lint({
        "schemas/nickname.yml":
          "description: A nickname\n\noneOf:\n  - type: string\n    maxLength: 10\n  - const: null\n",
        "variables/nickname.yml":
          "description: Nickname\n\nschema: nickname\n\ndefaultValue: null\n",
      }),
    ).toEqual([]);
  });
});
