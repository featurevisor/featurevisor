import { defineComponent, type App, type Plugin } from "vue";
import type {
  Context,
  FeatureKey,
  Featurevisor,
  VariableValue,
  VariationValue,
} from "@featurevisor/sdk";
import { mount } from "@vue/test-utils";

import { setupApp } from "./setupApp";
import { useFlag } from "./useFlag";
import { useSdk } from "./useSdk";
import { useVariable } from "./useVariable";
import { useVariation } from "./useVariation";

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

function createVariationGetter(value: VariationValue | null) {
  const spy = jest.fn();
  const getVariation: Featurevisor["getVariation"] = <
    TVariation extends VariationValue = VariationValue,
  >(
    featureKey: FeatureKey,
    context: Context = {},
  ): TVariation | null => {
    spy(featureKey, context);
    return value as TVariation | null;
  };

  return { getVariation, spy };
}

function createVariableGetter(value: VariableValue | null) {
  const spy = jest.fn();
  const getVariable = ((...args: unknown[]) => {
    spy(...args);
    return value;
  }) as Featurevisor["getVariable"];

  return { getVariable, spy };
}

function createSdk(overrides: Partial<Featurevisor> = {}): Featurevisor {
  const { getVariation } = createVariationGetter("treatment");
  const { getVariable } = createVariableGetter("blue");

  return {
    getRevision: jest.fn(() => "1.0"),
    isEnabled: jest.fn(() => true),
    getVariation,
    getVariable,
    ...overrides,
  } as Featurevisor;
}

function featurevisorPlugin(sdk: Featurevisor): Plugin {
  return {
    install(app: App) {
      setupApp(app, sdk);
    },
  };
}

function mountSetup(setup: () => Record<string, unknown>, sdk?: Featurevisor) {
  return mount(
    defineComponent({
      setup,
      template: "<div />",
    }),
    {
      global: sdk ? { plugins: [featurevisorPlugin(sdk)] } : undefined,
    },
  );
}

describe("vue: composables", () => {
  it("provides the exact SDK instance through setupApp and useSdk", () => {
    const sdk = createSdk();
    let injected: Featurevisor | undefined;

    mountSetup(() => {
      injected = useSdk();
      return {};
    }, sdk);

    expect(injected).toBe(sdk);
  });

  it("fails clearly when setupApp was not called", () => {
    expect(() =>
      mountSetup(() => {
        useSdk();
        return {};
      }),
    ).toThrow("Featurevisor SDK is not available. Call setupApp(app, featurevisor) first.");
  });

  it("evaluates a flag with the supplied context", () => {
    const context: Context = { userId: "user-1", country: "nl" };
    const isEnabled = jest.fn(() => true);
    const sdk = createSdk({ isEnabled });
    let result: boolean | undefined;

    mountSetup(() => {
      result = useFlag("checkout", context);
      return {};
    }, sdk);

    expect(result).toBe(true);
    expect(isEnabled).toHaveBeenCalledWith("checkout", context);
  });

  it.each([
    ["an evaluated variation", "treatment"],
    ["a missing variation", null],
  ])("returns %s", (_, value) => {
    const context: Context = { userId: "user-1" };
    const { getVariation, spy } = createVariationGetter(value);
    const sdk = createSdk({ getVariation });
    let result: string | null | undefined;

    mountSetup(() => {
      result = useVariation("checkout", context);
      return {};
    }, sdk);

    expect(result).toBe(value);
    expect(spy).toHaveBeenCalledWith("checkout", context);
  });

  it.each([
    ["a string variable", "blue"],
    ["an object variable", { theme: "dark" }],
    ["a missing variable", null],
  ])("returns %s", (_, value) => {
    const context: Context = { userId: "user-1" };
    const { getVariable, spy } = createVariableGetter(value);
    const sdk = createSdk({ getVariable });
    let result: unknown;

    mountSetup(() => {
      result = useVariable("checkout", "configuration", context);
      return {};
    }, sdk);

    expect(result).toEqual(value);
    expect(spy).toHaveBeenCalledWith("checkout", "configuration", context);
  });

  it("supports optional generic variation and variable result types", () => {
    interface CheckoutConfig {
      theme: string;
    }

    const { getVariation } = createVariationGetter("treatment");
    const { getVariable } = createVariableGetter({ theme: "dark" });
    const sdk = createSdk({ getVariation, getVariable });

    mountSetup(() => {
      const variation = useVariation("checkout");
      const typedVariation = useVariation<"control" | "treatment">("checkout");
      const variable = useVariable("checkout", "configuration");
      const typedVariable = useVariable<CheckoutConfig>("checkout", "configuration");
      const topLevelVariable = useVariable<CheckoutConfig>("configuration", { userId: "u" });

      expectExactType<IsExact<typeof variation, VariationValue | null>>(true);
      expectExactType<IsExact<typeof typedVariation, "control" | "treatment" | null>>(true);
      expectExactType<IsExact<typeof variable, VariableValue | null>>(true);
      expectExactType<IsExact<typeof typedVariable, CheckoutConfig | null>>(true);
      expectExactType<IsExact<typeof topLevelVariable, CheckoutConfig | null>>(true);

      expect(variation).toBe("treatment");
      expect(typedVariation).toBe("treatment");
      expect(variable).toEqual({ theme: "dark" });
      expect(typedVariable).toEqual({ theme: "dark" });
      expect(topLevelVariable).toEqual({ theme: "dark" });

      return {};
    }, sdk);
  });

  it("uses an empty context by default", () => {
    const isEnabled = jest.fn(() => false);
    const { getVariation, spy: getVariationSpy } = createVariationGetter(null);
    const { getVariable, spy: getVariableSpy } = createVariableGetter(null);
    const sdk = createSdk({ isEnabled, getVariation, getVariable });

    mountSetup(() => {
      useFlag("checkout");
      useVariation("checkout");
      useVariable("checkout", "configuration");
      return {};
    }, sdk);

    expect(isEnabled).toHaveBeenCalledWith("checkout", {});
    expect(getVariationSpy).toHaveBeenCalledWith("checkout", {});
    expect(getVariableSpy).toHaveBeenCalledWith("checkout", "configuration", {});
  });
});
