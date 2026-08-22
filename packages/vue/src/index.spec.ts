import { defineComponent, type App, type Plugin } from "vue";
import type { Context, Featurevisor } from "@featurevisor/sdk";
import { mount } from "@vue/test-utils";

import { setupApp } from "./setupApp";
import { useFlag } from "./useFlag";
import { useSdk } from "./useSdk";
import { useVariable } from "./useVariable";
import { useVariation } from "./useVariation";

function createSdk(overrides: Partial<Featurevisor> = {}): Featurevisor {
  return {
    getRevision: jest.fn(() => "1.0"),
    isEnabled: jest.fn(() => true),
    getVariation: jest.fn(() => "treatment"),
    getVariable: jest.fn(() => "blue"),
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
    const getVariation = jest.fn(() => value);
    const sdk = createSdk({
      getVariation: getVariation as unknown as Featurevisor["getVariation"],
    });
    let result: string | null | undefined;

    mountSetup(() => {
      result = useVariation("checkout", context);
      return {};
    }, sdk);

    expect(result).toBe(value);
    expect(getVariation).toHaveBeenCalledWith("checkout", context);
  });

  it.each([
    ["a string variable", "blue"],
    ["an object variable", { theme: "dark" }],
    ["a missing variable", null],
  ])("returns %s", (_, value) => {
    const context: Context = { userId: "user-1" };
    const getVariable = jest.fn(() => value);
    const sdk = createSdk({
      getVariable: getVariable as unknown as Featurevisor["getVariable"],
    });
    let result: unknown;

    mountSetup(() => {
      result = useVariable("checkout", "configuration", context);
      return {};
    }, sdk);

    expect(result).toEqual(value);
    expect(getVariable).toHaveBeenCalledWith("checkout", "configuration", context);
  });

  it("uses an empty context by default", () => {
    const isEnabled = jest.fn(() => false);
    const getVariation = jest.fn(() => null);
    const getVariable = jest.fn(() => null);
    const sdk = createSdk({ isEnabled, getVariation, getVariable });

    mountSetup(() => {
      useFlag("checkout");
      useVariation("checkout");
      useVariable("checkout", "configuration");
      return {};
    }, sdk);

    expect(isEnabled).toHaveBeenCalledWith("checkout", {});
    expect(getVariation).toHaveBeenCalledWith("checkout", {});
    expect(getVariable).toHaveBeenCalledWith("checkout", "configuration", {});
  });
});
