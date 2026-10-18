import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const ts = require("typescript");
const { z } = require("zod");
const prettier = require("prettier");
const Ajv = require("ajv");

// Transpile the current authoring schemas in memory. Regeneration does not depend
// on a possibly stale lib directory or delete build output used by other tests.
require.extensions[".ts"] = (module, path) => {
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path,
  }).outputText;
  module._compile(output, path);
};

const authoring = (name) => require(join(root, "packages/core/src/linter", `${name}.ts`));
const removedSchemaTypes = new Set(Object.keys(authoring("schemaFormats").REMOVED_SCHEMA_TYPES));
const { getAttributeZodSchema } = authoring("attributeSchema");
const { getConditionsZodSchema } = authoring("conditionSchema");
const { getSegmentZodSchema } = authoring("segmentSchema");
const { getFeatureZodSchema } = authoring("featureSchema");
const { getVariableZodSchema } = authoring("variableSchema");
const { getTargetZodSchema } = authoring("targetSchema");
const testAuthoring = authoring("testSchema");

const marker = "__FEATUREVISOR_ENVIRONMENT__";
const project = { tags: ["all"], defaultBucketBy: "userId" };
const withEnvironments = { ...project, environments: [marker] };
const exampleKey = ["example"];
// Runtime dispatch uses transforms for precise diagnostics. Editors use the
// representable grammar exposed by the same condition validator.
const conditions = getConditionsZodSchema(project, {}).editorSchema;
const environmentConditions = getConditionsZodSchema(withEnvironments, {}).editorSchema;

function convert(schema) {
  const json = z.toJSONSchema(schema, {
    target: "draft-07",
    io: "input",
    unrepresentable: "any",
  });
  assert.notDeepEqual(
    Object.keys(json),
    ["$schema"],
    "Authoring schema has no representable shape",
  );
  return json;
}

function removeProjectEnum(value) {
  if (Array.isArray(value)) return value.map(removeProjectEnum);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "enum" && Array.isArray(item) && item.length === 1 && item[0] === marker) continue;
    result[key] = removeProjectEnum(item);
  }
  return result;
}

function variantsByName(entries) {
  // Environments come from the consumer project, not this repository. A schema
  // snapshot must never restrict property names to a dummy project value.
  const definitions = {};
  const variants = Object.entries(entries).map(([prefix, schema]) => {
    const variant = removeProjectEnum(schema);
    const rename = (value) => {
      if (Array.isArray(value)) return value.map(rename);
      if (!value || typeof value !== "object") return value;
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] =
          key === "$ref" && typeof item === "string"
            ? item.replace(/^#\/definitions\//, `#/definitions/${prefix}_`)
            : rename(item);
      }
      return result;
    };
    for (const [key, value] of Object.entries(variant.definitions || {})) {
      definitions[`${prefix}_${key}`] = rename(value);
    }
    const body = { ...variant };
    delete body.$schema;
    delete body.definitions;
    return rename(body);
  });
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    anyOf: variants,
    definitions,
  };
}

function layouts(plain, perEnvironment) {
  return variantsByName({ plain, environment: perEnvironment });
}

const testShapes = testAuthoring.getTestAuthoringShapes(
  withEnvironments,
  exampleKey,
  exampleKey,
  exampleKey,
  exampleKey,
);
const plainTestShapes = testAuthoring.getTestAuthoringShapes(
  project,
  exampleKey,
  exampleKey,
  exampleKey,
  exampleKey,
);

function scenarioAuthoringShape(execution) {
  const assertion = execution.properties?.assertions?.items;
  assert.equal(assertion?.type, "object", "Scenario assertion shape changed");
  const properties = { ...assertion.properties };
  delete properties.key;
  delete properties.promotable;
  assert.ok(properties.checks, "Scenario checks shape is missing");
  return {
    $schema: execution.$schema,
    type: "object",
    properties: { promotable: execution.properties.promotable, ...properties },
    required: ["checks"],
    additionalProperties: false,
    definitions: execution.definitions,
  };
}

const scenario = layouts(
  scenarioAuthoringShape(convert(plainTestShapes.scenarioTestZodSchema)),
  scenarioAuthoringShape(convert(testShapes.scenarioTestZodSchema)),
);

const schemas = {
  attribute: convert(getAttributeZodSchema()),
  segment: convert(getSegmentZodSchema(project, conditions)),
  feature: layouts(
    convert(getFeatureZodSchema(project, conditions, exampleKey, exampleKey, exampleKey)),
    convert(
      getFeatureZodSchema(
        withEnvironments,
        environmentConditions,
        exampleKey,
        exampleKey,
        exampleKey,
      ),
    ),
  ),
  "global-variable": layouts(
    convert(getVariableZodSchema(project, {}, exampleKey, {}, {}).editorSchema),
    convert(getVariableZodSchema(withEnvironments, {}, exampleKey, {}, {}).editorSchema),
  ),
  target: convert(getTargetZodSchema(project)),
  tests: variantsByName({
    feature: convert(testShapes.featureTestZodSchema),
    segment: convert(testShapes.segmentTestZodSchema),
    variable: convert(testShapes.variableTestZodSchema),
    scenario: scenarioAuthoringShape(convert(testShapes.scenarioTestZodSchema)),
    plainFeature: convert(plainTestShapes.featureTestZodSchema),
    plainSegment: convert(plainTestShapes.segmentTestZodSchema),
    plainVariable: convert(plainTestShapes.variableTestZodSchema),
    plainScenario: scenarioAuthoringShape(convert(plainTestShapes.scenarioTestZodSchema)),
  }),
  scenarios: scenario,
};

const unrestrictedJsonProperties = new Set([
  "value",
  "additionalProperties",
  "error",
  "traffic",
  "force",
  "conditions",
  "stickyFeature",
  "variation",
  "variableValue",
  "variableSchema",
  "variable",
  "defaultVariableValue",
  "expectedValue",
]);

function prepare(value, schemaName, path = []) {
  if (Array.isArray(value))
    return value.map((item, index) => prepare(item, schemaName, [...path, index]));
  if (!value || typeof value !== "object") return value;

  if (Object.keys(value).length === 0) {
    const property = path.at(-1);
    assert.ok(
      property !== "conditions" || !["segment", "feature", "global-variable"].includes(schemaName),
      `${schemaName} conditions must retain their structural grammar`,
    );
    if (property === "not") return value; // z.never() becomes the false schema.
    if (property === "items" && path.at(-3) === "anyOf" && path.at(-4) === "value") {
      // Runtime refinements supply operator specific candidate diagnostics.
      // Editors still reject structured entries in condition operand arrays.
      return { anyOf: ["string", "number", "boolean", "null"].map((type) => ({ type })) };
    }
    if (property === "mutate") {
      // The input side of the validation pipeline is unrestricted so it can
      // report precise list item errors. Describe its accepted map and list
      // forms explicitly rather than losing the list form during conversion.
      const map = {
        type: "object",
        additionalProperties: {
          $comment: "Mutation values depend on the declared variable type. Run Featurevisor lint.",
        },
      };
      return {
        oneOf: [map, { type: "array", items: { ...map, minProperties: 1, maxProperties: 1 } }],
      };
    }
    assert.ok(
      unrestrictedJsonProperties.has(property),
      `Unexpected unrestricted authoring schema node: ${schemaName}/${path.join("/")}`,
    );
    return { $comment: "Any JSON value is structurally allowed here. Run Featurevisor lint." };
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      path.at(-1) === "properties" &&
      ["segments", "requiredFeatures", "requiredVariables"].includes(key)
    ) {
      // Removed authoring fields exist only to provide precise lint messages.
      // Editors describe supported authoring, never deprecated datafile inputs.
      continue;
    }
    if (schemaName === "tests" && path.at(-1) === "properties" && key === "sticky") {
      // Feature assertions renamed sticky to stickyFeatures. The old name parses
      // only so lint can name the replacement.
      continue;
    }
    if (
      schemaName === "feature" &&
      key === "required" &&
      path.length === 3 &&
      path[0] === "anyOf" &&
      path[2] === "properties"
    ) {
      // This removed authoring property survives Zod conversion only because
      // the linter supplies its migration error through a custom refinement.
      continue;
    }
    if (
      key === "enum" &&
      Array.isArray(item) &&
      path.at(-1) === "type" &&
      item.some((entry) => removedSchemaTypes.has(entry))
    ) {
      // Removed types parse only so lint can explain their migration. Editors
      // offer the supported types alone.
      result[key] = item.filter((entry) => !removedSchemaTypes.has(entry));
      continue;
    }
    if (
      key === "anyOf" &&
      Array.isArray(item) &&
      item.some((entry) => entry && typeof entry === "object" && Object.keys(entry).length === 0)
    ) {
      assert.equal(path.at(-1), "value", `Unexpected unrestricted union at ${path.join("/")}`);
      const concrete = item.filter((entry) => Object.keys(entry).length > 0);
      assert.ok(concrete.length > 0, "A value union cannot be entirely unrestricted");
      // z.date() is a JavaScript input, not representable in an editor JSON
      // schema. The other branches describe its authored string form.
      result[key] = prepare(concrete, schemaName, [...path, key]);
      continue;
    }
    result[key] = prepare(item, schemaName, [...path, key]);
  }
  const properties = result.properties;
  if (
    ["segment", "feature", "global-variable"].includes(schemaName) &&
    properties?.conditions &&
    ((schemaName === "segment" && path.length === 0) ||
      ["percentage", "enabled", "mutate"].some((key) => key in properties) ||
      ("value" in properties && "key" in properties))
  ) {
    // Lint makes selectors optional structurally to issue migration messages.
    // Supported editor authoring still requires them at selector locations.
    result.required = [...new Set([...(result.required || []), "conditions"])];
  }
  return result;
}

const check = process.argv.includes("--check");
assert.ok(
  process.argv.length === 2 || (process.argv.length === 3 && check),
  "Use --check or no option",
);
async function generate() {
  const validators = {};
  for (const [name, schema] of Object.entries(schemas)) {
    const path = join(root, "packages/core/json-schema", `${name}.json`);
    const prepared = prepare(schema, name);
    validators[name] = new Ajv({ allErrors: true, logger: false }).compile(prepared);
    const output = await prettier.format(JSON.stringify(prepared), {
      ...(await prettier.resolveConfig(path)),
      filepath: path,
    });
    if (check) assert.equal(readFileSync(path, "utf8"), output, `${name}.json is out of date`);
    else writeFileSync(path, output);
    console.log(`${check ? "Checked" : "Generated"} ${name}.json`);
  }
  const leaves = [
    { attribute: "example", operator: "equals", value: "nl" },
    "example",
    { feature: "example", variation: "treatment" },
    { variable: "example", path: ["enabled"], operator: "equals", value: true },
    { feature: "example", variable: "example", operator: "notNull" },
  ];
  const subjects = (conditions) => ({
    segment: { description: "Editor conditions", conditions },
    feature: {
      description: "Editor conditions",
      tags: ["all"],
      bucketBy: "example",
      conditions,
      force: [{ conditions, enabled: true }],
      rules: [{ key: "all", conditions, percentage: 100 }],
    },
    "global-variable": {
      description: "Editor conditions",
      tags: ["all"],
      type: "string",
      defaultValue: "default",
      conditions,
      overrides: [{ key: "selected", conditions, value: "selected" }],
    },
  });
  for (const conditions of [
    "*",
    ...leaves,
    leaves,
    { and: [leaves[0], { or: leaves.slice(1) }, { not: [leaves[0]] }] },
  ]) {
    for (const [name, value] of Object.entries(subjects(conditions))) {
      assert.equal(
        validators[name](value),
        true,
        `${name} must accept every condition leaf: ${JSON.stringify(validators[name].errors)}`,
      );
    }
  }
  for (const type of removedSchemaTypes) {
    assert.equal(
      validators.attribute({ description: "Example", type }),
      false,
      `Editors must reject removed type ${type}`,
    );
  }
  const featureSpec = (sticky) => ({
    feature: "example",
    assertions: [{ at: 50, [sticky]: { example: { enabled: true } }, expectedToBeEnabled: true }],
  });
  assert.equal(
    validators.tests(featureSpec("stickyFeatures")),
    true,
    "Editors must allow stickyFeatures",
  );
  assert.equal(
    validators.tests(featureSpec("sticky")),
    false,
    "Editors must reject removed sticky",
  );
  for (const field of ["segments", "requiredFeatures", "requiredVariables"]) {
    const value = subjects("*").feature;
    value[field] = ["example"];
    assert.equal(
      validators.feature(value),
      false,
      `Editors must reject removed authoring ${field}`,
    );
  }
  for (const conditions of [
    [],
    { and: [] },
    { or: [] },
    { not: [] },
    ["*"],
    { and: ["*"] },
    { attribute: "example", feature: "example", operator: "equals", value: "nl" },
    { feature: "example", operator: "equals", value: "treatment" },
    { variable: "example", operator: "exists", enabled: true },
  ]) {
    assert.equal(
      validators.segment({ description: "Invalid condition grammar", conditions }),
      false,
      `Editors must reject ${JSON.stringify(conditions)}`,
    );
  }
  const composition = {
    description: "Gated alias",
    tags: ["all"],
    compose: "example",
    conditions: leaves,
    disabledValue: "disabled",
  };
  assert.equal(
    validators["global-variable"](composition),
    true,
    "Editors must allow composed root gates and disabledValue",
  );
  console.log("Checked unified condition editor examples and removed authoring fields");
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
