import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parsers } from "@featurevisor/parsers";

import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { formatDefinition } from "./formatDefinition";
import { runFormat } from "./run";

// fmt --simplify writes each condition in its simplest form that evaluates the same

const yml = parsers.yml;
const expressions = { namespaceCharacter: "." };

/** A segment's file with these lines under `conditions:` */
const segment = (...lines: string[]) =>
  ["description: Segment", "", "conditions:", ...lines, ""].join("\n");

/** What fmt --simplify writes, which a second run leaves alone */
function simplified(source: string, options: { expressions?: typeof expressions } = {}) {
  const first = formatDefinition("segment", source, yml, undefined, { ...options, simplify: true });
  const again = formatDefinition("segment", first.output, yml, undefined, {
    ...options,
    simplify: true,
  });
  expect(again.changed).toBe(false);
  return first.output;
}

describe("fmt --simplify", () => {
  it("writes a whole value's list of one condition as that condition", () => {
    expect(
      simplified(segment("  - attribute: country", "    operator: equals", "    value: nl")),
    ).toBe(segment("  attribute: country", "  operator: equals", "  value: nl"));
    expect(simplified(segment("  - netherlands"))).toBe(
      "description: Segment\n\nconditions: netherlands\n",
    );
  });

  it("writes a whole value's and group as its list, and a group of one as its condition", () => {
    expect(simplified(segment("  and:", "    - netherlands", "    - payingAccounts"))).toBe(
      segment("  - netherlands", "  - payingAccounts"),
    );
    expect(simplified(segment("  - or:", "      - netherlands", "  - payingAccounts"))).toBe(
      segment("  - netherlands", "  - payingAccounts"),
    );
    // a list of one holding an and group is the group's list
    expect(simplified(segment("  - and:", "      - netherlands", "      - payingAccounts"))).toBe(
      segment("  - netherlands", "  - payingAccounts"),
    );
  });

  it("keeps groups that mean something of their own", () => {
    const or = segment("  or:", "    - netherlands", "    - payingAccounts");
    expect(simplified(or)).toBe(or);
    const not = segment("  not:", "    - netherlands");
    expect(simplified(not)).toBe(not);
  });

  it("joins expressions side by side into one, moving their comments, with expressions on", () => {
    const source = segment(
      "  # Dutch",
      "  - netherlands",
      "  # Paying, or large",
      "  - plan == 'paid' or account.seats >= 50",
    );
    expect(simplified(source, { expressions })).toBe(
      [
        "description: Segment",
        "",
        "conditions: |",
        "  # Dutch",
        "  netherlands",
        "",
        "  # Paying, or large",
        "  and (",
        "    plan == 'paid'",
        "    or account.seats >= 50",
        "  )",
        "",
      ].join("\n"),
    );
    expect(simplified(segment("  - age >= 18"), { expressions })).toBe(
      "description: Segment\n\nconditions: age >= 18\n",
    );
  });

  it("never writes a tree leaf as an expression", () => {
    const source = segment(
      "  - age >= 18",
      "  - attribute: country",
      "    operator: equals",
      "    value: nl",
    );
    expect(simplified(source, { expressions })).toBe(source);
  });

  it("keeps a value marked to keep as written, and leaves everything else alone", () => {
    const kept = segment("  # featurevisor-ignore-line", "  - netherlands");
    const marked =
      "description: Segment\n\nconditions: # featurevisor-ignore-line\n  - netherlands\n";
    expect(simplified(marked)).toBe(marked);
    expect(simplified(kept)).toBe(kept);
    const feature = [
      "description: Checkout",
      "",
      "bucketBy:",
      "  - userId",
      "",
      "rules:",
      "  - key: everyone",
      "    conditions:",
      "      - netherlands",
      "    percentage: 100",
      "",
    ].join("\n");
    expect(
      formatDefinition("feature", feature, yml, undefined, { simplify: true }).output,
    ).toContain(
      "bucketBy:\n  - userId\n\nrules:\n  - key: everyone\n    conditions: netherlands\n",
    );
  });

  it("formats without simplifying unless asked", () => {
    const source = segment("  - netherlands");
    expect(formatDefinition("segment", source, yml).changed).toBe(false);
  });

  it("simplifies by default with simplifyConditions, and --no-simplify turns it off", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-simplify-"));
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      fs.writeFileSync(
        path.join(root, "featurevisor.config.js"),
        "module.exports = { simplifyConditions: true };\n",
      );
      fs.mkdirSync(path.join(root, "segments"));
      fs.writeFileSync(
        path.join(root, "segments/netherlands.yml"),
        segment("  - attribute: country", "    operator: equals", "    value: nl"),
      );
      const projectConfig = getProjectConfig(root);
      const datasource = new Datasource(projectConfig, root);
      const run = (parsed: Record<string, unknown>) =>
        runFormat({
          rootDirectoryPath: root,
          projectConfig,
          datasource,
          parsed: { _: [], ...parsed },
        });

      expect(await run({ check: true, simplify: false })).toBe(0);
      expect(await run({ check: true })).toBe(1);
      // the setting already simplifies, so the rerun hint needs no --simplify
      expect(log.mock.calls.flat().join("\n")).toMatch(/Run: npx featurevisor fmt$/m);
      expect(await run({})).toBe(0);
      expect(fs.readFileSync(path.join(root, "segments/netherlands.yml"), "utf8")).toBe(
        segment("  attribute: country", "  operator: equals", "  value: nl"),
      );
    } finally {
      log.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
