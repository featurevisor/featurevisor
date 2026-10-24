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

/** Records the context every read below it would use, through useFeaturevisor. */
function ContextProbe({ name, seen }: { name: string; seen: Record<string, Context> }) {
  seen[name] = useFeaturevisor().getContext();
  return null;
}

describe("react: nested FeaturevisorScope", function () {
  test("merges three levels, each over the one around it, under the hook's own argument", function () {
    const sdk = instance({ userId: "user-1", country: "de", plan: "free", region: "eu" });
    const isEnabled = jest.spyOn(sdk, "isEnabled");
    const seen: Record<string, Context> = {};
    function Reader() {
      useFlag("wishlist", { team: "argument" });
      return <ContextProbe name="inner" seen={seen} />;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ country: "nl", plan: "enterprise", team: "outer" }}>
          <FeaturevisorScope context={{ plan: "paid", locale: "en" }}>
            <FeaturevisorScope context={{ locale: "nl-NL", team: "inner" }}>
              <Reader />
            </FeaturevisorScope>
          </FeaturevisorScope>
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );

    // The hook argument wins over every scope, and the instance supplies the rest.
    expect(isEnabled).toHaveBeenLastCalledWith("wishlist", {
      country: "nl",
      plan: "paid",
      locale: "nl-NL",
      team: "argument",
    });
    expect(seen.inner).toEqual({
      userId: "user-1",
      country: "nl",
      plan: "paid",
      region: "eu",
      locale: "nl-NL",
      team: "inner",
    });
  });

  test("keeps sibling scopes apart while both inherit the outer one", function () {
    const sdk = instance();
    render(
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ country: "nl" }}>
          <div data-testid="paid">
            <FeaturevisorScope context={{ plan: "paid" }}>
              <Readers />
            </FeaturevisorScope>
          </div>
          <div data-testid="free">
            <FeaturevisorScope context={{ plan: "free" }}>
              <Readers />
            </FeaturevisorScope>
          </div>
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );

    expect(screen.getByTestId("paid")).toHaveTextContent(
      "true,true,true,true,treatment,help-nl,Buy",
    );
    expect(screen.getByTestId("free")).toHaveTextContent(
      "false,false,false,false,control,help-nl,Buy",
    );
  });

  test("keeps the keys an inner scope sets when the outer one changes them, and follows the rest", function () {
    const sdk = instance();
    let renders = 0;
    const Reader = React.memo(function Reader() {
      renders += 1;
      return <Readers />;
    });
    const tree = (outer: Context) => (
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={outer}>
          <FeaturevisorScope context={{ plan: "paid" }}>
            <Reader />
          </FeaturevisorScope>
        </FeaturevisorScope>
      </FeaturevisorProvider>
    );

    const view = render(tree({ plan: "free", country: "de" }));
    expect(text()).toBe("true,true,true,true,treatment,help,Buy");
    const settled = renders;

    // The inner scope sets plan, so the merged value is the same and nothing renders again.
    view.rerender(tree({ plan: "enterprise", country: "de" }));
    expect(renders).toBe(settled);
    expect(text()).toBe("true,true,true,true,treatment,help,Buy");

    // It does not set country, so that change reaches the hooks below.
    view.rerender(tree({ plan: "enterprise", country: "nl" }));
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");
  });

  test("leaves the outer scope's own readers alone when an inner scope changes", function () {
    const sdk = instance();
    let outerRenders = 0;
    const OuterReader = React.memo(function OuterReader() {
      outerRenders += 1;
      return <p data-testid="outer">{String(useFlag("wishlist"))}</p>;
    });
    const tree = (innerPlan: string) => (
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ plan: "free" }}>
          <OuterReader />
          <FeaturevisorScope context={{ plan: innerPlan }}>
            <Readers />
          </FeaturevisorScope>
        </FeaturevisorScope>
      </FeaturevisorProvider>
    );

    const view = render(tree("free"));
    const settled = outerRenders;
    view.rerender(tree("paid"));

    expect(text()).toBe("true,true,true,true,treatment,help,Buy");
    expect(screen.getByTestId("outer")).toHaveTextContent("false");
    expect(outerRenders).toBe(settled);
  });

  test("merges shallowly, so an inner object replaces the outer one", function () {
    const sdk = instance();
    const seen: Record<string, Context> = {};
    render(
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ account: { locale: "de", seats: 10 } }}>
          <FeaturevisorScope context={{ account: { seats: 60 } }}>
            <ContextProbe name="inner" seen={seen} />
          </FeaturevisorScope>
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );
    expect(seen.inner.account).toEqual({ seats: 60 });
  });

  test("passes the outer scope through an empty inner one", function () {
    const sdk = instance();
    const seen: Record<string, Context> = {};
    render(
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ plan: "paid" }}>
          <ContextProbe name="outer" seen={seen} />
          <FeaturevisorScope context={{}}>
            <ContextProbe name="inner" seen={seen} />
          </FeaturevisorScope>
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );
    expect(seen.inner).toEqual(seen.outer);
  });

  test("switches values as an inner scope mounts and unmounts", function () {
    const sdk = instance();
    const tree = (withInner: boolean) => (
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ country: "nl" }}>
          {withInner ? (
            <FeaturevisorScope context={{ plan: "paid" }}>
              <Readers />
            </FeaturevisorScope>
          ) : (
            <Readers />
          )}
        </FeaturevisorScope>
      </FeaturevisorProvider>
    );

    const view = render(tree(false));
    expect(text()).toBe("false,false,false,false,control,help-nl,Buy");
    view.rerender(tree(true));
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");
    view.rerender(tree(false));
    expect(text()).toBe("false,false,false,false,control,help-nl,Buy");
  });

  test("starts again inside a FeaturevisorProvider, where scopes nest from there", function () {
    const outer = instance();
    const inner = instance({ userId: "user-2" });
    const seen: Record<string, Context> = {};
    render(
      <FeaturevisorProvider instance={outer}>
        <FeaturevisorScope context={{ plan: "paid" }}>
          <FeaturevisorProvider instance={inner}>
            <FeaturevisorScope context={{ country: "nl" }}>
              <FeaturevisorScope context={{ locale: "nl-NL" }}>
                <ContextProbe name="inner" seen={seen} />
              </FeaturevisorScope>
            </FeaturevisorScope>
          </FeaturevisorProvider>
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );
    expect(seen.inner).toEqual({ userId: "user-2", country: "nl", locale: "nl-NL" });
  });

  test("follows instance changes and every level's changes in StrictMode", function () {
    const sdk = instance();
    const tree = (country: string, plan: string) => (
      <React.StrictMode>
        <FeaturevisorProvider instance={sdk}>
          <FeaturevisorScope context={{ country }}>
            <FeaturevisorScope context={{ plan }}>
              <Readers />
            </FeaturevisorScope>
          </FeaturevisorScope>
        </FeaturevisorProvider>
      </React.StrictMode>
    );

    const view = render(tree("de", "free"));
    expect(text()).toBe("false,false,false,false,control,help,Buy");
    view.rerender(tree("nl", "free"));
    expect(text()).toBe("false,false,false,false,control,help-nl,Buy");
    view.rerender(tree("nl", "paid"));
    expect(text()).toBe("true,true,true,true,treatment,help-nl,Buy");
    act(() => sdk.setStickyFeatures({ wishlist: { enabled: false } }));
    expect(text()).toBe("false,false,false,false,treatment,help-nl,Buy");
  });
});

describe("react: the FeaturevisorScope docs examples", function () {
  // Both bucket by user. productReviews is on for product 1 only, and sizeGuide
  // for the clothing and shoes categories, so each reads what its scope adds.
  const docsDatafile = {
    schemaVersion: "4",
    revision: "docs",
    segments: {},
    features: {
      productReviews: {
        hash: "productReviews",
        bucketBy: "userId",
        traffic: [
          {
            key: "pilot",
            conditions: [{ attribute: "productId", operator: "in", value: ["1"] }],
            percentage: 100000,
          },
          { key: "everyone", conditions: "*", percentage: 0 },
        ],
      },
      sizeGuide: {
        hash: "sizeGuide",
        bucketBy: "userId",
        traffic: [
          {
            key: "apparel",
            conditions: [{ attribute: "category", operator: "in", value: ["clothing", "shoes"] }],
            percentage: 100000,
          },
          { key: "everyone", conditions: "*", percentage: 0 },
        ],
      },
    },
  } as unknown as DatafileContent;

  function ProductReviews() {
    return <p data-testid="reviews">{String(useFlag("productReviews"))}</p>;
  }

  function ProductPage({ productId }: { productId: string }) {
    return (
      <FeaturevisorScope context={{ productId }}>
        <ProductReviews />
      </FeaturevisorScope>
    );
  }

  function ProductCard({ productId }: { productId: string }) {
    const sizeGuide = useFlag("sizeGuide");
    const productReviews = useFlag("productReviews");
    return <li>{`${productId} size:${sizeGuide} reviews:${productReviews}`}</li>;
  }

  function CategoryPage({ category, productIds }: { category: string; productIds: string[] }) {
    return (
      <FeaturevisorScope context={{ category }}>
        <ul data-testid="cards">
          {productIds.map((productId) => (
            <FeaturevisorScope key={productId} context={{ productId }}>
              <ProductCard productId={productId} />
            </FeaturevisorScope>
          ))}
        </ul>
      </FeaturevisorScope>
    );
  }

  function docsInstance() {
    return createFeaturevisor({
      logLevel: "fatal",
      datafile: docsDatafile,
      context: { userId: "user-1" },
    });
  }

  test("give a product page's hooks its product", function () {
    const sdk = docsInstance();
    const tree = (productId: string) => (
      <FeaturevisorProvider instance={sdk}>
        <ProductPage productId={productId} />
      </FeaturevisorProvider>
    );

    const view = render(tree("1"));
    expect(screen.getByTestId("reviews")).toHaveTextContent("true");
    view.rerender(tree("2"));
    expect(screen.getByTestId("reviews")).toHaveTextContent("false");
  });

  test("let each card on a category page add its product to the page's category", function () {
    const sdk = docsInstance();
    const tree = (category: string) => (
      <FeaturevisorProvider instance={sdk}>
        <CategoryPage category={category} productIds={["1", "2"]} />
      </FeaturevisorProvider>
    );
    const cards = () =>
      [...screen.getByTestId("cards").querySelectorAll("li")].map((card) => card.textContent);

    const view = render(tree("shoes"));
    expect(cards()).toEqual(["1 size:true reviews:true", "2 size:true reviews:false"]);
    view.rerender(tree("electronics"));
    expect(cards()).toEqual(["1 size:false reviews:true", "2 size:false reviews:false"]);
  });

  test("merge the instance, the page's category and the card's product into one context", function () {
    const evaluated: Record<string, Context> = {};
    const sdk = createFeaturevisor({
      logLevel: "fatal",
      datafile: docsDatafile,
      context: { userId: "user-4", country: "nl" },
      modules: [
        {
          afterEvaluation(evaluation, options) {
            evaluated[evaluation.featureKey as string] = options.context;
            return evaluation;
          },
        },
      ],
    });
    let inspected: Context = {};
    function Inspector() {
      inspected = useFeaturevisor().getContext();
      return null;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <CategoryPage category="shoes" productIds={["1"]} />
        <FeaturevisorScope context={{ category: "shoes" }}>
          <FeaturevisorScope context={{ productId: "1" }}>
            <Inspector />
          </FeaturevisorScope>
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );

    const merged = { userId: "user-4", country: "nl", category: "shoes", productId: "1" };
    expect(evaluated.sizeGuide).toEqual(merged);
    expect(evaluated.productReviews).toEqual(merged);
    expect(inspected).toEqual(merged);
    expect(sdk.getContext()).toEqual({ userId: "user-4", country: "nl" });
  });

  test("let a related product's scope replace the page's product inside it only", function () {
    const sdk = docsInstance();
    function RelatedReviews() {
      return <p data-testid="related">{String(useFlag("productReviews"))}</p>;
    }
    function RelatedProducts() {
      return (
        <FeaturevisorScope context={{ productId: "2" }}>
          <RelatedReviews />
        </FeaturevisorScope>
      );
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ productId: "1" }}>
          <ProductReviews />
          <RelatedProducts />
        </FeaturevisorScope>
      </FeaturevisorProvider>,
    );

    expect(screen.getByTestId("reviews")).toHaveTextContent("true");
    expect(screen.getByTestId("related")).toHaveTextContent("false");
  });

  test("keep a scope's keys over setContext, and sticky values over the merged context", function () {
    const sdk = docsInstance();
    render(
      <FeaturevisorProvider instance={sdk}>
        <ProductPage productId="1" />
      </FeaturevisorProvider>,
    );

    act(() => sdk.setContext({ productId: "2" }));
    expect(screen.getByTestId("reviews")).toHaveTextContent("true");

    act(() => sdk.setStickyFeatures({ productReviews: { enabled: false } }));
    expect(screen.getByTestId("reviews")).toHaveTextContent("false");
  });
});

describe("react: FeaturevisorScope when its context changes", function () {
  test("updates every hook below it, through a memoized component, in one render", function () {
    const sdk = instance();
    let renders = 0;
    const commits: string[] = [];
    const Deep = React.memo(function Deep() {
      renders += 1;
      const flag = useFlag("wishlist");
      const variation = useVariation("pricing");
      const email = useVariable("supportEmail");
      React.useLayoutEffect(() => {
        commits.push(`${flag}:${variation}:${email}`);
      });
      return null;
    });
    const Boundary = React.memo(function Boundary() {
      return <Deep />;
    });
    const tree = (context: Context) => (
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={context}>
          <Boundary />
        </FeaturevisorScope>
      </FeaturevisorProvider>
    );

    const view = render(tree({ plan: "free", country: "de" }));
    expect(commits).toEqual(["false:control:help"]);

    commits.length = 0;
    const before = renders;
    view.rerender(tree({ plan: "paid", country: "nl" }));
    expect(renders).toBe(before + 1);
    expect(commits).toEqual(["true:treatment:help-nl"]);
  });

  test("gives useFeaturevisor reads the new context", function () {
    const sdk = instance();
    const reads: boolean[] = [];
    function Reader() {
      const { isEnabled } = useFeaturevisor();
      reads.push(isEnabled("wishlist"));
      return null;
    }
    const tree = (plan: string) => (
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ plan }}>
          <Reader />
        </FeaturevisorScope>
      </FeaturevisorProvider>
    );

    const view = render(tree("free"));
    view.rerender(tree("paid"));
    expect(reads[0]).toBe(false);
    expect(reads[reads.length - 1]).toBe(true);
  });

  test("follows a context object changed in place when the scope renders again", function () {
    const sdk = instance();
    const context: Context = { plan: "free" };
    const tree = () => (
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={context}>
          <Readers />
        </FeaturevisorScope>
      </FeaturevisorProvider>
    );

    const view = render(tree());
    expect(text()).toBe("false,false,false,false,control,help,Buy");
    context.plan = "paid";
    view.rerender(tree());
    expect(text()).toBe("true,true,true,true,treatment,help,Buy");
  });

  test("does not render components below that read no feature or variable", function () {
    const sdk = instance();
    let plainRenders = 0;
    const Plain = React.memo(function Plain() {
      plainRenders += 1;
      return <span>plain</span>;
    });
    const tree = (plan: string) => (
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope context={{ plan }}>
          <Plain />
          <Readers />
        </FeaturevisorScope>
      </FeaturevisorProvider>
    );

    const view = render(tree("free"));
    const settled = plainRenders;
    view.rerender(tree("paid"));
    expect(text()).toBe("true,true,true,true,treatment,help,Buy");
    expect(plainRenders).toBe(settled);
  });

  test("treats an inline context with equal nested objects and arrays as unchanged", function () {
    const sdk = instance();
    let renders = 0;
    const Reader = React.memo(function Reader() {
      renders += 1;
      useFlag("wishlist");
      return null;
    });
    const tree = (seats: number, label: string) => (
      <FeaturevisorProvider instance={sdk}>
        <FeaturevisorScope
          context={{ plan: "paid", account: { seats, tags: ["a", "b"] }, since: new Date(0) }}
        >
          <Reader />
          <span>{label}</span>
        </FeaturevisorScope>
      </FeaturevisorProvider>
    );

    const view = render(tree(10, "a"));
    const settled = renders;
    view.rerender(tree(10, "b"));
    view.rerender(tree(10, "c"));
    expect(renders).toBe(settled);

    view.rerender(tree(60, "d"));
    expect(renders).toBe(settled + 1);
  });
});

test("react: FeaturevisorScope renders again when a nested array or date changes", function () {
  const sdk = instance();
  const isEnabled = jest.spyOn(sdk, "isEnabled");
  const tree = (tags: string[], since: number) => (
    <FeaturevisorProvider instance={sdk}>
      <FeaturevisorScope context={{ account: { tags }, since: new Date(since) }}>
        <Readers />
      </FeaturevisorScope>
    </FeaturevisorProvider>
  );
  const lastContext = () => isEnabled.mock.calls[isEnabled.mock.calls.length - 1][1] as Context;

  const view = render(tree(["a"], 0));
  view.rerender(tree(["a", "b"], 0));
  expect(lastContext().account).toEqual({ tags: ["a", "b"] });

  view.rerender(tree(["a", "b"], 1000));
  expect((lastContext().since as Date).getTime()).toBe(1000);
});
