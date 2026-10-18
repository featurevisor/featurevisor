import type { Attribute, Schema } from "@featurevisor/types";

import { getContextWarnings, getTestContextWarnings } from "./contextWarnings";

const timestamp = "2026-01-01T00:00:00Z";

describe("context warnings", () => {
  test.each([
    ["boolean", { type: "boolean" }, true, "true"],
    ["string", { type: "string" }, "nl", 42],
    ["integer", { type: "integer" }, 3, 1.5],
    ["number", { type: "number" }, 1.5, "1.5"],
    ["date-time", { type: "string", format: "date-time" }, timestamp, "2026-01-01"],
    ["semver", { type: "string", format: "semver" }, "1.2.3", 123],
    ["semver text", { type: "string", format: "semver" }, "5.5", "5.5,0"],
    ["object", { type: "object" }, { id: "abc" }, []],
    ["array", { type: "array" }, ["read", "write"], ["read", 42]],
  ] as const)("checks declared %s values without mutation", (_label, schema, valid, invalid) => {
    const attributes = { value: schema } as Record<string, Attribute>;
    expect(getContextWarnings({ value: valid }, attributes)).toEqual([]);
    const context = { value: invalid };
    const before = structuredClone(context);
    expect(getContextWarnings(context, attributes)).toHaveLength(1);
    expect(context).toEqual(before);
  });

  test.each([
    [
      { type: "string", enum: ["free", "paid"] },
      "gold",
      'is not one of its allowed values: "free", "paid".',
    ],
    [{ type: "string", pattern: "^[a-z]{2}$" }, "NLD", "does not match its pattern ^[a-z]{2}$."],
    [{ type: "string", const: "web" }, "ios", 'must equal "web".'],
    [{ type: "string", minLength: 2 }, "n", "is shorter than its minLength of 2."],
    [{ type: "integer", minimum: 1 }, 0, "is below its minimum of 1."],
    [{ type: "number", maximum: 5 }, 5.5, "is above its maximum of 5."],
  ] as const)("names the violated constraint of %j", (schema, value, ending) => {
    const attributes = { value: schema } as Record<string, Attribute>;
    expect(getContextWarnings({ value }, attributes)[0].message).toBe(
      `Context value ${JSON.stringify(value)} for "value" ${ending}`,
    );
  });

  test("names an undeclared property instead of the enclosing object", () => {
    const attributes = {
      browser: {
        type: "object",
        properties: { name: { type: "string" }, version: { type: "string", format: "semver" } },
      },
    } as Record<string, Attribute>;
    expect(getContextWarnings({ browser: { name: "chrome", type: "x" } }, attributes)).toEqual([
      {
        attribute: "browser.type",
        path: ["browser", "type"],
        value: "x",
        message: 'Context property "browser.type" is not declared by attribute "browser".',
      },
    ]);
    expect(getContextWarnings({ browser: { version: 100 } }, attributes)[0].message).toBe(
      'Context value 100 for "browser.version" does not match its attribute type "string with format semver". YAML reads an unquoted version such as 100.0 as a number. Quote versions.',
    );
  });

  test.each(["2026-02-30T00:00:00Z", "2026-01-01T00:00:00", 1767225601000, null, "soon"])(
    "uses portable timestamp validation for %j",
    (value) => {
      expect(
        getContextWarnings(
          { signupDate: value },
          { signupDate: { type: "string", format: "date-time" } },
        ),
      ).toEqual([
        {
          attribute: "signupDate",
          path: ["signupDate"],
          value,
          message: `Context value ${JSON.stringify(value)} for "signupDate" is not a valid date. The before and after operators do not match this value. Use YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm.`,
        },
      ]);
    },
  );

  test.each([
    "2026-01-01T01:00:00+01:00",
    "0001-01-01T00:00:00Z",
    "2026-01-01T00:00:00.123456789Z",
  ])("accepts portable date %s", (value) =>
    expect(
      getContextWarnings({ now: value }, { now: { type: "string", format: "date-time" } }),
    ).toEqual([]),
  );

  test.each([
    [{ type: "string", enum: ["nl"] }, "be"],
    [{ type: "string", const: "nl" }, "be"],
    [{ type: "integer", minimum: 2 }, 1],
    [{ type: "number", maximum: 2 }, 3],
    [{ type: "string", minLength: 2 }, "a"],
    [{ type: "string", maxLength: 2 }, "abc"],
    [{ type: "string", pattern: "^nl$" }, "be"],
    [{ type: "array", minItems: 2, items: { type: "string" } }, ["a"]],
    [{ type: "array", maxItems: 1, items: { type: "string" } }, ["a", "b"]],
    [{ type: "array", uniqueItems: true, items: { type: "string" } }, ["a", "a"]],
    [{ type: "object", properties: { id: { type: "string" } }, required: ["id"] }, {}],
    [{ type: "object" }, { id: {} }],
  ])("reuses attribute constraints for %j", (schema, value) => {
    expect(getContextWarnings({ value }, { value: schema as Attribute })).toHaveLength(1);
  });

  test("warns at nested properties and referenced additional properties", () => {
    const schemas: Record<string, Schema> = {
      identifier: { type: "integer", minimum: 1 },
      label: { type: "string", enum: ["nl", "be"] },
      alias: { schema: "label" },
    };
    const attributes: Record<string, Attribute> = {
      user: {
        type: "object",
        properties: {
          id: { schema: "identifier" },
          signupDate: { type: "string", format: "date-time" },
        },
        additionalProperties: { schema: "alias" },
      },
    };
    const warnings = getContextWarnings(
      { user: { id: 0, signupDate: "soon", country: 42 } },
      attributes,
      schemas,
    );
    expect(warnings.map(({ attribute, path }) => ({ attribute, path }))).toEqual([
      { attribute: "user.id", path: ["user", "id"] },
      { attribute: "user.signupDate", path: ["user", "signupDate"] },
      { attribute: "user.country", path: ["user", "country"] },
    ]);
    expect(
      getContextWarnings(
        { user: { id: 1, signupDate: timestamp, country: "nl" } },
        attributes,
        schemas,
      ),
    ).toEqual([]);
  });

  test("checks oneOf with exact branch matching and date leaves", () => {
    const attributes: Record<string, Attribute> = {
      value: { oneOf: [{ type: "string" }, { type: "integer" }] },
      now: {
        oneOf: [
          { type: "string", format: "date-time", const: timestamp },
          { type: "string", format: "date-time", const: "2026-02-01T00:00:00Z" },
        ],
      },
    };
    expect(getContextWarnings({ value: "abc", now: timestamp }, attributes)).toEqual([]);
    expect(
      getContextWarnings({ value: false, now: "soon" }, attributes).map(
        (warning) => warning.message,
      ),
    ).toEqual([
      'Context value false for "value" does not match its attribute type "string or integer".',
      'Context value "soon" for "now" is not a valid date. The before and after operators do not match this value. Use YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm.',
    ]);
    expect(
      getContextWarnings(
        { value: 1 },
        { value: { oneOf: [{ type: "integer" }, { type: "number" }] } },
      ),
    ).toHaveLength(1);
  });

  test("accepts native dates directly, in nested properties and via schema references", () => {
    const schemas: Record<string, Schema> = {
      instant: { type: "string", format: "date-time" } as unknown as Schema,
    };
    const attributes: Record<string, Attribute> = {
      now: { type: "string", format: "date-time", enum: [timestamp] },
      user: {
        type: "object",
        properties: {
          signupDate: { type: "string", format: "date-time", const: timestamp },
          referenced: { schema: "instant" },
        },
      },
    };
    const instant = new Date(timestamp);
    const context = { now: instant, user: { signupDate: instant, referenced: instant } };
    expect(getContextWarnings(context, attributes, schemas)).toEqual([]);
    expect(context.now).toBe(instant);
    expect(context.user.signupDate).toBe(instant);
    const later = new Date("2026-01-01T00:00:01Z");
    expect(
      getContextWarnings({ now: later, user: { signupDate: later } }, attributes, schemas).map(
        (warning) => warning.attribute,
      ),
    ).toEqual(["now", "user.signupDate"]);
  });

  test("uses native date precision without changing dates or authored strings", () => {
    const attributes: Record<string, Attribute> = {
      now: { type: "string", format: "date-time", const: "2026-01-01T00:00:00.000999999Z" },
    };
    const now = new Date(timestamp);
    expect(getContextWarnings({ now }, attributes)).toEqual([]);
    expect(now.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(getContextWarnings({ now: timestamp }, attributes)).toHaveLength(1);
  });

  test("enum and const cannot bypass the declared type", () => {
    expect(
      getContextWarnings({ value: "bad" }, { value: { type: "integer", enum: ["bad"] } }),
    ).toHaveLength(1);
    expect(
      getContextWarnings({ value: 42 }, { value: { type: "string", const: 42 } }),
    ).toHaveLength(1);
    expect(
      getContextWarnings(
        { now: "soon" },
        { now: { type: "string", format: "date-time", enum: ["soon"] } },
      ),
    ).toHaveLength(1);
    expect(
      getContextWarnings(
        { now: "soon" },
        { now: { type: "string", format: "date-time", const: "soon" } },
      ),
    ).toHaveLength(1);
  });

  test("mixed date and integer branches preserve valid branch semantics", () => {
    const attributes: Record<string, Attribute> = {
      now: { oneOf: [{ type: "string", format: "date-time" }, { type: "integer" }] },
    };
    expect(getContextWarnings({ now: 42 }, attributes)).toEqual([]);
    expect(getContextWarnings({ now: new Date(timestamp) }, attributes)).toEqual([]);
    expect(getContextWarnings({ now: "soon" }, attributes)[0].message).toBe(
      'Context value "soon" for "now" does not match its attribute type "string with format date-time or integer".',
    );
  });

  test.each([NaN, Infinity, -Infinity])("warns about nonfinite double %s", (value) => {
    expect(getContextWarnings({ value }, { value: { type: "number" } })).toHaveLength(1);
  });

  test("warns for invalid native dates directly and through nested references", () => {
    const schemas: Record<string, Schema> = {
      instant: { type: "string", format: "date-time" } as unknown as Schema,
    };
    const invalid = new Date(NaN);
    const attributes: Record<string, Attribute> = {
      now: { type: "string", format: "date-time" },
      user: {
        type: "object",
        properties: {
          signupDate: { type: "string", format: "date-time" },
          referenced: { schema: "instant" },
        },
      },
    };
    expect(
      getContextWarnings(
        { now: invalid, user: { signupDate: invalid, referenced: invalid } },
        attributes,
        schemas,
      ).map((warning) => warning.path),
    ).toEqual([["now"], ["user", "signupDate"], ["user", "referenced"]]);
    expect(getContextWarnings({ now: new Date("10000-01-01T00:00:00Z") }, attributes)).toHaveLength(
      1,
    );
  });

  test("ignores unknown attributes, missing attributes and unresolved placeholders", () => {
    const attributes: Record<string, Attribute> = {
      country: { type: "string" },
      user: {
        type: "object",
        properties: { id: { type: "integer" }, country: { type: "string" } },
      },
    };
    expect(
      getContextWarnings(
        { unknown: {}, country: "${{ country }}", user: { id: "${{ id }}", country: 42 } },
        attributes,
      ).map((warning) => warning.attribute),
    ).toEqual(["user.country"]);
    expect(getContextWarnings({}, attributes)).toEqual([]);
    expect(getContextWarnings({ toString: 42 }, attributes)).toEqual([]);
    expect(getContextWarnings({ country: "prefix-${{ missing }}" }, attributes)).toEqual([]);
  });

  test("skips unavailable and cyclic schema references without overflowing", () => {
    const attributes: Record<string, Attribute> = {
      user: { type: "object", properties: { id: { schema: "missing" } } },
    };
    expect(getContextWarnings({ user: { id: 42 } }, attributes)).toEqual([]);
    attributes.user.properties!.id = { schema: "loop" };
    expect(
      getContextWarnings({ user: { id: 42 } }, attributes, { loop: { schema: "loop" } }),
    ).toEqual([]);
    const recursive: Schema = { type: "object", properties: { child: { schema: "recursive" } } };
    expect(
      getContextWarnings({ user: { id: {} } }, attributes, { loop: recursive, recursive }),
    ).toEqual([]);
  });
});

describe("test context warnings", () => {
  const attributes: Record<string, Attribute> = {
    country: { type: "string" },
    now: { type: "string", format: "date-time" },
    user: { type: "object", properties: { id: { type: "integer" } } },
  };

  test("names each distinct invalid matrix value while deduplicating repeated combinations", () => {
    const spec = {
      assertions: [
        {
          matrix: {
            when: [timestamp, "2026-02-01", "not a date", "not a date"],
            unrelated: [1, 2],
          },
          context: { now: "${{ when }}" },
        },
      ],
    };
    const warnings = getTestContextWarnings(spec, attributes);
    expect(warnings.map((warning) => warning.value)).toEqual(["2026-02-01", "not a date"]);
    expect(warnings[0].message).toContain('Context value "2026-02-01"');
    expect(warnings[1].message).toContain('Context value "not a date"');
  });

  test("shortens received values to 80 characters without merging distinct long values", () => {
    const values = ["x".repeat(100) + "a", "x".repeat(100) + "b"];
    const warnings = getTestContextWarnings(
      { assertions: [{ matrix: { value: values }, context: { now: "${{ value }}" } }] },
      attributes,
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0].message).toContain(
      `Context value ${JSON.stringify(values[0]).slice(0, 79)}… for`,
    );
    expect(warnings.map((warning) => warning.value)).toEqual(values);
  });

  test.each(["feature", "segment", "variable"])(
    "expands %s matrices and child contexts at authored paths",
    (owner) => {
      const spec = {
        [owner]: "example",
        assertions: [
          {
            matrix: { country: ["nl", 42], now: [timestamp, "soon"] },
            context: {
              country: "${{ country }}",
              now: "${{ now }}",
              user: { id: "${{ unexpanded }}" },
            },
            children: [{ context: { country: "${{ country }}", user: { id: 1.5 } } }],
          },
        ],
      };
      const before = structuredClone(spec);
      const warnings = getTestContextWarnings(spec, attributes);
      expect(warnings.map((warning) => warning.path)).toEqual(
        expect.arrayContaining([
          ["assertions", 0, "context", "country"],
          ["assertions", 0, "context", "now"],
          ["assertions", 0, "children", 0, "context", "country"],
          ["assertions", 0, "children", 0, "context", "user", "id"],
        ]),
      );
      expect(warnings).toHaveLength(4);
      expect(spec).toEqual(before);
    },
  );

  test("uses root scenario paths and expands nested child arrays", () => {
    const spec = {
      matrix: { contexts: [{ now: timestamp }, { now: 42 }] },
      context: "${{ contexts }}",
      children: [{ context: { user: { id: "bad" } } }],
      checks: [{ feature: "example", enabled: true }],
    };
    expect(
      getTestContextWarnings(spec, attributes, {}, true).map((warning) => warning.path),
    ).toEqual([
      ["children", 0, "context", "user", "id"],
      ["context", "now"],
    ]);
  });

  test("deduplicates by authored path without serializing bigint context values", () => {
    const spec = { assertions: [{ matrix: { unrelated: [1, 2] }, context: { country: 42n } }] };
    expect(() => getTestContextWarnings(spec, attributes)).not.toThrow();
    expect(getTestContextWarnings(spec, attributes)).toEqual([
      expect.objectContaining({ path: ["assertions", 0, "context", "country"], value: 42n }),
    ]);
  });

  test.each([
    null,
    [],
    {},
    { assertions: [null] },
    { assertions: [{ matrix: {} }] },
    { assertions: [{ matrix: { country: 42 } }] },
    { assertions: [{ matrix: { country: [] } }] },
  ])("leaves malformed authoring to lint: %j", (spec) => {
    expect(getTestContextWarnings(spec, attributes)).toEqual([]);
  });
});
