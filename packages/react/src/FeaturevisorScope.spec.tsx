import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createFeaturevisor } from "@featurevisor/sdk";
import type { Context, DatafileContent } from "@featurevisor/types";

import { FeaturevisorContext } from "./FeaturevisorContext";
import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { FeaturevisorScope } from "./FeaturevisorScope";
import { useEveryFlag } from "./useEveryFlag";
import { useFeaturevisor } from "./useFeaturevisor";
import { useFlag } from "./useFlag";
import { useFlags } from "./useFlags";
import { useRevision } from "./useRevision";
import { useSdk } from "./useSdk";
import { useSomeFlag } from "./useSomeFlag";
import { useVariable } from "./useVariable";
import { useVariation } from "./useVariation";

/**
 * wishlist is on only for the paid plan, pricing gives paid accounts treatment,
 * and supportEmail has a Dutch override.
 */
function datafile(revision = "first", wishlistOn = true): DatafileContent {
  return {
    schemaVersion: "4",
    revision,
    segments: {
      paid: { conditions: [{ attribute: "plan", operator: "equals", value: "paid" }] },
      netherlands: { conditions: [{ attribute: "country", operator: "equals", value: "nl" }] },
    },
    features: {
      wishlist: {
        hash: `wishlist-${wishlistOn}`,
        bucketBy: "userId",
        traffic: [
          { key: "paid", conditions: ["paid"], percentage: wishlistOn ? 100000 : 0 },
          { key: "all", conditions: "*", percentage: 0 },
        ],
      },
      pricing: {
        hash: "pricing",
        bucketBy: "userId",
        variations: [
          { value: "control", weight: 50 },
          { value: "treatment", weight: 50 },
        ],
        traffic: [
          {
            key: "paid",
            conditions: ["paid"],
            percentage: 100000,
            allocation: [{ variation: "treatment", range: [0, 100000] }],
          },
          {
            key: "all",
            conditions: "*",
            percentage: 100000,
            allocation: [{ variation: "control", range: [0, 100000] }],
          },
        ],
      },
      buyButton: {
        hash: "buyButton",
        bucketBy: "userId",
        variablesSchema: { label: { type: "string", defaultValue: "Buy" } },
        traffic: [{ key: "all", conditions: "*", percentage: 100000 }],
      },
    },
    variables: {
      supportEmail: {
        hash: "supportEmail",
        type: "string",
        defaultValue: "help",
        overrides: [{ key: "nl", conditions: "netherlands", value: "help-nl" }],
      },
    },
  } as unknown as DatafileContent;
}

function instance(context: Context = { userId: "user-1", country: "de" }) {
  return createFeaturevisor({ logLevel: "fatal", datafile: datafile(), context });
}

/** Every evaluating hook, written into one line of text. */
function Readers({ context }: { context?: Context }) {
  const flag = useFlag("wishlist", context);
  const [listed] = useFlags(["wishlist"], context);
  const every = useEveryFlag(["wishlist"], context);
  const some = useSomeFlag(["wishlist"], context);
  const variation = useVariation("pricing", context);
  const email = useVariable("supportEmail", context);
  const label = useVariable("buyButton", "label", context);
  return (
    <p data-testid="readers">
      {[flag, listed, every, some, variation, email, label].map(String).join(",")}
    </p>
  );
}

const text = () => screen.getByTestId("readers").textContent;

describe("react: FeaturevisorScope", function () {
  test("gives every evaluating hook below it the scope's context", function () {
    const sdk = instance();
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    const getVariable = jest.spyOn(sdk, "getVariable");

    const view = render(
      <FeaturevisorProvider instance={sdk}>
        <Readers />
      </FeaturevisorProvider>,
    );
    expect(text()).toBe("false,false,false,false,control,help,Buy");

    view.rerender(
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ plan: "paid", country: "nl" }}>
          <Readers />
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");
    expect(isEnabled).toHaveBeenLastCalledWith("wishlist", { plan: "paid", country: "nl" });
    expect(getVariable).toHaveBeenCalledWith("buyButton", "label", {
      plan: "paid",
      country: "nl",
    });
  });

  test("merges the instance, outer scope, inner scope and hook argument in that order", function () {
    const sdk = instance({ userId: "user-1", country: "de", plan: "free", locale: "de" });
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    let context: Context = {};
    function Reader() {
      useFlag("wishlist", { locale: "nl-NL" });
      context = useFeaturevisor().getContext({ locale: "nl-NL" });
      return null;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ country: "nl", plan: "enterprise", locale: "en" }}>
          <FeaturevisorScope context={{ plan: "paid" }}>
            <Reader />
          </FeaturevisorScope>
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );

    expect(isEnabled).toHaveBeenLastCalledWith("wishlist", {
      country: "nl",
      plan: "paid",
      locale: "nl-NL",
    });
    expect(context).toEqual({ userId: "user-1", country: "nl", plan: "paid", locale: "nl-NL" });
  });

  test("passes the hook's own context object through unchanged outside any scope", function () {
    const sdk = instance();
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    const context = { plan: "paid" };
    function Reader() {
      useFlag("wishlist", context);
      return null;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <Reader />
      </FeaturevisorProvider>,
    );
    expect(isEnabled.mock.calls[isEnabled.mock.calls.length - 1][1]).toBe(context);
  });

  test("follows the instance context for keys the scope does not set, and wins for keys it does", function () {
    const sdk = instance();
    render(
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ plan: "paid" }}>
          <Readers />
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );
    expect(text()).toBe("true,true,true,true,treatment,help,Buy");

    act(() => sdk.setContext({ country: "nl" }));
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");

    act(() => sdk.setContext({ plan: "free" }));
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");
  });

  test("renders scoped hooks again for datafile and sticky changes", function () {
    const sdk = instance();
    render(
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ plan: "paid" }}>
          <Readers />
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );

    act(() => sdk.setDatafile(datafile("second", false)));
    expect(text()).toBe("false,false,false,false,treatment,help,Buy");

    act(() => sdk.setStickyFeatures({ wishlist: { enabled: true } }));
    expect(text()).toBe("true,true,true,true,treatment,help,Buy");

    act(() => sdk.setStickyVariables({ supportEmail: "sticky" }));
    expect(text()).toBe("true,true,true,true,treatment,sticky,Buy");
  });

  test("renders nothing below again for an equal inline context, and once for a changed one", function () {
    const sdk = instance();
    let renders = 0;
    const commits: string[] = [];
    const Reader = React.memo(function Reader() {
      renders += 1;
      const flag = useFlag("wishlist");
      const variation = useVariation("pricing");
      React.useLayoutEffect(() => {
        commits.push(`${flag}:${variation}`);
      });
      return null;
    });
    const tree = (plan: string, label: string) => (
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ plan, country: "de" }}>
          <Reader key="reader" />
          <span>{label}</span>
        </FeaturevisorScope>
      </FeaturevisorProvider>
    );

    const view = render(tree("free", "a"));
    const settled = renders;

    view.rerender(tree("free", "b"));
    view.rerender(tree("free", "c"));
    expect(renders).toBe(settled);

    commits.length = 0;
    view.rerender(tree("paid", "d"));
    expect(renders).toBe(settled + 1);
    expect(commits).toEqual(["true:treatment"]);
  });

  test("adds no listeners to the instance", function () {
    const listeners = (scoped: boolean) => {
      const sdk = instance();
      const on = jest.spyOn(sdk, "on");
      render(
        <FeaturevisorProvider instance={sdk}>
          {scoped ? (
            <FeaturevisorScope context={{ plan: "paid" }}>
              <Readers />
            </FeaturevisorScope>
          ) : (
            <Readers />
          )}
        </FeaturevisorProvider>,
      );
      return on.mock.calls.length;
    };

    expect(listeners(true)).toBe(listeners(false));
  });

  test("leaves useSdk, useRevision and FeaturevisorContext as they are", function () {
    const sdk = instance();
    const seen: unknown[] = [];
    function Reader() {
      seen.push(useSdk(), React.useContext(FeaturevisorContext), useRevision());
      return null;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ plan: "paid" }}>
          <Reader />
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );
    expect(seen.slice(0, 3)).toEqual([sdk, sdk, "first"]);
  });

  test("does not reach through a FeaturevisorProvider inside it", function () {
    const outer = instance();
    const inner = instance();
    render(
      <FeaturevisorProvider instance={outer}>
        <FeaturevisorScope context={{ plan: "paid", country: "nl" }}>
          <FeaturevisorProvider instance={inner}>
            <Readers />
          </FeaturevisorProvider>
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );
    expect(text()).toBe("false,false,false,false,control,help,Buy");
  });

  test("updates an inner scope when the outer one changes", function () {
    const sdk = instance();
    const tree = (country: string) => (
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ country }}>
          <FeaturevisorScope context={{ plan: "paid" }}>
            <Readers />
          </FeaturevisorScope>
        </FeaturevisorScope>
      </FeaturevisorProvider>
    );

    const view = render(tree("de"));
    expect(text()).toBe("true,true,true,true,treatment,help,Buy");
    view.rerender(tree("nl"));
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");
  });

  test("scopes useFeaturevisor reads, while its setters still act on the instance", function () {
    const sdk = instance();
    let api: ReturnType<typeof useFeaturevisor> | undefined;
    function Reader() {
      api = useFeaturevisor();
      return null;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ plan: "paid", country: "nl" }}>
          <Reader />
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );

    expect(api!.isEnabled("wishlist")).toBe(true);
    expect(api!.isEnabled("wishlist", { plan: "free" })).toBe(false);
    expect(api!.getVariation("pricing")).toBe("treatment");
    expect(api!.getVariable("supportEmail")).toBe("help-nl");
    expect(api!.getVariableString("supportEmail", { country: "de" })).toBe("help");
    expect(api!.getVariable("buyButton", "label")).toBe("Buy");
    expect(api!.getVariableString("buyButton", "label", { plan: "free" })).toBe("Buy");
    expect(api!.getContext()).toEqual({ userId: "user-1", country: "nl", plan: "paid" });

    act(() => api!.setContext({ userId: "user-2" }));
    expect(sdk.getContext()).toEqual({ userId: "user-2", country: "de" });
  });

  test("keeps useFeaturevisor exactly as before outside any scope", function () {
    const sdk = instance();
    const results: ReturnType<typeof useFeaturevisor>[] = [];
    function Reader() {
      results.push(useFeaturevisor());
      return null;
    }

    const view = render(
      <FeaturevisorProvider instance={sdk}>
        <Reader />
      </FeaturevisorProvider>,
    );
    view.rerender(
      <FeaturevisorProvider instance={sdk}>
        <Reader />
      </FeaturevisorProvider>,
    );
    expect(results[results.length - 1]).toBe(results[0]);
    expect(results[0].getContext()).toBe(sdk.getContext());
  });

  test("works in StrictMode", function () {
    const sdk = instance();
    render(
      <React.StrictMode>
        <FeaturevisorProvider instance={sdk}>
          <FeaturevisorScope context={{ plan: "paid" }}>
            <Readers />
          </FeaturevisorScope>
        </FeaturevisorProvider>
      </React.StrictMode>,
    );
    expect(text()).toBe("true,true,true,true,treatment,help,Buy");

    act(() => sdk.setContext({ country: "nl" }));
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");
  });
});
