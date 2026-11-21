/**
 * @jest-environment node
 */
import { createFeaturevisor, type Evaluation } from "@featurevisor/sdk";

import { createSignals } from "./index";
import { getEngine } from "./engine";

const datafile = {
  schemaVersion: "4",
  revision: "1",
  segments: {},
  features: { checkout: { hash: "c", bucketBy: "userId", traffic: [] } },
};

test("reads on a server evaluate without attaching anything to a shared instance", () => {
  const f = createFeaturevisor({ logLevel: "fatal", datafile });
  const on = jest.spyOn(f, "on");
  const fv = createSignals(f);

  for (let request = 0; request < 3; request++) {
    expect(fv.flag("checkout", { userId: `user-${request}` }).read()).toBe(false);
  }

  expect(on).not.toHaveBeenCalled();
  expect(getEngine(f).attached).toBe(false);
});

test("React Native, which has a window but no document, listens from the first read", async () => {
  const global = globalThis as Record<string, unknown>;
  const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  global.window = globalThis;
  Object.defineProperty(globalThis, "navigator", {
    value: { product: "ReactNative" },
    configurable: true,
  });

  try {
    const evaluations: Evaluation[] = [];
    const f = createFeaturevisor({
      logLevel: "fatal",
      datafile,
      context: { userId: "user-1" },
      modules: [
        {
          name: "counting",
          afterEvaluation: (evaluation) => {
            evaluations.push(evaluation);
            return evaluation;
          },
        },
      ],
    });
    const checkout = createSignals(f).flag("checkout");

    // A component reads while rendering, then listens once mounted.
    expect(checkout.read()).toBe(false);
    expect(getEngine(f).attached).toBe(true);
    const stop = checkout.listen(() => {});
    await Promise.resolve();
    expect(evaluations).toHaveLength(1);
    stop();
  } finally {
    delete global.window;
    if (navigator) Object.defineProperty(globalThis, "navigator", navigator);
    else delete global.navigator;
  }
});
