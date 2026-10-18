import type { Conditions, DatafileContent, GroupSegment } from "@featurevisor/types";
import { createFeaturevisor, type Featurevisor } from "./instance";
import type { FeaturevisorDiagnostic } from "./diagnostics";
import type { DatafileSetEventDetails } from "./events";
import { createDatafile, createFeature } from "./instance.test-fixtures";

const malformed = ['{"not":[', '[{"feature":', '"unterminated', ' \n {"or": [oops] }'];
const country: Conditions = { attribute: "country", operator: "equals", value: "nl" };
const context = { country: "nl", userId: "regression" };

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function base(schemaVersion = "4"): DatafileContent {
  return createDatafile({
    schemaVersion,
    features: { healthy: createFeature({ hash: "healthy" }) },
    variables: { healthyValue: { type: "string", defaultValue: "healthy", hash: "healthy" } },
  });
}

function capture() {
  const diagnostics: FeaturevisorDiagnostic[] = [];
  const f = createFeaturevisor({
    logLevel: "error",
    onDiagnostic: (item) => diagnostics.push(item),
  });
  return {
    f,
    diagnostics,
    parseErrors: () => diagnostics.filter((item) => item.code === "conditions_parse_error"),
  };
}

const placements = [
  "feature root",
  "global root",
  "rule",
  "force",
  "rule variable override",
  "variation variable override",
  "indexed rule variable override",
  "indexed variation variable override",
  "global override",
  "nested override program",
  "segment",
  "legacy segments",
] as const;
type Placement = (typeof placements)[number];

function fixture(placement: Placement, conditions: Conditions) {
  const datafile = base(placement === "legacy segments" ? "2" : "4");
  const feature = createFeature({
    hash: "subject",
    variablesSchema: { copy: { type: "string", defaultValue: "fallback" } },
  });
  let entityType = "feature";
  let entityKey = "subject";
  let read: (f: Featurevisor) => unknown = (f) => f.getVariable("subject", "copy", context);
  let expected: unknown = "fallback";
  if (placement === "feature root") {
    feature.conditions = conditions;
    read = (f) => f.evaluateFlag("subject", context);
    expected = expect.objectContaining({ enabled: false, reason: "conditions_unmet" });
  } else if (placement === "global root") {
    datafile.variables!.subject = {
      type: "string",
      defaultValue: "selected",
      disabledValue: "disabled",
      conditions,
      hash: "subject",
    };
    entityType = "variable";
    read = (f) => f.evaluateVariable("subject", context);
    expected = expect.objectContaining({ variableValue: "disabled", reason: "conditions_unmet" });
  } else if (placement === "rule" || placement === "legacy segments") {
    feature.traffic = [
      {
        key: "selected/rule",
        ...(placement === "legacy segments"
          ? { segments: conditions as GroupSegment }
          : { conditions }),
        percentage: 100000,
        variables: { copy: "selected" },
      },
      { key: "fallback", conditions: "*", percentage: 100000, variables: { copy: "fallback" } },
    ];
  } else if (placement === "force") {
    feature.force = [{ conditions, enabled: true, variables: { copy: "selected" } }];
  } else if (placement.includes("variable override")) {
    const indexed = placement.startsWith("indexed");
    const override = { ...(indexed ? {} : { key: "override/key" }), conditions, value: "selected" };
    const variableOverrides = { copy: [override] };
    if (placement.includes("variation")) {
      feature.variations = [
        { value: "treatment", variables: { copy: "fallback" }, variableOverrides },
      ];
      feature.traffic[0].allocation = [{ variation: "treatment", range: [0, 100000] }];
    } else {
      feature.traffic[0].variableOverrides = variableOverrides;
    }
  } else if (placement === "global override" || placement === "nested override program") {
    entityType = "variable";
    datafile.variables!.subject = { type: "string", defaultValue: "fallback", hash: "subject" };
    read = (f) => f.getVariable("subject", context);
    if (placement === "global override") {
      datafile.variables!.subject.overrides = [
        { key: "selected/key", conditions, value: "selected" },
      ];
    } else {
      datafile.variables!.subject.overrideProgram = [
        {
          key: "parent",
          keyPath: ["parent"],
          conditions: "*",
          operations: [],
          onMatch: 1,
          onMiss: 3,
        },
        {
          key: "parent/child",
          keyPath: ["parent", "child/key"],
          conditions,
          operations: [{ op: "set", path: [], value: "selected" }],
          onMatch: 3,
          onMiss: 2,
        },
        {
          key: "sibling",
          conditions: "*",
          operations: [{ op: "set", path: [], value: "fallback" }],
          onMatch: 3,
          onMiss: 3,
        },
      ];
    }
  } else if (placement === "segment") {
    entityType = "segment";
    entityKey = "broken";
    datafile.segments.broken = { conditions };
    feature.conditions = "broken";
    read = (f) => f.evaluateFlag("subject", context);
    expected = expect.objectContaining({ enabled: false, reason: "conditions_unmet" });
  }
  if (entityType !== "variable") datafile.features.subject = feature;
  return { datafile, entityType, entityKey, read, expected };
}

describe.each(["2", "4"])("malformed schema %s selectors", (schemaVersion) => {
  describe.each(placements)("malformed selectors in %s", (placement) => {
    it.each(malformed)("accepts the datafile and isolates %j once per entity load", (raw) => {
      const { datafile, entityType, entityKey, read, expected } = fixture(placement, raw);
      datafile.schemaVersion = schemaVersion;
      const before = JSON.stringify(datafile);
      freeze(datafile);
      const { f, diagnostics, parseErrors } = capture();
      expect(f.setDatafile(datafile, true)).toBe(true);
      expect(parseErrors()).toHaveLength(schemaVersion === "2" ? 1 : 0);
      expect(f.isEnabled("healthy", context)).toBe(true);
      expect(f.getVariable("healthyValue")).toBe("healthy");
      expect(parseErrors()).toHaveLength(schemaVersion === "2" ? 1 : 0);
      for (let index = 0; index < 3; index++) expect(read(f)).toEqual(expected);
      expect(parseErrors()).toHaveLength(1);
      expect(parseErrors()[0]).toMatchObject({
        level: "error",
        code: "conditions_parse_error",
        originalError: expect.any(SyntaxError),
        details: { conditions: raw, entityType, entityKey },
      });
      expect(parseErrors()[0].details).toEqual({ conditions: raw, entityType, entityKey });
      expect(diagnostics.some((item) => item.code === "invalid_datafile")).toBe(false);
      expect(f.isEnabled("healthy", context)).toBe(true);
      expect(f.getVariable("healthyValue")).toBe("healthy");
      expect(f.setDatafile(datafile, true)).toBe(true);
      expect(parseErrors()).toHaveLength(schemaVersion === "2" ? 2 : 1);
      expect(read(f)).toEqual(expected);
      expect(parseErrors()).toHaveLength(2);
      expect(parseErrors()[1].details).toEqual(parseErrors()[0].details);
      expect(JSON.stringify(datafile)).toBe(before);
    });
  });
});

describe("normalization hardening", () => {
  it.each(["feature", "segment", "variable"] as const)(
    "stores eager v3 definitions before a %s parse diagnostic handler reads them",
    (kind) => {
      const { datafile, read, expected } = fixture(
        kind === "feature" ? "feature root" : kind === "segment" ? "segment" : "global root",
        malformed[0],
      );
      datafile.schemaVersion = "2";
      datafile.revision = "accepted-v3";
      const observations: unknown[] = [];
      const diagnostics: FeaturevisorDiagnostic[] = [];
      const f = createFeaturevisor({
        logLevel: "error",
        onDiagnostic(diagnostic) {
          if (diagnostic.code !== "conditions_parse_error") return;
          diagnostics.push(diagnostic);
          observations.push([f.getRevision(), read(f)]);
        },
      });
      expect(f.setDatafile(freeze(datafile), true)).toBe(true);
      expect(diagnostics).toHaveLength(1);
      expect(observations).toEqual([["accepted-v3", expected]]);
      expect(read(f)).toEqual(expected);
      expect(diagnostics).toHaveLength(1);
      expect(f.getSchemaVersion()).toBe("2");
    },
  );

  it("parses every v3 entity during loading and never repeats parse diagnostics on reads", () => {
    const d = base("2");
    d.features.subject = createFeature({ conditions: malformed[0] });
    d.segments.broken = { conditions: malformed[1] };
    d.variables!.subject = { type: "string", defaultValue: "selected", conditions: malformed[2] };
    const { f, parseErrors } = capture();
    expect(f.setDatafile(freeze(d), true)).toBe(true);
    expect(
      parseErrors()
        .map(({ details }) => details.entityType)
        .sort(),
    ).toEqual(["feature", "segment", "variable"]);
    for (let i = 0; i < 2; i++) {
      f.getFeature("subject");
      f.getSegment("broken");
      f.getVariable("subject");
    }
    expect(parseErrors()).toHaveLength(3);
    expect(f.setDatafile(base("4"))).toBe(true);
    expect(parseErrors()).toHaveLength(3);
    expect(f.setDatafile(freeze(d))).toBe(true);
    expect(parseErrors()).toHaveLength(6);
  });
  it.each([false, true])(
    "keeps malformed roots gated with disabledValue supplied=%s",
    (supplied) => {
      const d = base();
      d.features.subject = createFeature({ conditions: malformed[0] });
      d.variables!.subject = {
        type: "string",
        defaultValue: "enabled",
        conditions: malformed[0],
        ...(supplied ? { disabledValue: "disabled" } : {}),
      };
      const { f, parseErrors } = capture();
      expect(f.setDatafile(JSON.stringify(d))).toBe(true);
      expect(f.evaluateFlag("subject")).toMatchObject({
        reason: "conditions_unmet",
        enabled: false,
      });
      expect(f.evaluateVariable("subject")).toMatchObject({
        reason: "conditions_unmet",
        variableValue: supplied ? "disabled" : undefined,
      });
      expect(f.getVariable("subject")).toBe(supplied ? "disabled" : null);
      expect(parseErrors().map((item) => item.details.entityType)).toEqual(["feature", "variable"]);
    },
  );

  it.each<[Conditions]>([
    [{ not: ["broken"] }],
    [{ not: [{ not: ["broken"] }] }],
    [{ or: ["broken", { attribute: "country", operator: "equals", value: "nl" }] }],
    [{ not: ["alias"] }],
    [{ and: ["alias", { not: ["broken"] }] }],
  ])("fails the entire selector closed through malformed segments under %j", (conditions) => {
    const d = base();
    d.segments.broken = { conditions: malformed[0] };
    d.segments.alias = { conditions: { not: ["broken"] } };
    d.features.subject = createFeature({ conditions });
    d.variables!.subject = { type: "string", defaultValue: "selected", conditions };
    const { f, parseErrors } = capture();
    expect(f.setDatafile(d)).toBe(true);
    for (let index = 0; index < 2; index++) {
      expect(f.evaluateFlag("subject", context)).toMatchObject({
        reason: "conditions_unmet",
        enabled: false,
      });
      expect(f.evaluateVariable("subject", context)).toMatchObject({
        reason: "conditions_unmet",
        variableValue: undefined,
      });
      expect(f.getVariable("subject", context)).toBeNull();
    }
    expect(parseErrors()).toHaveLength(1);
    expect(parseErrors()[0].details.entityKey).toBe("broken");
  });

  it("does not read a malformed segment in a short circuited OR branch", () => {
    const d = base();
    d.segments.broken = { conditions: malformed[0] };
    d.features.subject = createFeature({ conditions: { or: [country, "broken"] } });
    const { f, parseErrors } = capture();
    expect(f.setDatafile(d)).toBe(true);
    expect(f.isEnabled("subject", context)).toBe(true);
    expect(parseErrors()).toEqual([]);
    expect(f.isEnabled("subject", { country: "de" })).toBe(false);
    expect(parseErrors()).toHaveLength(1);
  });

  it("reports every selector independently within one feature instead of deduplicating raw strings", () => {
    const raw = malformed[0];
    const d = base();
    d.features.subject = createFeature({
      conditions: raw,
      force: [
        { conditions: raw, enabled: true },
        { conditions: raw, enabled: false },
      ],
      traffic: [
        {
          key: "rule",
          conditions: raw,
          percentage: 100000,
          variableOverrides: { copy: [{ key: "copy", conditions: raw, value: "copy" }] },
        },
      ],
      variations: [
        { value: "treatment", variableOverrides: { copy: [{ conditions: raw, value: "copy" }] } },
      ],
    });
    const { f, parseErrors } = capture();
    expect(f.setDatafile(d)).toBe(true);
    const first = f.getFeature("subject");
    expect(f.getFeature("subject")).toBe(first);
    expect(parseErrors()).toHaveLength(6);
    expect(parseErrors().every((item) => !("location" in item.details))).toBe(true);
    expect(
      parseErrors().every(
        (item) => item.details.conditions === raw && item.details.entityKey === "subject",
      ),
    ).toBe(true);
  });

  it.each(["feature", "segment", "variable"] as const)(
    "caches a malformed %s before a diagnostic handler reenters its getter",
    (kind) => {
      const d = fixture(
        kind === "feature" ? "feature root" : kind === "segment" ? "segment" : "global root",
        malformed[0],
      ).datafile;
      const diagnostics: FeaturevisorDiagnostic[] = [];
      const reentered: unknown[] = [];
      let f: Featurevisor;
      const read = () =>
        kind === "feature"
          ? f.getFeature("subject")
          : kind === "segment"
            ? f.getSegment("broken")
            : f.getVariable("subject");
      f = createFeaturevisor({
        logLevel: "error",
        onDiagnostic(item) {
          if (item.code !== "conditions_parse_error") return;
          diagnostics.push(item);
          if (diagnostics.length < 4) reentered.push(read());
        },
      });
      expect(f.setDatafile(d)).toBe(true);
      const value = read();
      expect(diagnostics).toHaveLength(1);
      expect(reentered).toHaveLength(1);
      expect(reentered[0]).toBe(value);
      expect(read()).toBe(value);
    },
  );

  it.each([
    "{invalid",
    "null",
    "[]",
    "{}",
    '"not a datafile"',
    JSON.stringify({ schemaVersion: 4, revision: "bad", segments: {}, features: {} }),
    JSON.stringify({ schemaVersion: "4", revision: 4, segments: {}, features: {} }),
    JSON.stringify({ schemaVersion: "4", revision: "bad", segments: null, features: {} }),
    JSON.stringify({ schemaVersion: "4", revision: "bad", segments: {}, features: null }),
    JSON.stringify({ schemaVersion: "4", revision: "bad", segments: {} }),
  ])("rejects invalid top level JSON/shape %j without discarding the previous cache", (input) => {
    const { f, diagnostics } = capture();
    expect(f.setDatafile(base(), true)).toBe(true);
    const healthy = f.getFeature("healthy");
    const events = jest.fn();
    f.on("datafile_set", events);
    expect(f.setDatafile(input, true)).toBe(false);
    expect(events).not.toHaveBeenCalled();
    expect(f.getRevision()).toBe("revision-1");
    expect(f.getFeature("healthy")).toBe(healthy);
    expect(f.isEnabled("healthy")).toBe(true);
    expect(diagnostics.filter((item) => item.code === "invalid_datafile")).toHaveLength(1);
  });

  it.each(["feature root", "global root", "segment"] as const)(
    "retains untouched %s cache entries and invalidates only replacements",
    (placement) => {
      const { datafile, entityKey, read, expected } = fixture(placement, malformed[0]);
      const { f, parseErrors } = capture();
      expect(f.setDatafile(datafile, true)).toBe(true);
      expect(read(f)).toEqual(expected);
      const cached =
        placement === "feature root"
          ? f.getFeature("subject")
          : placement === "segment"
            ? f.getSegment(entityKey)
            : undefined;
      const patch = createDatafile({
        schemaVersion: "4",
        revision: "unrelated",
        variables: { unrelated: { type: "integer", defaultValue: 7 } },
      });
      freeze(patch);
      expect(f.setDatafile(patch)).toBe(true);
      expect(read(f)).toEqual(expected);
      expect(parseErrors()).toHaveLength(1);
      if (placement === "feature root") expect(f.getFeature("subject")).toBe(cached);
      if (placement === "segment") expect(f.getSegment(entityKey)).toBe(cached);
      const replacement = createDatafile({ schemaVersion: "4", revision: "changed" });
      if (placement === "feature root")
        replacement.features.subject = createFeature({ conditions: malformed[1] });
      else if (placement === "segment")
        replacement.segments[entityKey] = { conditions: malformed[1] };
      else
        replacement.variables = {
          subject: {
            type: "string",
            defaultValue: "selected",
            disabledValue: "disabled",
            conditions: malformed[1],
          },
        };
      freeze(replacement);
      expect(f.setDatafile(replacement)).toBe(true);
      expect(parseErrors()).toHaveLength(1);
      expect(read(f)).toEqual(expected);
      expect(parseErrors()).toHaveLength(2);
      expect(parseErrors()[1].details.conditions).toBe(malformed[1]);
      if (placement === "feature root") expect(f.getFeature("subject")).not.toBe(cached);
      if (placement === "segment") expect(f.getSegment(entityKey)).not.toBe(cached);
      const repaired = createDatafile({ schemaVersion: "4", revision: "repaired" });
      if (placement === "feature root")
        repaired.features.subject = createFeature({ conditions: "*" });
      else if (placement === "segment") repaired.segments[entityKey] = { conditions: "*" };
      else
        repaired.variables = {
          subject: { type: "string", defaultValue: "repaired", conditions: "*" },
        };
      expect(f.setDatafile(freeze(repaired))).toBe(true);
      if (placement === "global root") expect(f.getVariable("subject")).toBe("repaired");
      else expect(f.isEnabled("subject")).toBe(true);
      expect(parseErrors()).toHaveLength(2);
    },
  );

  it("normalizes only the first read of each entity, not construction or key enumeration", () => {
    const d = base();
    d.features.subject = createFeature({ conditions: malformed[0] });
    d.segments.broken = { conditions: malformed[1] };
    d.variables!.subject = { type: "string", defaultValue: "selected", conditions: malformed[2] };
    const diagnostics: FeaturevisorDiagnostic[] = [];
    const f = createFeaturevisor({
      datafile: freeze(d),
      logLevel: "error",
      onDiagnostic: (item) => diagnostics.push(item),
    });
    expect(f.getFeatureKeys()).toEqual(["healthy", "subject"]);
    expect(f.getVariableKeys()).toEqual(["healthyValue", "subject"]);
    expect(diagnostics).toEqual([]);
    f.getFeature("subject");
    expect(diagnostics).toHaveLength(1);
    f.getSegment("broken");
    expect(diagnostics).toHaveLength(2);
    f.getVariable("subject");
    expect(diagnostics).toHaveLength(3);
    f.getFeature("subject");
    f.getSegment("broken");
    f.getVariable("subject");
    expect(diagnostics).toHaveLength(3);
  });

  it("parses successful selectors lazily once and preserves normalized identities until replacement", () => {
    const featureSelector = JSON.stringify({ attribute: "feature", operator: "exists" });
    const segmentSelector = JSON.stringify({ attribute: "segment", operator: "exists" });
    const variableSelector = JSON.stringify({ attribute: "variable", operator: "exists" });
    const d = base();
    d.features.subject = createFeature({ conditions: featureSelector });
    d.segments.subject = { conditions: segmentSelector };
    d.variables!.subject = {
      type: "string",
      defaultValue: "selected",
      conditions: variableSelector,
    };
    const parse = jest.spyOn(JSON, "parse");
    const { f } = capture();
    expect(f.setDatafile(freeze(d), true)).toBe(true);
    f.getFeatureKeys();
    f.getVariableKeys();
    const count = (raw: string) => parse.mock.calls.filter(([input]) => input === raw).length;
    for (const raw of [featureSelector, segmentSelector, variableSelector])
      expect(count(raw)).toBe(0);
    const feature = f.getFeature("subject");
    const segment = f.getSegment("subject");
    const variable = f.evaluateVariable("subject", { variable: true }).variable;
    expect(f.getFeature("subject")).toBe(feature);
    expect(f.getSegment("subject")).toBe(segment);
    expect(f.evaluateVariable("subject", { variable: true }).variable).toBe(variable);
    for (const raw of [featureSelector, segmentSelector, variableSelector])
      expect(count(raw)).toBe(1);
    expect(feature).not.toBe(d.features.subject);
    expect(segment).not.toBe(d.segments.subject);
    expect(variable).not.toBe(d.variables!.subject);
    expect(f.setDatafile(createDatafile({ schemaVersion: "4", revision: "unrelated" }))).toBe(true);
    const afterUpdate = [featureSelector, segmentSelector, variableSelector].map(count);
    expect(f.getFeature("subject")).toBe(feature);
    expect(f.getSegment("subject")).toBe(segment);
    expect(f.evaluateVariable("subject", { variable: true }).variable).toBe(variable);
    expect([featureSelector, segmentSelector, variableSelector].map(count)).toEqual(afterUpdate);
  });

  it("keeps identical malformed strings separate across entity kinds and keys", () => {
    const d = base();
    d.features.first = createFeature({ conditions: malformed[0] });
    d.features.second = createFeature({ conditions: malformed[0] });
    d.segments.first = { conditions: malformed[0] };
    d.variables!.first = { type: "string", defaultValue: "selected", conditions: malformed[0] };
    const { f, parseErrors } = capture();
    expect(f.setDatafile(freeze(d), true)).toBe(true);
    for (let index = 0; index < 2; index++) {
      f.getFeature("first");
      f.getFeature("second");
      f.getSegment("first");
      f.getVariable("first");
    }
    expect(parseErrors().map(({ details }) => [details.entityType, details.entityKey])).toEqual([
      ["feature", "first"],
      ["feature", "second"],
      ["segment", "first"],
      ["variable", "first"],
    ]);
  });

  it("reports both malformed mixed selector fields without a NOT legacy gate matching", () => {
    const d = base("2");
    d.features.subject = createFeature({
      traffic: [
        {
          key: "mixed",
          conditions: malformed[0],
          segments: malformed[1],
          ...{ requiredFeatures: [{ not: ["missing"] }] },
          percentage: 100000,
          variables: { copy: "selected" },
        },
        { key: "fallback", conditions: "*", percentage: 100000, variables: { copy: "fallback" } },
      ],
      variablesSchema: { copy: { type: "string", defaultValue: "default" } },
    });
    const { f, parseErrors } = capture();
    expect(f.setDatafile(freeze(d), true)).toBe(true);
    expect(f.getVariable("subject", "copy")).toBe("fallback");
    expect(f.getVariable("subject", "copy")).toBe("fallback");
    expect(parseErrors().map(({ details }) => details)).toEqual([
      { conditions: malformed[0], entityType: "feature", entityKey: "subject" },
      { conditions: malformed[1], entityType: "feature", entityKey: "subject" },
    ]);
  });

  it.each([
    "rule variable override",
    "variation variable override",
    "global override",
    "nested override program",
  ] as const)("keeps later valid sibling selectors working after a malformed %s", (placement) => {
    const { datafile, read } = fixture(placement, malformed[0]);
    const sibling = { key: "sibling", conditions: "*", value: "recovered" };
    if (placement === "rule variable override")
      datafile.features.subject.traffic[0].variableOverrides!.copy.push(sibling);
    else if (placement === "variation variable override")
      datafile.features.subject.variations![0].variableOverrides!.copy.push(sibling);
    else if (placement === "global override") datafile.variables!.subject.overrides!.push(sibling);
    else
      datafile.variables!.subject.overrideProgram![2].operations = [
        { op: "set", path: [], value: "recovered" },
      ];
    const { f, parseErrors } = capture();
    expect(f.setDatafile(freeze(datafile))).toBe(true);
    expect(read(f)).toBe("recovered");
    expect(parseErrors()).toHaveLength(1);
  });

  describe.each(["2", "4"])("per entity schema provenance starting at %s", (initialVersion) => {
    it.each([false, true])(
      "retains old semantics through opposite schema partial updates with warm=%s",
      (warm) => {
        const otherVersion = initialVersion === "2" ? "4" : "2";
        const definitions = (prefix: string, schemaVersion: string) =>
          createDatafile({
            schemaVersion,
            revision: prefix,
            segments: { [prefix]: { conditions: "[]" } },
            features: {
              [prefix]: createFeature({ force: [{ conditions: "[]", enabled: false }] }),
            },
            variables: {
              [prefix]: {
                type: "string",
                defaultValue: "fallback",
                overrides: [{ key: "empty", conditions: "[]", value: "legacy" }],
              },
            },
          });
        const first = freeze(definitions("first", initialVersion));
        const second = freeze(definitions("second", otherVersion));
        const { f } = capture();
        expect(f.setDatafile(first, true)).toBe(true);
        const check = (key: string, version: string) => {
          expect(f.getSegment(key)!.conditions).toEqual(version === "2" ? "*" : []);
          expect(f.isEnabled(key)).toBe(version !== "2");
          expect(f.getVariable(key)).toBe(version === "2" ? "legacy" : "fallback");
        };
        if (warm) check("first", initialVersion);
        expect(f.setDatafile(second)).toBe(true);
        check("first", initialVersion);
        check("second", otherVersion);
        expect(f.setDatafile(freeze(definitions("third", initialVersion)))).toBe(true);
        check("first", initialVersion);
        check("second", otherVersion);
        check("third", initialVersion);
        expect(f.setDatafile(freeze(definitions("first", otherVersion)))).toBe(true);
        check("first", otherVersion);
        check("second", otherVersion);
        expect(f.setDatafile(definitions("replacement", otherVersion), true)).toBe(true);
        expect(f.getFeature("first")).toBeUndefined();
        expect(f.getSegment("second")).toBeUndefined();
        check("replacement", otherVersion);
      },
    );
  });

  it.each(["and", "or", "not"] as const)(
    "combines mixed legacy fields using AND without mutating %s groups",
    (group) => {
      const conditions: Conditions =
        group === "and"
          ? { and: [country] }
          : group === "or"
            ? { or: [country] }
            : { not: [country] };
      const d = base("2");
      d.features.source = createFeature();
      d.segments.audience = { conditions: "*" };
      d.features.subject = createFeature({
        conditions,
        ...{ segments: "audience" },
        requiredFeatures: ["source"],
      });
      d.variables!.subject = {
        type: "string",
        defaultValue: "fallback",
        overrides: [
          {
            key: "mixed",
            value: "selected",
            conditions,
            segments: "audience",
            requiredFeatures: ["source"],
          },
        ],
      };
      const before = JSON.stringify(d);
      const { f } = capture();
      expect(f.setDatafile(freeze(d))).toBe(true);
      const matching = { country: group === "not" ? "de" : "nl" };
      expect(f.isEnabled("subject", matching)).toBe(true);
      expect(f.getVariable("subject", matching)).toBe("selected");
      f.setStickyFeatures({ source: { enabled: false } });
      expect(f.isEnabled("subject", matching)).toBe(false);
      expect(f.getVariable("subject", matching)).toBe("fallback");
      expect(JSON.stringify(d)).toBe(before);
    },
  );
});

describe("stored segment equality and cold dependencies", () => {
  it.each([false, true])(
    "indexes converted v3 selectors across mixed version updates, warm=%s",
    (warm) => {
      const d = base("2");
      d.features.gate = createFeature({ hash: "gate" });
      d.features.dependent = createFeature({ hash: "dependent", requiredFeatures: ["gate"] });
      d.features.segmented = createFeature({
        hash: "segmented",
        traffic: [{ key: "all", segments: '["audience"]', percentage: 100000 }],
      });
      d.segments.audience = { conditions: "*" };
      d.variables!.dependent = {
        hash: "dependent",
        type: "string",
        defaultValue: "on",
        requiredFeatures: ["gate"],
      };
      d.variables!.segmented = {
        hash: "segmented",
        type: "string",
        defaultValue: "off",
        overrides: [{ key: "match", segments: '["audience"]', value: "on" }],
      };
      const { f } = capture();
      expect(f.setDatafile(freeze(d), true)).toBe(true);
      if (warm) {
        expect(f.isEnabled("dependent")).toBe(true);
        expect(f.getVariable("segmented")).toBe("on");
      }
      const events: DatafileSetEventDetails[] = [];
      f.on("datafile_set", (details) => events.push(details));
      expect(
        f.setDatafile(
          createDatafile({
            schemaVersion: "4",
            features: { gate: createFeature({ hash: "off", traffic: [] }) },
          }),
        ),
      ).toBe(true);
      expect(events[0].features).toContain("dependent");
      expect(events[0].variables).toContain("dependent");
      expect(f.isEnabled("dependent")).toBe(false);
      expect(f.getVariable("dependent")).toBeNull();
      expect(
        f.setDatafile(
          createDatafile({
            schemaVersion: "4",
            segments: { audience: { conditions: { attribute: "missing", operator: "exists" } } },
          }),
        ),
      ).toBe(true);
      expect(events[1].features).toContain("segmented");
      expect(events[1].variables).toContain("segmented");
      expect(f.isEnabled("segmented")).toBe(false);
      expect(f.getVariable("segmented")).toBe("off");
    },
  );
  function dependencyFile(conditions: Conditions, schemaVersion = "4") {
    const d = base(schemaVersion);
    d.segments.audience = { conditions };
    d.segments.nested = { conditions: "audience" };
    d.features.subject = createFeature({ hash: "stable", conditions: "nested" });
    d.variables!.subject = {
      hash: "stable",
      type: "string",
      defaultValue: "selected",
      conditions: "nested",
    };
    d.variables!.alias = { hash: "stable", type: "string", compose: "subject" };
    return d;
  }

  it.each([false, true])(
    "announces raw encoding changes even when segment results are equivalent with warm=%s",
    (warm) => {
      const { f } = capture();
      expect(f.setDatafile(freeze(dependencyFile(JSON.stringify(country))), true)).toBe(true);
      if (warm) expect(f.isEnabled("subject", context)).toBe(true);
      const events: DatafileSetEventDetails[] = [];
      f.on("datafile_set", (details) => events.push(details));
      expect(
        f.setDatafile(
          freeze(
            createDatafile({
              schemaVersion: "4",
              revision: "equivalent",
              segments: { audience: { conditions: country } },
            }),
          ),
        ),
      ).toBe(true);
      expect(events).toEqual([
        {
          revision: "equivalent",
          previousRevision: "revision-1",
          revisionChanged: true,
          features: ["subject"],
          variables: ["subject", "alias"],
          replaced: false,
        },
      ]);
      expect(f.isEnabled("subject", context)).toBe(true);
      expect(f.getVariable("alias", context)).toBe("selected");
    },
  );

  it.each([
    { previous: "[]", next: "*", changed: false },
    { previous: '{"and":[]}', next: "*", changed: false },
    { previous: "[]", next: "[]", changed: true },
    { previous: '{"and":[]}', next: '{"and":[]}', changed: true },
  ])(
    "compares stored v3 normalized segments with incoming v4 segments: %j",
    ({ previous, next, changed }) => {
      const { f } = capture();
      expect(f.setDatafile(freeze(dependencyFile(previous, "2")), true)).toBe(true);
      const events: DatafileSetEventDetails[] = [];
      f.on("datafile_set", (details) => events.push(details));
      expect(
        f.setDatafile(
          freeze(
            createDatafile({
              schemaVersion: "4",
              revision: "v4",
              segments: { audience: { conditions: next } },
            }),
          ),
        ),
      ).toBe(true);
      expect(events[0].features).toEqual(changed ? ["subject"] : []);
      expect(events[0].variables).toEqual(changed ? ["subject", "alias"] : []);
      expect(f.isEnabled("subject")).toBe(!changed);
      expect(f.getVariable("alias")).toBe(changed ? null : "selected");
    },
  );

  it.each([false, true])(
    "propagates changed or removed segments through stable hashes on replace=%s",
    (replace) => {
      const { f } = capture();
      const d = freeze(dependencyFile(JSON.stringify(country)));
      expect(f.setDatafile(d, true)).toBe(true);
      const events: DatafileSetEventDetails[] = [];
      f.on("datafile_set", (details) => events.push(details));
      const patch = replace
        ? { ...d, revision: "removed", segments: {} }
        : createDatafile({
            schemaVersion: "4",
            revision: "changed",
            segments: {
              audience: { conditions: { attribute: "country", operator: "equals", value: "de" } },
            },
          });
      expect(f.setDatafile(freeze(patch), replace)).toBe(true);
      expect(events[0].features).toEqual(["subject"]);
      expect(events[0].variables).toEqual(["subject", "alias"]);
      expect(events[0].replaced).toBe(replace);
      expect(f.isEnabled("subject", context)).toBe(false);
      expect(f.getVariable("alias", context)).toBeNull();
    },
  );

  it("does not report or cache diagnostic failures during segment equality comparisons", () => {
    const { f, parseErrors } = capture();
    expect(f.setDatafile(dependencyFile(malformed[0]), true)).toBe(true);
    expect(
      f.setDatafile(
        createDatafile({
          schemaVersion: "4",
          segments: { audience: { conditions: malformed[1] } },
        }),
      ),
    ).toBe(true);
    expect(parseErrors()).toEqual([]);
    expect(f.isEnabled("subject")).toBe(false);
    expect(parseErrors()).toHaveLength(1);
    expect(parseErrors()[0].details).toMatchObject({
      conditions: malformed[1],
      entityType: "segment",
      entityKey: "audience",
    });
  });

  describe.each(["segment", "feature", "variable"] as const)(
    "raw %s dependencies before the first read",
    (kind) => {
      it.each(
        placements.filter(
          (placement) => placement !== "segment" && placement !== "legacy segments",
        ),
      )(
        "invalidates dependents reached through %s without warming malformed neighbours",
        (placement) => {
          const leaf =
            kind === "segment"
              ? "audience"
              : kind === "feature"
                ? { feature: "gate" }
                : { variable: "policy", operator: "equals", value: true };
          const { datafile, read, expected, entityType } = fixture(placement, JSON.stringify(leaf));
          datafile.features.gate = createFeature({ hash: "gate-1" });
          datafile.segments.audience = { conditions: "*" };
          datafile.variables!.policy = { hash: "policy-1", type: "boolean", defaultValue: true };
          datafile.features.unread = createFeature({ hash: "unread", conditions: malformed[0] });
          datafile.variables!.unread = {
            hash: "unread",
            type: "string",
            defaultValue: "unread",
            conditions: malformed[1],
          };
          const before = JSON.stringify(datafile);
          const { f, parseErrors } = capture();
          expect(f.setDatafile(freeze(datafile), true)).toBe(true);
          const events: DatafileSetEventDetails[] = [];
          f.on("datafile_set", (details) => events.push(details));
          const patch = createDatafile({ schemaVersion: "4", revision: "dependency-change" });
          if (kind === "segment")
            patch.segments.audience = { conditions: { attribute: "missing", operator: "exists" } };
          else if (kind === "feature")
            patch.features.gate = createFeature({ hash: "gate-2", traffic: [] });
          else
            patch.variables = {
              policy: { hash: "policy-2", type: "boolean", defaultValue: false },
            };
          const patchBefore = JSON.stringify(patch);
          expect(f.setDatafile(freeze(patch))).toBe(true);
          expect(parseErrors()).toEqual([]);
          expect(entityType === "variable" ? events[0].variables : events[0].features).toContain(
            "subject",
          );
          expect(read(f)).toEqual(expected);
          expect(parseErrors()).toEqual([]);
          expect(f.isEnabled("healthy")).toBe(true);
          expect(JSON.stringify(datafile)).toBe(before);
          expect(JSON.stringify(patch)).toBe(patchBefore);
        },
      );
    },
  );
});
