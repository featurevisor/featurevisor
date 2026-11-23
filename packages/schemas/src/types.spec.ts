import { createFeaturevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

import { createSchemas, formAction } from "./index";
import type {
  BuiltInAnnotations,
  ConstraintsOf,
  FieldConstraints,
  FieldKind,
  FieldPath,
  FieldValue,
  InferSchema,
  SchemaHandle,
  SchemaKey,
  SchemaOption,
} from "./types";

type IsAny<T> = 0 extends 1 & T ? true : false;

type IsExact<TActual, TExpected> =
  IsAny<TActual> extends true
    ? IsAny<TExpected>
    : IsAny<TExpected> extends true
      ? false
      : [TActual] extends [TExpected]
        ? [TExpected] extends [TActual]
          ? true
          : false
        : false;

function expectExactType<T extends true>(value: T): void {
  expect(value).toBe(true);
}

/** As generated code types a schema, with an optional key, a nullable one, arrays and an open object. */
type SignUp = {
  email: string;
  displayName: string;
  country?: "GB" | "NL";
  nickname?: string | null;
  address?: { city: string; postcode?: string };
  items?: { name: string; quantity: number }[];
  tags?: string[];
  labels?: { [key: string]: string };
  extra?: { [key: string]: unknown };
};

interface SchemaTypes {
  signUp: SignUp;
  coupon: string;
}

function typed() {
  const f = createFeaturevisor({
    datafile: {
      schemaVersion: "4",
      revision: "1",
      segments: {},
      features: {},
      variables: {},
      schemas: { coupon: { hash: "c1", type: "string" } },
    } as DatafileContent,
    logLevel: "fatal",
  });
  return createSchemas<SchemaTypes>(f);
}

describe("typed field paths", () => {
  test("at takes the fields of the schema, in every form, and types each field's handle", () => {
    const signUp = typed().get("signUp");

    expectExactType<IsExact<typeof signUp, SchemaHandle<SignUp>>>(true);
    expectExactType<IsExact<ReturnType<typeof signUp.at<"address.city">>, SchemaHandle<string>>>(
      true,
    );
    expectExactType<IsExact<FieldValue<SignUp, "country">, "GB" | "NL">>(true);
    expectExactType<IsExact<FieldValue<SignUp, "nickname">, string | null>>(true);
    expectExactType<IsExact<FieldValue<SignUp, "items.0.quantity">, number>>(true);
    expectExactType<IsExact<FieldValue<SignUp, "items[0].name">, string>>(true);
    expectExactType<IsExact<FieldValue<SignUp, "items[].name">, string>>(true);
    expectExactType<IsExact<FieldValue<SignUp, "items">, { name: string; quantity: number }[]>>(
      true,
    );
    expectExactType<IsExact<FieldValue<SignUp, "tags[]">, string>>(true);
    expectExactType<IsExact<FieldValue<SignUp, "labels.*">, string>>(true);
    expectExactType<IsExact<FieldValue<SignUp, "labels.en">, string>>(true);

    signUp.at("address.postcode");
    signUp.at("items.12.name");
    // @ts-expect-error a field the schema lacks
    signUp.at("displayNam");
    // @ts-expect-error a nullable value is a oneOf, where at stops
    signUp.at("nickname.length");
    // @ts-expect-error a key an object does not list, when it takes no other keys
    signUp.at("address.street");
    // @ts-expect-error an object that takes any other key holds values of no known type
    signUp.at("extra.anything");
  });

  test("a field's own handle takes paths from the field", () => {
    const address = typed().get("signUp").at("address");

    expectExactType<IsExact<ReturnType<typeof address.at<"city">>, SchemaHandle<string>>>(true);
    // @ts-expect-error paths are relative to the field
    address.at("address.city");
  });

  test("a value that is not an object or an array has no fields", () => {
    expectExactType<IsExact<FieldPath<string>, never>>(true);
  });

  test("an untyped handle takes any path", () => {
    const f = createFeaturevisor({ logLevel: "fatal" });
    const handle = createSchemas(f).get("signUp");

    expectExactType<IsExact<FieldPath<unknown>, string>>(true);
    expectExactType<IsExact<ReturnType<typeof handle.at<"any.path">>, SchemaHandle<unknown>>>(true);
    expect(handle.at("any.path").path).toBe("any.path");
  });

  test("checks are typed by their path, and their reads are field paths", () => {
    const s = typed();

    const handle = s.get("signUp", {
      refine: [
        {
          key: "nameFree",
          path: "displayName",
          check: (name) => name.length > 0,
        },
        {
          key: "itemsCounted",
          path: "items[].quantity",
          reads: ["items"],
          check: (quantity) => quantity > 0,
        },
        {
          key: "whole",
          check: (value) => value.email.length > 0,
        },
      ],
    });
    expectExactType<IsExact<typeof handle, SchemaHandle<SignUp>>>(true);
    expect(handle.key).toBe("signUp");

    const free = s.get("signUp", {
      refine: [{ key: "free", path: "email", check: async (email) => email !== "taken" }],
    });
    expectExactType<IsExact<typeof free, SchemaHandle<SignUp, true>>>(true);
    expect(free.key).toBe("signUp");

    s.get("signUp", {
      // @ts-expect-error a path the schema lacks
      refine: [{ key: "typo", path: "emial", check: () => true }],
    });
    s.get("signUp", {
      // @ts-expect-error reads are field paths too
      refine: [{ key: "typo", path: "email", reads: ["emial"], check: () => true }],
    });
  });

  test("parse, options, option, kind and the helpers are typed by the schema", () => {
    const s = typed();
    const signUp = s.get("signUp");

    expectExactType<IsExact<ReturnType<typeof signUp.parse>, SignUp>>(true);
    expectExactType<IsExact<ReturnType<typeof s.parse<"coupon">>, string>>(true);
    expectExactType<IsExact<InferSchema<typeof signUp>, SignUp>>(true);
    expectExactType<IsExact<SchemaKey<typeof s>, "signUp" | "coupon">>(true);
    expectExactType<IsExact<typeof signUp.kind, FieldKind | undefined>>(true);

    const country = signUp.at("country");
    expectExactType<IsExact<typeof country.options, ReadonlyArray<SchemaOption<"GB" | "NL">>>>(
      true,
    );
    expectExactType<
      IsExact<ReturnType<typeof country.option>, SchemaOption<"GB" | "NL"> | undefined>
    >(true);
    country.option("GB");
    // @ts-expect-error a value the field does not allow
    country.option("FR");

    const tags = signUp.at("tags");
    expectExactType<IsExact<typeof tags.options, ReadonlyArray<SchemaOption<string>>>>(true);
    expect(tags.path).toBe("tags");

    expectExactType<
      IsExact<NonNullable<typeof signUp.options.country>, ReadonlyArray<SchemaOption<"GB" | "NL">>>
    >(true);

    const key: string = "coupon";
    if (s.has(key)) expectExactType<IsExact<typeof key, "signUp" | "coupon">>(true);
    expect(s.has("coupon")).toBe(true);
  });

  test("a union's constraints are its own, as the runtime gives a oneOf's", () => {
    // The repository compiles without strictNullChecks, so a union with a string stands in for a nullable object.
    expectExactType<IsExact<ConstraintsOf<{ city: string } | string>, FieldConstraints>>(true);
    expectExactType<IsExact<ConstraintsOf<string[] | number>, FieldConstraints>>(true);
    expectExactType<
      IsExact<NonNullable<ConstraintsOf<{ city: string }>["city"]>, FieldConstraints>
    >(true);
  });

  test("annotations and options are typed by the schema's vocabularies", () => {
    type FormAnnotations = { placeholder?: string; input?: "text" | "email" };
    type CountryOption = { flag?: string };
    interface Vocabularies {
      signUp: { annotations: FormAnnotations; options: CountryOption };
      // As generated code writes a schema without vocabularies.
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      coupon: { annotations: {}; options: {} };
    }
    const f = createFeaturevisor({ logLevel: "fatal" });
    const s = createSchemas<SchemaTypes, Vocabularies>(f);
    const signUp = s.get("signUp");
    const email = signUp.at("email");

    expectExactType<IsExact<typeof email.annotations.placeholder, string | undefined>>(true);
    expectExactType<IsExact<typeof email.annotations.input, "text" | "email" | undefined>>(true);
    expectExactType<IsExact<typeof email.annotations.title, string | undefined>>(true);
    // @ts-expect-error an annotation the vocabulary does not declare
    void email.annotations.placeholdr;

    const choice = signUp.at("country").option("GB");
    expectExactType<IsExact<NonNullable<typeof choice>["value"], "GB" | "NL">>(true);
    expectExactType<IsExact<NonNullable<typeof choice>["flag"], string | undefined>>(true);
    // @ts-expect-error a field a choice does not carry
    void choice?.flg;

    // A schema without vocabularies has the built in annotations only.
    const coupon = s.get("coupon");
    expectExactType<IsExact<typeof coupon.annotations, BuiltInAnnotations>>(true);
    // @ts-expect-error not built in, and no vocabulary declares it
    void coupon.annotations.placeholder;

    // An untyped handle reads any annotation, and a typed handle fits where one is asked for.
    const untyped: SchemaHandle<string> = email;
    expectExactType<IsExact<typeof untyped.annotations.placeholder, unknown>>(true);
    expect(untyped.path).toBe("email");
    expect(signUp.fields).toEqual([]);
  });

  test("formAction omits fields by the schema's field paths", () => {
    const signUp = typed().get("signUp");

    const action = formAction(signUp, () => undefined, { omit: ["email", "items[].name"] });
    // @ts-expect-error a field the schema lacks
    formAction(signUp, () => undefined, { omit: ["emial"] });
    expect(typeof action).toBe("function");
  });
});
