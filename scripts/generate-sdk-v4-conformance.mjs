import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { createFeaturevisor, applyVariableOperations } from "../packages/sdk/node-esm/index.js";

// Portable cases supplement sdk-v3.json. They exercise SDK evaluation rather
// than requiring other languages to expose their private mutation interpreter.
const clone = (value) => JSON.parse(JSON.stringify(value));

function combineVariableConditions(existing, required) {
  let decoded = existing;
  let stringified = false;
  if (typeof existing === "string" && existing !== "*") {
    try {
      decoded = JSON.parse(existing);
      stringified = true;
    } catch {
      /* Bare segment reference. */
    }
  }
  const parts = [decoded, required].filter((part) => part !== undefined && part !== "*");
  const combined = parts.length === 1 ? clone(parts[0]) : { and: parts.flat() };
  return stringified ? JSON.stringify(combined) : combined;
}

// Only the unreleased variable selectors migrate in historical datafiles.
// Legacy segments and requiredFeatures stay intact as compatibility evidence.
function migrateFixture(value, inDatafile = false, inExpected = false) {
  if (Array.isArray(value))
    return value.map((entry) => migrateFixture(entry, inDatafile, inExpected));
  if (!value || typeof value !== "object") {
    return ["required_features_unmet", "required_variables_unmet"].includes(value)
      ? "conditions_unmet"
      : value;
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    const expected = inExpected || key.startsWith("expected");
    if (inDatafile && key === "requiredVariables") {
      result.conditions = combineVariableConditions(value.conditions, entry);
    } else if (inDatafile && key === "conditions" && "requiredVariables" in value) {
      continue;
    } else if (inExpected && ["requiredFeatures", "requiredVariables"].includes(key)) {
      result.conditions = key === "requiredFeatures" ? featureLeaves(entry) : clone(entry);
    } else {
      const outputKey = ["required_features_unmet", "required_variables_unmet"].includes(key)
        ? "conditions_unmet"
        : key;
      result[outputKey] =
        key === "dependencyPurpose" && entry === "requirement"
          ? "condition"
          : migrateFixture(entry, inDatafile || key === "datafile", expected);
    }
  }
  return result;
}

function featureLeaves(value) {
  if (typeof value === "string") return { feature: value };
  if (Array.isArray(value)) return value.map(featureLeaves);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      ["and", "or", "not"].includes(key) ? featureLeaves(entry) : entry,
    ]),
  );
}

// Retain historical JSON lexemes such as 1.0. Native numeric parsers need
// those spellings, so migrating a selector must not reserialize its neighbours.
function migrateFixtureSource(source) {
  let position = 0;
  const edits = [];
  const whitespace = () => {
    while (/\s/.test(source[position] || "") && position < source.length) position++;
  };
  const string = () => {
    const start = position++;
    while (source[position] !== '"') {
      if (source[position] === "\\") position++;
      position++;
    }
    position++;
    return { start, end: position, value: JSON.parse(source.slice(start, position)) };
  };
  function value(inDatafile = false) {
    whitespace();
    const start = position;
    if (source[position] === '"') return string();
    if (source[position] === "{") {
      position++;
      whitespace();
      const entries = [];
      while (source[position] !== "}") {
        const key = string();
        whitespace();
        assert.equal(source[position++], ":");
        const entry = value(inDatafile || key.value === "datafile");
        entries.push({ key, entry });
        whitespace();
        if (source[position] !== ",") break;
        position++;
        whitespace();
      }
      assert.equal(source[position++], "}");
      if (inDatafile) {
        const required = entries.find(({ key }) => key.value === "requiredVariables");
        const existing = entries.find(({ key }) => key.value === "conditions");
        if (required) {
          edits.push({ start: required.key.start, end: required.key.end, text: '"conditions"' });
          if (existing) {
            const [conditions, variables] = [existing.entry, required.entry].map(({ start, end }) =>
              JSON.parse(source.slice(start, end)),
            );
            edits.push({
              start: required.entry.start,
              end: required.entry.end,
              text: JSON.stringify(combineVariableConditions(conditions, variables)),
            });
            const index = entries.indexOf(existing);
            edits.push(
              index < entries.length - 1
                ? { start: existing.key.start, end: entries[index + 1].key.start, text: "" }
                : { start: entries[index - 1].entry.end, end: existing.entry.end, text: "" },
            );
          }
        }
      }
    } else if (source[position] === "[") {
      position++;
      whitespace();
      while (source[position] !== "]") {
        value(inDatafile);
        whitespace();
        if (source[position] !== ",") break;
        position++;
      }
      assert.equal(source[position++], "]");
    } else {
      while (position < source.length && !/[\s,\]}]/.test(source[position])) position++;
    }
    return { start, end: position };
  }
  value();
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  result = result
    .replaceAll('"required_features_unmet"', '"conditions_unmet"')
    .replaceAll('"required_variables_unmet"', '"conditions_unmet"')
    .replaceAll('"dependencyPurpose": "requirement"', '"dependencyPurpose": "condition"');
  assert.deepEqual(
    JSON.parse(result),
    migrateFixture(JSON.parse(source)),
    "Lossless migration must match the structural migration",
  );
  return result;
}
const cases = [];
const base = () => ({
  schemaVersion: "2",
  revision: "portable-v4",
  features: {},
  segments: {},
  variables: {},
});
const selector = (property, values) => ({ select: { property, values } });
const step = (operations, extra = {}) => ({
  key: "case",
  keyPath: ["case"],
  operations,
  onMatch: 1,
  onMiss: 1,
  segments: "*",
  ...extra,
});

function check(name, datafile, expected, context = {}, options = {}) {
  const input = migrateFixture(clone(datafile), true);
  expected = migrateFixture(expected, false, true);
  const f = createFeaturevisor({ datafile: clone(input), logLevel: "fatal", ...options });
  for (let i = 0; i < 2; i++) {
    const evaluation = f.evaluateVariable("subject", context);
    const observed = { value: f.getVariable("subject", context), reason: evaluation.reason };
    for (const key of [
      "variableOverridePaths",
      "variableOverridePath",
      "variableOverrideKey",
      "variableOverrideIndex",
    ]) {
      if (key in expected) observed[key] = evaluation[key];
    }
    assert.deepEqual(observed, expected, name);
  }
  void f.close();
  cases.push({ name, datafile: input, context, options, expected });
}

function mutation(name, input, operations, expectedValue, error = false) {
  if (error)
    assert.throws(() => applyVariableOperations(clone(input), clone(operations)), undefined, name);
  else
    assert.deepEqual(applyVariableOperations(clone(input), clone(operations)), expectedValue, name);
  const datafile = base();
  datafile.variables.subject = {
    type: Array.isArray(input) ? "array" : typeof input === "string" ? "string" : "object",
    defaultValue: input,
    overrideProgram: [step(operations)],
  };
  check(
    name,
    datafile,
    error
      ? { value: null, reason: "error" }
      : {
          value: expectedValue,
          reason: "variable_override_rule",
          variableOverridePaths: [["case"]],
          variableOverrideKey: "case",
          variableOverrideIndex: 0,
          variableOverridePath: ["case"],
        },
  );
}

// Keep the emptiness corpus reproducible alongside mutation cases.
for (const [name, value, empty, nonempty] of [
  ["empty string", "", true, false],
  ["whitespace", " \t", false, true],
  ["text", "hello", false, true],
  ["empty array", [], true, false],
  ["array containing null", [null], false, true],
  ["array containing empty array", [[]], false, true],
  ["empty object", {}, true, false],
  ["object containing null", { value: null }, false, true],
  ["object containing empty object", { nested: {} }, false, true],
  ["null", null, false, false],
  ["zero", 0, false, false],
  ["false", false, false, false],
  ["missing", undefined, false, false],
]) {
  for (const [operator, matched] of [
    ["empty", empty],
    ["notEmpty", nonempty],
  ]) {
    const content = value === undefined ? {} : { value };
    for (const feature of [false, true]) {
      const datafile = { ...base(), revision: "emptiness" };
      const source = { type: "object", defaultValue: content };
      if (feature)
        datafile.features.sourceFeature = {
          bucketBy: ["userId"],
          force: [{ segments: "*", enabled: true }],
          traffic: [],
          variablesSchema: { source },
        };
      else datafile.variables.source = source;
      datafile.variables.subject = {
        type: "boolean",
        defaultValue: true,
        disabledValue: false,
        requiredVariables: [
          {
            ...(feature ? { feature: "sourceFeature" } : {}),
            variable: "source",
            path: ["value"],
            operator,
          },
        ],
      };
      check(`${operator} ${feature ? "feature" : "global"} requirement: ${name}`, datafile, {
        value: matched,
        reason: matched ? "variable_default" : "required_variables_unmet",
      });
    }
    const datafile = { ...base(), revision: "emptiness" };
    datafile.variables.subject = {
      type: "string",
      defaultValue: "default",
      overrideProgram: [
        {
          key: "content",
          keyPath: ["content"],
          conditions: [{ attribute: "value", operator }],
          operations: [{ op: "set", path: [], value: "matched" }],
          onMatch: 1,
          onMiss: 1,
        },
      ],
    };
    check(
      `${operator} program condition: ${name}`,
      datafile,
      {
        value: matched ? "matched" : "default",
        reason: matched ? "variable_override_rule" : "variable_default",
      },
      content,
    );
  }
}

mutation("set root", { old: true }, [{ op: "set", path: [], value: { next: true } }], {
  next: true,
});
mutation("set missing own property", {}, [{ op: "set", path: ["enabled"], value: false }], {
  enabled: false,
});
mutation(
  "literal dotted property",
  { "a.b": { value: 1 } },
  [{ op: "set", path: ["a.b", "value"], value: 2 }],
  { "a.b": { value: 2 } },
);
mutation("numeric string object property", { 0: 1 }, [{ op: "set", path: ["0"], value: 2 }], {
  0: 2,
});
mutation("set at array length", [1], [{ op: "set", path: [1], value: 2 }], [1, 2]);
mutation("set beyond array length", [1], [{ op: "set", path: [2], value: 2 }], [1]);
mutation(
  "set selected item",
  [{ id: 1 }, { id: 2 }],
  [{ op: "set", path: [selector("id", [2])], value: { id: 3 } }],
  [{ id: 1 }, { id: 3 }],
);
mutation("remove own property", { one: 1, two: 2 }, [{ op: "remove", path: ["one"] }], { two: 2 });
mutation("remove array item", [1, 2, 3], [{ op: "remove", path: [1] }], [1, 3]);
mutation("remove missing property", {}, [{ op: "remove", path: ["one"] }], {});

for (const op of ["append", "prepend", "appendUnique", "removeValue"]) {
  const original = op === "removeValue" ? ["a", "x", "x"] : ["a"];
  const expected = op === "removeValue" ? ["a"] : op === "prepend" ? ["x", "a"] : ["a", "x"];
  mutation(`${op} root`, original, [{ op, path: [], value: "x" }], expected);
  mutation(`${op} property`, { tags: original }, [{ op, path: ["tags"], value: "x" }], {
    tags: expected,
  });
  mutation(`${op} array index`, [original], [{ op, path: [0], value: "x" }], [expected]);
  mutation(
    `${op} selected nested array`,
    [
      { id: "a", tags: original },
      { id: "a", tags: original },
    ],
    [{ op, path: [selector("id", ["a"]), "tags"], value: "x" }],
    [
      { id: "a", tags: expected },
      { id: "a", tags: original },
    ],
  );
  mutation(`${op} null root`, null, [{ op, path: [], value: "x" }], null);
  mutation(`${op} null array element`, [null], [{ op, path: [0], value: "x" }], [null]);
  mutation(
    `${op} missing final property`,
    {},
    [{ op, path: ["tags"], value: "x" }],
    op === "removeValue" ? {} : { tags: ["x"] },
  );
  mutation(`${op} null final property`, { tags: null }, [{ op, path: ["tags"], value: "x" }], {
    tags: op === "removeValue" ? null : ["x"],
  });
  mutation(`${op} missing intermediate`, {}, [{ op, path: ["missing", "tags"], value: "x" }], {});
  mutation(`${op} unavailable array index`, [], [{ op, path: [0], value: "x" }], []);
  mutation(
    `${op} wrong container`,
    { tags: false },
    [{ op, path: ["tags"], value: "x" }],
    null,
    true,
  );
}

for (const value of ["1", 1, true, false, null, 0]) {
  const input = ["1", 1, true, false, null, 0, value];
  mutation(
    `appendUnique strict ${JSON.stringify(value)}`,
    input,
    [{ op: "appendUnique", path: [], value }],
    input,
  );
  mutation(
    `removeValue strict ${JSON.stringify(value)}`,
    input,
    [{ op: "removeValue", path: [], value }],
    input.filter((item) => item !== value),
  );
}
mutation(
  "unique append preserves existing duplicates",
  ["1", "1"],
  [{ op: "appendUnique", path: [], value: 1 }],
  ["1", "1", 1],
);
mutation(
  "zero and negative zero compare equally",
  [0],
  [{ op: "appendUnique", path: [], value: -0 }],
  [0],
);
mutation(
  "append inserts an array as one item",
  [1],
  [{ op: "append", path: [], value: [2, 3] }],
  [1, [2, 3]],
);
mutation(
  "prepend inserts an array as one item",
  [1],
  [{ op: "prepend", path: [], value: [2, 3] }],
  [[2, 3], 1],
);
for (const op of ["before", "after"]) {
  mutation(
    `${op} indexed item`,
    [1, 3],
    [{ op, path: [1], value: 2 }],
    op === "before" ? [1, 2, 3] : [1, 3, 2],
  );
  mutation(
    `${op} selected item`,
    [{ id: "a" }, { id: "b" }, { id: "b" }],
    [{ op, path: [selector("id", ["b"])], value: { id: "new" } }],
    op === "before"
      ? [{ id: "a" }, { id: "new" }, { id: "b" }, { id: "b" }]
      : [{ id: "a" }, { id: "b" }, { id: "new" }, { id: "b" }],
  );
  mutation(`${op} unavailable index`, [1], [{ op, path: [1], value: 2 }], [1]);
  mutation(`${op} invalid root`, [], [{ op, path: [], value: 2 }], null, true);
}
mutation(
  "selector distinguishes null from missing",
  [{ other: 1 }, { id: null }, { id: null }],
  [{ op: "remove", path: [selector("id", [null])] }],
  [{ other: 1 }, { id: null }],
);
mutation(
  "selector distinguishes booleans from numbers",
  [{ id: 1 }, { id: true }],
  [{ op: "remove", path: [selector("id", [true])] }],
  [{ id: 1 }],
);
mutation(
  "selector candidates can include text and number",
  [{ id: "01" }, { id: 1 }, { id: "1" }],
  [{ op: "remove", path: [selector("id", ["1", 1])] }],
  [{ id: "01" }, { id: "1" }],
);
mutation(
  "selectors see previous mutations",
  [{ id: "old" }],
  [
    { op: "append", path: [], value: { id: "new", tags: [] } },
    { op: "append", path: [selector("id", ["new"]), "tags"], value: "seen" },
    { op: "remove", path: [selector("id", ["old"])] },
  ],
  [{ id: "new", tags: ["seen"] }],
);
mutation(
  "ordered idempotent primitive operations",
  ["a", "b", "b"],
  [
    { op: "removeValue", path: [], value: "b" },
    { op: "appendUnique", path: [], value: "b" },
    { op: "appendUnique", path: [], value: "b" },
    { op: "removeValue", path: [], value: "a" },
  ],
  ["b"],
);

for (const op of ["appendUnique", "removeValue"]) {
  for (const value of [{}, []])
    mutation(
      `${op} invalid operand ${JSON.stringify(value)} even on a miss`,
      {},
      [{ op, path: ["missing", "tags"], value }],
      null,
      true,
    );
}
for (const key of ["__proto__", "prototype", "constructor"]) {
  mutation(`unsafe property ${key}`, {}, [{ op: "set", path: [key], value: true }], null, true);
  mutation(
    `unsafe selector ${key} even on a miss`,
    [],
    [{ op: "set", path: [selector(key, ["missing"])], value: true }],
    null,
    true,
  );
}
for (const path of [[-1], [0.5], [true], [null], [{ select: { property: "id", values: [{}] } }]]) {
  mutation(
    `invalid path ${JSON.stringify(path)}`,
    [],
    [{ op: "set", path, value: true }],
    null,
    true,
  );
}
mutation("missing operand", {}, [{ op: "set", path: ["a"] }], null, true);
mutation("unknown operation", {}, [{ op: "unknown", path: [], value: 1 }], null, true);
mutation("cannot remove root", {}, [{ op: "remove", path: [] }], null, true);
mutation(
  "string paths are not parsed by SDK",
  {},
  [{ op: "set", path: "a.b", value: 1 }],
  null,
  true,
);
mutation(
  "late operation error never publishes partial result",
  {},
  [
    { op: "set", path: ["a"], value: true },
    { op: "append", path: ["a"], value: 1 },
  ],
  null,
  true,
);

for (const region of ["eu", "us"])
  for (const country of ["nl", "be"]) {
    const datafile = base();
    datafile.variables.subject = {
      type: "object",
      defaultValue: { trace: [] },
      overrideProgram: [
        step([{ op: "append", path: ["trace"], value: "parent" }], {
          key: "parent",
          keyPath: ["parent"],
          conditions: [{ attribute: "region", operator: "equals", value: "eu" }],
          segments: undefined,
          onMatch: 1,
          onMiss: 3,
        }),
        step([{ op: "append", path: ["trace"], value: "nl" }], {
          key: "nl",
          keyPath: ["parent", "nl"],
          conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
          segments: undefined,
          onMatch: 2,
          onMiss: 2,
        }),
        step([{ op: "append", path: ["trace"], value: "child" }], {
          key: "child",
          keyPath: ["parent", "child"],
          onMatch: 3,
          onMiss: 3,
        }),
        step([{ op: "append", path: ["trace"], value: "tail" }], {
          key: "tail",
          keyPath: ["tail"],
          onMatch: 4,
          onMiss: 4,
        }),
      ],
    };
    const paths =
      region === "eu"
        ? [
            ["parent"],
            ...(country === "nl" ? [["parent", "nl"]] : []),
            ["parent", "child"],
            ["tail"],
          ]
        : [["tail"]];
    check(
      `nested continuation ${region} ${country}`,
      datafile,
      {
        value: { trace: paths.map((path) => path.at(-1)) },
        reason: "variable_override_rule",
        variableOverridePaths: paths,
        variableOverrideIndex: 3,
      },
      { region, country },
    );
  }

for (const jump of [0, -1, 2, 0.5, "1"]) {
  const datafile = base();
  datafile.variables.subject = {
    type: "object",
    defaultValue: {},
    overrideProgram: [step([{ op: "set", path: ["partial"], value: true }], { onMatch: jump })],
  };
  check(`invalid forward jump ${JSON.stringify(jump)}`, datafile, { value: null, reason: "error" });
}

for (const fallback of [false, true]) {
  const datafile = base();
  datafile.variables.subject = {
    type: "string",
    defaultValue: "default",
    overrideProgram: [],
    ...(fallback ? { overrides: [{ key: "unused", segments: "*", value: "incorrect" }] } : {}),
  };
  check(`empty program${fallback ? " ignores ordinary overrides" : ""}`, datafile, {
    value: "default",
    reason: "variable_default",
  });
}

const requirement = (name, leaf, source, expected, extra = {}) => {
  const datafile = base();
  datafile.variables.source = source;
  datafile.variables.subject = {
    type: "string",
    defaultValue: "matched",
    disabledValue: "miss",
    requiredVariables: [leaf],
    ...extra,
  };
  check(name, datafile, expected);
};
for (const [path, operator, matches] of [
  [["missing"], "isNull", false],
  [["missing"], "notNull", false],
  [["missing"], "exists", false],
  [["null"], "isNull", true],
  [["null"], "exists", true],
  [["null"], "notNull", false],
  [["false"], "exists", true],
  [["zero"], "exists", true],
  [["empty"], "exists", true],
  [[0], "exists", false],
  [["0"], "exists", true],
]) {
  requirement(
    `required path ${JSON.stringify(path)} ${operator}`,
    { variable: "source", path, operator },
    { type: "object", defaultValue: { null: null, false: false, zero: 0, empty: "", 0: true } },
    {
      value: matches ? "matched" : "miss",
      reason: matches ? "variable_default" : "required_variables_unmet",
    },
  );
}
for (const [path, operator, value, matches] of [
  [["0"], "equals", "first", true],
  [[0], "equals", "first", true],
  [["length"], "equals", 1, true],
  [["00"], "exists", undefined, false],
  [["-1"], "exists", undefined, false],
]) {
  requirement(
    `required array path ${JSON.stringify(path)} ${operator}`,
    { variable: "source", path, operator, ...(value === undefined ? {} : { value }) },
    { type: "array", defaultValue: ["first"] },
    {
      value: matches ? "matched" : "miss",
      reason: matches ? "variable_default" : "required_variables_unmet",
    },
  );
}
requirement(
  "getter null after source program error remains a legitimate comparison",
  { variable: "source", operator: "isNull" },
  {
    type: "object",
    defaultValue: {},
    overrideProgram: [step([{ op: "remove", path: [] }])],
  },
  { value: "matched", reason: "variable_default" },
);
requirement(
  "JSON getter null remains a legitimate comparison",
  { variable: "source", operator: "isNull" },
  { type: "json", defaultValue: "not JSON" },
  { value: "matched", reason: "variable_default" },
);
for (const operator of ["matches", "semverGreaterThan"]) {
  requirement(
    `invalid ${operator} cannot succeed through NOT`,
    { not: [{ variable: "source", operator, value: operator === "matches" ? "[" : "broken" }] },
    { type: "string", defaultValue: operator === "matches" ? "text" : "also-broken" },
    { value: null, reason: "error" },
  );
}
for (const path of [["constructor"], "a.b"]) {
  requirement(
    `invalid required path ${JSON.stringify(path)}`,
    { variable: "source", path, operator: "notNull" },
    { type: "object", defaultValue: {} },
    { value: null, reason: "error" },
  );
}
requirement(
  "variable cycle cannot pass an isNull check",
  { variable: "subject", operator: "isNull" },
  { type: "boolean", defaultValue: true },
  { value: null, reason: "error" },
);

// Equivalent ordinary and runtime representations of a noncontinuing nested
// tree. Expected values are explicit, not copied from either SDK evaluation.
{
  const initial = { stage: "default", rows: [{ id: 1, tags: [] }], flags: [null, "a"] };
  const parent = { stage: "parent", rows: [{ id: 1, tags: ["parent"] }], flags: ["a"] };
  const child = {
    stage: "parent",
    rows: [
      { id: 0, tags: [] },
      { id: 1, tags: ["parent", "child"] },
    ],
    flags: ["a"],
  };
  const reset = { stage: "reset", rows: [], flags: [] };
  const fallback = { stage: "fallback", rows: [], flags: ["a"] };
  const us = { ...initial, stage: "us" };
  const condition = (attribute, value) => ({ attribute, operator: "equals", value });
  const requiredFeatures = ["gate"];
  const requiredVariables = [{ variable: "permission", operator: "equals", value: true }];
  const rows = [
    ["child", { region: "eu", country: "nl", eligible: true }, child, "child", 1, 1],
    [
      "literal reset",
      { region: "eu", country: "nl", eligible: true, reset: true },
      reset,
      "reset",
      2,
      0,
    ],
    ["parent fallback", { region: "eu", country: "be", eligible: true }, parent, "parent", 0, 3],
    [
      "sibling fallback",
      { region: "eu", country: "be", city: "rotterdam" },
      fallback,
      "fallback",
      3,
      2,
    ],
    [
      "unmet feature",
      { region: "eu", country: "nl", eligible: false, city: "rotterdam" },
      fallback,
      "fallback",
      3,
      2,
    ],
    [
      "unmet variable",
      { region: "eu", country: "nl", eligible: true, denied: true },
      parent,
      "parent",
      0,
      3,
    ],
    [
      "parent miss skips matching child",
      { region: "us", country: "nl", eligible: true, reset: true },
      initial,
      null,
    ],
    ["root fallback", { region: "us", country: "us" }, us, "us", 4, 4],
    ["missing context", {}, initial, null],
    [
      "first child prevents later matching sibling",
      { region: "eu", country: "nl", eligible: true, city: "rotterdam" },
      child,
      "child",
      1,
      1,
    ],
  ];
  for (const runtime of [false, true]) {
    for (const stringify of [false, true]) {
      const datafile = base();
      datafile.segments = {
        europe: { conditions: [condition("region", "eu")] },
        eligible: { conditions: [condition("eligible", true)] },
      };
      datafile.features.gate = {
        bucketBy: "userId",
        traffic: [{ key: "eligible", segments: ["eligible"], percentage: 100000 }],
      };
      datafile.variables.permission = {
        type: "boolean",
        defaultValue: true,
        overrides: [{ key: "denied", conditions: [condition("denied", true)], value: false }],
      };
      const selected = selector("id", [1]);
      const program = [
        {
          key: "parent",
          keyPath: ["parent"],
          segments: ["europe"],
          onMatch: 1,
          onMiss: 4,
          operations: [
            { op: "set", path: ["stage"], value: "parent" },
            { op: "append", path: ["rows", selected, "tags"], value: "parent" },
            { op: "removeValue", path: ["flags"], value: null },
            { op: "appendUnique", path: ["flags"], value: "a" },
          ],
        },
        {
          key: "child",
          keyPath: ["parent", "child"],
          conditions: [condition("country", "nl")],
          requiredFeatures,
          requiredVariables,
          onMatch: 2,
          onMiss: 3,
          operations: [
            { op: "before", path: ["rows", selected], value: { id: 0, tags: [] } },
            { op: "append", path: ["rows", selected, "tags"], value: "child" },
          ],
        },
        {
          key: "reset",
          keyPath: ["parent", "child", "reset"],
          conditions: [condition("reset", true)],
          onMatch: 5,
          onMiss: 5,
          operations: [{ op: "set", path: [], value: reset }],
        },
        {
          key: "fallback",
          keyPath: ["parent", "fallback"],
          conditions: [condition("city", "rotterdam")],
          onMatch: 5,
          onMiss: 5,
          operations: [
            { op: "set", path: ["stage"], value: "fallback" },
            { op: "remove", path: ["rows", 0] },
          ],
        },
        {
          key: "us",
          keyPath: ["us"],
          conditions: [condition("country", "us")],
          onMatch: 5,
          onMiss: 5,
          operations: [{ op: "set", path: ["stage"], value: "us" }],
        },
      ];
      const overrides = [
        {
          key: "reset",
          keyPath: ["parent", "child", "reset"],
          segments: ["europe"],
          conditions: [condition("country", "nl"), condition("reset", true)],
          requiredFeatures,
          requiredVariables,
          value: reset,
        },
        {
          key: "child",
          keyPath: ["parent", "child"],
          segments: ["europe"],
          conditions: [condition("country", "nl")],
          requiredFeatures,
          requiredVariables,
          value: child,
        },
        {
          key: "fallback",
          keyPath: ["parent", "fallback"],
          segments: ["europe"],
          conditions: [condition("city", "rotterdam")],
          value: fallback,
        },
        { key: "parent", keyPath: ["parent"], segments: ["europe"], value: parent },
        { key: "us", keyPath: ["us"], conditions: [condition("country", "us")], value: us },
      ];
      datafile.variables.subject = {
        type: "object",
        defaultValue: initial,
        ...(runtime ? { overrideProgram: program } : { overrides }),
      };
      if (stringify) {
        for (const segment of Object.values(datafile.segments))
          segment.conditions = JSON.stringify(segment.conditions);
        for (const override of [
          ...(runtime ? program : overrides),
          ...datafile.variables.permission.overrides,
        ]) {
          for (const property of ["conditions", "segments"])
            if (override[property]) override[property] = JSON.stringify(override[property]);
        }
      }
      for (const [name, context, value, key, programIndex, ordinaryIndex] of rows) {
        const path =
          key === "reset"
            ? ["parent", "child", "reset"]
            : key === "child" || key === "fallback"
              ? ["parent", key]
              : [key];
        const paths =
          key === "reset"
            ? [["parent"], ["parent", "child"], path]
            : key === "child" || key === "fallback"
              ? [["parent"], path]
              : [path];
        check(
          `first match ${runtime ? "runtime" : "precomputed"} ${stringify ? "stringified" : "parsed"}: ${name}`,
          datafile,
          {
            value,
            reason: key ? "variable_override_rule" : "variable_default",
            ...(key
              ? {
                  variableOverrideKey: key,
                  variableOverridePath: path,
                  variableOverrideIndex: runtime ? programIndex : ordinaryIndex,
                  ...(runtime ? { variableOverridePaths: paths } : {}),
                }
              : {}),
          },
          context,
        );
      }
    }
  }
}

const fixture = {
  version: 1,
  description:
    "Portable v4 accumulation, mutation, path and error cases supplementing sdk-v3.json version 11. Run each case twice through the ordinary global variable getter and detailed evaluator. Do not mutate fixture datafiles. Extra evaluation metadata is allowed; compare expected fields only.",
  cases,
};

const conditionCases = [];
const attribute = { attribute: "country", operator: "equals", value: "nl" };
const variable = { variable: "policy", path: ["enabled"], operator: "equals", value: true };
const enabledFeature = () => ({
  bucketBy: "userId",
  traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
});
const conditionsBase = () => ({
  schemaVersion: "4",
  revision: "conditions-conformance",
  segments: { dutch: { conditions: attribute } },
  features: { gate: enabledFeature(), subject: enabledFeature() },
  variables: { policy: { type: "object", defaultValue: { enabled: true } } },
});

function conditionCase(name, edit, expected, extra = {}) {
  const datafile = conditionsBase();
  edit(datafile);
  conditionCases.push({
    name,
    type: "flag",
    feature: "subject",
    datafile,
    context: { userId: "conditions-user", country: "nl" },
    expected,
    ...extra,
  });
}
const enabled = { enabled: true, reason: "rule" };
for (const [name, conditions] of [
  ["wildcard", "*"],
  ["attribute leaf", attribute],
  ["segment leaf", "dutch"],
  ["feature leaf", { feature: "gate" }],
  ["global variable leaf", variable],
  [
    "mixed group",
    {
      and: [
        attribute,
        "dutch",
        { feature: "gate" },
        variable,
        {
          or: [
            { feature: "missing" },
            { not: [{ attribute: "country", operator: "equals", value: "us" }] },
          ],
        },
      ],
    },
  ],
]) {
  conditionCase(
    name,
    (d) => {
      d.features.subject.conditions = conditions;
    },
    enabled,
  );
}
conditionCase(
  "feature variable leaf",
  (d) => {
    d.features.gate.variablesSchema = {
      policy: { type: "object", defaultValue: { enabled: true } },
    };
    d.features.subject.conditions = { ...variable, feature: "gate" };
  },
  enabled,
);
for (const [name, conditions] of [
  ["segment reference", "dutch"],
  ["feature reference", { feature: "gate" }],
  ["variable reference", variable],
]) {
  conditionCase(
    `segment with ${name}`,
    (d) => {
      d.segments.dependent = { conditions };
      d.features.subject.traffic[0].conditions = "dependent";
    },
    enabled,
  );
}
conditionCase(
  "malformed segment cycle fails the evaluation",
  (d) => {
    d.segments.first = { conditions: "second" };
    d.segments.second = { conditions: { not: ["first"] } };
    d.features.subject.traffic[0].conditions = "first";
  },
  { reason: "error" },
);
conditionCase(
  "root gate reports its unmet conditions",
  (d) => {
    d.features.subject.conditions = attribute;
  },
  { enabled: false, reason: "conditions_unmet", conditions: attribute },
  { context: { country: "us" } },
);
conditionCase(
  "force bypasses the root gate",
  (d) => {
    d.features.subject.conditions = attribute;
    d.features.subject.force = [{ conditions: "*", enabled: true }];
  },
  { enabled: true, reason: "forced" },
  { context: { country: "us" } },
);
conditionCase(
  "sticky flag bypasses the root gate",
  (d) => {
    d.features.subject.conditions = attribute;
  },
  { enabled: true, reason: "sticky" },
  {
    context: { country: "us" },
    options: { stickyFeatures: { subject: { enabled: true } } },
  },
);
conditionCase(
  "rule fall through after an unmet mixed condition",
  (d) => {
    d.features.subject.traffic.unshift({
      key: "miss",
      conditions: ["dutch", { feature: "gate", enabled: false }],
      percentage: 0,
    });
  },
  { ...enabled, ruleKey: "all" },
);
conditionCase(
  "bare string always means segment",
  (d) => {
    d.features.subject.conditions = "gate";
  },
  { enabled: false, reason: "conditions_unmet", conditions: "gate" },
);
for (const conditions of [[], { and: [] }, { or: [] }, { not: [] }]) {
  conditionCase(
    `empty expression ${JSON.stringify(conditions)}`,
    (d) => {
      d.features.subject.conditions = conditions;
    },
    { enabled: false, reason: "conditions_unmet", conditions },
  );
}
for (const schemaVersion of ["2", "4"]) {
  conditionCase(
    `explicit null feature gate is not absent in schema ${schemaVersion}`,
    (d) => {
      d.schemaVersion = schemaVersion;
      d.features.subject.conditions = null;
    },
    { enabled: false, reason: "conditions_unmet", conditions: null },
  );
}
conditionCase(
  "NOT with a null child still negates its ordinary false result",
  (d) => {
    d.features.subject.conditions = { not: [null] };
  },
  enabled,
);
conditionCase(
  "legacy v3 fields retain their meaning",
  (d) => {
    d.schemaVersion = "2";
    d.features.subject.requiredFeatures = ["gate"];
    d.features.subject.traffic = [{ key: "all", segments: "dutch", percentage: 100000 }];
  },
  enabled,
);
for (const segments of [[], { and: [] }]) {
  conditionCase(
    `legacy empty segment selector ${JSON.stringify(segments)} keeps v3 wildcard matching`,
    (d) => {
      d.schemaVersion = "2";
      d.features.subject.traffic = [{ key: "all", segments, percentage: 100000 }];
    },
    enabled,
  );
}
conditionCase(
  "schema 3 legacy input remains readable",
  (d) => {
    d.schemaVersion = "3";
    d.features.subject.requiredFeatures = ["gate"];
    d.features.subject.traffic = [{ key: "all", segments: "dutch", percentage: 100000 }];
  },
  enabled,
);
conditionCase(
  "legacy root string feature is exposed as a normalized object leaf",
  (d) => {
    d.features.subject.requiredFeatures = ["missing"];
  },
  { enabled: false, reason: "conditions_unmet", conditions: [{ feature: "missing" }] },
);
conditionCase(
  "stringified mixed conditions retain all leaf kinds",
  (d) => {
    d.features.subject.conditions = JSON.stringify([
      "dutch",
      attribute,
      { feature: "gate" },
      variable,
    ]);
  },
  enabled,
);
conditionCase(
  "mixed legacy and new root gates are ANDed",
  (d) => {
    d.features.subject.conditions = "*";
    d.features.subject.requiredFeatures = [{ feature: "gate", enabled: false }];
  },
  { enabled: false, reason: "conditions_unmet" },
);
conditionCase(
  "mixed legacy and new rule selectors are ANDed",
  (d) => {
    d.features.subject.traffic[0].segments = "missing";
  },
  { enabled: false, reason: "no_match" },
);
conditionCase(
  "unreleased requiredVariables is not read",
  (d) => {
    d.features.subject.requiredVariables = [
      { variable: "missing", operator: "equals", value: true },
    ];
  },
  enabled,
);

function variableCase(name, edit, expected, extra = {}) {
  const { variableValue, ...evaluation } = expected;
  conditionCase(
    name,
    (d) => {
      d.variables.subject = { type: "string", defaultValue: "default", disabledValue: "disabled" };
      edit(d);
    },
    { value: variableValue, ...evaluation },
    { type: "variable", feature: undefined, variable: "subject", ...extra },
  );
}
for (const schemaVersion of ["2", "4"]) {
  variableCase(
    `explicit null variable gate is not absent in schema ${schemaVersion}`,
    (d) => {
      d.schemaVersion = schemaVersion;
      d.variables.subject.conditions = null;
    },
    { variableValue: "disabled", reason: "conditions_unmet", conditions: null },
  );
}
variableCase(
  "global root gate returns disabledValue",
  (d) => {
    d.variables.subject.conditions = { feature: "gate", enabled: false };
  },
  { variableValue: "disabled", reason: "conditions_unmet" },
);
variableCase(
  "global root gate preserves useDefaultWhenDisabled",
  (d) => {
    d.variables.subject.conditions = { feature: "gate", enabled: false };
    d.variables.subject.useDefaultWhenDisabled = true;
  },
  { variableValue: "default", reason: "conditions_unmet" },
);
variableCase(
  "mixed legacy and new override selectors are ANDed",
  (d) => {
    d.variables.subject.overrides = [
      {
        key: "miss",
        conditions: attribute,
        segments: "dutch",
        requiredFeatures: [{ feature: "gate", enabled: false }],
        value: "incorrect",
      },
      { key: "all", conditions: "*", value: "matched" },
    ];
  },
  { variableValue: "matched", reason: "variable_override_rule", variableOverrideKey: "all" },
);
for (const fallback of [false, true]) {
  variableCase(
    `composed root gate ${fallback ? "uses disabledValue" : "returns null"} before sources`,
    (d) => {
      d.variables.subject = {
        type: "object",
        compose: "policy",
        conditions: { feature: "gate", enabled: false },
        ...(fallback ? { disabledValue: { enabled: false } } : {}),
      };
    },
    { variableValue: fallback ? { enabled: false } : null, reason: "conditions_unmet" },
    {
      dependencies: [{ feature: "gate", dependencyPurpose: "condition" }],
    },
  );
}
for (const country of ["nl", "us"]) {
  variableCase(
    `override ancestors AND with child ${country}`,
    (d) => {
      d.variables.subject.overrideProgram = [
        {
          key: "parent",
          keyPath: ["parent"],
          conditions: attribute,
          operations: [],
          onMatch: 1,
          onMiss: 2,
        },
        {
          key: "child",
          keyPath: ["parent", "child"],
          conditions: { feature: "gate" },
          operations: [{ op: "set", path: [], value: "child" }],
          onMatch: 2,
          onMiss: 2,
        },
      ];
    },
    {
      variableValue: country === "nl" ? "child" : "default",
      reason: country === "nl" ? "variable_override_rule" : "variable_default",
    },
    { context: { country } },
  );
}
conditionCase(
  "module dependencies are ordered and tagged condition",
  (d) => {
    d.features.subject.conditions = ["dutch", { feature: "gate" }, variable, { feature: "gate" }];
  },
  enabled,
  {
    dependencies: [
      { feature: "gate", dependencyPurpose: "condition" },
      { variable: "policy", dependencyPurpose: "condition" },
    ],
  },
);
conditionCase(
  "short circuit avoids later dependency callbacks",
  (d) => {
    d.features.subject.conditions = [attribute, { feature: "gate" }];
  },
  { enabled: false, reason: "conditions_unmet" },
  { context: { country: "us" }, dependencies: [] },
);

conditionCase(
  "malformed rule selector falls through",
  (d) => {
    d.features.subject.traffic.unshift({
      key: "broken",
      conditions: '["dutch"',
      percentage: 100000,
    });
  },
  { ...enabled, ruleKey: "all" },
);
conditionCase(
  "malformed root gate reports normalized unmet conditions",
  (d) => {
    d.features.subject.conditions = '{"feature":';
  },
  { enabled: false, reason: "conditions_unmet", conditions: { or: [] } },
);
conditionCase(
  "NOT over a malformed segment cannot match",
  (d) => {
    d.segments.broken = { conditions: '{"attribute":"country"' };
    d.features.subject.traffic[0].conditions = { not: ["broken"] };
  },
  { enabled: false, reason: "no_match" },
);
conditionCase(
  "malformed force selector is skipped",
  (d) => {
    d.features.subject.force = [{ conditions: "[[", enabled: false }];
  },
  { ...enabled, ruleKey: "all" },
);
variableCase(
  "malformed global override selector is skipped",
  (d) => {
    d.variables.subject.overrides = [
      { key: "broken", conditions: '{"not":[', value: "incorrect" },
      { key: "all", conditions: "*", value: "matched" },
    ];
  },
  { variableValue: "matched", reason: "variable_override_rule", variableOverrideKey: "all" },
);
conditionCase(
  "schema 2 malformed segments string falls through",
  (d) => {
    d.schemaVersion = "2";
    d.features.subject.traffic = [
      { key: "broken", segments: '["dutch",', percentage: 100000 },
      { key: "all", segments: "*", percentage: 100000 },
    ];
  },
  { ...enabled, ruleKey: "all" },
);

for (const schemaVersion of ["2", "4"]) {
  for (const conditions of [[], { and: [] }]) {
    const label = `schema ${schemaVersion} empty ${JSON.stringify(conditions)}`;
    const legacy = schemaVersion === "2";
    for (const site of ["root", "rule", "force", "segment"]) {
      const matches = legacy && (site === "force" || site === "segment");
      conditionCase(
        `${label} at ${site}`,
        (d) => {
          d.schemaVersion = schemaVersion;
          if (site === "root") d.features.subject.conditions = conditions;
          if (site === "rule") d.features.subject.traffic[0].conditions = conditions;
          if (site === "force") d.features.subject.force = [{ conditions, enabled: false }];
          if (site === "segment") {
            d.segments.empty = { conditions };
            d.features.subject.traffic[0].conditions = "empty";
          }
        },
        site === "root"
          ? { enabled: false, reason: "conditions_unmet", conditions }
          : site === "force" && matches
            ? { enabled: false, reason: "forced" }
            : site === "force" || matches
              ? { ...enabled, ruleKey: "all" }
              : { enabled: false, reason: "no_match" },
      );
    }
    for (const site of ["variable root", "override", "override program"]) {
      const matches = legacy && site === "override";
      variableCase(
        `${label} at ${site}`,
        (d) => {
          d.schemaVersion = schemaVersion;
          if (site === "variable root") d.variables.subject.conditions = conditions;
          if (site === "override")
            d.variables.subject.overrides = [{ key: "empty", conditions, value: "matched" }];
          if (site === "override program")
            d.variables.subject.overrideProgram = [
              {
                key: "empty",
                keyPath: ["empty"],
                conditions,
                operations: [{ op: "set", path: [], value: "incorrect" }],
                onMatch: 1,
                onMiss: 1,
              },
            ];
        },
        site === "variable root"
          ? { variableValue: "disabled", reason: "conditions_unmet", conditions }
          : matches
            ? {
                variableValue: "matched",
                reason: "variable_override_rule",
                variableOverrideKey: "empty",
              }
            : { variableValue: "default", reason: "variable_default" },
      );
    }
  }
  for (const [name, conditions, legacyMatch, currentMatch] of [
    ["empty AND inside OR", { or: [{ and: [] }, { ...attribute, value: "us" }] }, true, false],
    ["NOT of empty AND", { not: [{ and: [] }] }, false, true],
    ["empty OR", { or: [] }, false, false],
  ]) {
    const matches = schemaVersion === "2" ? legacyMatch : currentMatch;
    conditionCase(
      `schema ${schemaVersion} segment ${name}`,
      (d) => {
        d.schemaVersion = schemaVersion;
        d.segments.nested = { conditions };
        d.features.subject.traffic[0].conditions = "nested";
      },
      matches ? { ...enabled, ruleKey: "all" } : { enabled: false, reason: "no_match" },
    );
  }
}

for (const schemaVersion of ["2", "3", "4"]) {
  for (const segments of [[], { and: [] }]) {
    for (const stringified of [false, true]) {
      conditionCase(
        `schema ${schemaVersion} ${stringified ? "stringified" : "parsed"} legacy segments ${JSON.stringify(segments)} match`,
        (d) => {
          d.schemaVersion = schemaVersion;
          d.features.subject.traffic = [
            {
              key: "all",
              segments: stringified ? JSON.stringify(segments) : segments,
              percentage: 100000,
            },
          ];
        },
        { ...enabled, ruleKey: "all" },
      );
    }
  }
}

// Keep the spelling in the emitted JSON, not just the JavaScript number value.
// JSON.rawJSON also survives clone() as the ordinary number used for evaluation.
for (const site of ["attribute", "variable", "stringified attribute"]) {
  conditionCase(
    `numeric 1.0 equals integer at ${site}`,
    (d) => {
      const leaf =
        site === "variable"
          ? { variable: "count", operator: "equals", value: JSON.rawJSON("1.0") }
          : { attribute: "count", operator: "equals", value: JSON.rawJSON("1.0") };
      d.variables.count = { type: "integer", defaultValue: 1 };
      d.features.subject.conditions =
        site === "stringified attribute" ? JSON.stringify(leaf) : leaf;
    },
    enabled,
    { context: { count: 1 } },
  );
}

for (const [name, path, operator, value, matches] of [
  ["numeric array index", ["items", 1, "count"], "equals", 5, true],
  ["numeric 1.0 array index", ["items", JSON.rawJSON("1.0"), "count"], "equals", 5, true],
  ["string array index", ["items", "1", "count"], "equals", 5, true],
  ["array length", ["items", "length"], "equals", 2, true],
  ["literal dotted key", ["a.b", "count"], "equals", 1, true],
  ["missing path isNull", ["absent"], "isNull", undefined, false],
  ["missing path notNull", ["absent"], "notNull", undefined, false],
  ["explicit null isNull", ["nothing"], "isNull", undefined, true],
  ["explicit null notNull", ["nothing"], "notNull", undefined, false],
  ["nonnull path notNull", ["items", 1, "count"], "notNull", undefined, true],
]) {
  const conditions = {
    variable: "policy",
    path,
    operator,
    ...(value === undefined ? {} : { value }),
  };
  conditionCase(
    `compiled path ${name}`,
    (d) => {
      d.variables.policy.defaultValue = {
        items: [{ count: 0 }, { count: 5 }],
        "a.b": { count: 1 },
        a: { b: { count: 99 } },
        nothing: null,
      };
      d.features.subject.conditions = conditions;
    },
    matches ? enabled : { enabled: false, reason: "conditions_unmet", conditions },
  );
}

for (const operator of ["isNull", "notNull"]) {
  conditionCase(
    `compiled missing path NOT ${operator} matches`,
    (d) => {
      d.features.subject.conditions = {
        not: [{ variable: "policy", path: ["absent"], operator }],
      };
    },
    enabled,
  );
}
for (const owner of ["global", "feature"]) {
  conditionCase(
    `missing ${owner} variable getter is null before path traversal`,
    (d) => {
      d.features.subject.conditions = {
        ...(owner === "feature" ? { feature: "gate" } : {}),
        variable: "missing",
        operator: "isNull",
      };
    },
    enabled,
  );
}

// Condition cases capture expectations from JavaScript, then freeze them in
// the canonical fixture. Native implementations never supply their own oracle.
function referenceConditionCase(name, edit, extra = {}) {
  const datafile = conditionsBase();
  datafile.features.off = { bucketBy: "userId", traffic: [] };
  datafile.variables.policy.defaultValue.limit = 3;
  if (extra.type === "variable")
    datafile.variables.subject = {
      type: "string",
      defaultValue: "default",
      disabledValue: "disabled",
    };
  edit(datafile);
  const entry = {
    name,
    type: "flag",
    feature: "subject",
    datafile,
    context: { userId: "conditions-user", country: "nl" },
    ...extra,
  };
  if (entry.type === "variable") {
    delete entry.feature;
    entry.variable = "subject";
  }
  const dependencies = [];
  const f = createFeaturevisor({
    datafile: clone(datafile),
    logLevel: "fatal",
    ...entry.options,
    modules: [
      {
        beforeEvaluation(options) {
          if (options.dependencyPurpose)
            dependencies.push({
              ...(options.featureKey ? { feature: options.featureKey } : {}),
              ...(options.variableKey ? { variable: options.variableKey } : {}),
              dependencyPurpose: options.dependencyPurpose,
            });
          return options;
        },
      },
    ],
  });
  const evaluation =
    entry.type === "variable"
      ? f.evaluateVariable(entry.variable, entry.context)
      : f.evaluateFlag(entry.feature, entry.context);
  entry.dependencies = clone(dependencies);
  entry.expected = {};
  for (const key of ["enabled", "reason", "ruleKey", "variableOverrideKey", "conditions"])
    if (evaluation[key] !== undefined) entry.expected[key] = clone(evaluation[key]);
  if (entry.type === "variable")
    entry.expected.value = f.getVariable(entry.variable, entry.context);
  void f.close();
  conditionCases.push(entry);
  return entry;
}

for (const schemaVersion of ["2", "4"])
  referenceConditionCase(
    `schema ${schemaVersion} force mixes empty conditions with segments`,
    (d) => {
      d.schemaVersion = schemaVersion;
      d.features.subject.force = [{ conditions: [], segments: "dutch", enabled: false }];
    },
  );

for (const [name, requiredFeatures] of [
  ["empty list is no gate", []],
  ["nested AND OR NOT", [{ or: ["missing", { and: ["gate", { not: ["off"] }] }] }]],
  ["empty OR is unmet", [{ or: [] }]],
])
  referenceConditionCase(`schema 2 requiredFeatures ${name}`, (d) => {
    d.schemaVersion = "2";
    d.features.subject.requiredFeatures = requiredFeatures;
  });
referenceConditionCase(
  "schema 2 override requiredFeatures strings and segments",
  (d) => {
    d.schemaVersion = "2";
    d.variables.subject.overrides = [
      {
        key: "dep",
        segments: "dutch",
        requiredFeatures: ["gate", { feature: "off", enabled: false }],
        value: "matched",
      },
    ];
  },
  { type: "variable" },
);

referenceConditionCase("string variable never equals a number", (d) => {
  d.variables.text = { type: "string", defaultValue: "3" };
  d.features.subject.conditions = { variable: "text", operator: "equals", value: 3 };
});
for (const [type, actual, value] of [
  ["integer", 3, 2.5],
  ["double", 3.5, 3],
])
  referenceConditionCase(
    `variable greaterThan with ${type} actual and ${Number.isInteger(value) ? "integer" : "floating"} expected`,
    (d) => {
      d.variables.count = { type, defaultValue: actual };
      d.features.subject.conditions = { variable: "count", operator: "greaterThan", value };
    },
  );
const numericGetterControl = referenceConditionCase(
  "numeric getter integer equals expected 1.0 lexeme",
  (d) => {
    d.variables.subject = { type: "integer", defaultValue: 1 };
  },
  { type: "variable" },
);
assert.equal(numericGetterControl.expected.value, 1);
numericGetterControl.expected.value = JSON.rawJSON("1.0");

referenceConditionCase("absent feature satisfies enabled false", (d) => {
  d.features.subject.conditions = { feature: "missing", enabled: false };
});
referenceConditionCase("disabled feature matches its disabled variation", (d) => {
  d.features.off.variations = [{ value: "control" }, { value: "treatment" }];
  d.features.off.disabledVariationValue = "control";
  d.features.subject.conditions = { feature: "off", enabled: false, variation: "control" };
});
referenceConditionCase("variation leaf without variations does not match", (d) => {
  d.features.subject.conditions = { feature: "gate", variation: "control" };
});
referenceConditionCase(
  "sticky dependency feature drives the gate",
  (d) => {
    d.features.subject.conditions = { feature: "off" };
  },
  { options: { stickyFeatures: { off: { enabled: true } } } },
);

for (const shortCircuit of [false, true])
  referenceConditionCase(
    shortCircuit
      ? "short circuit OR never reaches a cycle"
      : "cycle under NOT fails the evaluation",
    (d) => {
      d.features.loop = { ...enabledFeature(), conditions: { feature: "loop" } };
      d.features.subject.conditions = shortCircuit
        ? { or: [attribute, { feature: "loop" }] }
        : { not: [{ feature: "loop" }] };
    },
  );
referenceConditionCase(
  "global override referencing itself is a cycle",
  (d) => {
    d.variables.subject.overrides = [
      {
        key: "self",
        conditions: { variable: "subject", operator: "equals", value: "default" },
        value: "incorrect",
      },
    ];
  },
  { type: "variable" },
);
referenceConditionCase("segment and direct feature leaf memoize one dependency", (d) => {
  d.segments.needsGate = { conditions: { feature: "gate" } };
  d.features.subject.conditions = ["needsGate", { feature: "gate" }, "needsGate"];
});
referenceConditionCase("variable leaf over an alias reports condition then composition", (d) => {
  d.variables.alias = { type: "object", compose: "policy" };
  d.features.subject.conditions = {
    variable: "alias",
    path: ["limit"],
    operator: "equals",
    value: 3,
  };
});
referenceConditionCase("composition override never mutates its source in one evaluation", (d) => {
  d.variables.alias = {
    type: "object",
    compose: "policy",
    overrideProgram: [
      {
        key: "all",
        keyPath: ["all"],
        conditions: "*",
        operations: [{ op: "set", path: ["limit"], value: 90 }],
        onMatch: 1,
        onMiss: 1,
      },
    ],
  };
  d.features.subject.conditions = [
    { variable: "alias", path: ["limit"], operator: "equals", value: 90 },
    { variable: "policy", path: ["limit"], operator: "equals", value: 3 },
    { variable: "alias", path: ["limit"], operator: "equals", value: 90 },
  ];
});
referenceConditionCase(
  "malformed composition gate returns disabledValue and empty OR metadata",
  (d) => {
    d.variables.subject = {
      type: "object",
      compose: "policy",
      conditions: '{"or":[',
      disabledValue: { blocked: true },
    };
  },
  { type: "variable" },
);
for (const country of ["nl", "de", "us"])
  referenceConditionCase(
    `alias chain gates at each hop in ${country}`,
    (d) => {
      d.variables.hop1 = {
        type: "object",
        compose: "policy",
        conditions: attribute,
        disabledValue: { hop: 1 },
      };
      d.variables.hop2 = {
        type: "object",
        compose: "hop1",
        conditions: { not: [{ ...attribute, value: "us" }] },
      };
      d.variables.subject = { type: "object", compose: "hop2" };
    },
    { type: "variable", context: { country } },
  );
referenceConditionCase(
  "root gate reads a composed alias",
  (d) => {
    d.variables.source = { type: "boolean", defaultValue: true };
    d.variables.alias = { type: "boolean", compose: "source" };
    d.variables.subject.conditions = { variable: "alias", operator: "equals", value: true };
  },
  { type: "variable" },
);

for (const schemaVersion of ["2", "4"])
  for (const conditions of [[], { and: [] }])
    for (const stringified of [false, true])
      for (const site of ["rule", "variation"])
        referenceConditionCase(
          `schema ${schemaVersion} ${stringified ? "stringified" : "parsed"} empty ${JSON.stringify(conditions)} at feature variable ${site} override`,
          (d) => {
            d.schemaVersion = schemaVersion;
            d.features.gate.variablesSchema = {
              label: { type: "string", defaultValue: "default" },
            };
            const variableOverrides = {
              label: [
                {
                  conditions: stringified ? JSON.stringify(conditions) : conditions,
                  value: "matched",
                },
              ],
            };
            if (site === "rule") d.features.gate.traffic[0].variableOverrides = variableOverrides;
            else {
              d.features.gate.variations = [{ value: "control", variableOverrides }];
              d.features.gate.traffic[0].variation = "control";
            }
            // Observe the selected value through a condition on another feature.
            d.features.subject.conditions = {
              feature: "gate",
              variable: "label",
              operator: "equals",
              value: "matched",
            };
          },
        );

// Verify all expectations through ordinary evaluators, twice per instance.
for (const entry of conditionCases) {
  const dependencies = [];
  const f = createFeaturevisor({
    datafile: clone(entry.datafile),
    logLevel: "fatal",
    ...entry.options,
    modules: [
      {
        beforeEvaluation(options) {
          if (options.dependencyPurpose)
            dependencies.push({
              ...(options.featureKey ? { feature: options.featureKey } : {}),
              ...(options.variableKey ? { variable: options.variableKey } : {}),
              dependencyPurpose: options.dependencyPurpose,
            });
          return options;
        },
      },
    ],
  });
  for (let repeat = 0; repeat < 2; repeat++) {
    if (entry.type === "variable")
      assert.deepEqual(
        f.getVariable(entry.variable, entry.context),
        clone(entry.expected.value),
        entry.name,
      );
    else
      assert.equal(
        f.isEnabled(entry.feature, entry.context),
        entry.expected.enabled ?? false,
        entry.name,
      );
    dependencies.length = 0;
    const evaluation =
      entry.type === "variable"
        ? f.evaluateVariable(entry.variable, entry.context)
        : f.evaluateFlag(entry.feature, entry.context);
    const expected = clone(entry.expected);
    delete expected.value;
    for (const key of Object.keys(expected))
      assert.ok(Object.hasOwn(evaluation, key), `${entry.name}: missing ${key}`);
    assert.deepEqual(
      Object.fromEntries(Object.keys(expected).map((key) => [key, evaluation[key]])),
      expected,
      entry.name,
    );
    if (entry.dependencies) assert.deepEqual(dependencies, entry.dependencies, entry.name);
  }
  void f.close();
}

// Cache free oracle for the deliberately small graph histories below. Expected
// notifications never come from the SDK or its incremental dependency index.
const statefulKinds = ["features", "variables", "segments"];
function statefulReferences(definition) {
  const references = [];
  function visit(value) {
    if (typeof value === "string") {
      if (value === "*") return;
      if (value.startsWith("[") || value.startsWith("{")) return visit(JSON.parse(value));
      references.push(["segments", value]);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      if (value.feature) references.push(["features", value.feature]);
      else if (value.variable) references.push(["variables", value.variable]);
      else if (!value.attribute) Object.values(value).forEach(visit);
    }
  }
  visit(definition.conditions);
  for (const rule of definition.traffic || []) visit(rule.conditions);
  if (typeof definition.compose === "string") references.push(["variables", definition.compose]);
  return references;
}
function statefulGraph(state) {
  const graph = new Map();
  for (const kind of statefulKinds)
    for (const [key, definition] of Object.entries(state[kind]))
      for (const [refKind, refKey] of statefulReferences(definition)) {
        const ref = `${refKind}:${refKey}`;
        if (!graph.has(ref)) graph.set(ref, new Set());
        graph.get(ref).add(`${kind}:${key}`);
      }
  return graph;
}
function statefulClosure(seeds, graph) {
  const reached = new Set(seeds);
  for (const node of reached) for (const dependent of graph.get(node) || []) reached.add(dependent);
  return reached;
}
function statefulChanges(previous, next) {
  const seeds = new Set();
  for (const kind of statefulKinds)
    for (const key of new Set([...Object.keys(previous[kind]), ...Object.keys(next[kind])])) {
      const before = previous[kind][key];
      const after = next[kind][key];
      if (
        !before ||
        !after ||
        (kind === "segments"
          ? JSON.stringify(before) !== JSON.stringify(after)
          : !before.hash || !after.hash || before.hash !== after.hash)
      )
        seeds.add(`${kind}:${key}`);
    }
  const oldReached = statefulClosure(seeds, statefulGraph(previous));
  // Old intermediate segments cannot seed traversal in the new generation.
  const carried = [...oldReached].filter((key) => !key.startsWith("segments:"));
  const affected = statefulClosure(new Set([...seeds, ...carried]), statefulGraph(next));
  return Object.fromEntries(
    ["features", "variables"].map((kind) => [
      kind,
      [...affected]
        .filter((key) => key.startsWith(`${kind}:`))
        .map((key) => key.slice(kind.length + 1))
        .sort(),
    ]),
  );
}
const statefulDatafile = (revision, parts = {}) => ({
  schemaVersion: "4",
  revision,
  segments: {},
  features: {},
  variables: {},
  ...parts,
});
const statefulAttribute = (value) => [{ attribute: "country", operator: "equals", value }];
const statefulFeature = (hash, conditions = "*") => ({
  hash,
  bucketBy: "userId",
  conditions,
  traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
});
// Only the simple forms authored below are evaluated here. This is intentionally
// independent of SDK evaluation and does not handle arbitrary runtime programs.
function statefulResult(state, kind, key, context) {
  const definition = state[kind][key];
  function matches(value) {
    if (value === undefined || value === "*") return true;
    if (typeof value === "string") {
      if (value.startsWith("[") || value.startsWith("{")) return matches(JSON.parse(value));
      return matches(state.segments[value].conditions);
    }
    if (Array.isArray(value)) return value.every(matches);
    if (value.attribute) return context[value.attribute] === value.value;
    if (value.feature) return statefulResult(state, "features", value.feature, context);
    if (value.variable)
      return statefulResult(state, "variables", value.variable, context) === value.value;
    throw new Error("Unsupported source owned stateful oracle expression");
  }
  const enabled = matches(definition.conditions);
  if (kind === "features") return enabled;
  if (!enabled) return definition.disabledValue ?? null;
  return definition.compose
    ? statefulResult(state, "variables", definition.compose, context)
    : definition.defaultValue;
}
function statefulHistory(name, initial, steps, probes) {
  let state = clone(initial);
  return {
    name,
    initial: { datafile: initial, context: { userId: "subject", country: "nl" } },
    operations: steps.map(({ datafile, replace = false }) => {
      const next = statefulDatafile(datafile.revision);
      for (const kind of statefulKinds)
        next[kind] = replace ? clone(datafile[kind]) : { ...state[kind], ...clone(datafile[kind]) };
      const changes = statefulChanges(state, next);
      const operation = {
        action: "setDatafile",
        target: "root",
        replace,
        datafile,
        expect: {
          events: [
            {
              target: "root",
              name: "datafile_set",
              details: {
                revision: next.revision,
                previousRevision: state.revision,
                revisionChanged: next.revision !== state.revision,
                ...changes,
                replaced: replace,
              },
            },
          ],
          results: probes.map(([kind, key]) => ({
            target: "root",
            method: kind === "features" ? "isEnabled" : "getVariable",
            args: [key],
            value: statefulResult(next, kind, key, { userId: "subject", country: "nl" }),
          })),
        },
      };
      state = next;
      return operation;
    }),
  };
}
const graphInitial = statefulDatafile("0", {
  segments: {
    s0: { conditions: statefulAttribute("nl") },
    s4: { conditions: statefulAttribute("nl") },
  },
  features: { f3: statefulFeature("f3", ["s4"]), g: statefulFeature("g1") },
});
const additionalStatefulCases = [
  statefulHistory(
    "cached graph refreshes after segment only partial updates",
    graphInitial,
    [
      { datafile: statefulDatafile("1", { features: { g: statefulFeature("g2") } }) },
      { datafile: statefulDatafile("2", { segments: { s4: { conditions: ["s0"] } } }) },
      {
        datafile: statefulDatafile("3", {
          segments: { s0: { conditions: statefulAttribute("de") } },
        }),
      },
    ],
    [
      ["features", "f3"],
      ["features", "g"],
    ],
  ),
];
for (const seed of [5, 11, 29]) {
  let randomState = seed;
  const random = () => (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) >>> 8;
  const initial = statefulDatafile("0", {
    segments: { s0: { conditions: statefulAttribute("nl") }, s4: { conditions: ["s0"] } },
    features: { f3: statefulFeature("f3", ["s4"]), g: statefulFeature("g0") },
    variables: {
      gate: { hash: "gate0", type: "boolean", defaultValue: true },
      message: {
        hash: "message",
        type: "string",
        defaultValue: "ready",
        disabledValue: "blocked",
        conditions: [{ feature: "f3" }],
      },
      alias: { hash: "alias", type: "string", compose: "message" },
    },
  });
  const steps = [];
  let current = clone(initial);
  for (let step = 1; step <= 12; step++) {
    const choice = random() % 5;
    const incoming = statefulDatafile(String(step));
    if (choice === 0)
      incoming.segments.s0 = { conditions: statefulAttribute(random() % 2 ? "nl" : "de") };
    else if (choice === 1)
      incoming.segments.s4 = {
        conditions: random() % 2 ? ["s0"] : [{ variable: "gate", operator: "equals", value: true }],
      };
    else if (choice === 2)
      incoming.variables.gate = {
        ...(step % 3 ? { hash: `gate${step}` } : {}),
        type: "boolean",
        defaultValue: Boolean(random() % 2),
      };
    else if (choice === 3)
      incoming.features.f3 = statefulFeature("f3", random() % 2 ? ["s4"] : "*");
    else incoming.features.g = statefulFeature(`g${step}`);
    for (const kind of statefulKinds) current[kind] = { ...current[kind], ...incoming[kind] };
    if (step === 8) delete current.features.g;
    current.revision = String(step);
    steps.push({ datafile: clone(step % 4 === 0 ? current : incoming), replace: step % 4 === 0 });
  }
  additionalStatefulCases.push(
    statefulHistory(`cache free graph history seed ${seed}`, initial, steps, [
      ["features", "f3"],
      ["variables", "gate"],
      ["variables", "message"],
      ["variables", "alias"],
    ]),
  );
}

const generated = new Map([
  ["sdk-v4-cases.json", fixture],
  ["sdk-conditions.json", { version: 1, capability: "unified-conditions", cases: conditionCases }],
]);
const historicalSources = new Map();
for (const name of [
  "sdk-v3.json",
  "sdk-stateful.json",
  "sdk-composition.json",
  "test-checks.json",
]) {
  const source = migrateFixtureSource(
    readFileSync(new URL(`../conformance/native-baseline/${name}`, import.meta.url), "utf8"),
  );
  historicalSources.set(name, source);
  generated.set(name, JSON.parse(source));
}
// Append source owned cases without reserializing historical numeric lexemes.
const historicalStateful = historicalSources.get("sdk-stateful.json");
const statefulEnd = historicalStateful.lastIndexOf("\n  ]");
assert.ok(statefulEnd > 0);
const statefulSource =
  historicalStateful.slice(0, statefulEnd).trimEnd() +
  ",\n" +
  additionalStatefulCases
    .map((entry) =>
      JSON.stringify(entry, null, 2)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    )
    .join(",\n") +
  historicalStateful.slice(statefulEnd);
historicalSources.set("sdk-stateful.json", statefulSource);
generated.set("sdk-stateful.json", JSON.parse(statefulSource));
if (process.argv.includes("--check") || process.argv.includes("--write")) {
  for (const [name, value] of generated) {
    const url = new URL(`../conformance/${name}`, import.meta.url);
    if (process.argv.includes("--check")) {
      const source = readFileSync(url, "utf8");
      assert.deepEqual(JSON.parse(source), clone(value), `${name} differs from its generator`);
      if (historicalSources.has(name))
        assert.equal(
          source,
          historicalSources.get(name),
          `${name} must preserve its historical JSON spellings`,
        );
      if (name === "sdk-conditions.json")
        assert.equal(
          source,
          JSON.stringify(value, null, 2) + "\n",
          `${name} must preserve its generated JSON spellings`,
        );
    } else writeFileSync(url, historicalSources.get(name) || JSON.stringify(value, null, 2) + "\n");
    console.log(`${process.argv.includes("--check") ? "Checked" : "Generated"} ${name}`);
  }
} else process.stdout.write(JSON.stringify(fixture, null, 2) + "\n");
