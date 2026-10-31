import * as path from "node:path";

import type { PluginHandlerOptions } from "../cli";
import { CONFIG_MODULE_NAME } from "../config/projectConfig";
import { FeaturevisorCLIError, formatFeaturevisorCLIError } from "../error";
import {
  CLI_FORMAT_BOLD,
  CLI_FORMAT_DIM,
  CLI_FORMAT_GREEN,
  CLI_FORMAT_RED,
  CLI_FORMAT_YELLOW,
} from "../tester/cliFormat";
import { applyPlan, checkPlan, type CheckResult } from "./check";
import { planConversion, type Plan } from "./plan";
import { readProject, type Shape } from "./project";

const SHAPES: Shape[] = ["flat", "environments", "sets"];

function describeShape(shape: Plan["from"]) {
  return shape === "flat" ? "no environments and no sets" : shape;
}

function lanesOption(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return String(value)
    .split(",")
    .map((lane) => lane.trim())
    .filter(Boolean);
}

function summary(plan: Plan, root: string) {
  const relative = (filePath: string) => path.relative(root, filePath);
  const isState = (filePath: string) => /(^|[\\/])existing-state(-[^\\/]+)?\.json$/.test(filePath);
  const isConfig = (filePath: string) => relative(filePath) === CONFIG_MODULE_NAME;
  const count = (paths: string[]) => ({
    definitions: paths.filter((filePath) => !isState(filePath) && !isConfig(filePath)).length,
    state: paths.filter(isState).length,
  });
  return {
    written: count([...plan.writes.keys()]),
    removed: count([...plan.removes]),
    paths: {
      writes: [...plan.writes.keys()].map(relative).sort(),
      removes: [...plan.removes].map(relative).sort(),
    },
  };
}

function printPlan(plan: Plan, root: string, check: CheckResult | undefined, apply: boolean) {
  const { written, removed } = summary(plan, root);
  const lanes = plan.lanes.join(", ");
  console.log("");
  console.log(
    CLI_FORMAT_BOLD,
    `Convert ${describeShape(plan.from)} to ${describeShape(plan.to)}${plan.keep ? `, keeping ${plan.keep}` : ""}`,
  );
  if (lanes)
    console.log(
      `  ${plan.from === "sets" || plan.to === "sets" ? "Sets" : "Environments"}: ${lanes}`,
    );

  if (plan.conflicts.length > 0) {
    console.log("");
    console.log(CLI_FORMAT_RED, "Cannot convert:");
    for (const conflict of plan.conflicts) console.log(CLI_FORMAT_RED, `  - ${conflict}`);
    return;
  }

  console.log(
    `  Definitions and specs: ${written.definitions} ${apply ? "written" : "to write"}, ${removed.definitions} ${apply ? "removed" : "to remove"}`,
  );
  if (written.state + removed.state > 0) {
    console.log(
      `  State files: ${written.state} ${apply ? "written" : "to write"}, ${removed.state} ${apply ? "removed" : "to remove"}`,
    );
  }
  if (plan.configEdits.length > 0)
    console.log(`  ${CONFIG_MODULE_NAME}: ${plan.configEdits.join(", ")}`);

  if (plan.differences.length > 0) {
    console.log("");
    console.log(CLI_FORMAT_YELLOW, "Differences:");
    for (const difference of plan.differences) console.log(`  - ${difference}`);
  }

  if (check) {
    console.log("");
    console.log(CLI_FORMAT_BOLD, "Checks on a converted copy:");
    if (check.passed) {
      console.log(CLI_FORMAT_GREEN, "  ✔ Lint passes");
      console.log(
        CLI_FORMAT_GREEN,
        `  ✔ Features and variables build the same in ${check.lanes.join(", ")}`,
      );
      if (check.tests) {
        const { before, after } = check.tests;
        console.log(
          CLI_FORMAT_GREEN,
          `  ✔ Tests pass${before === after ? `, ${after} cases` : `, ${before} cases before and ${after} after`}`,
        );
      }
      for (const carried of check.carried) console.log(CLI_FORMAT_DIM, `  ${carried}`);
      for (const added of check.added) console.log(CLI_FORMAT_DIM, `  New datafile: ${added}`);
    } else {
      for (const problem of check.problems) console.log(CLI_FORMAT_RED, `  ✘ ${problem}`);
    }
  }

  if (plan.next.length > 0 && (!check || check.passed)) {
    console.log("");
    console.log(CLI_FORMAT_BOLD, apply ? "Next:" : "After converting:");
    for (const step of plan.next) console.log(`  - ${step}`);
  }

  console.log("");
  if (check && !check.passed) {
    console.log(CLI_FORMAT_RED, "Nothing was converted");
  } else if (apply) {
    console.log(CLI_FORMAT_GREEN, "✔ Converted");
  } else {
    console.log(`Nothing was written. Run with --apply to convert.`);
  }
}

/** The command: 0 when previewed or converted, 2 when it cannot convert */
export async function runConversion(options: PluginHandlerOptions): Promise<number> {
  const { rootDirectoryPath, projectConfig, parsed } = options;
  const json = parsed.json === true;
  try {
    const to = parsed.to as Shape;
    if (!SHAPES.includes(to)) {
      throw new FeaturevisorCLIError("Pass --to=flat, --to=environments or --to=sets.", {
        code: "invalid_cli_arguments",
      });
    }
    const apply = parsed.apply === true;
    const project = readProject(rootDirectoryPath, projectConfig);
    const plan = planConversion(project, {
      to,
      lanes: lanesOption(parsed.environments ?? parsed.sets),
      keep: parsed.keep as string | undefined,
    });
    const check =
      plan.conflicts.length === 0
        ? await checkPlan(plan, rootDirectoryPath, projectConfig)
        : undefined;
    const converting = apply && plan.conflicts.length === 0 && check?.passed === true;
    if (converting) applyPlan(plan, rootDirectoryPath);

    if (json) {
      const { paths } = summary(plan, rootDirectoryPath);
      const payload = {
        from: plan.from,
        to: plan.to,
        lanes: plan.lanes,
        ...(plan.keep ? { keep: plan.keep } : {}),
        writes: paths.writes,
        removes: paths.removes,
        config: plan.configEdits,
        conflicts: plan.conflicts,
        differences: plan.differences,
        next: plan.next,
        ...(check ? { check } : {}),
        applied: converting,
      };
      console.log(parsed.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload));
    } else {
      printPlan(plan, rootDirectoryPath, check, converting);
    }
    return plan.conflicts.length > 0 || !check?.passed ? 2 : 0;
  } catch (error) {
    console.error(formatFeaturevisorCLIError(error, { json, pretty: parsed.pretty === true }));
    return 2;
  }
}
