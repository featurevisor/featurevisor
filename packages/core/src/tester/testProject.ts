import * as path from "path";

import type {
  TestSegment,
  TestFeature,
  TestVariable,
  TestScenario,
  Test,
  DatafileContent,
  TestResult,
} from "@featurevisor/types";
import type { Evaluation } from "@featurevisor/sdk";

import { testSegment } from "./testSegment";
import { testFeature } from "./testFeature";
import { testVariable } from "./testVariable";
import { CLI_FORMAT_BOLD } from "./cliFormat";
import { Dependencies } from "../dependencies";
import { prettyDuration } from "./prettyDuration";
import { printTestResult } from "./printTestResult";

import { buildDatafile, buildTargetDatafile } from "../builder";
import { Plugin } from "../cli";
import { parsePositiveIntegerOption } from "../cli/validation";
import { listEntities } from "../list";
import { getProjectSetExecutions, printSetHeader } from "../sets";
import { resolveTargets } from "../targeting";
import { FeaturevisorCLIError, formatFeaturevisorCLIError } from "../error";
import { createCoverageCollector } from "./coverage";
import { getTestDatafileKey } from "./datafileKey";
import { createTestInputSnapshot, getTestInputFingerprint } from "./provenance";
import {
  createTestReport,
  createReportSpec,
  appendReportSpec,
  appendReportError,
  printReportSummary,
  type TestReport,
} from "./report";

export interface TestProjectOptions {
  keyPattern?: string;
  assertionPattern?: string;
  verbose?: boolean;
  showDatafile?: boolean;
  onlyFailures?: boolean;
  quiet?: boolean;
  entityType?: "feature" | "segment" | "variable" | "scenario";
  inflate?: number;
  target?: string | string[];
  case?: string;
  json?: boolean;
  pretty?: boolean;
  coverage?: boolean;
  uncovered?: boolean;
  set?: string | null;
  rootDirectoryPath?: string;
  report?: TestReport;
  onEvaluation?: (evaluation: Evaluation, assertion: any) => void;
}

export interface ExecutionResult {
  passed: boolean;
  assertionsCount: {
    passed: number;
    failed: number;
  };
  result?: TestResult;
}

export type DatafileContentByKey = Map<string, DatafileContent>;

export function filterTestForTargets(test: Test, selectedTargetKeys?: string[]): Test | undefined {
  if (!selectedTargetKeys) return test;

  const assertions = test.assertions.filter(
    (assertion) => !assertion.target || selectedTargetKeys.includes(assertion.target),
  );
  if ("segment" in test && assertions.length === test.assertions.length) return test;

  return assertions.length > 0 ? ({ ...test, assertions } as Test) : undefined;
}

async function buildTestDatafilesForEnvironment(
  deps: Dependencies,
  datafileContentByKey: DatafileContentByKey,
  environment: string | false,
  selectedTargetKeys?: string[],
) {
  const { projectConfig, datasource, options } = deps;
  const existingState = await datasource.readState(environment);
  const datafileContent = await buildDatafile(
    projectConfig,
    datasource,
    {
      revision: "include-all-features",
      environment,
      inflate: options.inflate,
    },
    existingState,
  );

  datafileContentByKey.set(getTestDatafileKey(environment), datafileContent);

  const targetKeys = selectedTargetKeys || (await datasource.listTargets());
  for (const targetKey of targetKeys) {
    const target = await datasource.readTarget(targetKey);
    const targetDatafileContent = await buildTargetDatafile({
      projectConfig,
      datasource,
      target,
      environment,
      existingState,
      revision: "include-target-features",
      inflate: options.inflate,
    });

    datafileContentByKey.set(getTestDatafileKey(environment, targetKey), targetDatafileContent);
  }
}

export async function executeTest(
  test: Test,
  deps: Dependencies,
  options: TestProjectOptions,
  datafileContentByKey: DatafileContentByKey,
): Promise<ExecutionResult | undefined> {
  const { datasource, projectConfig, rootDirectoryPath } = deps;

  const extension = datasource.getExtension();
  const scenarioPathSegments = (test.key || "").split(projectConfig.namespaceCharacter);
  if (
    scenarioPathSegments.length > 1 &&
    ["spec", "feature", "segment"].includes(scenarioPathSegments[scenarioPathSegments.length - 1])
  ) {
    const suffix = scenarioPathSegments.pop();
    scenarioPathSegments[scenarioPathSegments.length - 1] += `.${suffix}`;
  }
  const relativeTestFilePath =
    test._test?.source ||
    ("scenario" in test
      ? path.relative(
          rootDirectoryPath,
          path.join(
            projectConfig.testsDirectoryPath,
            scenarioPathSegments.join(path.sep) + (extension ? `.${extension}` : ""),
          ),
        )
      : test.key + (extension ? `.${extension}` : ""));

  const tAsSegment = test as TestSegment;
  const tAsFeature = test as TestFeature;
  const tAsVariable = test as TestVariable;
  const tAsScenario = test as TestScenario;
  const key =
    tAsSegment.segment || tAsFeature.feature || tAsVariable.variable || tAsScenario.scenario;
  const type = tAsScenario.scenario
    ? "scenario"
    : tAsSegment.segment
      ? "segment"
      : tAsVariable.variable
        ? "variable"
        : "feature";

  const executionResult: ExecutionResult = {
    passed: true,
    assertionsCount: {
      passed: 0,
      failed: 0,
    },
  };

  if (!key) {
    console.error(`  => Invalid test: ${JSON.stringify(test)}`);
    executionResult.passed = false;
    if (options.report) appendReportError(options.report, "Invalid test: missing entity identity");

    return executionResult;
  }

  let testResult;
  if (type === "segment") {
    testResult = await testSegment(datasource, tAsSegment, options, datafileContentByKey);
  } else if (type === "variable" || type === "scenario") {
    testResult = await testVariable(
      type === "scenario" ? tAsScenario : tAsVariable,
      options,
      datafileContentByKey,
    );
  } else {
    testResult = await testFeature(
      datasource,
      projectConfig,
      tAsFeature,
      options,
      datafileContentByKey,
    );
  }

  const reportSpec = createReportSpec(test, testResult, options);
  executionResult.result = testResult;
  if (options.report) {
    appendReportSpec(options.report, reportSpec);
    if (testResult.notFound)
      appendReportError(
        options.report,
        `${testResult.type} "${testResult.key}" not found (${reportSpec.source})`,
      );
  }
  if (!options.json && !options.onlyFailures) {
    // show all
    printTestResult(testResult, relativeTestFilePath, rootDirectoryPath, reportSpec, test);
  } else {
    // show failed only
    if (!options.json && !testResult.passed) {
      printTestResult(testResult, relativeTestFilePath, rootDirectoryPath, reportSpec, test);
    }
  }

  if (!testResult.passed) {
    executionResult.passed = false;

    executionResult.assertionsCount.failed = testResult.assertions.filter((a) => !a.passed).length;
    executionResult.assertionsCount.passed +=
      testResult.assertions.length - executionResult.assertionsCount.failed;
  } else {
    executionResult.assertionsCount.passed = testResult.assertions.length;
  }

  return executionResult;
}

export async function testProject(
  deps: Dependencies,
  testOptions: TestProjectOptions = {},
): Promise<boolean> {
  const startTime = Date.now();
  const options = { ...deps.options, ...testOptions } as TestProjectOptions;
  const fingerprintInputs = options.json && !options.inflate && !deps.options.inflate;
  if (fingerprintInputs) deps = { ...deps, datasource: createTestInputSnapshot(deps.datasource) };
  const { rootDirectoryPath, projectConfig, datasource } = deps;
  const report = options.report || createTestReport();
  const ownsReport = !options.report;
  const set = options.set || null;
  const previousFingerprints = report.provenance?.sets.filter((entry) => entry.set === set) || [];
  const hasPreviousResults = report.results.some((result) => result.set === set);
  // Never retain provenance from an earlier execution of the same Set.
  if (report.provenance) {
    report.provenance.sets = report.provenance.sets.filter((entry) => entry.set !== set);
  }
  // The builder reads deps.options, while case execution uses merged options.
  // Neither an inflated build nor an inflated request represents Catalog inputs.
  if (fingerprintInputs) {
    try {
      const fingerprint = await getTestInputFingerprint(projectConfig, datasource);
      // A report combining different snapshots must stay unverified for this Set.
      if (
        !hasPreviousResults ||
        (previousFingerprints.length === 1 && previousFingerprints[0].fingerprint === fingerprint)
      ) {
        (report.provenance ||= { version: 1, algorithm: "sha256", sets: [] }).sets.push({
          set,
          fingerprint,
        });
      }
    } catch (error) {
      // Optional report metadata must not introduce a separate validation policy.
      // Required input failures still fail when the builder or test runner reads them.
      console.warn(
        `Test report inputs could not be verified: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const collector = options.coverage ? createCoverageCollector(options.set || null) : undefined;
  const executionOptions = {
    ...options,
    report,
    onEvaluation: collector?.onEvaluation || options.onEvaluation,
  };

  let hasError = false;

  if (options.uncovered) {
    const baseDeps = {
      rootDirectoryPath,
      projectConfig,
      datasource,
      options: { withoutTests: true },
    };
    const features = await listEntities<{ key: string }>(baseDeps, "feature");
    const variables = await listEntities<{ key: string }>(baseDeps, "variable");
    (report.uncovered ||= []).push({
      set: options.set || null,
      features: features.map((feature) => feature.key).sort(),
      variables: variables.map((variable) => variable.key).sort(),
    });
  }

  // Validate and select cases before building datafiles, including when searching sets.
  const tests = await listEntities<Test>(
    {
      rootDirectoryPath,
      projectConfig,
      datasource,
      options: { ...options, applyMatrix: true, executionMetadata: true },
    },
    "test",
  );

  const datafileContentByKey: DatafileContentByKey = new Map();
  const selectedTargets = options.target
    ? await resolveTargets(datasource, options.target, { defaultToAll: false })
    : undefined;
  const selectedTargetKeys = selectedTargets?.map((target) => target.key);

  // with environments
  if (Array.isArray(projectConfig.environments)) {
    for (const environment of projectConfig.environments) {
      await buildTestDatafilesForEnvironment(
        deps,
        datafileContentByKey,
        environment,
        selectedTargetKeys,
      );
    }
  }

  // no environments
  if (!Array.isArray(projectConfig.environments)) {
    await buildTestDatafilesForEnvironment(deps, datafileContentByKey, false, selectedTargetKeys);
  }

  let executedCases = 0;
  for (const originalTest of tests) {
    const test = filterTestForTargets(originalTest, selectedTargetKeys);
    if (!test) continue;
    executedCases += test.assertions.length;

    const executionResult = await executeTest(test, deps, executionOptions, datafileContentByKey);

    if (!executionResult) {
      continue;
    }

    if (!executionResult.passed) {
      hasError = true;
    }
  }

  if (options.case && executedCases === 0)
    throw new Error("No test case matches --case and the selected filters");

  const diffInMs = Date.now() - startTime;

  if (collector) {
    const selections = collector.getSelections();
    if (!report.coverage) report.coverage = { mode: "observed-selections", selections: [] };
    report.coverage.selections.push(...selections);
  }
  if (ownsReport) {
    if (options.json) console.log(JSON.stringify(report, null, options.pretty ? 2 : undefined));
    else {
      printReportSummary(report);
      console.log(CLI_FORMAT_BOLD, `Time:       ${prettyDuration(diffInMs)}`);
    }
  }

  return hasError;
}

export const testPlugin: Plugin = {
  command: "test",
  handler: async function ({ rootDirectoryPath, projectConfig, datasource, parsed }) {
    const report = createTestReport();
    const started = Date.now();
    let errorMessages: string[] | undefined;
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalDebug = console.debug;
    // Keep progress and diagnostics away from the single JSON document.
    if (parsed.json)
      console.log = console.info = console.debug = (...args) => console.error(...args);
    try {
      if (typeof parsed.inflate !== "undefined") {
        parsed = { ...parsed, inflate: parsePositiveIntegerOption("--inflate", parsed.inflate, 1) };
      }
      const executions = await getProjectSetExecutions(projectConfig, datasource, parsed.set);
      let matchedCase = false;
      for (const execution of executions) {
        printSetHeader(projectConfig, execution.set, parsed.json);
        const options = { ...parsed, set: execution.set || null, report } as TestProjectOptions;
        try {
          await testProject(
            {
              rootDirectoryPath,
              projectConfig: execution.projectConfig,
              datasource: execution.datasource,
              options,
            },
            options,
          );
          matchedCase = true;
        } catch (error) {
          if (
            parsed.case &&
            !parsed.set &&
            executions.length > 1 &&
            error instanceof FeaturevisorCLIError &&
            error.code === "test_case_not_found"
          )
            continue;
          throw error;
        }
      }
      if (parsed.case && !matchedCase)
        throw new Error("No test case matches --case and the selected filters");
    } catch (error) {
      appendReportError(report, error);
      if (parsed.verbose && !parsed.json) {
        errorMessages = report.errors.map((item, index) =>
          index === report.errors.length - 1
            ? formatFeaturevisorCLIError(error, { verbose: true })
            : item.message,
        );
      }
    } finally {
      console.log = originalLog;
      console.info = originalInfo;
      console.debug = originalDebug;
    }
    if (parsed.json) console.log(JSON.stringify(report, null, parsed.pretty ? 2 : undefined));
    else {
      printReportSummary(report, errorMessages);
      console.log(CLI_FORMAT_BOLD, `Time:       ${prettyDuration(Date.now() - started)}`);
    }
    return report.passed ? undefined : false;
  },
  examples: [
    {
      command: "test",
      description: "Run all tests",
    },
    {
      command: "test --key-pattern=pattern",
      description: "Run tests matching key pattern",
    },
    {
      command: "test --assertion-pattern=pattern",
      description: "Run tests matching assertion pattern",
    },
    {
      command: "test --only-failures",
      description: "Show only failed tests",
    },
    {
      command: "test --show-datafile",
      description: "Show datafile content for each test",
    },
    {
      command: "test --verbose",
      description: "Show detailed evaluation logs",
    },
  ],
};
