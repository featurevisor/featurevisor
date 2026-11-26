import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { lintProject } from "../linter/lintProject";
import { listEntities } from "../list";
import { createTestReport } from "./report";
import { testProject } from "./testProject";

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
    minLength: 2
  taxId:
    type: string
  password:
    type: string
  confirmPassword:
    type: string

required: [accountType, displayName]

mutations:
  dev:
    - key: shortNames
      conditions: "*"
      mutate:
        properties.displayName.minLength: 1

    - key: business
      conditions:
        input: accountType
        operator: equals
        value: business
      mutate:
        required:appendUnique: taxId

    - key: dutch
      conditions:
        attribute: country
        operator: equals
        value: nl
      mutate:
        properties.displayName.minLength: 3

  production:
    - key: business
      conditions:
        input: accountType
        operator: equals
        value: business
      mutate:
        required:appendUnique: taxId

    - key: dutch
      conditions:
        attribute: country
        operator: equals
        value: nl
      mutate:
        properties.displayName.minLength: 3

issues:
  - key: passwordsDiffer
    conditions:
      input: confirmPassword
      operator: notEquals
      valueFrom:
        input: password
    path: confirmPassword
    message: The passwords do not match
`;

function createProject(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-schema-tests-"));
  const all: Record<string, string> = {
    "featurevisor.config.js": `module.exports = ${JSON.stringify({
      tags: ["web"],
      environments: ["dev", "production"],
    })};`,
    "attributes/country.yml": "description: Country\ntype: string\n",
    "schemas/signUp.yml": signUp,
    "targets/web.yml": "description: Web\ntag: web\n",
    "targets/api.yml": "description: API\nincludeFeatures:\n  - none\n",
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

async function run(spec: string) {
  const { root, projectConfig, datasource } = createProject({
    "tests/schemas/signUp.spec.yml": spec,
  });
  try {
    const deps = { rootDirectoryPath: root, projectConfig, datasource, options: {} };
    const lint = await lintProject(deps as any, { json: true });
    const report = createTestReport();
    await testProject(deps as any, { json: true, report });
    return {
      lint: lint.errors.map(({ path: at, message }) => [at.join("."), message]),
      passed: report.passed,
      assertions: report.results.flatMap((result) =>
        result.cases.map((entry) => ({
          passed: entry.passed,
          errors: entry.errors.map((error) => error.message),
        })),
      ),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("schema specs", () => {
  test("assertions validate values with the package, by environment, context and mutation", async () => {
    const result = await run(`schema: signUp

assertions:
  - description: A complete sign up
    environment: production
    value:
      accountType: personal
      displayName: Ada
    expectedToBeValid: true

  - description: A name of one letter passes in dev only
    environment: dev
    value:
      accountType: personal
      displayName: A
    expectedToBeValid: true

  - description: A business without a tax ID names its mutation
    environment: production
    value:
      accountType: business
      displayName: Ada
    expectedIssues:
      - path: [taxId]
        code: required
        mutation: business

  - description: Dutch names are longer
    environment: production
    context:
      country: nl
    value:
      accountType: personal
      displayName: Ad
    expectedIssues:
      - path: [displayName]
        code: minLength
        mutation: dutch

  - description: Passwords that differ
    environment: production
    value:
      accountType: personal
      displayName: Ada
      password: a
      confirmPassword: b
    expectedIssues:
      - path: [confirmPassword]
        params:
          refine: passwordsDiffer
        message: The passwords do not match
`);

    expect(result.lint).toEqual([]);
    expect(result.assertions).toEqual(Array(5).fill({ passed: true, errors: [] }));
    expect(result.passed).toBe(true);
  });

  test("a failing assertion says what differs", async () => {
    const result = await run(`schema: signUp

assertions:
  - description: Expected valid, but the name is short
    environment: production
    value:
      accountType: personal
      displayName: A
    expectedToBeValid: true

  - description: Expected another issue
    environment: production
    value:
      accountType: business
      displayName: A
    expectedIssues:
      - path: [taxId]
        code: required

  - description: The API target delivers no schema
    environment: production
    target: api
    value:
      accountType: personal
      displayName: Ada
    expectedToBeValid: true
`);

    expect(result.passed).toBe(false);
    expect(result.assertions.map(({ passed }) => passed)).toEqual([false, false, false]);
    expect(result.assertions[0].errors[0]).toContain(
      "Expected the value to be valid, and it has an issue:",
    );
    expect(result.assertions[1].errors[0]).toBe(
      'The issues differ from expectedIssues:\n       unexpected: {"path":["displayName"],"code":"minLength","message":"Value at \\"displayName\\" must be at least 2 characters long (got 1).","params":{"minLength":2,"length":1}}',
    );
    expect(result.assertions[2].errors[0]).toBe(
      'Target "api" does not deliver schema "signUp". Tag the schema for it, or list it in its includeSchemas.',
    );
  });

  test("each assertion is a case to rerun, and native runners' execution documents leave schema specs out", async () => {
    const { root, projectConfig, datasource } = createProject({
      "tests/schemas/signUp.spec.yml": `schema: signUp

assertions:
  - description: First
    environment: production
    value: { accountType: personal, displayName: Ada }
    expectedToBeValid: true
  - description: Second
    environment: production
    value: { accountType: personal, displayName: A }
    expectedToBeValid: false
`,
    });
    try {
      const deps = (options: Record<string, unknown>) =>
        ({ rootDirectoryPath: root, projectConfig, datasource, options }) as any;
      const [one] = await listEntities<any>(
        deps({ case: JSON.stringify([null, "schema", "schemas.signUp", 1, null]) }),
        "test",
      );
      expect(one.assertions.map((assertion: any) => assertion.description)).toEqual([
        "Assertion #2: Second",
      ]);
      expect(
        await listEntities(deps({ executionProtocol: true, applyMatrix: true }), "test"),
      ).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a matrix runs one case per combination, in every field", async () => {
    const result = await run(`schema: signUp

assertions:
  - description: \${{ accountType }} accounts in \${{ environment }}
    matrix:
      environment: [dev, production]
      accountType: [personal, business]
    environment: \${{ environment }}
    value:
      accountType: \${{ accountType }}
      displayName: Ada
      taxId: DE123456789
    expectedToBeValid: true

  - description: A name of one letter in \${{ environment }}
    matrix:
      environment: [dev, production]
      valid: [true]
    environment: \${{ environment }}
    value:
      accountType: personal
      displayName: A
    expectedToBeValid: \${{ valid }}
`);

    expect(result.lint).toEqual([]);
    // The second assertion fails in production, where names need two characters.
    expect(result.assertions.map(({ passed }) => passed)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  test("lint checks schema specs", async () => {
    const result = await run(`schema: singUp

assertions:
  - description: No environment
    value: {}
    expectedToBeValid: true
  - environment: production
    expectedToBeValid: true
    expectedIssues:
      - code: required
  - environment: production
    value: {}
`);

    expect(result.lint).toEqual(
      expect.arrayContaining([
        ["schema", 'Unknown schema "singUp". Did you mean "signUp"?'],
        ["assertions.0.environment", expect.stringContaining("Add environment.")],
        ["assertions.1.value", "Add the `value` to validate."],
        ["assertions.1.expectedIssues", "A value expected to be valid has no issues to expect."],
        ["assertions.2.expectedToBeValid", "Add `expectedToBeValid` or `expectedIssues`."],
      ]),
    );
  });
});
