import { createFeaturevisor } from "@featurevisor/sdk";
import type { DatafileContent, DatafileSchema } from "@featurevisor/types";

import {
  createSchemas,
  flattenIssues,
  formAction,
  initialFormState,
  SchemaError,
  type SchemaIssue,
  type SchemaResult,
} from "./index";

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

  test("a template reads only an issue's own params", () => {
    const { s } = setup({ messages: { required: "Missing {key}{constructor}" } });

    expect(s.validate("signUp", { email: "a@b.c" }).issues![0].message).toBe("Missing displayName");
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

  test("a schema the datafile lacks fails validation, and a handle follows new datafiles", () => {
    const f = createFeaturevisor({ logLevel: "fatal" });
    const s = createSchemas(f);
    const handle = s.get("coupon");

    expect(handle.validate("ABCD1234").issues![0]).toMatchObject({ code: "schemaNotFound" });

    f.setDatafile(datafile());
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

  test("a field the schema lacks fails closed", () => {
    const { s } = setup();
    const field = s.get("signUp").at("address.street");

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

  test("options list what enum and const allow as objects, by field, with a multiple select's items", () => {
    const { s } = setup();

    expect(s.get("signUp").options).toEqual({
      country: [{ value: "GB" }, { value: "NL" }],
      tags: [{ value: "new" }, { value: "vip" }],
    });
    expect(s.get("signUp").at("country").options).toEqual([{ value: "GB" }, { value: "NL" }]);
    expect(s.get("missing").options).toEqual([]);
  });

  test("constraints say required only where an input left empty fails", () => {
    const { s } = setup(
      undefined,
      datafile({
        prefs: {
          hash: "p1",
          type: "object",
          properties: {
            name: { type: "string" },
            newsletter: { type: "boolean" },
            acceptTerms: { const: true },
            either: { enum: [true, false] },
            topics: { type: "array", items: { type: "string", enum: ["news", "deals"] } },
            picks: { type: "array", minItems: 1, items: { type: "string" } },
            nickname: { oneOf: [{ type: "string" }, { const: null }] },
          },
          required: ["name", "newsletter", "acceptTerms", "either", "topics", "picks", "nickname"],
        },
      }),
    );

    // An unchecked box reads as false, a list with nothing chosen as [] and an empty nullable field as null.
    expect(s.get("prefs").constraints).toEqual({
      name: { required: true },
      newsletter: {},
      acceptTerms: { required: true },
      either: {},
      topics: { multiple: true },
      picks: { required: true, multiple: true },
      nickname: {},
    });
  });

  test("constraints and options are frozen, and a schema the datafile lacks has none", () => {
    const { s } = setup();
    const signUpHandle = s.get("signUp");

    expect(Object.isFrozen(signUpHandle.constraints)).toBe(true);
    expect(Object.isFrozen(signUpHandle.constraints.email)).toBe(true);
    expect(Object.isFrozen(signUpHandle.options)).toBe(true);
    expect(Object.isFrozen(signUpHandle.at("country").options)).toBe(true);
    expect(Object.isFrozen(signUpHandle.at("country").options[0])).toBe(true);

    const missing = s.get("missing");
    expect(missing.options.map((option: { value: unknown }) => option.value)).toEqual([]);
    expect(missing.options.country).toBeUndefined();
    expect(missing.constraints).toEqual({});
    expect(signUpHandle.at("nope").options).toEqual([]);
  });

  test("option finds one choice by value, comparing objects by value", () => {
    const { s } = setup(
      undefined,
      datafile({
        plan: { hash: "p1", oneOf: [{ const: "free" }, { const: { tier: 2 } }, { const: null }] },
      }),
    );
    const plan = s.get("plan");

    expect(plan.option("free")).toEqual({ value: "free" });
    expect(plan.option({ tier: 2 })).toEqual({ value: { tier: 2 } });
    expect(plan.option(null)).toEqual({ value: null });
    expect(plan.option("paid")).toBeUndefined();
    expect(setup().s.get("signUp").at("tags").option("vip")).toEqual({ value: "vip" });
  });
});

describe("annotations", () => {
  const form: DatafileSchema = {
    hash: "f1",
    type: "object",
    properties: {
      email: {
        type: "string",
        annotations: { title: "Email address", placeholder: "ada@example.com" },
      },
      plan: {
        type: "string",
        enum: ["free", "pro", "team"],
        annotations: {
          title: "Plan",
          options: {
            free: { title: "Free" },
            pro: { title: "Pro", badge: "popular" },
            team: { title: "Team" },
          },
        },
      },
      seats: {
        enum: [1, 5, null],
        annotations: { options: { "1": { title: "Just me" }, null: { title: "Not sure" } } },
      },
      country: { schema: "country", annotations: { title: "Country of residence" } },
      nickname: {
        oneOf: [
          { type: "string", maxLength: 3 },
          { const: null, annotations: { title: "No nickname" } },
        ],
        annotations: { title: "Nickname" },
      },
      address: { schema: "postal", annotations: { order: ["postcode", "city"] } },
      "a.b": { type: "string" },
    },
    required: ["email", "plan", "country"],
    annotations: { title: "Create your account", order: ["plan", "email", "nope"] },
  };
  const country: DatafileSchema = {
    hash: "c1",
    oneOf: [
      { const: "GB", annotations: { title: "United Kingdom", flag: "gb" } },
      { const: "NL", annotations: { title: "Netherlands", flag: "nl" } },
    ],
    annotations: { title: "Country" },
  };
  const postal: DatafileSchema = {
    hash: "p1",
    type: "object",
    properties: {
      city: { type: "string", annotations: { title: "City" } },
      street: { type: "string" },
      postcode: { type: "string" },
    },
    required: ["city"],
    annotations: { title: "Address", order: ["street", "city"] },
  };
  const annotated = (options?: Parameters<typeof createSchemas>[1]) =>
    setup(options, datafile({ form, country, postal }));
  const filled = { email: "ada@example.com", plan: "free", country: "GB" };

  test("a handle has its own annotations, over those of a schema its field references", () => {
    const { s } = annotated();
    const signUpForm = s.get("form");

    expect(signUpForm.annotations).toEqual({
      title: "Create your account",
      order: ["plan", "email", "nope"],
    });
    expect(Object.isFrozen(signUpForm.annotations)).toBe(true);
    expect(signUpForm.at("email").annotations).toEqual({
      title: "Email address",
      placeholder: "ada@example.com",
    });
    // The reference's own title wins over the referenced schema's.
    expect(signUpForm.at("country").annotations).toEqual({ title: "Country of residence" });
    expect(s.get("country").annotations.title).toBe("Country");
    expect(signUpForm.at("address").annotations).toEqual({
      title: "Address",
      order: ["postcode", "city"],
    });
    expect(signUpForm.at("address.city").annotations.title).toBe("City");
    expect(signUpForm.at("address.city").name).toBe("city");
    expect(signUpForm.name).toBe("");
    expect(s.get("missing").annotations).toEqual({});
  });

  test("fields come in order, then the fields it leaves out, and are the handles at gives", () => {
    const { s } = annotated();
    const signUpForm = s.get("form");

    expect(signUpForm.fields.map((field) => field.name)).toEqual([
      "plan",
      "email",
      "seats",
      "country",
      "nickname",
      "address",
      "a.b",
    ]);
    expect(signUpForm.fields[0]).toBe(signUpForm.at("plan"));
    expect(signUpForm.fields).toBe(signUpForm.fields);
    // A field beside a reference orders the referenced schema's fields for that use only.
    expect(signUpForm.at("address").fields.map((field) => field.path)).toEqual([
      "address.postcode",
      "address.city",
      "address.street",
    ]);
    expect(s.get("postal").fields.map((field) => field.name)).toEqual([
      "street",
      "city",
      "postcode",
    ]);
    // A key a path would read otherwise still has a handle of its own.
    const dotted = signUpForm.fields[6];
    expect(dotted.name).toBe("a.b");
    expect(codes(dotted.validate(1).issues)).toEqual([["type", ""]]);
    expect(signUpForm.at("email").fields).toEqual([]);
    expect(s.get("missing").fields).toEqual([]);
  });

  test("options carry each choice's title and what its vocabulary declares", () => {
    const { s } = annotated();
    const signUpForm = s.get("form");

    expect(signUpForm.at("plan").options).toEqual([
      { value: "free", title: "Free" },
      { value: "pro", title: "Pro", badge: "popular" },
      { value: "team", title: "Team" },
    ]);
    expect(signUpForm.at("seats").options).toEqual([
      { value: 1, title: "Just me" },
      { value: 5 },
      { value: null, title: "Not sure" },
    ]);
    expect(signUpForm.at("country").options).toEqual([
      { value: "GB", title: "United Kingdom", flag: "gb" },
      { value: "NL", title: "Netherlands", flag: "nl" },
    ]);
    // A nullable field's branches carry a field's annotations, so they make no choices.
    expect(signUpForm.at("nickname").options).toEqual([]);
    expect(signUpForm.at("plan").option("pro")?.badge).toBe("popular");
    expect(signUpForm.options.plan[1].title).toBe("Pro");
    expect(Object.isFrozen(signUpForm.at("plan").options[0])).toBe(true);
  });

  test("issues carry the field's title, and an enum's issue its choices' titles when every choice has one", () => {
    const { s } = annotated();

    expect(s.validate("form", {}).issues!.map(({ params }) => params)).toEqual([
      { key: "email", title: "Email address" },
      { key: "plan", title: "Plan" },
      { key: "country", title: "Country of residence" },
    ]);

    const issues = s.validate("form", {
      email: 1,
      plan: "gold",
      seats: 7,
      country: "FR",
      nickname: "abcd",
      extra: true,
    }).issues!;
    expect(issues.map(({ code, params }) => [code, params])).toEqual([
      ["type", { type: "string", received: "number", title: "Email address" }],
      [
        "enum",
        { options: ["free", "pro", "team"], titles: ["Free", "Pro", "Team"], title: "Plan" },
      ],
      ["enum", { options: [1, 5, null] }],
      [
        "enum",
        {
          options: ["GB", "NL"],
          titles: ["United Kingdom", "Netherlands"],
          title: "Country of residence",
        },
      ],
      ["maxLength", { maxLength: 3, length: 4, title: "Nickname" }],
      ["additionalProperties", { key: "extra" }],
    ]);
    expect(issues[1].message).toBe('Value at "plan" must be one of Free, Pro, Team.');

    const worded = annotated({ messages: { required: "{title} is required" } }).s;
    expect(worded.validate("form", { plan: "free", country: "GB" }).issues![0].message).toBe(
      "Email address is required",
    );

    const checked = s.get("form", { refine: [{ key: "free", path: "email", check: () => false }] });
    expect(checked.validate(filled).issues![0].params).toEqual({
      refine: "free",
      title: "Email address",
    });
  });

  test("annotations never change what validation accepts", () => {
    const strip = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(strip);
      if (!node || typeof node !== "object") return node;
      return Object.fromEntries(
        Object.entries(node)
          .filter(([key]) => key !== "annotations")
          .map(([key, value]) => [key, key === "enum" || key === "const" ? value : strip(value)]),
      );
    };
    const { s } = annotated();
    const bare = setup(
      undefined,
      datafile(strip({ form, country, postal }) as Record<string, DatafileSchema>),
    ).s;

    for (const value of [{}, filled, { ...filled, plan: "gold", nickname: "abcd" }, 42]) {
      expect(codes(s.validate("form", value).issues)).toEqual(
        codes(bare.validate("form", value).issues),
      );
    }
  });
});

describe("mutations under conditions", () => {
  // As Core writes them in a datafile: conditions as trees, `mutate` compiled into operations.
  const signUp: DatafileSchema = {
    hash: "m1",
    type: "object",
    properties: {
      accountType: { type: "string", enum: ["personal", "business"] },
      displayName: { type: "string", minLength: 3, maxLength: 10 },
      taxId: { type: "string" },
      address: { schema: "postal" },
    },
    required: ["accountType", "displayName"],
    mutations: [
      {
        key: "germanBusiness",
        conditions: {
          and: [
            { input: "accountType", operator: "equals", value: "business" },
            { input: "address.country", operator: "equals", value: "DE" },
          ],
        },
        operations: [
          { op: "appendUnique", path: ["required"], value: "taxId" },
          { op: "set", path: ["properties", "taxId", "pattern"], value: "^DE[0-9]{9}$" },
          {
            op: "set",
            path: ["properties", "taxId", "messages"],
            value: { pattern: "Enter a German VAT number, such as DE123456789" },
          },
        ],
      },
      {
        key: "payingAccounts",
        conditions: "paying",
        operations: [{ op: "set", path: ["properties", "displayName", "maxLength"], value: 20 }],
      },
      {
        key: "relaxedNames",
        conditions: [{ feature: "relaxedNames" }],
        operations: [{ op: "set", path: ["properties", "displayName", "minLength"], value: 1 }],
      },
    ],
  } as unknown as DatafileSchema;
  const postal = {
    hash: "p1",
    type: "object",
    properties: { country: { type: "string" }, state: { type: "string" } },
    mutations: [
      {
        key: "unitedStates",
        conditions: [{ input: "country", operator: "equals", value: "US" }],
        operations: [{ op: "set", path: ["required"], value: ["state"] }],
      },
    ],
  } as unknown as DatafileSchema;

  // `valueFrom` reads the other side of a comparison from another field.
  const shipping = {
    hash: "s1",
    type: "object",
    properties: {
      billingCountry: { type: "string" },
      shippingCountry: { type: "string" },
      customsDescription: { type: "string" },
    },
    required: ["billingCountry"],
    mutations: [
      {
        key: "shipsAbroad",
        conditions: [
          {
            input: "shippingCountry",
            operator: "notEquals",
            valueFrom: { input: "billingCountry" },
          },
        ],
        operations: [{ op: "appendUnique", path: ["required"], value: "customsDescription" }],
      },
    ],
  } as unknown as DatafileSchema;

  function mutating(relaxed = false) {
    const f = createFeaturevisor({
      datafile: {
        schemaVersion: "4",
        revision: "1",
        segments: {
          paying: {
            hash: "g1",
            conditions: [{ attribute: "plan", operator: "equals", value: "paid" }],
          },
        },
        features: {
          relaxedNames: {
            hash: "f1",
            bucketBy: "userId",
            traffic: [{ key: "all", conditions: "*", percentage: relaxed ? 100000 : 0 }],
          },
        },
        variables: {},
        schemas: { signUp, postal, shipping },
      } as unknown as DatafileContent,
      logLevel: "fatal",
      context: { userId: "user-1" },
    });
    return createSchemas(f);
  }
  const personal = { accountType: "personal", displayName: "Ada" };

  test("input conditions change the rules for the value being validated", () => {
    const s = mutating();

    expect(
      s.validate("signUp", { ...personal, address: { country: "DE" } }).issues,
    ).toBeUndefined();

    const business = { accountType: "business", displayName: "Ada", address: { country: "DE" } };
    expect(codes(s.validate("signUp", business).issues)).toEqual([["required", "taxId"]]);

    const wrong = s.validate("signUp", { ...business, taxId: "NL1" }).issues!;
    expect(codes(wrong)).toEqual([["pattern", "taxId"]]);
    expect(wrong[0].message).toBe("Enter a German VAT number, such as DE123456789");
    expect(s.validate("signUp", { ...business, taxId: "DE123456789" }).issues).toBeUndefined();
  });

  test("valueFrom compares one field with another", () => {
    const s = mutating();

    expect(
      s.validate("shipping", { billingCountry: "NL", shippingCountry: "NL" }).issues,
    ).toBeUndefined();
    expect(
      codes(s.validate("shipping", { billingCountry: "NL", shippingCountry: "DE" }).issues),
    ).toEqual([["required", "customsDescription"]]);
    expect(
      s.validate("shipping", {
        billingCountry: "NL",
        shippingCountry: "DE",
        customsDescription: "Books",
      }).issues,
    ).toBeUndefined();
  });

  test("context conditions read segments and features through the SDK", () => {
    const s = mutating();
    const longer = { ...personal, displayName: "Ada Lovelace" };

    expect(codes(s.validate("signUp", longer).issues)).toEqual([["maxLength", "displayName"]]);
    expect(s.validate("signUp", longer, { plan: "paid" }).issues).toBeUndefined();

    const short = { ...personal, displayName: "A" };
    expect(codes(s.validate("signUp", short).issues)).toEqual([["minLength", "displayName"]]);
    expect(mutating(true).validate("signUp", short).issues).toBeUndefined();
  });

  test("a mutation in a referenced schema reads that schema's own value, in every form that uses it", () => {
    const s = mutating();
    const american = { ...personal, address: { country: "US" } };

    expect(codes(s.validate("signUp", american).issues)).toEqual([["required", "address.state"]]);
    expect(codes(s.get("postal").validate({ country: "US" }).issues)).toEqual([
      ["required", "state"],
    ]);
    // A field's handle applies the mutations inside the field.
    expect(codes(s.get("signUp").at("address").validate({ country: "US" }).issues)).toEqual([
      ["required", "state"],
    ]);
    expect(s.get("signUp").at("address").validate({ country: "GB" }).issues).toBeUndefined();
  });

  test("every mutation that matches applies, and each combination answers the same every time", () => {
    const s = mutating(true);
    const value = {
      accountType: "business",
      displayName: "A Lovelace Ltd",
      address: { country: "DE" },
    };

    for (let run = 0; run < 3; run++) {
      expect(codes(s.validate("signUp", value, { plan: "paid" }).issues)).toEqual([
        ["required", "taxId"],
      ]);
      expect(codes(s.validate("signUp", value).issues)).toEqual([
        ["required", "taxId"],
        ["maxLength", "displayName"],
      ]);
    }
  });

  test("constraints, options and kinds read the base rules, which no condition changes", () => {
    const s = mutating();

    expect(s.get("signUp").constraints.displayName).toEqual({
      required: true,
      minLength: 3,
      maxLength: 10,
    });
    expect(s.get("signUp").constraints.taxId).toEqual({});
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
      // Clearing a nullable field is how a form sets it to null.
      nickname: null,
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

  test("a row left empty keeps its index, so issues sit at the inputs they are about", () => {
    const { s } = setup();
    const data = new URLSearchParams(
      "email=a@b.c&displayName=Ada&items[0].name=&items[0].quantity=&items[1].name=Ink&items[1].quantity=0&tags[1]=vip",
    );

    const value = s.get("signUp").fromFormData(data) as Record<string, unknown>;

    expect(value.items).toEqual([{}, { name: "Ink", quantity: 0 }]);
    // A list of values closes its gaps, since an empty value cannot hold a place.
    expect(value.tags).toEqual(["vip"]);
    expect(codes(s.validate("signUp", value).issues)).toEqual([
      ["required", "items.0.name"],
      ["minimum", "items.1.quantity"],
    ]);

    // A row no input names at all is kept too.
    const gap = s.get("signUp").fromFormData(new URLSearchParams("items[1].name=Ink")) as Record<
      string,
      unknown
    >;
    expect(gap.items).toEqual([{}, { name: "Ink" }]);
  });

  test("a required list with nothing chosen reads as [], and an optional one stays absent", () => {
    const { s } = setup(
      undefined,
      datafile({
        prefs: {
          hash: "p1",
          type: "object",
          properties: {
            topics: { type: "array", items: { type: "string", enum: ["news", "deals"] } },
            extras: { type: "array", items: { type: "string" } },
            note: { oneOf: [{ type: "string" }, { const: null }] },
          },
          required: ["topics"],
        },
      }),
    );

    const value = s.get("prefs").fromFormData(new URLSearchParams("topics=&note="));

    expect(value).toEqual({ topics: [], note: null });
    expect(s.isValid("prefs", value)).toBe(true);
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

  test("an aborted signal leaves checks that answer at once synchronous", () => {
    const { s } = setup();
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    const handle = s.get("signUp", {
      refine: [{ key: "named", path: "displayName", check: (name: string) => name !== "Bob" }],
    });

    const result = handle.validate({ ...valid, displayName: "Bob" }, { signal: controller.signal });

    expect(codes((result as SchemaResult<unknown>).issues)).toEqual([["refine", "displayName"]]);
  });

  test("a translator that throws rejects an asynchronous validation, never leaving it pending", async () => {
    const { s } = setup({
      message: () => {
        throw new Error("translator broke");
      },
    });
    const handle = s.get("signUp", {
      refine: [{ key: "free", path: "email", check: async () => false }],
    });

    await expect(handle.validate(valid)).rejects.toThrow("translator broke");
  });

  test("a check on every value of an open object runs in the handle of one value", () => {
    const { s } = setup(
      undefined,
      datafile({
        labels: { hash: "l1", type: "object", additionalProperties: { type: "string" } },
      }),
    );
    const handle = s.get("labels", {
      refine: [
        { key: "lower", path: "*", check: (label: string) => label === label.toLowerCase() },
      ],
    });

    expect(codes(handle.validate({ en: "Hi" }).issues)).toEqual([["refine", "en"]]);
    expect(codes(handle.at("en").validate("Hi").issues)).toEqual([["refine", ""]]);
    expect(handle.at("en").validate("hi").issues).toBeUndefined();
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

describe("hardening", () => {
  test("a required key must be the value's own, never inherited", () => {
    const { s } = setup(
      undefined,
      datafile({
        named: {
          type: "object",
          properties: { constructor: { type: "string" as const } },
          required: ["constructor"],
        },
      }),
    );

    expect(codes(s.validate("named", {}).issues)).toEqual([["required", "constructor"]]);
    expect(s.isValid("named", { constructor: "Ada" })).toBe(true);
  });

  test("annotations and a choice's entry can never set a prototype, nor a choice's value", () => {
    // JSON reads `__proto__` as an own key, as a datafile does.
    const { plan, plans } = JSON.parse(
      '{"plan":{"hash":"p1","enum":["free"],"annotations":{"__proto__":{"polluted":true},"options":{"free":{"title":"Free","value":"paid","__proto__":{"polluted":true}}}}},' +
        '"plans":{"hash":"p2","type":"object","properties":{"plan":{"schema":"plan","annotations":{"title":"Plan","__proto__":{"polluted":true}}}}}}',
    );
    const { s } = setup(undefined, datafile({ plan, plans }));
    const option = s.get("plan").option("free") as Record<string, unknown>;

    expect(option.value).toBe("free");
    expect(option.title).toBe("Free");
    // A field's annotations merge over the referenced schema's, and the schema's own are copied.
    for (const made of [option, s.get("plan").annotations, s.get("plans").at("plan").annotations]) {
      expect(Object.getPrototypeOf(made)).toBe(Object.prototype);
      expect((made as Record<string, unknown>).polluted).toBeUndefined();
    }
    expect(s.get("plans").at("plan").annotations.title).toBe("Plan");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("a form name can never reach a prototype", () => {
    const { s } = setup(
      undefined,
      datafile({
        labels: {
          type: "object",
          additionalProperties: { type: "object", additionalProperties: { type: "string" } },
        },
      }),
    );
    const data = new URLSearchParams("__proto__.polluted=yes&en.title=Hello");

    const value = s.get("labels").fromFormData(data) as Record<string, unknown>;

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
    expect(value.en).toEqual({ title: "Hello" });
  });

  test("a Date or a File is not an object, and says what it is", () => {
    const { s } = setup(
      undefined,
      datafile({
        profile: {
          type: "object",
          properties: { name: { type: "string" }, born: { type: "object" } },
        },
      }),
    );

    const result = s.validate("profile", { name: new File(["x"], "x.txt"), born: new Date(0) });

    expect(result.issues!.map(({ path, params }) => [path.join("."), params.received])).toEqual([
      ["name", "file"],
      ["born", "date"],
    ]);
  });

  test("form data reads a field typed only by its listed values", () => {
    const { s } = setup(
      undefined,
      datafile({
        order: { type: "object", properties: { size: { enum: [1, 2, 3] }, gift: { const: true } } },
      }),
    );

    expect(s.get("order").fromFormData(new URLSearchParams("size=2&gift=true"))).toEqual({
      size: 2,
      gift: true,
    });
  });

  test("a oneOf follows a referenced schema that changes, as do constraints through it", () => {
    const { f, s } = setup(
      undefined,
      datafile({
        name: { hash: "n1", type: "string", maxLength: 5 },
        person: {
          hash: "p1",
          type: "object",
          properties: {
            name: { oneOf: [{ schema: "name" }, { const: null }] },
            nick: { schema: "name" },
          },
        },
      }),
    );
    expect(s.isValid("person", { name: 5 })).toBe(false);
    expect(s.get("person").constraints.nick).toEqual({ maxLength: 5 });

    // A partial datafile changes only the referenced schema.
    f.setDatafile(datafile({ name: { hash: "n2", type: "integer", maximum: 9 } }, "2"));

    expect(s.isValid("person", { name: 5 })).toBe(true);
    expect(s.get("person").constraints.nick).toEqual({ max: 9, step: 1 });
  });
});

describe("conveniences", () => {
  test("kind says what a field's rules make it", () => {
    const { s } = setup(
      undefined,
      datafile({
        signUp,
        address,
        form: {
          hash: "f1",
          type: "object",
          properties: {
            name: { type: "string" },
            startsAt: { type: "string", format: "date-time" },
            appVersion: { type: "string", format: "semver" },
            age: { type: "integer" },
            plan: { oneOf: [{ const: "free" }, { const: "pro" }] },
            fixed: { const: "web" },
            nickname: { oneOf: [{ type: "string" }, { const: null }] },
            payment: { oneOf: [{ type: "string" }, { type: "integer" }] },
            notes: { type: "array" },
          },
        },
      }),
    );
    const field = (path: string) => s.get("form").at(path).kind;

    expect(s.get("form").kind).toBe("object");
    expect(field("name")).toBe("text");
    expect(field("startsAt")).toBe("date-time");
    expect(field("appVersion")).toBe("version");
    expect(field("age")).toBe("number");
    expect(field("plan")).toBe("select");
    expect(field("fixed")).toBe("select");
    expect(field("nickname")).toBe("text");
    expect(field("payment")).toBeUndefined();
    expect(field("notes")).toBe("list");
    expect(s.get("signUp").at("country").kind).toBe("select");
    expect(s.get("signUp").at("marketingConsent").kind).toBe("boolean");
    expect(s.get("signUp").at("tags").kind).toBe("multiselect");
    expect(s.get("signUp").at("items").kind).toBe("list");
    expect(s.get("signUp").at("address").kind).toBe("object");
    expect(s.get("missing").kind).toBeUndefined();
  });

  test("a choice between booleans has the kind boolean, for a checkbox", () => {
    const { s } = setup(
      undefined,
      datafile({
        terms: {
          hash: "t1",
          type: "object",
          properties: {
            acceptTerms: { const: true },
            either: { enum: [true, false, null] },
            plan: { enum: ["free", "pro"] },
          },
        },
      }),
    );
    const terms = s.get("terms");

    expect(terms.at("acceptTerms").kind).toBe("boolean");
    expect(terms.at("either").kind).toBe("boolean");
    expect(terms.at("plan").kind).toBe("select");
  });

  test("a oneOf of consts reports enum, with its values, as an enum does", () => {
    const { s } = setup(
      undefined,
      datafile({ plan: { hash: "p1", oneOf: [{ const: "free" }, { const: "pro" }] } }),
    );

    expect(s.validate("plan", "pro")).toEqual({ value: "pro" });
    expect(s.validate("plan", "gold").issues![0]).toMatchObject({
      code: "enum",
      params: { options: ["free", "pro"] },
    });
    expect(s.get("plan").options).toEqual([{ value: "free" }, { value: "pro" }]);
  });

  test("parse gives the value, or throws a SchemaError with the issues", async () => {
    const { s } = setup();

    expect(s.parse("coupon", "ABCD1234")).toBe("ABCD1234");
    expect(s.get("coupon").parse("ABCD1234")).toBe("ABCD1234");

    let thrown: unknown;
    try {
      s.parse("signUp", { email: "nope" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SchemaError);
    expect(thrown).toBeInstanceOf(Error);
    const error = thrown as SchemaError;
    expect(error.name).toBe("SchemaError");
    expect(error.schema).toBe("signUp");
    expect(error.message).toBe('signUp: 2 issues. Value at "displayName" is required.');
    expect(error.flattened.fieldErrors).toEqual({
      email: ["Enter an email like ada@example.com"],
      displayName: ['Value at "displayName" is required.'],
    });

    const free = s.get("coupon", {
      refine: [{ key: "unused", check: async (code: string) => code !== "USED1234" }],
    });
    await expect(free.parse("ABCD1234")).resolves.toBe("ABCD1234");
    await expect(free.parse("USED1234")).rejects.toBeInstanceOf(SchemaError);
  });

  test("keys and has tell which schemas the datafile has", () => {
    const { f, s } = setup();

    expect(s.keys()).toEqual(["signUp", "address", "coupon"]);
    expect(s.has("coupon")).toBe(true);
    expect(s.has("missing")).toBe(false);

    f.setDatafile(datafile({ coupon }, "2"), true);
    expect(s.keys()).toEqual(["coupon"]);
    expect(s.has("signUp")).toBe(false);
  });

  test("subscribe calls back when a datafile changes the schema, through a reference too", () => {
    const { f, s } = setup();
    const calls: string[] = [];
    const stopSignUp = s.get("signUp").subscribe(() => calls.push("signUp"));
    s.get("signUp")
      .at("address.city")
      .subscribe(() => calls.push("city"));
    s.get("coupon").subscribe(() => calls.push("coupon"));

    // Unchanged hashes call nothing.
    f.setDatafile(datafile(undefined, "2"));
    expect(calls).toEqual([]);

    // A referenced schema's change changes the hash of the schemas that reference it.
    f.setDatafile(
      datafile(
        { signUp: { ...signUp, hash: "s2" }, address: { ...address, hash: "a2" }, coupon },
        "3",
      ),
    );
    expect(calls).toEqual(["signUp", "city"]);

    stopSignUp();
    f.setDatafile(datafile({ signUp: { ...signUp, hash: "s3" }, address, coupon }, "4"));
    expect(calls).toEqual(["signUp", "city", "city"]);

    s.close();
    f.setDatafile(datafile({ signUp, address, coupon: { ...coupon, hash: "c2" } }, "5"));
    expect(calls).toEqual(["signUp", "city", "city"]);
  });

  test("formAction answers with issues and what was typed, or runs the action", async () => {
    const { s } = setup(
      undefined,
      datafile({
        profile: {
          hash: "p1",
          type: "object",
          properties: {
            name: { type: "string", minLength: 2 },
            avatar: { type: "string" },
            newsletter: { type: "boolean" },
          },
          required: ["name"],
        },
      }),
    );
    const saved: unknown[] = [];
    const action = formAction(s.get("profile"), (value, { previousState }) => {
      saved.push(value);
      return { profileId: "profile-1", previouslyOk: previousState.ok };
    });

    const failed = new FormData();
    failed.append("name", "A");
    failed.append("avatar", new File(["x"], "avatar.png"));
    const first = await action(initialFormState, failed);
    expect(first.ok).toBe(false);
    expect(Object.keys(first.errors.fieldErrors)).toEqual(["name", "avatar"]);
    // A file cannot travel back from a server action, so what was typed leaves it out.
    expect(first.values).toEqual({ name: "A", newsletter: false });
    expect(saved).toEqual([]);

    const passed = new FormData();
    passed.append("name", "Ada");
    const second = await action(first, passed);
    expect(second).toEqual({
      ok: true,
      errors: { formErrors: [], fieldErrors: {} },
      profileId: "profile-1",
      previouslyOk: false,
    });
    expect(saved).toEqual([{ name: "Ada", newsletter: false }]);
    expect(Object.isFrozen(initialFormState.errors.formErrors)).toBe(true);
  });

  test("formAction validates with the request's context, and never sends omitted fields back", async () => {
    const { s } = setup({
      // The instance's context says nl, so a request's context has to reach the message.
      messages: {
        minimum: (_params, { context }) => (context.locale === "en" ? "Too young" : "Te jong"),
      },
    });
    const accounts = s.get("signUp");
    const data = new URLSearchParams("email=a@b.c&displayName=Ada&age=5&items[0].name=Pen");

    const english = formAction(accounts, () => undefined, {
      context: async (formData) => ({ locale: String(formData.get("lang") || "en") }),
      omit: ["email", "items[].name"],
    });
    const state = await english(initialFormState, data);

    expect(state.errors.fieldErrors).toEqual({ age: ["Too young"] });
    expect(state.values).toEqual({
      displayName: "Ada",
      age: 5,
      items: [{}],
      marketingConsent: false,
    });

    const dutch = await formAction(accounts, () => undefined)(initialFormState, data);
    expect(dutch.errors.fieldErrors).toEqual({ age: ["Te jong"] });
  });
});
