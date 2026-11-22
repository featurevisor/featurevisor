import { createFeaturevisor } from "@featurevisor/sdk";
import type { DatafileContent, DatafileSchema } from "@featurevisor/types";

import { createSchemas, flattenIssues, type SchemaIssue } from "./index";

const signUp: DatafileSchema = {
  hash: "s1",
  type: "object",
  properties: {
    email: { type: "string", pattern: "^[^@\\s]+@[^@\\s]+$" },
    displayName: { type: "string", minLength: 2, maxLength: 40 },
    nickname: { oneOf: [{ type: "string", maxLength: 10 }, { const: null }] },
    age: { type: "integer", minimum: 18, maximum: 120 },
    country: { type: "string", enum: ["GB", "NL"] },
    marketingConsent: { type: "boolean" },
    address: { schema: "address", messages: { required: "Add an address so we can deliver" } },
    tags: { type: "array", items: { type: "string", enum: ["new", "vip"] }, uniqueItems: true },
    items: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: { name: { type: "string" }, quantity: { type: "integer", minimum: 1 } },
        required: ["name"],
      },
    },
  },
  required: ["email", "displayName"],
  messages: {
    additionalProperties: "{key} is not part of a sign up",
    email: {
      required: "Tell us your email address",
      pattern: "Enter an email like ada@example.com",
    },
    displayName: { minLength: "Use at least {minLength} characters" },
    address: { city: { required: "Which city should we deliver to?" } },
    items: { "[]": { quantity: { minimum: "Order at least {minimum}" } } },
  },
};

const address: DatafileSchema = {
  hash: "a1",
  type: "object",
  properties: { city: { type: "string", minLength: 1 }, zip: { type: "string" } },
  required: ["city"],
  messages: { city: { required: "A city, please" }, zip: { type: "Zip codes are text" } },
};

const coupon: DatafileSchema = {
  hash: "c1",
  type: "string",
  pattern: "^[A-Z0-9]{8}$",
  messages: { pattern: "Enter the 8 letters and digits printed on the coupon" },
};

function datafile(
  schemas: Record<string, DatafileSchema> = { signUp, address, coupon },
  revision = "1",
) {
  return {
    schemaVersion: "4",
    revision,
    segments: {},
    features: {},
    variables: {},
    schemas,
  } as DatafileContent;
}

function setup(options?: Parameters<typeof createSchemas>[1], data = datafile()) {
  const diagnostics: { code: string; details: unknown }[] = [];
  const f = createFeaturevisor({
    datafile: data,
    logLevel: "fatal",
    context: { userId: "user-1", locale: "nl" },
    onDiagnostic: (diagnostic) =>
      diagnostics.push({ code: diagnostic.code, details: diagnostic.details }),
  });
  return { f, s: createSchemas(f, options), diagnostics };
}

const valid = { email: "ada@example.com", displayName: "Ada" };

function codes(issues: ReadonlyArray<SchemaIssue> | undefined) {
  return (issues || []).map(({ code, path }) => [code, path.join(".")]);
}

describe("validation", () => {
  test("a valid value comes back as the same reference, never changed", () => {
    const { s } = setup();
    const input = { ...valid, marketingConsent: true };

    const result = s.validate("signUp", input);

    expect(result).toEqual({ value: input });
    expect((result as { value: unknown }).value).toBe(input);
    expect(s.isValid("signUp", input)).toBe(true);
  });

  test("every issue is reported, each with its code, path, params and schema", () => {
    const { s } = setup();

    const result = s.validate("signUp", {
      displayName: "A",
      age: 12.5,
      country: "FR",
      tags: ["new", "new"],
      items: [{ quantity: 0 }, { name: "Pen" }, { name: "Ink" }, { name: "Nib" }],
      extra: true,
    });

    expect(codes(result.issues)).toEqual([
      ["required", "email"],
      ["minLength", "displayName"],
      ["type", "age"],
      ["enum", "country"],
      ["uniqueItems", "tags"],
      ["maxItems", "items"],
      ["required", "items.0.name"],
      ["minimum", "items.0.quantity"],
      ["additionalProperties", "extra"],
    ]);
    expect(result.issues![1]).toEqual({
      message: "Use at least 2 characters",
      path: ["displayName"],
      code: "minLength",
      params: { minLength: 2, length: 1 },
      schema: "signUp",
    });
    expect(result.issues![2].params).toEqual({ type: "integer", received: "number" });
    expect(result.issues![3].params).toEqual({ options: ["GB", "NL"] });
    expect(result.issues![4].params).toEqual({ index: 1 });
  });

  test("lengths count code points, so an emoji counts one", () => {
    const { s } = setup();

    expect(s.isValid("signUp", { ...valid, displayName: "😀👍🏽" })).toBe(true);
    expect(s.validate("signUp", { ...valid, displayName: "😀" }).issues![0].params).toEqual({
      minLength: 2,
      length: 1,
    });
  });

  test("a key whose value is undefined counts as absent", () => {
    const { s } = setup();

    expect(s.isValid("signUp", { ...valid, age: undefined, unknown: undefined })).toBe(true);
    expect(codes(s.validate("signUp", { ...valid, email: undefined }).issues)).toEqual([
      ["required", "email"],
    ]);
  });

  test("a number that is not finite fails", () => {
    const { s } = setup();

    expect(s.validate("signUp", { ...valid, age: NaN }).issues![0].params).toEqual({
      type: "integer",
      received: "NaN",
    });
  });

  test("a nullable field's type selects its branch, whose issues are reported", () => {
    const { s } = setup();

    expect(s.isValid("signUp", { ...valid, nickname: null })).toBe(true);
    expect(codes(s.validate("signUp", { ...valid, nickname: "Augusta Ada" }).issues)).toEqual([
      ["maxLength", "nickname"],
    ]);
    expect(s.validate("signUp", { ...valid, nickname: 1 }).issues![0]).toMatchObject({
      code: "oneOf",
      params: { matches: 0 },
    });
  });

  test("a oneOf whose branches share a type reports how many matched", () => {
    const { s } = setup(
      undefined,
      datafile({
        either: {
          oneOf: [
            { type: "string", minLength: 2 },
            { type: "string", maxLength: 4 },
          ],
        },
      }),
    );

    expect(s.isValid("either", "ab")).toBe(false);
    expect(s.validate("either", "abc").issues![0]).toMatchObject({
      code: "oneOf",
      params: { matches: 2 },
    });
    expect(s.isValid("either", "abcdef")).toBe(true);
  });

  test("an array without items holds strings, and a flat object primitives", () => {
    const { s } = setup(
      undefined,
      datafile({
        list: { type: "array" },
        flat: { type: "object" },
        open: {
          type: "object",
          properties: { id: { type: "string" } },
          additionalProperties: true,
        },
      }),
    );

    expect(codes(s.validate("list", ["a", 1]).issues)).toEqual([["type", "1"]]);
    expect(codes(s.validate("flat", { a: 1, b: { nested: true } }).issues)).toEqual([
      ["type", "b"],
    ]);
    expect(s.isValid("open", { id: "1", anything: { nested: [1, { deep: true }] } })).toBe(true);
  });

  test("formats use the SDK's timestamp and version grammars", () => {
    const { s } = setup(
      undefined,
      datafile({
        when: { type: "string", format: "date-time" },
        version: { type: "string", format: "semver" },
      }),
    );

    expect(s.isValid("when", "2026-11-23T09:00:00Z")).toBe(true);
    expect(s.validate("when", "soon").issues![0]).toMatchObject({
      code: "format",
      params: { format: "date-time" },
    });
    expect(s.isValid("version", "1.2.3")).toBe(true);
    expect(s.isValid("version", "one")).toBe(false);
  });

  test("a missing schema fails closed, with one diagnostic per key", () => {
    const diagnostics: { code: string; details: unknown }[] = [];
    const f = createFeaturevisor({
      datafile: datafile(),
      logLevel: "warn",
      onDiagnostic: (diagnostic) =>
        diagnostics.push({ code: diagnostic.code, details: diagnostic.details }),
    });
    const s = createSchemas(f);

    expect(s.validate("checkout", {}).issues).toEqual([
      {
        message: 'Schema "checkout" was not found.',
        path: [],
        code: "schemaNotFound",
        params: { schema: "checkout" },
        schema: "checkout",
      },
    ]);
    s.validate("checkout", {});
    expect(diagnostics.filter((diagnostic) => diagnostic.code === "schema_not_found")).toEqual([
      { code: "schema_not_found", details: { schemaKey: "checkout" } },
    ]);
  });
});

describe("messages", () => {
  test("the schema's messages, from the outside in, beside rules and into references", () => {
    const { s } = setup();

    const result = s.validate("signUp", {
      displayName: "Ada",
      email: "nope",
      address: {},
      extra: 1,
    });

    expect(result.issues!.map((issue) => issue.message)).toEqual([
      "Enter an email like ada@example.com",
      // The sign up form's wording wins over the address schema's own.
      "Which city should we deliver to?",
      "extra is not part of a sign up",
    ]);
  });

  test("a field that is a reference words its own issues beside the reference", () => {
    const { s } = setup(
      undefined,
      datafile({
        ...{ address },
        order: {
          type: "object",
          properties: { address: { schema: "address", messages: { required: "Where to?" } } },
          required: ["address"],
        },
      }),
    );

    expect(s.validate("order", {}).issues![0].message).toBe("Where to?");
    // A reused schema's own messages word its fields wherever it is used.
    expect(s.validate("order", { address: {} }).issues![0].message).toBe("A city, please");
    expect(s.validate("order", { address: { city: "Leiden", zip: 2311 } }).issues![0].message).toBe(
      "Zip codes are text",
    );
  });

  test("a message is for the field it names, never for fields inside it", () => {
    const { s } = setup();

    const result = s.validate("signUp", { ...valid, items: [{ quantity: 1 }] });

    expect(result.issues![0].message).toBe('Value at "items.0.name" is required.');
  });

  test("the application's messages, then the default", () => {
    const { s } = setup({
      messages: {
        maxLength: "Keep it to {maxLength} characters",
        maximum: ({ maximum, value }) => `${value} is over ${maximum}`,
      },
    });

    const result = s.validate("signUp", {
      ...valid,
      nickname: "Augusta Ada",
      age: 121,
      country: "FR",
    });

    expect(result.issues!.map((issue) => issue.message)).toEqual([
      "Keep it to 10 characters",
      "121 is over 120",
      'Value at "country" must be one of GB, NL.',
    ]);
  });

  test("a form's messages win, nested fields and array items included", () => {
    const { s } = setup();
    const leaderboard = s.get("signUp", {
      messages: {
        displayName: { minLength: "Names on the leaderboard need {minLength} characters" },
        address: { city: { required: "Which city should we send the prize to?" } },
        items: { "[]": { quantity: { minimum: "At least {minimum} of each" } } },
      },
    });

    const result = leaderboard.validate({
      email: "ada@example.com",
      displayName: "A",
      address: {},
      items: [{ name: "Pen", quantity: 0 }],
    });

    expect(result.issues!.map((issue) => issue.message)).toEqual([
      "Names on the leaderboard need 2 characters",
      "Which city should we send the prize to?",
      "At least 1 of each",
    ]);
  });

  test("message translates every issue last, with the context", () => {
    const { s } = setup({
      message: (issue, { context }) =>
        issue.code === "required" ? `[${context.locale}] ${issue.message}` : undefined,
    });

    expect(s.validate("signUp", { displayName: "Ada" }).issues![0].message).toBe(
      "[nl] Tell us your email address",
    );
    expect(s.validate("signUp", { ...valid, displayName: "A" }).issues![0].message).toBe(
      "Use at least 2 characters",
    );
  });

  test("templates write literal braces, and lists with commas", () => {
    const { s } = setup({ messages: { enum: "{{one of}} {options}" } });

    expect(s.validate("signUp", { ...valid, country: "FR" }).issues![0].message).toBe(
      "{one of} GB, NL",
    );
  });

  test("a standalone schema words its issues beside its rules", () => {
    const { s } = setup();

    expect(s.validate("coupon", "nope").issues![0].message).toBe(
      "Enter the 8 letters and digits printed on the coupon",
    );
  });
});

describe("handles", () => {
  test("a handle is a Standard Schema, and stable", () => {
    const { s } = setup();
    const handle = s.get("signUp");

    expect(s.get("signUp")).toBe(handle);
    expect(handle["~standard"].vendor).toBe("featurevisor");
    expect(handle["~standard"].version).toBe(1);
    expect(handle["~standard"].validate(valid)).toEqual({ value: valid });
    expect(handle.key).toBe("signUp");
  });

  test("the same options give the same handle", () => {
    const { s } = setup();
    const options = { messages: {} };

    expect(s.get("signUp", options)).toBe(s.get("signUp", options));
    expect(s.get("signUp", { messages: {} })).not.toBe(s.get("signUp", options));
  });

  test("status is missing until the datafile has the schema, and follows new datafiles", () => {
    const f = createFeaturevisor({ logLevel: "fatal" });
    const s = createSchemas(f);
    const handle = s.get("coupon");

    expect(handle.status).toBe("missing");
    expect(handle.isValid("ABCD1234")).toBe(false);

    f.setDatafile(datafile());
    expect(handle.status).toBe("ready");
    expect(handle.isValid("ABCD1234")).toBe(true);

    f.setDatafile(datafile({ coupon: { hash: "c2", type: "string", pattern: "^[0-9]{4}$" } }, "2"));
    expect(handle.isValid("ABCD1234")).toBe(false);
    expect(handle.isValid("1234")).toBe(true);
  });

  test("a change to a referenced schema reaches the schemas that use it", () => {
    const { f, s } = setup();
    const handle = s.get("signUp");
    expect(handle.isValid({ ...valid, address: { city: "Leiden" } })).toBe(true);

    f.setDatafile(
      datafile(
        { address: { hash: "a2", type: "object", properties: { city: { type: "integer" } } } },
        "2",
      ),
    );

    expect(handle.isValid({ ...valid, address: { city: "Leiden" } })).toBe(false);
  });

  test("at gives a field's handle, with paths relative to the field and the schema's messages", () => {
    const { s } = setup();
    const signUpHandle = s.get("signUp");
    const city = signUpHandle.at("address.city");

    expect(signUpHandle.at("address.city")).toBe(city);
    expect(city.status).toBe("ready");
    expect(city.path).toBe("address.city");
    expect(city.isValid("Leiden")).toBe(true);
    expect(signUpHandle.at("items.0.quantity").validate(0).issues![0]).toMatchObject({
      message: "Order at least 1",
      path: [],
    });
    expect(signUpHandle.at("items[].quantity").isValid(2)).toBe(true);
    expect(signUpHandle.at("displayName").validate("A").issues![0].message).toBe(
      "Use at least 2 characters",
    );
  });

  test("a field the schema lacks is missing, and fails closed", () => {
    const { s } = setup();
    const field = s.get("signUp").at("address.street");

    expect(field.status).toBe("missing");
    expect(field.validate("Main St").issues![0]).toMatchObject({
      code: "schemaNotFound",
      params: { schema: "signUp", field: "address.street" },
    });
  });

  test("constraints are HTML attributes by field, through nested objects, stopping at arrays", () => {
    const { s } = setup();

    expect(s.get("signUp").constraints).toEqual({
      email: { required: true },
      displayName: { required: true, minLength: 2, maxLength: 40 },
      nickname: { maxLength: 10 },
      age: { min: 18, max: 120, step: 1 },
      country: {},
      marketingConsent: {},
      address: {},
      "address.city": { required: true, minLength: 1 },
      "address.zip": {},
      tags: { multiple: true },
      items: { multiple: true },
    });
    expect(s.get("signUp").at("items.0").constraints).toEqual({
      name: { required: true },
      quantity: { min: 1, step: 1 },
    });
    expect(s.get("coupon").constraints).toEqual({});
  });

  test("options list what enum and const allow, by field, with a multiple select's items", () => {
    const { s } = setup();

    expect(s.get("signUp").options).toEqual({ country: ["GB", "NL"], tags: ["new", "vip"] });
    expect(s.get("signUp").at("country").options).toEqual(["GB", "NL"]);
    expect(s.get("missing").options).toEqual({});
  });
});

describe("form data", () => {
  test("is read by the schema's types, leaving out what it does not describe", () => {
    const { s } = setup();
    const data = new URLSearchParams();
    data.append("email", "ada@example.com");
    data.append("displayName", "Ada");
    data.append("age", " 36 ");
    data.append("nickname", "");
    data.append("tags", "new");
    data.append("tags", "vip");
    data.append("items[0].name", "Pen");
    data.append("items.0.quantity", "2");
    data.append("items[1].name", "Ink");
    data.append("address.city", "Leiden");
    data.append("csrf", "token");
    data.append("intent", "save");

    const value = s.get("signUp").fromFormData(data);

    expect(value).toEqual({
      email: "ada@example.com",
      displayName: "Ada",
      age: 36,
      tags: ["new", "vip"],
      items: [{ name: "Pen", quantity: 2 }, { name: "Ink" }],
      address: { city: "Leiden" },
      marketingConsent: false,
    });
    expect(s.isValid("signUp", value)).toBe(true);
  });

  test("a checkbox reads on and true as true, and text that spells no number stays text", () => {
    const { s } = setup();
    const data = new URLSearchParams("email=a@b.c&displayName=Ada&marketingConsent=on&age=old");

    const value = s.get("signUp").fromFormData(data) as Record<string, unknown>;

    expect(value.marketingConsent).toBe(true);
    expect(value.age).toBe("old");
    expect(codes(s.validate("signUp", value).issues)).toEqual([["type", "age"]]);
  });
});

describe("checks in code", () => {
  test("run after the rules, only where nothing has an issue, with input, context and a signal", () => {
    const { s } = setup();
    const seen: unknown[] = [];
    const handle = s.get("signUp", {
      refine: [
        {
          key: "nameFree",
          path: "displayName",
          check: (name, { input, context, signal }) => {
            seen.push([
              name,
              (input as { email: string }).email,
              context.locale,
              signal instanceof AbortSignal,
            ]);
            return name !== "Taken";
          },
          message: "That name is taken",
        },
      ],
    });

    expect(
      handle.validate({ ...valid, displayName: "A" }).issues!.map((issue) => issue.code),
    ).toEqual(["minLength"]);
    expect(seen).toEqual([]);

    expect(handle.validate({ ...valid, displayName: "Taken" }).issues).toEqual([
      {
        message: "That name is taken",
        path: ["displayName"],
        code: "refine",
        params: { refine: "nameFree" },
        schema: "signUp",
      },
    ]);
    expect(seen).toEqual([["Taken", "ada@example.com", "nl", true]]);
  });

  test("a check that throws fails closed with refineError", () => {
    const { s } = setup();
    const handle = s.get("signUp", {
      refine: [
        {
          key: "nameFree",
          path: "displayName",
          check: () => {
            throw new Error("offline");
          },
        },
      ],
    });

    expect(handle.validate(valid).issues![0]).toMatchObject({
      code: "refineError",
      message: 'Value at "displayName" could not be checked.',
    });
  });

  test("asynchronous checks return a promise, in order, and their messages follow the lookup", async () => {
    const { s } = setup({ messages: { refine: "Not allowed" } });
    const handle = s.get("signUp", {
      refine: [
        {
          key: "slow",
          path: "displayName",
          check: () => new Promise<boolean>((done) => setTimeout(() => done(false), 5)),
        },
        { key: "fast", path: "email", check: async () => false },
        { key: "rejects", path: "email", check: () => Promise.reject(new Error("down")) },
      ],
    });

    const result = await handle.validate(valid);

    expect(
      result.issues!.map(({ code, path, message }) => [code, path.join("."), message]),
    ).toEqual([
      ["refine", "displayName", "Not allowed"],
      ["refine", "email", "Not allowed"],
      ["refineError", "email", 'Value at "email" could not be checked.'],
    ]);
    expect(await handle.isValid(valid)).toBe(false);
  });

  test("a check with [] runs for every item, at the item's path", () => {
    const { s } = setup();
    const handle = s.get("signUp", {
      refine: [{ key: "inStock", path: "items[].name", check: (name) => name !== "Ink" }],
    });

    expect(
      codes(handle.validate({ ...valid, items: [{ name: "Pen" }, { name: "Ink" }] }).issues),
    ).toEqual([["refine", "items.1.name"]]);
  });

  test("reads holds a check back while the fields it reads have issues", () => {
    const { s } = setup();
    let calls = 0;
    const handle = s.get("signUp", {
      refine: [
        {
          key: "itemsFit",
          path: "displayName",
          reads: ["items"],
          check: () => {
            calls++;
            return true;
          },
        },
      ],
    });

    handle.validate({ ...valid, items: [{ quantity: 1 }] });
    expect(calls).toBe(0);
    handle.validate({ ...valid, items: [{ name: "Pen" }] });
    expect(calls).toBe(1);
  });

  test("aborting the signal rejects the validation with its reason", async () => {
    const { s } = setup();
    const controller = new AbortController();
    const handle = s.get("signUp", {
      refine: [{ key: "slow", path: "displayName", check: () => new Promise<boolean>(() => {}) }],
    });

    const result = handle.validate(valid, { signal: controller.signal });
    controller.abort(new Error("newer input"));

    await expect(result).rejects.toThrow("newer input");
  });

  test("a field's handle runs its own checks, relative to the field", () => {
    const { s } = setup();
    const handle = s.get("signUp", {
      refine: [
        { key: "nameFree", path: "displayName", check: (name) => name !== "Taken" },
        { key: "total", path: "displayName", reads: ["items"], check: () => false },
      ],
    });

    expect(codes(handle.at("displayName").validate("Taken").issues)).toEqual([["refine", ""]]);
    expect(handle.at("displayName").isValid("Ada")).toBe(true);
  });

  test("Standard Schema's validate runs the checks too, with a signal from libraryOptions", async () => {
    const { s } = setup();
    const handle = s.get("signUp", {
      refine: [{ key: "nameFree", path: "displayName", check: async (name) => name !== "Taken" }],
    });

    const result = await handle["~standard"].validate({ ...valid, displayName: "Taken" });

    expect(codes(result.issues as SchemaIssue[])).toEqual([["refine", "displayName"]]);
  });
});

describe("flattenIssues", () => {
  test("groups messages by field, with the value's own under formErrors", () => {
    const { s } = setup();
    const issues = [
      ...s.validate("signUp", { displayName: "A", items: [{}] }).issues!,
      ...s.validate("coupon", "x").issues!,
    ];

    expect(flattenIssues(issues)).toEqual({
      formErrors: ["Enter the 8 letters and digits printed on the coupon"],
      fieldErrors: {
        email: ["Tell us your email address"],
        displayName: ["Use at least 2 characters"],
        "items.0.name": ['Value at "items.0.name" is required.'],
      },
    });
  });
});

describe("the instance", () => {
  test("refuses a child instance", () => {
    const f = createFeaturevisor({ datafile: datafile(), logLevel: "fatal" });

    expect(() => createSchemas(f.spawn({}) as never)).toThrow("not a child");
  });

  test("several instances on one SDK instance share its module", () => {
    const { f } = setup();

    expect(() => createSchemas(f)).not.toThrow();
    expect(createSchemas(f).isValid("coupon", "ABCD1234")).toBe(true);
  });
});
