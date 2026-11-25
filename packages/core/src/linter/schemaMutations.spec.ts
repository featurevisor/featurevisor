import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createFeaturevisor } from "@featurevisor/sdk";
import { createSchemas } from "@featurevisor/schemas";

import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { getCustomDatafile } from "../builder/buildDatafile";
import { generateTypeScriptCodeForProject } from "../generate-code/typescript";
import { lintProject } from "./lintProject";

const signUp = `description: A sign up form

tags:
  - web

type: object

properties:
  accountType:
    type: string
    enum: [personal, business]
  displayName:
    type: string
    maxLength: 40
  country:
    type: string
    enum: [GB, NL]
  taxId:
    type: string

required: [accountType, displayName]

mutations:
  dev:
    - key: longerNames
      conditions: "*"
      mutate:
        properties.displayName.maxLength: 60
        properties.country.enum:append: DE

  staging:
    - key: longerNames
      conditions: "*"
      mutate:
        properties.displayName.maxLength: 60

  production:
    - key: business
      conditions:
        input: accountType
        operator: equals
        value: business
      mutate:
        required:appendUnique: taxId
        properties.taxId.pattern: "^[A-Z]{2}[0-9]{9}$"
    - key: payingAccounts
      conditions: paying
      mutate:
        properties.displayName.maxLength: 80
    - key: dutch
      conditions: country == 'nl'
      mutate:
        properties.displayName.description: For the Dutch market
`;

/** Indents condition lines written for a list at the root by one more level, for a list under an environment. */
const indent = (text: string) => text.replace(/^/gm, "  ");

function createProject(files: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-schema-mutations-"));
  const all: Record<string, string> = {
    "featurevisor.config.js": `module.exports = ${JSON.stringify({
      tags: ["web"],
      environments: ["dev", "staging", "production"],
      conditionExpressions: true,
    })};`,
    "attributes/userId.yml": "description: User\ntype: string\n",
    "attributes/plan.yml": "description: Plan\ntype: string\n",
    "attributes/country.yml": "description: Country\ntype: string\n",
    "segments/paying.yml": "description: Paying accounts\nconditions: plan == 'paid'\n",
    "segments/unused.yml": "description: Not read by anything\nconditions: plan == 'free'\n",
    "schemas/signUp.yml": signUp,
    "targets/web.yml": "description: Web\ntag: web\n",
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  const projectConfig = getProjectConfig(root);
  const datasource = new Datasource(projectConfig, root);
  return { root, projectConfig, datasource };
}

async function lint(files: Record<string, string> = {}) {
  const { root, projectConfig, datasource } = createProject(files);
  try {
    const deps = { rootDirectoryPath: root, projectConfig, datasource, options: {} };
    const result = await lintProject(deps as any, { json: true });
    return result.errors.map(({ key, message, path: at }) => ({ key, at: at.join("."), message }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("schemas per environment and under conditions", () => {
  test("a schema with mutations by environment lints clean", async () => {
    expect(await lint()).toEqual([]);
  });

  test("each environment's datafile holds its own mutations, those that always apply already applied", async () => {
    const { root, projectConfig, datasource } = createProject();
    try {
      const build = (environment: string) =>
        getCustomDatafile({ projectConfig, datasource, environment, tag: "web", revision: "1" });
      const dev = (await build("dev")).schemas!.signUp as any;
      const staging = (await build("staging")).schemas!.signUp as any;
      const production = await build("production");
      const prod = production.schemas!.signUp as any;

      expect(dev.properties.displayName.maxLength).toBe(60);
      expect(dev.properties.country.enum).toEqual(["GB", "NL", "DE"]);
      expect(staging.properties.displayName.maxLength).toBe(60);
      expect(staging.properties.country.enum).toEqual(["GB", "NL"]);
      expect(prod.properties.displayName.maxLength).toBe(40);
      // `*` mutations before any other apply when the datafile is built, so dev and staging have none left.
      expect("mutations" in dev).toBe(false);
      expect("mutations" in staging).toBe(false);
      expect(new Set([dev.hash, staging.hash, prod.hash]).size).toBe(3);

      // Mutations reach the datafile compiled, with expressions expanded into trees.
      expect(prod.mutations.map((mutation: any) => mutation.key)).toEqual([
        "business",
        "payingAccounts",
        "dutch",
      ]);
      // Conditions are written as features' are, here as JSON text, the project's default.
      const conditions = (mutation: any) => JSON.parse(mutation.conditions);
      expect({ ...prod.mutations[0], conditions: conditions(prod.mutations[0]) }).toEqual({
        key: "business",
        conditions: { input: "accountType", operator: "equals", value: "business" },
        operations: [
          { op: "appendUnique", path: ["required"], value: "taxId" },
          { op: "set", path: ["properties", "taxId", "pattern"], value: "^[A-Z]{2}[0-9]{9}$" },
        ],
      });
      expect(conditions(prod.mutations[2])).toEqual({
        attribute: "country",
        operator: "equals",
        value: "nl",
      });
      // The segments mutations read come along, and no others.
      expect(Object.keys(production.segments)).toEqual(["paying"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("generated types come from production's version, or the environment named", async () => {
    const { root, projectConfig, datasource } = createProject();
    try {
      const generate = async (environment?: string) => {
        const out = path.join(root, `generated-${environment || "default"}`);
        fs.mkdirSync(out, { recursive: true });
        await generateTypeScriptCodeForProject(
          { rootDirectoryPath: root, projectConfig, datasource, options: {} } as any,
          out,
          { environment },
        );
        return fs.readFileSync(path.join(out, "schemas.ts"), "utf8");
      };

      expect(await generate()).toContain('country?: "GB" | "NL"');
      expect(await generate("dev")).toContain('country?: "GB" | "NL" | "DE"');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("lint checks every environment's list and every mutation", async () => {
    const errors = await lint({
      "schemas/broken.yml": `description: Broken in every way

type: object

properties:
  name:
    type: string
    minLength: 2
  age:
    type: integer

mutations:
  qa:
    - key: longer
      conditions: "*"
      mutate:
        properties.name.minLength: 3

  dev:
    - key: longer
      conditions: "*"
      mutate:
        properties.nam.minLength: 3

  staging:
    - key: short
      conditions: "*"
      mutate:
        properties.name.maxLength: 1

  production:
    - key: older
      conditions:
        input: agee
        operator: greaterThan
        value: 18
      mutate:
        properties.age.type: string
    - key: older
      conditions: unknownSegment
      mutate:
        properties.age.minimum: 18
`,
      "variables/form.yml": `description: Uses a schema that varies

schema: signUp

defaultValue:
  accountType: personal
  displayName: Ada
`,
    });

    expect(errors.map(({ key, at }) => `${key} ${at}`)).toEqual([
      "form schema",
      "broken mutations.qa",
      "broken mutations.dev.0.mutate.properties.nam.minLength",
      // A maxLength below minLength fails twice, once for each bound.
      "broken mutations.staging.0",
      "broken mutations.staging.0",
      "broken mutations.production.0.conditions.input",
      "broken mutations.production.0.mutate.properties.age.type",
      "broken mutations.production.1.key",
      "broken mutations.production.1.conditions",
    ]);
    const messages = errors.map(({ message }) => message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Unknown environment "qa". Environments: dev, staging, production.',
        "`properties.nam.minLength` reaches nothing: `properties.nam` is not there. A mutation changes what exists, and creates no objects on the way.",
        "`input('agee')` names no field of this node, whose fields are name, age. Paths are relative to the node a mutation or an issue sits on.",
        expect.stringContaining("A mutation cannot change a `type`"),
        'Mutation key "older" is used twice in this node.',
        expect.stringContaining('With mutation "short", the schema fails:'),
        expect.stringContaining("a variable's schema stays the same everywhere"),
      ]),
    );
  });

  test("valueFrom compares one field with another, and value is always a value", async () => {
    const shipping = (conditions: string) => ({
      "schemas/shipping.yml": `description: Shipping

tags:
  - web

type: object

properties:
  billingCountry:
    type: string
  shippingCountry:
    type: string
  customsDescription:
    type: string

required: [billingCountry]

mutations:
  production:
    - key: shipsAbroad
      conditions:
        input: shippingCountry
${indent(conditions)}
      mutate:
        required:appendUnique: customsDescription
`,
    });
    const found = async (conditions: string) =>
      (await lint(shipping(conditions))).map(({ at, message }) => ({ at, message }));
    const at = "mutations.production.0.conditions";

    expect(
      await found("      operator: notEquals\n      valueFrom:\n        input: billingCountry"),
    ).toEqual([]);
    expect(
      await found("      operator: notEquals\n      valueFrom:\n        input: billing"),
    ).toEqual([
      {
        at: `${at}.valueFrom.input`,
        message:
          "`input('billing')` names no field of this node, whose fields are billingCountry, shippingCountry, customsDescription. Paths are relative to the node a mutation or an issue sits on.",
      },
    ]);
    expect(
      await found("      operator: notEquals\n      value:\n        input: billingCountry"),
    ).toEqual([
      {
        at: `${at}.value`,
        message:
          "A value is text, a number, a boolean, null or a list. To compare with another field, use `valueFrom: { input: ... }`.",
      },
    ]);
    expect(
      await found(
        "      operator: notEquals\n      value: GB\n      valueFrom:\n        input: billingCountry",
      ),
    ).toEqual([
      { at: `${at}.valueFrom`, message: "A condition takes `value` or `valueFrom`, not both." },
    ]);
    expect(
      await found("      operator: matches\n      valueFrom:\n        input: billingCountry"),
    ).toEqual([
      {
        at: `${at}.valueFrom`,
        message:
          "`matches` never takes its pattern from `valueFrom`, since a pattern from a user is one nobody reviewed.",
      },
    ]);
    expect(
      await found("      operator: exists\n      valueFrom:\n        input: billingCountry"),
    ).toEqual([
      { at: `${at}.valueFrom`, message: 'when operator is "exists", valueFrom is not needed' },
    ]);
  });

  test("valueFrom reaches the datafile as written", async () => {
    const { root, projectConfig, datasource } = createProject({
      "schemas/signUp.yml": `description: A sign up form

tags:
  - web

type: object

properties:
  billingCountry:
    type: string
  shippingCountry:
    type: string
  customsDescription:
    type: string

required: [billingCountry]

mutations:
  production:
    - key: shipsAbroad
      conditions:
        input: shippingCountry
        operator: notEquals
        valueFrom:
          input: billingCountry
      mutate:
        required:appendUnique: customsDescription
`,
    });
    try {
      const datafile = await getCustomDatafile({
        projectConfig,
        datasource,
        environment: "production",
        tag: "web",
        revision: "1",
      });
      const mutation = (datafile.schemas!.signUp as any).mutations[0];
      expect(JSON.parse(mutation.conditions)).toEqual({
        input: "shippingCountry",
        operator: "notEquals",
        valueFrom: { input: "billingCountry" },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("input(...) in expressions compiles to input leaves and valueFrom", async () => {
    const shipping = (conditions: string) => ({
      "schemas/shipping.yml": `description: Shipping

tags:
  - web

type: object

properties:
  billingCountry:
    type: string
  shippingCountry:
    type: string
  customsDescription:
    type: string

required: [billingCountry]

mutations:
  production:
    - key: shipsAbroad
      conditions: ${conditions}
      mutate:
        required:appendUnique: customsDescription
`,
    });
    const located = async (conditions: string) => {
      const { root, projectConfig, datasource } = createProject(shipping(conditions));
      try {
        const deps = { rootDirectoryPath: root, projectConfig, datasource, options: {} };
        const result = await lintProject(deps as any, { json: true });
        return result.errors.map(({ message, line, column, endColumn }) => ({
          message,
          line,
          column,
          endColumn,
        }));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    };

    const clean = "input('shippingCountry') != input('billingCountry') and plan == 'paid'";
    expect(await located(clean)).toEqual([]);
    const { root, projectConfig, datasource } = createProject(shipping(clean));
    try {
      const datafile = await getCustomDatafile({
        projectConfig,
        datasource,
        environment: "production",
        tag: "web",
        revision: "1",
      });
      expect(JSON.parse((datafile.schemas!.shipping as any).mutations[0].conditions)).toEqual([
        {
          input: "shippingCountry",
          operator: "notEquals",
          valueFrom: { input: "billingCountry" },
        },
        { attribute: "plan", operator: "equals", value: "paid" },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }

    // A path that names no field points at the call that reads it, on the conditions line.
    const conditionsLine = 21;
    const conditionsColumn = "      conditions: ".length + 1;
    const wrong = "input('shippingCountry') != input('billing')";
    expect(await located(wrong)).toEqual([
      {
        message:
          "`input('billing')` names no field of this node, whose fields are billingCountry, shippingCountry, customsDescription. Paths are relative to the node a mutation or an issue sits on.",
        line: conditionsLine,
        column: conditionsColumn + wrong.indexOf("input('billing')"),
        endColumn: conditionsColumn + wrong.length,
      },
    ]);
    expect(await located("input('shippingCountry') matches input('billingCountry')")).toEqual([
      expect.objectContaining({
        message:
          "`matches` never takes its pattern from `input(...)`, since a pattern from a user is one nobody reviewed.",
      }),
    ]);
  });

  test("input(...) anywhere but a schema's mutations says where it goes", async () => {
    const errors = await lint({
      "features/checkout.yml": `description: Checkout

tags:
  - web

bucketBy: userId

rules:
  dev:
    - key: everyone
      conditions: "*"
      percentage: 100
  staging:
    - key: everyone
      conditions: "*"
      percentage: 100
  production:
    - key: inputs
      conditions: input('accountType') == 'business'
      percentage: 100
`,
    });

    expect(errors.map(({ key, message }) => ({ key, message }))).toEqual([
      {
        key: "checkout",
        message:
          "`input` reads the value a schema validates, so it goes only in a schema's mutations and issues.",
      },
    ]);
  });

  test("a schema's expressions need a project that allows them", async () => {
    const errors = await lint({
      "featurevisor.config.js": `module.exports = ${JSON.stringify({
        tags: ["web"],
        environments: ["dev", "staging", "production"],
      })};`,
      "segments/paying.yml":
        "description: Paying accounts\nconditions:\n  attribute: plan\n  operator: equals\n  value: paid\n",
      "segments/unused.yml": "description: Not read\nconditions: '*'\n",
      "schemas/signUp.yml": `description: A sign up form

type: object

properties:
  password:
    type: string
  confirmPassword:
    type: string

mutations:
  production:
    - key: differs
      conditions: input('password') != input('confirmPassword')
      mutate:
        properties.confirmPassword.maxLength: 0
`,
    });

    expect(errors.map(({ key, message }) => ({ key, message }))).toEqual([
      { key: "signUp", message: "Condition expressions are not allowed in this project." },
    ]);
  });

  test("input stays in schemas, and a project can narrow it further", async () => {
    const config = (allowedConditions?: unknown) => ({
      "featurevisor.config.js": `module.exports = ${JSON.stringify({
        tags: ["web"],
        environments: ["dev", "staging", "production"],
        conditionExpressions: true,
        ...(allowedConditions ? { allowedConditions } : {}),
      })};`,
    });
    const segment = {
      "segments/business.yml":
        "description: Business\nconditions: input('accountType') == 'business'\n",
    };
    const variable = {
      "variables/limit.yml": `description: Limit

type: integer

defaultValue: 1

overrides:
  production:
    - key: business
      conditions:
        input: accountType
        operator: equals
        value: business
      value: 2
`,
    };
    const where =
      "`input` reads the value a schema validates, so it goes only in a schema's mutations and issues.";

    expect(
      (await lint({ ...config(), ...segment })).map(({ key, message }) => [key, message]),
    ).toEqual([["business", where]]);
    expect(
      (await lint({ ...config(), ...variable })).map(({ key, message }) => [key, message]),
    ).toEqual([["limit", where]]);
    // A project can keep schema mutations to segments, leaving input out.
    expect(
      (await lint(config({ schemas: ["segment"] }))).map(({ key, at, message }) => [
        key,
        at,
        message,
      ]),
    ).toEqual([
      [
        "signUp",
        "mutations.production.0.conditions",
        'Input conditions are not allowed in schema mutations and issues. Remove this condition, or allow "input" in allowedConditions.schemas.',
      ],
      [
        "signUp",
        "mutations.production.2.conditions",
        'Attribute conditions are not allowed in schema mutations and issues. Move this condition into a segment and reference the segment, or allow "attribute" in allowedConditions.schemas.',
      ],
    ]);
    expect(await lint(config({ schemas: ["segment", "input", "attribute"] }))).toEqual([]);
  });

  test("an environment without a list inherits one as rules do, and [] means none", async () => {
    const files = {
      "featurevisor.config.js": `module.exports = ${JSON.stringify({
        tags: ["web"],
        environments: ["dev", "staging", "production"],
        inheritEnvironments: { dev: { from: "staging" } },
        conditionExpressions: true,
      })};`,
      "schemas/signUp.yml": `description: A sign up form

tags:
  - web

type: object

properties:
  name:
    type: string
    maxLength: 40

mutations:
  staging:
    - key: paidNames
      conditions: plan == 'paid' and input('name') exists
      mutate:
        properties.name.maxLength: 80

  production: []
`,
    };
    expect(await lint(files)).toEqual([]);

    const { root, projectConfig, datasource } = createProject(files);
    try {
      const build = async (environment: string) =>
        (
          await getCustomDatafile({
            projectConfig,
            datasource,
            environment,
            tag: "web",
            revision: "1",
          })
        ).schemas!.signUp as any;
      const dev = await build("dev");
      // Dev has no list, so it uses staging's, with its expression compiled.
      expect(dev.mutations.map((mutation: any) => mutation.key)).toEqual(["paidNames"]);
      expect(JSON.parse(dev.mutations[0].conditions)).toEqual([
        { attribute: "plan", operator: "equals", value: "paid" },
        { input: "name", operator: "exists" },
      ]);
      expect("mutations" in (await build("production"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("issues report when their conditions match, and reach the datafile compiled", async () => {
    const files = {
      "segments/netherlands.yml": "description: Dutch\nconditions: country == 'nl'\n",
      "schemas/checkout.yml": `description: Checkout

tags:
  - web

type: object

properties:
  billingCountry:
    type: string
  shippingCountry:
    type: string

required: [billingCountry]

issues:
  - key: dutchShippingCountry
    conditions: netherlands and input('shippingCountry') != input('billingCountry')
    path: shippingCountry
    message: We ship Dutch orders to the billing country only
`,
    };
    expect(await lint(files)).toEqual([]);

    const { root, projectConfig, datasource } = createProject(files);
    try {
      const datafile = await getCustomDatafile({
        projectConfig,
        datasource,
        environment: "production",
        tag: "web",
        revision: "1",
      });
      const entry = (datafile.schemas!.checkout as any).issues[0];
      expect({ ...entry, conditions: JSON.parse(entry.conditions) }).toEqual({
        key: "dutchShippingCountry",
        conditions: [
          "netherlands",
          {
            input: "shippingCountry",
            operator: "notEquals",
            valueFrom: { input: "billingCountry" },
          },
        ],
        path: "shippingCountry",
        message: "We ship Dutch orders to the billing country only",
      });
      // The segment its conditions read comes along.
      expect(Object.keys(datafile.segments)).toContain("netherlands");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("lint checks every issue entry", async () => {
    const errors = await lint({
      "schemas/broken.yml": `description: Broken issues

type: object

properties:
  password:
    type: string
  confirmPassword:
    type: string
  code:
    type: string
    issues:
      - key: onString
        conditions:
          input: code
          operator: exists
        message: Never

issues:
  - key: differs
    conditions:
      input: confirmPassword
      operator: notEquals
      valueFrom:
        input: pasword
    path: confirmPassword
    message: The passwords do not match
  - key: differs
    conditions: paying
    path: confirmPasword
    message: Everyone fails
`,
      "schemas/silent.yml": `description: An issue without a message

type: object

properties:
  password:
    type: string

issues:
  - key: noMessage
    conditions:
      input: password
      operator: notExists
`,
      "variables/form.yml": `description: Uses a schema with issues

schema: broken

defaultValue:
  password: a
`,
    });

    expect(errors.map(({ key, at, message }) => [key, at, message])).toEqual(
      expect.arrayContaining([
        ["form", "schema", expect.stringContaining("a variable's schema stays the same")],
        [
          "silent",
          "issues.0.message",
          "An issue needs a `message`, or `issues` nested under it, which it groups under its conditions.",
        ],
      ]),
    );
    const messages = errors
      .filter(({ key }) => key === "broken")
      .map(({ at, message }) => [at, message]);
    expect(messages).toEqual(
      expect.arrayContaining([
        [
          "properties.code.issues",
          "`issues` goes on object nodes only, since its entries compare an object's fields.",
        ],
        [
          "issues.0.conditions.valueFrom.input",
          "`input('pasword')` names no field of this node, whose fields are password, confirmPassword, code. Paths are relative to the node a mutation or an issue sits on.",
        ],
        ["issues.1.key", 'Issue key "differs" is used twice in this node.'],
        [
          "issues.1.conditions",
          "An issue's conditions read at least one `input`, or it would fail every value for everyone they match. They say when a value fails, such as `input('confirmPassword') != input('password')`.",
        ],
        [
          "issues.1.path",
          "`confirmPasword` names no field of this node, whose fields are password, confirmPassword, code. An issue's path is relative to the node it sits on.",
        ],
      ]),
    );
  });

  test("the flags and global variables a delivered schema's conditions read come along", async () => {
    const files = {
      "features/strictNames.yml": `description: Stricter names, rolling out

bucketBy: userId

conditions:
  - feature: namesV2

rules:
  dev:
    - key: everyone
      conditions: "*"
      percentage: 100
  staging:
    - key: everyone
      conditions: "*"
      percentage: 100
  production:
    - key: everyone
      conditions: "*"
      percentage: 100
`,
      "features/namesV2.yml": `description: The new name rules

bucketBy: userId

rules:
  dev:
    - key: everyone
      conditions: "*"
      percentage: 100
  staging:
    - key: everyone
      conditions: "*"
      percentage: 100
  production:
    - key: everyone
      conditions: "*"
      percentage: 100
`,
      "features/unrelated.yml": `description: Read by nothing

bucketBy: userId

rules:
  dev:
    - key: everyone
      conditions: "*"
      percentage: 100
  staging:
    - key: everyone
      conditions: "*"
      percentage: 100
  production:
    - key: everyone
      conditions: "*"
      percentage: 100
`,
      "variables/relaxedNames.yml":
        "description: Relaxed names\n\ntype: boolean\n\ndefaultValue: false\n",
      "schemas/profile.yml": `description: A profile

tags:
  - web

type: object

properties:
  name:
    type: string
    maxLength: 40

mutations:
  production:
    - key: strict
      conditions:
        feature: strictNames
      mutate:
        properties.name.pattern: "^[A-Za-z ]+$"
    - key: relaxed
      conditions:
        variable: relaxedNames
        operator: equals
        value: true
      mutate:
        properties.name.maxLength: 80
`,
      "targets/web.yml": "description: Web\ntag: web\n",
    };
    expect(await lint(files)).toEqual([]);

    const { root, projectConfig, datasource } = createProject(files);
    try {
      const datafile = await getCustomDatafile({
        projectConfig,
        datasource,
        environment: "production",
        tag: "web",
        revision: "1",
      });
      // None of them is tagged web, so before this a target left them out and the conditions never matched.
      expect(Object.keys(datafile.features).sort()).toEqual(["namesV2", "strictNames"]);
      expect(Object.keys(datafile.variables || {})).toEqual(["relaxedNames"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("an input's operator and value suit the field it reads", async () => {
    const leaf = (conditions: string) => ({
      "schemas/typed.yml": `description: Typed fields

type: object

properties:
  age:
    type: integer
  name:
    type: string
  tags:
    type: array
    items:
      type: string
  start:
    type: string
    format: date-time
  end:
    type: string
    format: date-time

mutations:
  production:
    - key: probe
      conditions:
${indent(conditions)}
      mutate:
        properties.name.maxLength: 10
`,
    });
    const found = async (conditions: string) =>
      (await lint(leaf(conditions))).map(({ at, message }) => [at, message]);
    const at = "mutations.production.0.conditions";

    expect(await found("      input: age\n      operator: startsWith\n      value: x")).toEqual([
      [`${at}.value`, 'Operator "startsWith" can only be used with string-like fields.'],
    ]);
    expect(await found("      input: name\n      operator: greaterThan\n      value: 3")).toEqual([
      [`${at}.value`, 'Operator "greaterThan" can only be used with integer or number fields.'],
    ]);
    expect(await found("      input: age\n      operator: equals\n      value: x")).toEqual([
      [`${at}.value`, 'Value does not match the schema of field "age".'],
    ]);
    expect(await found("      input: name\n      operator: includes\n      value: a")).toEqual([
      [`${at}.value`, 'Operator "includes" can only be used with array fields.'],
    ]);
    expect(
      await found(
        "      input: age\n      operator: equals\n      valueFrom:\n        input: name",
      ),
    ).toEqual([
      [
        `${at}.valueFrom.input`,
        'Field "name" is of another type, so "equals" cannot compare "age" with it.',
      ],
    ]);
    expect(
      await found("      input: name\n      operator: in\n      valueFrom:\n        input: age"),
    ).toEqual([
      [
        `${at}.valueFrom.input`,
        'Field "age" is not an array, so "in" cannot compare "name" with it.',
      ],
    ]);
    expect(
      await found(
        "      input: tags\n      operator: includes\n      valueFrom:\n        input: age",
      ),
    ).toEqual([
      [
        `${at}.valueFrom.input`,
        'Field "age" is of another type than its items, so "includes" cannot compare "tags" with it.',
      ],
    ]);
    // Comparisons that suit their fields lint clean.
    for (const conditions of [
      "      input: end\n      operator: after\n      valueFrom:\n        input: start",
      "      input: name\n      operator: in\n      valueFrom:\n        input: tags",
      "      input: tags\n      operator: includes\n      valueFrom:\n        input: name",
      "      input: age\n      operator: greaterThanOrEquals\n      value: 18",
    ]) {
      expect(await found(conditions)).toEqual([]);
    }
  });

  test("nested mutations and issues lint clean, and reach the datafile flat", async () => {
    const files = {
      "schemas/checkout.yml": `description: Checkout

tags:
  - web

type: object

properties:
  accountType:
    type: string
    enum: [personal, business]
  country:
    type: string
  taxId:
    type: string
  shippingCountry:
    type: string
  billingCountry:
    type: string

required: [accountType]

mutations:
  production:
    - key: business
      conditions: input('accountType') == 'business'
      mutate:
        required:appendUnique: taxId
      mutations:
        - key: germanBusiness
          conditions: input('country') == 'DE'
          mutate:
            properties.taxId.pattern: "^DE[0-9]{9}$"

    - key: paying
      conditions: paying
      mutations:
        - key: payingVat
          conditions: input('accountType') == 'business'
          mutate:
            properties.taxId.minLength: 11

issues:
  - key: dutch
    conditions: country == 'nl'
    issues:
      - key: shipsElsewhere
        conditions: input('shippingCountry') != input('billingCountry')
        path: shippingCountry
        message: We ship Dutch orders to the billing country only
`,
    };
    expect(await lint(files)).toEqual([]);

    const { root, projectConfig, datasource } = createProject(files);
    try {
      const datafile = await getCustomDatafile({
        projectConfig,
        datasource,
        environment: "production",
        tag: "web",
        revision: "1",
      });
      const checkout = datafile.schemas!.checkout as any;
      const conditions = (entry: any) => JSON.parse(entry.conditions);

      // A child comes after its parent, its conditions joined with its parent's, and a parent that only groups applies nothing.
      expect(checkout.mutations.map((mutation: any) => mutation.key)).toEqual([
        "business",
        "germanBusiness",
        "payingVat",
      ]);
      expect(conditions(checkout.mutations[1])).toEqual([
        { input: "accountType", operator: "equals", value: "business" },
        { input: "country", operator: "equals", value: "DE" },
      ]);
      expect(conditions(checkout.mutations[2])).toEqual([
        "paying",
        { input: "accountType", operator: "equals", value: "business" },
      ]);
      expect(checkout.issues.map((entry: any) => entry.key)).toEqual(["shipsElsewhere"]);
      expect(conditions(checkout.issues[0])).toEqual([
        { attribute: "country", operator: "equals", value: "nl" },
        { input: "shippingCountry", operator: "notEquals", valueFrom: { input: "billingCountry" } },
      ]);

      // The package validates the flat lists, and an issue names the nested mutation that set its rule.
      const f = createFeaturevisor({ datafile, logLevel: "fatal" });
      const s = createSchemas(f);
      const german = { accountType: "business", country: "DE", taxId: "NL123456789" };
      expect(
        s.validate("checkout", german).issues!.map(({ code, mutation }) => [code, mutation]),
      ).toEqual([["pattern", "germanBusiness"]]);
      expect(s.validate("checkout", { ...german, country: "GB" }).issues).toBeUndefined();
      const shipping = { accountType: "personal", shippingCountry: "DE", billingCountry: "NL" };
      expect(s.validate("checkout", shipping).issues).toBeUndefined();
      expect(
        s
          .validate("checkout", shipping, { country: "nl" })
          .issues!.map(({ params }) => params.refine),
      ).toEqual(["shipsElsewhere"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("lint checks nested mutations after the ones around them, and keys across the tree", async () => {
    const errors = await lint({
      "schemas/form.yml": `description: A form

type: object

properties:
  name:
    type: string
  password:
    type: string

mutations:
  production:
    - key: named
      conditions: input('name') exists
      mutate:
        properties.nickname:
          type: string
      mutations:
        - key: shortNickname
          conditions: input('name') == 'Ada'
          mutate:
            properties.nickname.maxLength: 3
        - key: named
          conditions: plan == 'paid'
          mutate:
            properties.nickame.maxLength: 9
        - key: nothing
          conditions: plan == 'free'

issues:
  - key: dutch
    conditions: country == 'nl'
    path: name
    issues:
      - key: guardOnly
        conditions: plan == 'paid'
        message: Everyone fails
`,
    });

    expect(errors.map(({ at, message }) => [at, message])).toEqual([
      [
        "mutations.production.0.mutations.1.key",
        'Mutation key "named" is used twice in this node.',
      ],
      [
        "mutations.production.0.mutations.1.mutate.properties.nickame.maxLength",
        "`properties.nickame.maxLength` reaches nothing: `properties.nickame` is not there. A mutation changes what exists, and creates no objects on the way.",
      ],
      [
        "mutations.production.0.mutations.2.mutate",
        "A mutation needs a `mutate`, or `mutations` nested under it, which it groups under its conditions.",
      ],
      [
        "issues.0.path",
        "An issue's `path` says where its `message` goes, so an entry that only groups others takes none.",
      ],
      [
        "issues.0.issues.0.conditions",
        "An issue's conditions read at least one `input`, or it would fail every value for everyone they match. They say when a value fails, such as `input('confirmPassword') != input('password')`.",
      ],
    ]);
  });

  test("mutations by environment sit at a schema's root, in a project with environments", async () => {
    const withoutEnvironments = await lint({
      "featurevisor.config.js": `module.exports = ${JSON.stringify({ tags: ["web"], conditionExpressions: true })};`,
      "schemas/signUp.yml": `description: A sign up form\n\ntype: string\n\nmutations:\n  dev: []\n`,
    });
    expect(withoutEnvironments.map(({ message }) => message)).toEqual([
      "Mutations by environment need a project with environments, so this schema's `mutations` are a list. In a project with sets, each set has its own schema files.",
    ]);

    const misplaced = await lint({
      "schemas/form.yml": `description: A form

type: object

properties:
  name:
    type: string
    mutations:
      production: []

mutations:
  - key: everywhere
    conditions: "*"
    mutate:
      properties.name.maxLength: 80
`,
    });
    expect(misplaced.map(({ at, message }) => [at, message])).toEqual([
      [
        "mutations",
        "In a project with environments, a schema's root `mutations` go under environment names, as features' rules do, such as `mutations: { production: [...] }`. A field's own mutations stay a list.",
      ],
      [
        "properties.name.mutations",
        "Only a schema's root lists its mutations by environment. A field's mutations are a list, the same in every environment.",
      ],
    ]);
  });

  test("an input leaf goes only in a schema's mutations", async () => {
    const errors = await lint({
      "features/checkout.yml": `description: Checkout

tags:
  - web

bucketBy: userId

rules:
  dev:
    - key: everyone
      conditions: "*"
      percentage: 100
  staging:
    - key: everyone
      conditions: "*"
      percentage: 100
  production:
    - key: inputs
      conditions:
        input: accountType
        operator: equals
        value: business
      percentage: 100
`,
    });

    expect(errors.map(({ key, message }) => ({ key, message }))).toEqual([
      {
        key: "checkout",
        message:
          "`input` reads the value a schema validates, so it goes only in a schema's mutations and issues.",
      },
    ]);
  });
});
