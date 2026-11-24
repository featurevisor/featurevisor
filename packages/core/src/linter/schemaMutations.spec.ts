import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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

environments:
  dev:
    mutate:
      properties.displayName.maxLength: 60
      properties.country.enum:append: DE
  staging:
    mutate:
      properties.displayName.maxLength: 60

mutations:
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
  test("a schema with environments and mutations lints clean", async () => {
    expect(await lint()).toEqual([]);
  });

  test("each environment's datafile holds the schema as it resolves there, with mutations compiled", async () => {
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
      expect("environments" in prod).toBe(false);
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

  test("lint checks every environment entry and every mutation", async () => {
    const errors = await lint({
      "schemas/broken.yml": `description: Broken in every way

type: object

properties:
  name:
    type: string
    minLength: 2
  age:
    type: integer

environments:
  qa:
    mutate:
      properties.name.minLength: 3
  dev:
    mutate:
      properties.nam.minLength: 3
  staging:
    mutate:
      properties.name.maxLength: 1

mutations:
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
      "broken environments.qa",
      "broken environments.dev.mutate.properties.nam.minLength",
      // A maxLength below minLength fails twice, once for each bound.
      "broken environments.staging.mutate",
      "broken environments.staging.mutate",
      "broken mutations.0.conditions.input",
      "broken mutations.0.mutate.properties.age.type",
      "broken mutations.1.key",
      "broken mutations.1.conditions",
    ]);
    const messages = errors.map(({ message }) => message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Unknown environment "qa". Environments: dev, staging, production.',
        "`properties.nam.minLength` reaches nothing: `properties.nam` is not there. A mutation changes what exists, and creates no objects on the way.",
        "`input('agee')` names no field of this node, whose fields are name, age. Paths are relative to the node a mutation sits on.",
        expect.stringContaining("A mutation cannot change a `type`"),
        'Mutation key "older" is used twice in this node.',
        expect.stringContaining("In staging, the schema fails:"),
        expect.stringContaining("a variable's schema stays the same everywhere"),
      ]),
    );
  });

  test("environments need a project with environments", async () => {
    const errors = await lint({
      "featurevisor.config.js": `module.exports = ${JSON.stringify({ tags: ["web"], conditionExpressions: true })};`,
      "schemas/signUp.yml": `description: A sign up form\n\ntype: string\n\nenvironments:\n  dev: {}\n`,
    });

    expect(errors.map(({ message }) => message)).toEqual([
      "`environments` needs a project with environments. In a project with sets, each set has its own schema files.",
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
      segments: "*"
      percentage: 100
  staging:
    - key: everyone
      segments: "*"
      percentage: 100
  production:
    - key: inputs
      segments:
        input: accountType
        operator: equals
        value: business
      percentage: 100
`,
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every(({ key }) => key === "checkout")).toBe(true);
  });
});
