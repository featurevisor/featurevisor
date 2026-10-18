import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createFeaturevisor } from "@featurevisor/sdk";
import { getProjectConfig } from "../config";
import { Datasource } from "../datasource";
import { buildTargetDatafile } from "./buildProject";

describe("global mutation precomputation across project layouts and Targets", () => {
  test.each(
    ["environments", "sets", "neither"].flatMap((layout) =>
      [false, true].flatMap((stringify) =>
        [false, true].map((specialized) => ({ layout, stringify, specialized })),
      ),
    ),
  )(
    "$layout stringify=$stringify specialized=$specialized",
    async ({ layout, stringify, specialized }) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "featurevisor-precomputation-"));
      const write = (file: string, value: unknown) => {
        const destination = path.join(root, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, JSON.stringify(value));
      };
      const environment = layout === "environments" ? "production" : false;
      const prefix = layout === "sets" ? "sets/production/" : "";
      const scoped = (entries: unknown[]) => (environment ? { production: entries } : entries);
      try {
        fs.writeFileSync(
          path.join(root, "featurevisor.config.js"),
          `module.exports = ${JSON.stringify({
            parser: "json",
            stringify,
            sets: layout === "sets",
            ...(environment ? { environments: [environment] } : {}),
          })};`,
        );
        write(`${prefix}attributes/country.json`, { type: "string" });
        write(`${prefix}attributes/city.json`, { type: "string" });
        write(`${prefix}attributes/eligible.json`, { type: "boolean" });
        write(`${prefix}segments/dutch.json`, {
          conditions: [{ attribute: "country", operator: "equals", value: "nl" }],
        });
        write(`${prefix}segments/eligible.json`, {
          conditions: [{ attribute: "eligible", operator: "equals", value: true }],
        });
        write(`${prefix}features/gate.json`, {
          description: "Dependency",
          bucketBy: "userId",
          rules: scoped([{ key: "eligible", conditions: ["eligible"], percentage: 100 }]),
        });
        write(`${prefix}variables/permission.json`, { type: "boolean", defaultValue: true });
        write(`${prefix}variables/unrelated.json`, { type: "boolean", defaultValue: true });
        write(`${prefix}variables/policy.json`, {
          description: "Target selected policy",
          type: "object",
          defaultValue: { trace: [] },
          overrides: scoped([
            {
              key: "dutch",
              conditions: ["dutch"],
              mutate: { "trace:append": "parent" },
              overrides: [
                {
                  key: "city",
                  conditions: [
                    { attribute: "city", operator: "equals", value: "amsterdam" },
                    { feature: "gate" },
                    { variable: "permission", operator: "equals", value: true },
                  ],

                  mutate: { "trace:append": "child" },
                },
              ],
            },
            { key: "fallback", conditions: "*", value: { trace: ["fallback"] } },
          ]),
        });
        const input = fs.readFileSync(path.join(root, `${prefix}variables/policy.json`), "utf8");
        for (const precomputeMutations of [true, false]) {
          const config = { ...getProjectConfig(root), precomputeMutations };
          const datasource = new Datasource(
            config,
            root,
            layout === "sets" ? "production" : undefined,
          );
          const datafile = await buildTargetDatafile({
            projectConfig: datasource.getConfig(),
            datasource,
            target: {
              description: "Policy only",
              includeVariables: ["policy"],
              includeFeatures: ["unrelated"],
              ...(specialized ? { context: { country: "nl" } } : {}),
            },
            environment,
            existingState: { features: {} },
            revision: "parity",
          });
          expect(Object.keys(datafile.variables!).sort()).toEqual(["permission", "policy"]);
          expect(Object.keys(datafile.features)).toEqual(["gate"]);
          expect(datafile.segments.eligible).toBeDefined();
          expect(Boolean(datafile.variables!.policy.overrideProgram)).toBe(!precomputeMutations);
          const f = createFeaturevisor({ datafile, logLevel: "fatal" });
          try {
            const fixed = specialized ? {} : { country: "nl" };
            expect(
              f.getVariable("policy", { ...fixed, city: "amsterdam", eligible: true }),
            ).toEqual({ trace: ["parent", "child"] });
            expect(
              f.getVariable("policy", { ...fixed, city: "amsterdam", eligible: false }),
            ).toEqual({ trace: ["parent"] });
            expect(
              f.getVariable("policy", { ...fixed, city: "rotterdam", eligible: true }),
            ).toEqual({ trace: ["parent"] });
            if (!specialized)
              expect(
                f.getVariable("policy", { country: "us", city: "amsterdam", eligible: true }),
              ).toEqual({ trace: ["fallback"] });
            const child = f.spawn(
              { ...fixed, city: "amsterdam", eligible: true },
              { stickyVariables: { permission: false } },
            );
            expect(child.getVariable("policy")).toEqual({ trace: ["parent"] });
            child.close();
            expect(
              f.getVariable("policy", { ...fixed, city: "amsterdam", eligible: true }),
            ).toEqual({ trace: ["parent", "child"] });
          } finally {
            f.close();
          }
        }
        expect(fs.readFileSync(path.join(root, `${prefix}variables/policy.json`), "utf8")).toBe(
          input,
        );
        expect(fs.existsSync(path.join(root, ".featurevisor"))).toBe(false);
        expect(fs.existsSync(path.join(root, "datafiles"))).toBe(false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
