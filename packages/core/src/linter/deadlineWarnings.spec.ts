import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { getProjectConfig } from "../config/projectConfig";
import { Datasource } from "../datasource";
import { getDeadlineClock } from "../metadata";
import { getDeadlineWarnings } from "./deadlineWarnings";
import { lintPlugin, lintProject } from "./lintProject";
import { LINT_WARNING_CODES } from "./warningCodes";

// Midday in UTC is 1 March in every usual timezone, so these read the same wherever they run
const clock = getDeadlineClock("2027-03-01T12:00:00Z");

describe("getDeadlineWarnings", () => {
  function codes(deadlines: Record<string, unknown>, definition: Record<string, unknown> = {}) {
    return getDeadlineWarnings({ ...definition, metadata: { deadlines } }, clock).map(
      ({ code, path }) => `${path.join(".")}: ${code}`,
    );
  }

  it("warns about open deadlines that are overdue or due today", () => {
    expect(
      codes({
        review: { by: "2027-02-28T12:00:00Z" },
        audit: { by: "2027-03-01T11:00:00Z" },
        remove: { by: "2027-03-01T13:00:00Z" },
        deprecate: { by: "2027-03-02T12:00:00Z" },
        notify: { by: "2027-06-01T12:00:00Z" },
      }),
    ).toEqual([
      "metadata.deadlines.review: deadline_overdue",
      "metadata.deadlines.audit: deadline_overdue",
      "metadata.deadlines.remove: deadline_due_today",
    ]);
  });

  it("says what was due and what to do about it", () => {
    expect(
      getDeadlineWarnings(
        {
          metadata: {
            deadlines: {
              review: { by: "2027-02-01T09:00:00Z" },
              remove: { by: "2027-03-01T17:00:00+01:00" },
            },
          },
        },
        clock,
      ).map(({ message }) => message),
    ).toEqual([
      'The "review" deadline was due by 2027-02-01T09:00:00Z and is not done. Set `done` once the work is done, or move `by` later.',
      'The "remove" deadline is due today, by 2027-03-01T17:00:00+01:00. Set `done` once the work is done.',
    ]);
  });

  it("leaves out deadlines that are done, whether with true or a timestamp", () => {
    expect(
      codes({
        review: { by: "2027-02-01T09:00:00Z", done: true },
        remove: { by: "2027-02-01T09:00:00Z", done: "2027-01-30T16:00:00Z" },
      }),
    ).toEqual([]);
  });

  it("leaves out archived definitions, as Catalog does", () => {
    expect(codes({ remove: { by: "2027-02-01T09:00:00Z" } }, { archived: true })).toEqual([]);
    expect(codes({ remove: { by: "2027-02-01T09:00:00Z" } }, { deprecated: true })).toEqual([
      "metadata.deadlines.remove: deadline_overdue",
    ]);
  });

  it("ignores what lint reports as invalid metadata, such as a date alone", () => {
    expect(
      codes({ review: { by: "soon" }, audit: { by: "2027-02-01" }, remove: "2027-02-01" }),
    ).toEqual([]);
    expect(getDeadlineWarnings({}, clock)).toEqual([]);
    expect(getDeadlineWarnings({ metadata: "text" }, clock)).toEqual([]);
    expect(getDeadlineWarnings(undefined, clock)).toEqual([]);
  });

  it("reads a date object as JSON would write it", () => {
    const by = new Date("2027-02-01T00:00:00Z");
    expect(
      getDeadlineWarnings({ metadata: { deadlines: { review: { by } } } }, clock)[0].message,
    ).toContain("was due by 2027-02-01T00:00:00.000Z");
  });
});

describe("deadline warnings in lint", () => {
  let root: string;

  function write(file: string, content: string) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }

  function getDependencies() {
    const projectConfig = getProjectConfig(root);
    return {
      rootDirectoryPath: root,
      projectConfig,
      datasource: new Datasource(projectConfig, root),
    };
  }

  const due = (by: string) => `metadata:\n  deadlines:\n    review:\n      by: "${by}"\n`;
  const rules = 'rules:\n  - key: everyone\n    conditions: "*"\n    percentage: 0\n';
  const overdue = "2027-02-01T09:00:00Z";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-deadlines-"));
    write("featurevisor.config.js", "module.exports = {};");
    write("attributes/userId.yml", `description: User\n${due(overdue)}type: string\n`);
    write(
      "segments/everyone.yml",
      `description: Everyone\n${due("2027-03-01T15:00:00Z")}conditions: "*"\n`,
    );
    write("schemas/link.yml", `description: Link\n${due(overdue)}type: string\n`);
    write(
      "features/checkout.yml",
      `description: Checkout\n${due(overdue)}bucketBy: userId\n${rules}`,
    );
    write(
      "features/pricing.yml",
      `description: Pricing\n${due("2027-06-01T09:00:00Z")}bucketBy: userId\n${rules}`,
    );
    write(
      "features/legacy.yml",
      `description: Legacy\narchived: true\n${due(overdue)}bucketBy: userId\n${rules}`,
    );
    write(
      "variables/supportEmail.yml",
      `description: Support\n${due(overdue)}type: string\ndefaultValue: x\n`,
    );
    write("targets/all.yml", `description: All\n${due(overdue)}tags:\n  - all\n`);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function describeItems(items: { code?: string; entityType: string; key: string; path: any[] }[]) {
    return items.map(
      ({ code, entityType, key, path: at }) => `${entityType} ${key} ${at.join(".")}: ${code}`,
    );
  }

  it("warns on every kind of definition without failing", async () => {
    const result = await lintProject({ ...getDependencies(), options: {} } as any, {
      json: true,
      now: "2027-03-01T12:00:00Z",
    });

    expect(result.hasError).toBe(false);
    expect(result.errors).toEqual([]);
    expect(describeItems(result.warnings || [])).toEqual([
      "attribute userId metadata.deadlines.review: deadline_overdue",
      "segment everyone metadata.deadlines.review: deadline_due_today",
      "feature checkout metadata.deadlines.review: deadline_overdue",
      "variable supportEmail metadata.deadlines.review: deadline_overdue",
      "schema link metadata.deadlines.review: deadline_overdue",
      "target all metadata.deadlines.review: deadline_overdue",
    ]);
  });

  it("checks deadlines against the current moment without --now", async () => {
    write(
      "features/old.yml",
      `description: Old\n${due("2001-01-01T09:00:00Z")}bucketBy: userId\n${rules}`,
    );
    const result = await lintProject({ ...getDependencies(), options: {} } as any, {
      json: true,
      entityType: "feature",
    });

    expect(result.hasError).toBe(false);
    expect((result.warnings || []).map(({ key }) => key)).toContain("old");
  });

  it("reports the codes --fail-on names as errors, and keeps the rest as warnings", async () => {
    const result = await lintProject({ ...getDependencies(), options: {} } as any, {
      json: true,
      now: "2027-03-01T12:00:00Z",
      failOn: ["deadline_overdue"],
    });

    expect(result.hasError).toBe(true);
    expect(describeItems(result.errors)).toEqual([
      "attribute userId metadata.deadlines.review: deadline_overdue",
      "feature checkout metadata.deadlines.review: deadline_overdue",
      "variable supportEmail metadata.deadlines.review: deadline_overdue",
      "schema link metadata.deadlines.review: deadline_overdue",
      "target all metadata.deadlines.review: deadline_overdue",
    ]);
    expect(describeItems(result.warnings || [])).toEqual([
      "segment everyone metadata.deadlines.review: deadline_due_today",
    ]);
  });

  it("prints a warning --fail-on names as an error under its file", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await lintProject({ ...getDependencies(), options: {} } as any, {
        entityType: "feature",
        now: "2027-03-01T12:00:00Z",
        failOn: ["deadline_overdue"],
      });
      const printed = log.mock.calls.map((call) => call.join(" "));
      const at = printed.findIndex((line) => line.includes('=> Error: The "review" deadline'));
      expect(at).toBeGreaterThan(0);
      expect(printed[at - 1]).toContain(path.join("features", "checkout.yml"));
      expect(printed[at + 1]).toBe("     Path: metadata.deadlines.review");
      expect(printed.some((line) => line.includes("=> Warning:"))).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it("passes the CLI's --now and --fail-on to lint, and fails when they find something", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const passed = await lintPlugin.handler({
        ...getDependencies(),
        parsed: { json: true, now: "2027-01-15T09:00:00Z", failOn: ["deadline_overdue"] },
      } as any);
      expect(passed).not.toBe(false);
      const payload = JSON.parse(log.mock.calls[0][0]);
      expect(payload).toEqual({ errors: [], warnings: [] });

      log.mockClear();
      const failed = await lintPlugin.handler({
        ...getDependencies(),
        parsed: { json: true, now: "2027-03-01T12:00:00Z", failOn: "deadline_overdue" },
      } as any);
      expect(failed).toBe(false);
      expect(JSON.parse(log.mock.calls[0][0]).errors).toHaveLength(5);
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    [
      { now: "2027-03-01" },
      'Invalid --now: "2027-03-01". Expected a timestamp with a timezone, such as 2027-03-01T09:00:00Z. A date alone has no time or timezone.',
    ],
    [
      { now: "2027-02-30T09:00:00Z" },
      'Invalid --now: "2027-02-30T09:00:00Z". Expected a timestamp with a timezone, such as 2027-01-15T09:00:00Z. Use YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm.',
    ],
    [
      { failOn: ["deadline_overdu"] },
      'Invalid --fail-on: "deadline_overdu" is not a lint warning code. Did you mean "deadline_overdue"?',
    ],
    [
      { failOn: ["invalid_type"] },
      `Invalid --fail-on: "invalid_type" is not a lint warning code. The warning codes are ${LINT_WARNING_CODES.join(", ")}.`,
    ],
  ])("refuses %j", async (parsed, message) => {
    await expect(lintPlugin.handler({ ...getDependencies(), parsed } as any)).rejects.toMatchObject(
      { message, code: "invalid_cli_arguments" },
    );
  });
});

describe("lint warning codes", () => {
  it("lists only codes lint reports", () => {
    const sources = [
      ...fs
        .readdirSync(__dirname)
        .filter((file) => file.endsWith(".ts") && !file.includes(".spec.")),
    ]
      .map((file) => fs.readFileSync(path.join(__dirname, file), "utf8"))
      // Expressions warn from their own package, which sits beside this one
      .concat(fs.readFileSync(path.join(__dirname, "../../../expressions/src/parser.ts"), "utf8"))
      .join("\n")
      .replace(/export const LINT_WARNING_CODES = \[[^\]]*\]/, "");
    for (const code of LINT_WARNING_CODES) {
      expect(`${code}: ${sources.includes(`"${code}"`)}`).toBe(`${code}: true`);
    }
  });
});
