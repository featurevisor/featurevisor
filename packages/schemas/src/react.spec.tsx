import * as React from "react";
import { act, render } from "@testing-library/react";
import { createFeaturevisor } from "@featurevisor/sdk";
import { FeaturevisorProvider, FeaturevisorScope } from "@featurevisor/react";
import type { DatafileContent, DatafileSchema } from "@featurevisor/types";

import { createSchemas } from "./index";
import { SchemasProvider, useSchema, useSchemas, useValidation } from "./react";

const signUp: DatafileSchema = {
  hash: "s1",
  type: "object",
  properties: {
    username: { type: "string", minLength: 3 },
    country: { type: "string", enum: ["GB", "NL"] },
  },
  required: ["username"],
};

const coupon: DatafileSchema = { hash: "c1", type: "string", pattern: "^[A-Z0-9]{8}$" };

function datafile(schemas: Record<string, DatafileSchema> = { signUp, coupon }, revision = "1") {
  return {
    schemaVersion: "4",
    revision,
    segments: {},
    features: {},
    variables: {},
    schemas,
  } as DatafileContent;
}

function sdk() {
  return createFeaturevisor({
    datafile: datafile(),
    logLevel: "fatal",
    context: { userId: "user-1" },
  });
}

function wait(ms: number) {
  return new Promise((done) => setTimeout(done, ms));
}

describe("useSchema", () => {
  test("works under a FeaturevisorProvider alone, and renders again when the schema changes", () => {
    const f = sdk();
    let renders = 0;
    function Form() {
      renders++;
      const handle = useSchema("signUp");
      return <span data-testid="options">{JSON.stringify(handle.options)}</span>;
    }
    const view = render(
      <FeaturevisorProvider instance={f}>
        <Form />
      </FeaturevisorProvider>,
    );
    expect(view.getByTestId("options").textContent).toBe('{"country":["GB","NL"]}');

    // Context changes never render it again, since schemas do not depend on it here.
    act(() => f.setContext({ plan: "pro" }));
    // A datafile that leaves the schema as it was renders nothing again.
    act(() => void f.setDatafile(datafile({ signUp, coupon }, "2")));
    expect(renders).toBe(1);

    act(
      () =>
        void f.setDatafile(
          datafile(
            {
              signUp: {
                ...signUp,
                hash: "s2",
                properties: {
                  ...signUp.properties,
                  country: { type: "string", enum: ["GB", "NL", "BE"] },
                },
              },
            },
            "3",
          ),
        ),
    );
    expect(view.getByTestId("options").textContent).toBe('{"country":["GB","NL","BE"]}');
    expect(renders).toBe(2);
  });

  test("keeps one handle for the component, reading the latest inline options", () => {
    const f = sdk();
    const handles = new Set<unknown>();
    let setWording: (text: string) => void = () => {};
    let result: unknown;
    function Form() {
      const [wording, setter] = React.useState("first");
      setWording = setter;
      const handle = useSchema("signUp", { messages: { username: { minLength: wording } } });
      handles.add(handle);
      result = handle.validate({ username: "ab" });
      return null;
    }
    render(
      <FeaturevisorProvider instance={f}>
        <Form />
      </FeaturevisorProvider>,
    );
    act(() => setWording("second"));

    expect(handles.size).toBe(1);
    expect((result as { issues: { message: string }[] }).issues[0].message).toBe("second");
  });

  test("SchemasProvider's messages apply, and an instance can be passed in", () => {
    const f = sdk();
    let message = "";
    function Form() {
      const handle = useSchema("coupon");
      message = (handle.validate("x").issues || [])[0]?.message || "";
      return null;
    }
    render(
      <FeaturevisorProvider instance={f}>
        <SchemasProvider messages={{ pattern: "Check the code" }}>
          <Form />
        </SchemasProvider>
      </FeaturevisorProvider>,
    );
    expect(message).toBe("Check the code");

    const own = createSchemas(sdk(), { messages: { pattern: "From elsewhere" } });
    render(
      <SchemasProvider schemas={own}>
        <Form />
      </SchemasProvider>,
    );
    expect(message).toBe("From elsewhere");
  });

  test("throws without a provider", () => {
    function Form() {
      useSchemas();
      return null;
    }
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Form />)).toThrow("needs a SchemasProvider or a FeaturevisorProvider");
    jest.restoreAllMocks();
  });

  test("checks keep their answers per value, and the latest validation wins", async () => {
    const f = sdk();
    const asked: string[] = [];
    const answers = new Map<string, (free: boolean) => void>();
    let handle: any;
    function Form() {
      handle = useSchema("signUp", {
        refine: [
          {
            key: "usernameFree",
            path: "username",
            check: (username: string) =>
              new Promise<boolean>((resolve) => {
                asked.push(username);
                answers.set(username, resolve);
              }),
          },
        ],
      });
      return null;
    }
    render(
      <FeaturevisorProvider instance={f}>
        <Form />
      </FeaturevisorProvider>,
    );

    const older = handle.validate({ username: "fah" });
    const newer = handle.validate({ username: "fahad" });
    answers.get("fahad")!(false);
    answers.get("fah")!(true);

    const [olderResult, newerResult] = await Promise.all([older, newer]);
    expect(newerResult.issues[0].params).toEqual({ refine: "usernameFree" });
    // The older validation settles with the newer one's result.
    expect(olderResult).toBe(newerResult);

    await handle.validate({ username: "fahad" });
    expect(asked).toEqual(["fah", "fahad"]);
  });
});

describe("scope context and kept answers", () => {
  const order: DatafileSchema = {
    hash: "o1",
    type: "object",
    properties: {
      quantity: { type: "integer" },
      total: { type: "number" },
      note: { type: "string" },
    },
  };

  test("a FeaturevisorScope's context reaches checks and messages, under the context given", async () => {
    const f = sdk();
    const seen: unknown[] = [];
    let handle: any;
    function Form() {
      handle = useSchema("coupon", {
        refine: [
          {
            key: "sameCountry",
            check: (_value: string, { context }) => {
              seen.push(context);
              return context.country === "nl";
            },
          },
        ],
      });
      return null;
    }
    render(
      <FeaturevisorProvider instance={f}>
        <FeaturevisorScope context={{ country: "nl", plan: "pro" }}>
          <Form />
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );

    expect(await handle.isValid("ABCD1234")).toBe(true);
    expect(await handle.isValid("ABCD1234", { context: { country: "de" } })).toBe(false);
    expect(await handle["~standard"].validate("ABCD1234")).toEqual({ value: "ABCD1234" });
    expect(seen).toEqual([
      { userId: "user-1", country: "nl", plan: "pro" },
      { userId: "user-1", country: "de", plan: "pro" },
    ]);
  });

  test("useValidation runs checks again when the scope's context changes", async () => {
    const f = sdk();
    let latest: any;
    function Field() {
      const handle = useSchema("coupon", {
        refine: [
          { key: "dutch", check: (_value: string, { context }) => context.country === "nl" },
        ],
      });
      latest = useValidation(handle, "ABCD1234");
      return null;
    }
    const tree = (country: string) => (
      <FeaturevisorProvider instance={f}>
        <FeaturevisorScope context={{ country }}>
          <Field />
        </FeaturevisorScope>
      </FeaturevisorProvider>
    );
    const view = render(tree("nl"));
    await act(() => wait(10));
    expect(latest).toEqual({ value: "ABCD1234", validating: false });

    view.rerender(tree("de"));
    await act(() => wait(10));
    expect(latest.issues[0].params).toEqual({ refine: "dutch" });
  });

  test("a check's kept answer follows the fields its reads name, and no others", async () => {
    const f = createFeaturevisor({ datafile: datafile({ order }), logLevel: "fatal" });
    const asked: unknown[] = [];
    let handle: any;
    function Form() {
      handle = useSchema("order", {
        refine: [
          {
            key: "totalMatches",
            path: "total",
            reads: ["quantity"],
            check: (total: number, { input }) => {
              asked.push(total);
              return total === (input as { quantity: number }).quantity * 5;
            },
          },
        ],
      });
      return null;
    }
    render(
      <FeaturevisorProvider instance={f}>
        <Form />
      </FeaturevisorProvider>,
    );

    expect(handle.isValid({ quantity: 2, total: 10 })).toBe(true);
    expect(handle.isValid({ quantity: 3, total: 10 })).toBe(false);
    expect(handle.isValid({ quantity: 3, total: 10, note: "x" })).toBe(false);
    expect(asked).toEqual([10, 10]);
  });
});

describe("useValidation", () => {
  test("validates while rendering, and again when the value changes", () => {
    const f = sdk();
    let setCode: (code: string) => void = () => {};
    let latest: any;
    function CouponField() {
      const [code, setter] = React.useState("x");
      setCode = setter;
      latest = useValidation("coupon", code);
      return null;
    }
    render(
      <FeaturevisorProvider instance={f}>
        <CouponField />
      </FeaturevisorProvider>,
    );

    expect(latest.issues[0].code).toBe("pattern");
    expect(latest.validating).toBe(false);
    act(() => setCode("ABCD1234"));
    expect(latest).toEqual({ value: "ABCD1234", validating: false });
  });

  test("rules answer at once, and checks in code wait for the pause", async () => {
    const f = sdk();
    const asked: string[] = [];
    let setName: (name: string) => void = () => {};
    let latest: any;
    function UsernameField() {
      const [name, setter] = React.useState("ab");
      setName = setter;
      const handle = useSchema("signUp", {
        refine: [
          {
            key: "usernameFree",
            path: "username",
            check: async (username: string) => {
              asked.push(username);
              return username !== "taken";
            },
          },
        ],
      });
      latest = useValidation(handle.at("username"), name, { debounce: 20 });
      return null;
    }
    render(
      <FeaturevisorProvider instance={f}>
        <UsernameField />
      </FeaturevisorProvider>,
    );

    // Too short: the rule's issue shows at once, and no check runs.
    expect(latest.issues[0].code).toBe("minLength");

    act(() => setName("taken"));
    expect(latest.validating).toBe(true);
    expect(latest.issues).toBeUndefined();

    await act(() => wait(40));
    expect(latest.validating).toBe(false);
    expect(latest.issues[0].code).toBe("refine");

    act(() => setName("fahad"));
    await act(() => wait(40));
    expect(latest).toEqual({ value: "fahad", validating: false });
    expect(asked).toEqual(["taken", "fahad"]);
  });
});
