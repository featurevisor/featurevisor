import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { BOUND_METHODS, useFeaturevisor } from "./useFeaturevisor";
import { createInstance } from "@featurevisor/sdk";

const standardVariations = [{ value: "control" }, { value: "treatment" }];

function trafficAllControl() {
  return [
    {
      key: "1",
      segments: "*" as const,
      percentage: 100000,
      allocation: [
        { variation: "control" as const, range: [0, 100000] as [number, number] },
        { variation: "treatment" as const, range: [0, 0] as [number, number] },
      ],
    },
  ];
}

function variationFeature(key: string) {
  return {
    key,
    bucketBy: "userId" as const,
    variations: standardVariations,
    traffic: trafficAllControl(),
  };
}

function getNewInstance() {
  const sdk = createInstance({
    datafile: {
      schemaVersion: "2",
      revision: "1.0",
      features: {
        test: {
          key: "test",
          bucketBy: "userId",
          variations: standardVariations,
          traffic: trafficAllControl(),
        },
      },
      segments: {},
    },
  });

  return sdk;
}

/** Richer datafile: several flags, one with variables, one forced off via 0% traffic. */
function getComplexInstance() {
  return createInstance({
    datafile: {
      schemaVersion: "2",
      revision: "complex-spec",
      segments: {},
      features: {
        sidebar: variationFeature("sidebar"),
        hero: variationFeature("hero"),
        promo: {
          key: "promo",
          bucketBy: "userId",
          variablesSchema: {
            cta: {
              key: "cta",
              type: "string",
              defaultValue: "Shop now",
            },
          },
          variations: standardVariations,
          traffic: trafficAllControl(),
        },
        widget_on: variationFeature("widget_on"),
        widget_off: {
          key: "widget_off",
          bucketBy: "userId",
          variations: standardVariations,
          traffic: [
            {
              key: "1",
              segments: "*",
              percentage: 0,
              allocation: [],
            },
          ],
        },
      },
    },
  });
}

describe("react: useFeaturevisor", function () {
  test("should be a function", function () {
    expect(useFeaturevisor).toBeInstanceOf(Function);
  });

  test("should expose only the expected bound methods", function () {
    let keys: string[] = [];

    function TestComponent() {
      const api = useFeaturevisor();
      keys = Object.keys(api);

      return <p>Test</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(keys.sort()).toEqual([...BOUND_METHODS].sort());
  });

  test("should expose a function for each bound method name", function () {
    let api: ReturnType<typeof useFeaturevisor> | undefined;

    function TestComponent() {
      api = useFeaturevisor();

      return <p>Test</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(api).toBeDefined();
    for (const key of BOUND_METHODS) {
      expect(typeof api![key]).toBe("function");
    }
  });

  test("should allow calling destructured isEnabled without throwing", function () {
    let enabled: boolean | undefined;

    function TestComponent() {
      const { isEnabled } = useFeaturevisor();
      enabled = isEnabled("test");

      return <p>Test</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(typeof enabled).toBe("boolean");
  });

  test("should allow calling destructured getVariation without throwing", function () {
    let variation: string | null | undefined;

    function TestComponent() {
      const { getVariation } = useFeaturevisor();
      variation = getVariation("test", { userId: "u1" });

      return <p>Test</p>;
    }

    render(
      <FeaturevisorProvider instance={getNewInstance()}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(variation).toBe("control");
  });

  test("should keep stable method references when the sdk instance is unchanged", function () {
    const instance = getNewInstance();
    const isEnabledRefs: Array<ReturnType<typeof useFeaturevisor>["isEnabled"]> = [];

    function TestComponent() {
      const { isEnabled } = useFeaturevisor();
      isEnabledRefs.push(isEnabled);

      return <p>Test</p>;
    }

    const { rerender } = render(
      <FeaturevisorProvider instance={instance}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    rerender(
      <FeaturevisorProvider instance={instance}>
        <TestComponent />
      </FeaturevisorProvider>,
    );

    expect(isEnabledRefs).toHaveLength(2);
    expect(isEnabledRefs[0]).toBe(isEnabledRefs[1]);
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  describe("complex usage (top of component + lists)", function () {
    test("should evaluate isEnabled, getVariation, and getVariableString at top level, then render summary", function () {
      function Dashboard() {
        const { isEnabled, getVariation, getVariableString, setContext } = useFeaturevisor();

        setContext({ tenantId: "acme" }, false);

        const user = { userId: "user-1" };
        const showSidebar = isEnabled("sidebar", user);
        const heroLabel = getVariation("hero", user);
        const promoActive = isEnabled("promo", user);
        const promoCta = promoActive ? getVariableString("promo", "cta", user) : null;

        return (
          <div>
            <p data-testid="header-summary">
              {showSidebar ? "sidebar-yes" : "sidebar-no"}|{heroLabel ?? "none"}|
              {promoCta ?? "no-cta"}
            </p>
          </div>
        );
      }

      render(
        <FeaturevisorProvider instance={getComplexInstance()}>
          <Dashboard />
        </FeaturevisorProvider>,
      );

      expect(screen.getByTestId("header-summary")).toHaveTextContent(
        "sidebar-yes|control|Shop now",
      );
    });

    test("should call isEnabled and getVariation inside a mapped list of feature keys", function () {
      const widgetFeatureKeys = ["widget_on", "widget_off", "widget_on"] as const;

      function WidgetList() {
        const { isEnabled, getVariation } = useFeaturevisor();
        const user = { userId: "loop-user" };

        return (
          <ul>
            {widgetFeatureKeys.map((featureKey, index) => (
              <li key={`${featureKey}-${index}`} data-testid={`widget-row-${index}`}>
                {isEnabled(featureKey, user)
                  ? (getVariation(featureKey, user) ?? "no-variation")
                  : "hidden"}
              </li>
            ))}
          </ul>
        );
      }

      render(
        <FeaturevisorProvider instance={getComplexInstance()}>
          <WidgetList />
        </FeaturevisorProvider>,
      );

      expect(screen.getByTestId("widget-row-0")).toHaveTextContent("control");
      expect(screen.getByTestId("widget-row-1")).toHaveTextContent("hidden");
      expect(screen.getByTestId("widget-row-2")).toHaveTextContent("control");
    });

    test("should call hook methods from nested loops (users × widgets)", function () {
      const userIds = ["alpha", "beta"] as const;
      const widgetKeys = ["widget_on", "widget_off"] as const;

      function Matrix() {
        const { isEnabled, getVariation, getVariableString } = useFeaturevisor();

        return (
          <div>
            {userIds.map((userId) => (
              <section key={userId} data-testid={`user-${userId}`}>
                {widgetKeys.map((featureKey) => {
                  const on = isEnabled(featureKey, { userId });
                  const variation = on ? getVariation(featureKey, { userId }) : null;
                  const promoCta = on ? getVariableString("promo", "cta", { userId }) : null;

                  return (
                    <span
                      key={`${userId}-${featureKey}`}
                      data-testid={`cell-${userId}-${featureKey}`}
                    >
                      {String(on)}|{variation ?? "—"}|{promoCta ?? "—"}
                    </span>
                  );
                })}
              </section>
            ))}
          </div>
        );
      }

      render(
        <FeaturevisorProvider instance={getComplexInstance()}>
          <Matrix />
        </FeaturevisorProvider>,
      );

      expect(screen.getByTestId("cell-alpha-widget_on")).toHaveTextContent("true|control|Shop now");
      expect(screen.getByTestId("cell-alpha-widget_off")).toHaveTextContent("false|—|—");
      expect(screen.getByTestId("cell-beta-widget_on")).toHaveTextContent("true|control|Shop now");
      expect(screen.getByTestId("cell-beta-widget_off")).toHaveTextContent("false|—|—");
    });
  });

  test("should reflect a new provider instance after swap", function () {
    const off = getComplexInstance();
    const on = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "swap",
        segments: {},
        features: {
          widget_off: {
            key: "widget_off",
            bucketBy: "userId",
            variations: [{ value: "control" }, { value: "treatment" }],
            traffic: [
              {
                key: "1",
                segments: "*",
                percentage: 100000,
                allocation: [
                  { variation: "control", range: [0, 100000] as [number, number] },
                  { variation: "treatment", range: [0, 0] as [number, number] },
                ],
              },
            ],
          },
        },
      },
    });

    function Probe() {
      const { isEnabled, getVariation } = useFeaturevisor();
      const user = { userId: "swap-user" };

      return (
        <span data-testid="probe">
          {isEnabled("widget_off", user) ? (getVariation("widget_off", user) ?? "") : "off"}
        </span>
      );
    }

    const { rerender } = render(
      <FeaturevisorProvider instance={off}>
        <Probe />
      </FeaturevisorProvider>,
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("off");

    rerender(
      <FeaturevisorProvider instance={on}>
        <Probe />
      </FeaturevisorProvider>,
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("control");
  });

  test("getVariableBoolean and getVariableInteger should read typed helpers", function () {
    const sdk = createInstance({
      datafile: {
        schemaVersion: "2",
        revision: "typed",
        segments: {},
        features: {
          flags: {
            key: "flags",
            bucketBy: "userId",
            traffic: [
              { key: "1", segments: "*", percentage: 100000, allocation: [] },
            ],
            variablesSchema: {
              darkMode: { type: "boolean", defaultValue: true },
              maxItems: { type: "integer", defaultValue: 10 },
            },
            hash: "typed-1",
          },
        },
      },
    });

    let dark: boolean | null | undefined;
    let max: number | null | undefined;

    function Reader() {
      const { getVariableBoolean, getVariableInteger } = useFeaturevisor();
      dark = getVariableBoolean("flags", "darkMode", { userId: "1" });
      max = getVariableInteger("flags", "maxItems", { userId: "1" });
      return <p>ok</p>;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <Reader />
      </FeaturevisorProvider>,
    );

    expect(dark).toBe(true);
    expect(max).toBe(10);
  });
});
