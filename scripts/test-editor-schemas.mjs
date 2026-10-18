import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const Ajv = require("ajv");
const yaml = require("js-yaml");
const check = spawnSync(
  process.execPath,
  [join(root, "scripts/generate-editor-schemas.mjs"), "--check"],
  {
    cwd: root,
    encoding: "utf8",
  },
);
assert.equal(check.status, 0, check.stderr || check.stdout);

const locations = {
  attribute: "attributes",
  segment: "segments",
  feature: "features",
  "global-variable": "variables",
  target: "targets",
  tests: "tests",
  scenarios: "tests/scenarios",
};
const ajv = new Ajv({ allErrors: true });
let checked = 0;

const invalid = {
  attribute: [{ type: "string" }],
  segment: [
    { description: "Missing conditions" },
    {
      description: "Object operands are not authored conditions",
      conditions: { attribute: "country", operator: "equals", value: { unexpected: true } },
    },
    {
      description: "Membership candidates cannot contain objects",
      conditions: { attribute: "permissions", operator: "includesAny", value: ["write", {}] },
    },
    {
      description: "Membership candidates cannot contain arrays",
      conditions: { attribute: "permissions", operator: "notIncludesAny", value: [["write"]] },
    },
  ],
  feature: [
    { description: "Missing bucketBy" },
    {
      description: "Ordered mutations require one entry per map",
      bucketBy: "userId",
      variablesSchema: { settings: { type: "object", defaultValue: {} } },
      rules: [
        {
          key: "all",
          conditions: "*",
          percentage: 100,
          variableOverrides: {
            settings: [{ conditions: "*", mutate: [{ first: true, second: false }] }],
          },
        },
      ],
    },
  ],
  "global-variable": [{ description: "Missing type" }],
  target: [{}],
  tests: [
    { feature: "checkout" },
    { checks: [] },
    { variable: "settings", assertions: [{ checks: [{ operator: "unknown", value: 1 }] }] },
  ],
  scenarios: [
    { description: "Missing checks" },
    { checks: [] },
    { checks: "not an array" },
    { checks: [{}] },
    { checks: [{ and: [] }] },
    { checks: [{ variable: "settings", operator: "equals" }] },
    { checks: [{ variable: "settings", operator: "isNull", value: null }] },
    {
      checks: [
        { variable: "settings", operator: "equals", value: 1, compareTo: { variable: "other" } },
      ],
    },
    { checks: [{ feature: "checkout", enabled: "yes" }] },
    { checks: [{ segment: "customers", matches: "yes" }] },
    { scenario: "normalized", assertions: [{ checks: [{}] }] },
  ],
};

function visit(directory, validate) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path, validate);
    else if (/\.(?:ya?ml|json)$/.test(entry.name)) {
      // YAML timestamps parse to Date objects. Editor JSON schemas see their
      // textual representation rather than the JavaScript Date input branch.
      const value = /\.json$/.test(entry.name)
        ? JSON.parse(readFileSync(path, "utf8"))
        : JSON.parse(JSON.stringify(yaml.load(readFileSync(path, "utf8"))));
      assert.ok(validate(value), `${path}: ${ajv.errorsText(validate.errors)}`);
      checked++;
    }
  }
}

for (const [name, directory] of Object.entries(locations)) {
  const schema = JSON.parse(readFileSync(join(root, "packages/core/json-schema", `${name}.json`)));
  assert.ok(!JSON.stringify(schema).includes("__FEATUREVISOR_ENVIRONMENT__"));
  const validate = ajv.compile(schema);
  for (const project of ["example-1", "example-json", "example-composition"]) {
    const source = join(root, "examples", project, directory);
    if (existsSync(source)) visit(source, validate);
  }
  assert.equal(validate(null), false, `${name} must reject null`);
  for (const value of invalid[name]) {
    assert.equal(validate(value), false, `${name} must reject ${JSON.stringify(value)}`);
  }
}

console.log(`Editor schemas validated ${checked} example definitions`);
