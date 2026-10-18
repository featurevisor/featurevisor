import type { Conditions, DatafileContent } from "@featurevisor/types";

import type { DatafileSetEventDetails } from "./events";

import { createFeaturevisor } from "./instance";
import { createDatafile, createFeature } from "./instance.test-fixtures";

type Kind = "features" | "variables" | "segments";
type Definition = Record<string, unknown>;
const kinds: Kind[] = ["features", "variables", "segments"];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// Deliberately independent of the SDK's dependency extraction and event helpers.
// Rebuild both graphs from complete snapshots on every step.
function oracle(before: DatafileContent, after: DatafileContent) {
  const collection = (data: DatafileContent, kind: Kind) =>
    (data[kind] || {}) as Record<string, Definition>;
  const identity = (kind: Kind, key: string) => `${kind}:${key}`;
  const graph = (data: DatafileContent) => {
    const reverse = new Map<string, Set<string>>();
    const add = (source: string, dependent: string) => {
      if (!reverse.has(source)) reverse.set(source, new Set());
      reverse.get(source)!.add(dependent);
    };
    const visit = (value: unknown, dependent: string): void => {
      if (typeof value === "string") {
        if (/^\s*[{[\"]/.test(value)) visit(JSON.parse(value), dependent);
        else if (value !== "*") add(identity("segments", value), dependent);
      } else if (Array.isArray(value)) {
        value.forEach((child) => visit(child, dependent));
      } else if (value && typeof value === "object") {
        const condition = value as Definition;
        if ("feature" in condition) add(identity("features", String(condition.feature)), dependent);
        else if ("variable" in condition)
          add(identity("variables", String(condition.variable)), dependent);
        else if (!("attribute" in condition))
          for (const key of ["and", "or", "not"])
            if (key in condition) visit(condition[key], dependent);
      }
    };
    for (const kind of kinds)
      for (const [key, entity] of Object.entries(collection(data, kind))) {
        const dependent = identity(kind, key);
        visit(entity.conditions, dependent);
        if (kind === "features") {
          const entries = [
            ...((entity.force || []) as Definition[]),
            ...((entity.traffic || []) as Definition[]),
            ...((entity.variations || []) as Definition[]),
          ];
          for (const entry of entries) {
            visit(entry.conditions, dependent);
            for (const overrides of Object.values(
              (entry.variableOverrides || {}) as Record<string, Definition[]>,
            ))
              for (const override of overrides) visit(override.conditions, dependent);
          }
        } else if (kind === "variables") {
          if (typeof entity.compose === "string")
            add(identity("variables", entity.compose), dependent);
          else if (Array.isArray(entity.compose))
            for (const source of entity.compose as Definition[])
              add(
                identity(
                  "feature" in source ? "features" : "variables",
                  String(source.feature ?? source.variable),
                ),
                dependent,
              );
          for (const override of (entity.overrideProgram || entity.overrides || []) as Definition[])
            visit(override.conditions, dependent);
        }
      }
    return reverse;
  };
  const seeds = new Set<string>();
  for (const kind of kinds) {
    const old = collection(before, kind),
      next = collection(after, kind);
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (
        !old[key] ||
        !next[key] ||
        (kind === "segments"
          ? JSON.stringify(old[key]) !== JSON.stringify(next[key])
          : !old[key].hash || !next[key].hash || old[key].hash !== next[key].hash)
      )
        seeds.add(identity(kind, key));
    }
  }
  const closure = (start: Set<string>, reverse: Map<string, Set<string>>) => {
    const reached = new Set(start);
    for (const source of reached)
      for (const dependent of reverse.get(source) || []) reached.add(dependent);
    return reached;
  };
  const previous = closure(seeds, graph(before));
  // Reached intermediate segments do not carry into the next graph. Otherwise
  // traversal can invent a path that existed in neither accepted snapshot.
  const nextSeeds = new Set([
    ...seeds,
    ...[...previous].filter((key) => !key.startsWith("segments:")),
  ]);
  const affected = closure(nextSeeds, graph(after));
  return {
    features: [...affected]
      .filter((key) => key.startsWith("features:"))
      .map((key) => key.slice(9))
      .sort(),
    variables: [...affected]
      .filter((key) => key.startsWith("variables:"))
      .map((key) => key.slice(10))
      .sort(),
  };
}

describe("incremental datafile notifications", () => {
  it("refreshes cached segment edges before a later segment only update", () => {
    const f = createFeaturevisor({
      logLevel: "fatal",
      datafile: createDatafile({
        schemaVersion: "4",
        segments: {
          s0: { conditions: { attribute: "country", operator: "equals", value: "nl" } },
          s4: { conditions: { attribute: "country", operator: "equals", value: "de" } },
        },
        features: { f3: createFeature({ hash: "fixed", conditions: "s4" }) },
      }),
    });
    const events: DatafileSetEventDetails[] = [];
    f.on("datafile_set", (event) => events.push(event));
    f.setDatafile(
      createDatafile({ schemaVersion: "4", features: { g: createFeature({ hash: "g" }) } }),
    );
    f.setDatafile(createDatafile({ schemaVersion: "4", segments: { s4: { conditions: "s0" } } }));
    expect(events[events.length - 1].features).toEqual(["f3"]);
    f.setDatafile(
      createDatafile({
        schemaVersion: "4",
        segments: {
          s0: { conditions: { attribute: "country", operator: "equals", value: "us" } },
        },
      }),
    );
    expect(events[events.length - 1].features).toEqual(["f3"]);
    void f.close();
  });

  it.each(Array.from({ length: 40 }, (_, seed) => seed + 1))(
    "matches uncached old and new graph traversal for seeded history %s",
    (seed) => {
      let state = seed;
      const random = (max: number) => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state % max;
      };
      const ids = Array.from({ length: 18 }, (_, index) => ({
        kind: kinds[index % 3],
        key: `${kinds[index % 3][0]}${Math.floor(index / 3)}`,
      }));
      const definition = (index: number): Definition => {
        const { kind } = ids[index];
        let conditions: unknown = {
          attribute: "country",
          operator: "equals",
          value: random(2) ? "nl" : "de",
        };
        if (index > 0) {
          const source = ids[random(index)];
          conditions =
            source.kind === "segments"
              ? source.key
              : source.kind === "features"
                ? { feature: source.key }
                : { variable: source.key, operator: "equals", value: true };
          if (random(2)) conditions = { not: [conditions] };
        }
        if (random(2)) conditions = JSON.stringify(conditions);
        const hash = random(4) ? `hash-${random(3)}` : undefined;
        if (kind === "segments") return { conditions };
        if (kind === "features")
          return { ...createFeature({ hash, conditions: conditions as Conditions }) };
        return { hash, type: "boolean", defaultValue: Boolean(random(2)), conditions };
      };
      const initial = createDatafile({ schemaVersion: "4", variables: {} });
      for (let index = 0; index < ids.length; index++) {
        const { kind, key } = ids[index];
        (initial[kind] as Record<string, unknown>)[key] = definition(index);
      }
      let accepted = clone(initial);
      const f = createFeaturevisor({ logLevel: "fatal", datafile: clone(accepted) });
      let received: DatafileSetEventDetails | undefined;
      f.on("datafile_set", (event) => {
        received = event;
      });
      for (let step = 0; step < 40; step++) {
        const replace = random(5) === 0;
        const patch = createDatafile({
          schemaVersion: "4",
          revision: `${seed}-${step}`,
          variables: {},
        });
        for (let index = 0; index < ids.length; index++) {
          if (random(replace ? 3 : 9) !== 0) continue;
          const { kind, key } = ids[index];
          (patch[kind] as Record<string, unknown>)[key] = definition(index);
        }
        const next = clone(patch);
        if (!replace)
          for (const kind of kinds)
            Object.assign(next[kind]!, { ...accepted[kind], ...patch[kind] });
        const expected = oracle(accepted, next);
        received = undefined;
        expect(f.setDatafile(clone(patch), replace)).toBe(true);
        expect(received).toBeDefined();
        expect({
          features: [...received!.features].sort(),
          variables: [...received!.variables].sort(),
        }).toEqual(expected);
        accepted = next;
      }
      void f.close();
    },
  );
});
