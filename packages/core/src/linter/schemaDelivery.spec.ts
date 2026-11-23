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

async function lintWarnings(files: Record<string, string>) {
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
    if (result.errors.length)
      return result.errors.map(({ message }) => ({ code: "error", at: message }));
    return (result.warnings || []).map(({ code, path: at }) => ({ code, at: at.join(".") }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

  test("warns about messages that can never show", async () => {
    const warnings = await lintWarnings({
      "schemas/order.yml": `description: An order

type: object

properties:
  quantity:
    type: integer
    minimum: 1
    messages:
      minimum: Order at least {minimum}
  note:
    oneOf:
      - type: string
        maxLength: 3
        messages:
          maxLength: Shorter, please
      - type: string
        minLength: 10
  nickname:
    oneOf:
      - type: string
        maxLength: 10
      - const: null
  code:
    oneOf:
      - type: string
        minLength: 3
      - enum: [1, 2]
    messages:
      minLength: At least {minLength} letters
  mixed:
    oneOf:
      - oneOf:
          - type: string
          - type: integer
      - type: boolean
        messages:
          type: Yes or no

messages:
  quantity:
    maxLength: Too long
    minimum: At least {minimum}
  nickname:
    maxLength: Keep it to {maxLength}
`,
    });

    expect(warnings).toEqual([
      { code: "message_never_shown", at: "messages.quantity.maxLength" },
      { code: "message_worded_twice", at: "properties.quantity.messages.minimum" },
      { code: "message_never_shown", at: "properties.note.oneOf.0.messages.maxLength" },
      // An enum branch takes its values' types, so the value's type selects a branch.
      // A branch that is a oneOf itself takes no one type, so none is selected.
      { code: "message_never_shown", at: "properties.mixed.oneOf.1.messages.type" },
    ]);
  });

  test("annotations that fit their vocabularies lint clean", async () => {
    const warnings = await lintWarnings({
      "schemas/formAnnotations.yml": `description: What our forms say about a field

type: object

properties:
  placeholder:
    type: string
  input:
    type: string
    enum: [text, email, select]
`,
      "schemas/countryOption.yml": `description: What a country choice carries

type: object

properties:
  flag:
    type: string
  hidden:
    type: boolean
`,
      "schemas/country.yml": `description: Countries we sell to

optionSchema:
  schema: countryOption

oneOf:
  - const: GB
    annotations:
      title: United Kingdom
      flag: gb
  - const: NL
    annotations:
      title: Netherlands
      flag: nl
  - const: null
    annotations:
      title: Prefer not to say
      hidden: true

messages:
  enum: Choose a country from the list
`,
      "schemas/signUp.yml": `description: A sign up form

annotationsSchema:
  schema: formAnnotations

optionSchema:
  type: object
  properties:
    badge:
      type: string

type: object

properties:
  email:
    type: string
    annotations:
      title: Email address
      placeholder: ada@example.com
      input: email
      examples: [ada@example.com]
  plan:
    type: string
    enum: [free, pro]
    annotations:
      title: Plan
      input: select
      options:
        free:
          title: Free
        pro:
          title: Pro
          badge: popular
  seats:
    enum: [1, 5, null]
    annotations:
      options:
        "1":
          title: Just me
        "5":
          title: A small team
        "null":
          title: Not sure yet
  country:
    schema: country
    annotations:
      title: Country
  address:
    type: object
    properties:
      city:
        type: string
      zip:
        type: string
    annotations:
      order: [zip, city]

required: [email]

annotations:
  title: Create your account
  order: [plan, email]
`,
    });

    expect(warnings).toEqual([]);
  });

  test("annotations are checked against the vocabularies and the built in ones", async () => {
    const errors = await lint({
      "schemas/form.yml": `description: A form

annotationsSchema:
  type: object
  properties:
    placeholder:
      type: string
    title:
      type: string

optionSchema:
  type: object
  properties:
    tone:
      type: string
    value:
      type: string

type: object

properties:
  email:
    type: string
    annotations:
      placeholdr: ada
      placeholder: 3
      title: ""
      examples: [1]
  plan:
    type: string
    enum: [free, pro]
    annotations:
      options:
        gold:
          title: Gold
        free:
          title: Free
          tone: 1
          value: free
          colour: red
  size:
    type: integer
    annotations:
      options: {}
  mixed:
    enum: [1, "1"]
    annotations:
      options:
        "1":
          title: One
  tier:
    oneOf:
      - const: 1
        annotations:
          title: One
      - const: 1

annotations:
  order: [plan, plan, nope]
`,
    });

    expect(errors.map(({ at }) => at.join("."))).toEqual([
      "annotationsSchema.properties.title",
      "optionSchema.properties.value",
      "annotations.order.1",
      "annotations.order.2",
      "properties.email.annotations.placeholdr",
      "properties.email.annotations.placeholder",
      "properties.email.annotations.title",
      "properties.email.annotations.examples.0",
      "properties.plan.annotations.options.gold",
      "properties.plan.annotations.options.free.tone",
      "properties.plan.annotations.options.free.value",
      "properties.plan.annotations.options.free.colour",
      "properties.size.annotations.options",
      "properties.mixed.annotations.options.1",
      "properties.tier.oneOf.1",
    ]);
    expect(errors.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        "`title` is built in, so `annotationsSchema` cannot declare it.",
        "Unknown annotation `placeholdr`. `annotationsSchema` declares `placeholder`, `title`.",
        "`placeholder` does not match what `annotationsSchema` declares for it.",
        "Example 1 does not pass the field's own rules.",
        "gold is not one of the `enum`'s values: free, pro.",
        '1 names 1 and "1" at once, so it cannot say which.',
        "1 is a choice already, at `oneOf[0]`.",
        "`order` names nope, which is not a field here. Fields: email, plan, size, mixed, tier.",
      ]),
    );
  });

  test("a vocabulary's required names are carried by every node a handle reaches, and by every choice", async () => {
    const errors = await lint({
      "schemas/address.yml": `description: An address

annotationsSchema:
  type: object
  properties:
    help:
      type: string

type: object

properties:
  city:
    type: string

annotations:
  help: Where you live
`,
      "schemas/form.yml": `description: A form

annotationsSchema:
  type: object
  properties:
    help:
      type: string
    placeholder:
      type: string
  required: [help]

optionSchema:
  type: object
  properties:
    tone:
      type: string
  required: [tone]

type: object

properties:
  email:
    type: string
    annotations:
      help: Where we write
  plan:
    type: string
    enum: [free, pro, team]
    annotations:
      help: Pick one
      options:
        free:
          tone: grey
        pro:
          title: Pro
  tier:
    oneOf:
      - const: 1
        annotations:
          tone: blue
      - const: 2
    annotations:
      help: Tiers
  tags:
    type: array
    items:
      type: string
    annotations:
      help: Tags
  address:
    schema: address
  nickname:
    oneOf:
      - type: object
        properties:
          first:
            type: string
      - const: null
    annotations:
      help: Optional

annotations:
  help: The whole form
`,
    });

    // A field beside a reference carries the referenced schema's annotations, and nothing inside a oneOf is reached.
    expect(errors.map(({ at, message }) => [at.join("."), message])).toEqual([
      [
        "properties.plan.annotations.options.pro",
        "`optionSchema` requires `tone`, which this choice does not have.",
      ],
      [
        "properties.plan.enum.2",
        "`optionSchema` requires `tone`, and the choice team has no entry in `options`.",
      ],
      [
        "properties.tier.oneOf.1",
        "`optionSchema` requires `tone`, which this choice does not have.",
      ],
      [
        "properties.tags.items",
        "`annotationsSchema` requires `help`, which this node does not have.",
      ],
    ]);
  });

  test("without a vocabulary only the built in annotations are allowed, and a vocabulary is an object", async () => {
    const errors = await lint({
      "schemas/plain.yml": `description: A plain schema

annotationsSchema:
  type: string

type: string

annotations:
  title: Plain
  placeholder: Type here
`,
    });

    expect(errors.map(({ message }) => message)).toEqual([
      "`annotationsSchema` must be an object schema, whose properties are the names annotations can have.",
      "`placeholder` is not a built in annotation, and this schema has no `annotationsSchema` to declare it.",
    ]);
  });

  test("warns when some choices have a title and others do not, and a choice list words its issue as enum", async () => {
    const warnings = await lintWarnings({
      "schemas/plan.yml": `description: A plan

type: object

properties:
  plan:
    type: string
    enum: [free, pro, team]
    annotations:
      options:
        free:
          title: Free
  tier:
    oneOf:
      - const: 1
        annotations:
          title: One
      - const: 2
    messages:
      enum: Choose a tier
      minLength: Never raised
`,
    });

    expect(warnings).toEqual([
      { code: "option_without_title", at: "properties.plan.annotations.options" },
      { code: "option_without_title", at: "properties.tier.oneOf" },
      { code: "message_never_shown", at: "properties.tier.messages.minLength" },
    ]);
  });

  test("targets take includeAnnotations, and variables' schemas take no annotations", async () => {
    expect(
      await lint({
        "schemas/request.yml": "description: A request\n\ntags:\n  - web\n\ntype: string\n",
        "targets/api.yml": "description: API\n\ntag: web\n\nincludeAnnotations: false\n",
      }),
    ).toEqual([]);

    const errors = await lint({
      "variables/payload.yml":
        "description: Payload\n\ntype: object\n\nproperties:\n  email:\n    type: string\n    annotations:\n      title: Email\n\ndefaultValue:\n  email: ada@example.com\n",
    });
    expect(errors.length).toBeGreaterThan(0);
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
