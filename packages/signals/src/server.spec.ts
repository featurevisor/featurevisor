/**
 * @jest-environment node
 */
import { createFeaturevisor } from "@featurevisor/sdk";

import { createSignals } from "./index";
import { getEngine } from "./engine";

test("reads on a server evaluate without attaching anything to a shared instance", () => {
  const f = createFeaturevisor({
    logLevel: "fatal",
    datafile: {
      schemaVersion: "4",
      revision: "1",
      segments: {},
      features: { checkout: { hash: "c", bucketBy: "userId", traffic: [] } },
    },
  });
  const on = jest.spyOn(f, "on");
  const fv = createSignals(f);

  for (let request = 0; request < 3; request++) {
    expect(fv.flag("checkout", { userId: `user-${request}` }).read()).toBe(false);
  }

  expect(on).not.toHaveBeenCalled();
  expect(getEngine(f).attached).toBe(false);
});
