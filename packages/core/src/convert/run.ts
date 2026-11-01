import * as path from "node:path";

import type { PluginHandlerOptions } from "../cli";
import { CONFIG_MODULE_NAME } from "../config";
import { FeaturevisorCLIError, formatFeaturevisorCLIError } from "../error";
import {
  CLI_FORMAT_BOLD,
  CLI_FORMAT_DIM,
  CLI_FORMAT_GREEN,
  CLI_FORMAT_RED,
  CLI_FORMAT_YELLOW,
} from "../tester/cliFormat";
import { applyPlan, checkPlan, type CheckResult } from "./check";
import { writeSetting } from "./config";
import { CONDITION_FORMS, isConditionForm, planConversion, type Plan, type Target } from "./plan";
import { readProject } from "./project";

const TARGETS: Target[] = ["flat", "environments", "sets", ...CONDITION_FORMS];

function describeShape(shape: Plan["from"]) {
  if (shape === "flat") return "no environments and no sets";
  return shape === "trees" ? "condition trees" : shape;
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
  if (plan.conditions) {
    const one = plan.conditions === 1;
    const [from, to] =
      plan.to === "expressions"
        ? [one ? "tree" : "trees", one ? "an expression" : "expressions"]
        : [one ? "expression" : "expressions", one ? "a tree" : "trees"];
    console.log(
      `  Conditions: ${plan.conditions} ${from} ${apply ? "written" : "to write"} as ${to}`,
    );
  }
  if (plan.simplified) {
    console.log(
      `  Simplified: ${plan.simplified} ${plan.simplified === 1 ? "condition" : "conditions"} ${apply ? "written" : "to write"} in ${plan.simplified === 1 ? "its" : "their"} simplest form`,
    );
  }
  if (plan.config.byHand) {
    console.log(`  ${CONFIG_MODULE_NAME}: for you to edit after converting, as below`);
  } else if (plan.config.edits.length > 0) {
    console.log(`  ${CONFIG_MODULE_NAME}: ${plan.config.edits.join(", ")}`);
  }

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
        !isConditionForm(plan.to)
          ? `  ✔ Features and variables build the same in ${check.lanes.join(", ")}`
          : plan.simplified
            ? "  ✔ Every datafile evaluates the same, its conditions in their simplest form"
            : "  ✔ Every datafile builds the same",
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

  if (plan.config.byHand && (!check || check.passed)) printConfigByHand(plan, apply);

  if (plan.next.length > 0 && (!check || check.passed)) {
    console.log("");
    console.log(CLI_FORMAT_BOLD, apply ? "Next:" : "After converting:");
    for (const step of plan.next) console.log(`  - ${step}`);
  }

  console.log("");
  if (check && !check.passed) {
    console.log(CLI_FORMAT_RED, "Nothing was converted");
  } else if (apply) {
    console.log(
      CLI_FORMAT_GREEN,
      plan.config.byHand ? `✔ Converted, except ${CONFIG_MODULE_NAME}` : "✔ Converted",
    );
  } else {
    console.log(
      `Nothing was written. Run with --apply to convert${plan.config.byHand ? `, then edit ${CONFIG_MODULE_NAME}` : ""}.`,
    );
  }
}

/** The edits to featurevisor.config.js convert leaves to the user, as text to copy */
function printConfigByHand(plan: Plan, apply: boolean) {
  const { remove, add } = plan.config;
  console.log("");
  console.log(
    CLI_FORMAT_YELLOW,
    `Edit ${CONFIG_MODULE_NAME} by hand${apply ? "" : " after converting"}, since ${plan.config.byHand}:`,
  );
  for (const name of remove) console.log(`  - Remove ${name}`);
  if (add.length > 0) {
    console.log(`  - Add these settings to the object it exports:`);
    console.log("");
    for (const [name, value] of add) {
      console.log(
        writeSetting(name, value)
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n"),
      );
    }
    console.log("");
  }
  console.log(
    `  Until then, Featurevisor reads the project in its old shape. Run lint once it is edited.`,
  );
}

/** The command: 0 when previewed or converted, 2 when it cannot convert */
export async function runConversion(options: PluginHandlerOptions): Promise<number> {
  const { rootDirectoryPath, projectConfig, parsed } = options;
  const json = parsed.json === true;
  try {
    const to = parsed.to as Target;
    if (!TARGETS.includes(to)) {
      throw new FeaturevisorCLIError(
        "Pass --to=flat, --to=environments or --to=sets to change the project's shape, or --to=expressions or --to=trees to change how its conditions are written.",
        { code: "invalid_cli_arguments" },
      );
    }
    const apply = parsed.apply === true;
    const project = readProject(rootDirectoryPath, projectConfig);
    const plan = planConversion(project, {
      to,
      lanes: lanesOption(parsed.environments ?? parsed.sets),
      keep: parsed.keep as string | undefined,
      exact: parsed.exact === true,
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
        ...(plan.conditions !== undefined ? { conditions: plan.conditions } : {}),
        ...(plan.simplified !== undefined ? { simplified: plan.simplified } : {}),
        config: plan.config.edits,
        ...(plan.config.byHand
          ? {
              configByHand: {
                reason: plan.config.byHand,
                remove: plan.config.remove,
                add: plan.config.add.map(
                  ([name, value]) =>
                    `${name}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`,
                ),
              },
            }
          : {}),
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
