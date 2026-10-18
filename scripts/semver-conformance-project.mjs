import { readFileSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import assert from "node:assert/strict";
import process from "node:process";

// Shared expected orders generate authored tests, never expectations taken from an SDK.
export function createSemverProject(root, project) {
  const fixture = JSON.parse(readFileSync(join(root, "conformance/semver.json"), "utf8"));
  assert.equal(fixture.kind, "featurevisor.semver");
  assert.equal(fixture.version, 1);
  const write = (path, value) => {
    const destination = join(project, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, typeof value === "string" ? value : JSON.stringify(value));
  };
  mkdirSync(project, { recursive: true });
  symlinkSync(
    join(root, "node_modules"),
    join(project, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  write("featurevisor.config.js", 'module.exports = { parser: "json" };');
  write("attributes/version.json", { type: "string" });
  const operators = [
    "semverEquals",
    "semverNotEquals",
    "semverGreaterThan",
    "semverGreaterThanOrEquals",
    "semverLessThan",
    "semverLessThanOrEquals",
  ];
  let index = 0;
  let failures = 0;
  for (const entry of fixture.cases) {
    for (const reverse of [false, true]) {
      const a = reverse ? entry.right : entry.left;
      const b = reverse ? entry.left : entry.right;
      const order = entry.order === null ? null : reverse ? -entry.order : entry.order;
      for (const [operatorIndex, operator] of operators.entries()) {
        const key = `version${index++}`;
        const source = `${key}Source`;
        const sourceFeature = `${source}Feature`;
        const other = `${key}Other`;
        const expected =
          order !== null &&
          [order === 0, order !== 0, order > 0, order >= 0, order < 0, order <= 0][operatorIndex];
        const description = `${entry.name}, ${reverse ? "reverse" : "forward"}, ${operator}`;
        const variableCondition = { variable: source, operator, value: b };
        const condition = { attribute: "version", operator, value: b };
        write(`variables/${source}.json`, { type: "string", defaultValue: a });
        write(`variables/${other}.json`, { type: "string", defaultValue: b });
        write(`features/${sourceFeature}.json`, {
          bucketBy: "userId",
          variablesSchema: { [source]: { type: "string", defaultValue: a } },
          rules: [{ key: "all", conditions: "*", percentage: 100 }],
        });
        write(`segments/${key}.json`, { conditions: condition });
        write(`features/${key}.json`, {
          description,
          bucketBy: "userId",
          rules: [{ key: "version", conditions: [key], percentage: 100 }],
        });
        write(`tests/${key}.spec.json`, {
          feature: key,
          assertions: [{ at: 50, context: { version: a }, expectedToBeEnabled: expected }],
        });
        for (const featureSource of [false, true]) {
          if (order === null) continue; // Native unit tests cover variable condition errors.
          const subject = `${key}${featureSource ? "Feature" : "Global"}`;
          const selected = {
            ...variableCondition,
            ...(featureSource ? { feature: sourceFeature } : {}),
          };
          write(`variables/${subject}.json`, {
            type: "boolean",
            defaultValue: true,
            disabledValue: false,
            conditions: [selected],
          });
          write(`tests/${subject}.spec.json`, {
            variable: subject,
            assertions: [{ expectedValue: order === null ? null : expected }],
          });
        }
        const checks = [
          variableCondition,
          { variable: source, operator, compareTo: { variable: other } },
        ];
        write(`tests/${key}Checks.spec.json`, {
          description,
          checks: checks.map((check) => (expected ? check : { not: [check] })),
        });
        if (order === null) failures++;
      }
    }
  }
  return { project, failures, comparisons: index, cases: index * 4 - failures * 2 };
}

export function assertSemverReport(report, expected, runner) {
  assert.equal(
    report.results.flatMap((spec) => spec.cases).length,
    expected.cases,
    `${runner}: skipped version cases`,
  );
  const failed = report.results.filter((spec) => !spec.passed);
  assert.equal(failed.length, expected.failures, `${runner}: version comparison failure count`);
  for (const spec of failed) {
    assert.equal(spec.type, "scenario", `${runner}: failed runtime evaluation ${spec.source}`);
    assert.match(spec.source, /Checks\.spec\.json$/, `${runner}: unexpected version spec failure`);
    for (const testCase of spec.cases) {
      assert.ok(testCase.errors.length > 0);
      for (const error of testCase.errors) {
        assert.equal(error.type, "check", `${runner}: unstructured version comparison error`);
        assert.ok(
          ["valid checks", "successful comparison"].includes(error.expected),
          `${runner}: version error became an ordinary mismatch: ${JSON.stringify(error)}`,
        );
      }
    }
  }
}
