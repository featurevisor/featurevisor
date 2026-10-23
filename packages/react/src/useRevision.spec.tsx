import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createFeaturevisor, type Featurevisor } from "@featurevisor/sdk";
import type { DatafileContent } from "@featurevisor/types";

import { FeaturevisorProvider } from "./FeaturevisorProvider";
import { expectExactType, type IsExact } from "./typeAssertions.test-helper";
import { useFlag } from "./useFlag";
import { useRevision } from "./useRevision";

/** One feature, checkout, on for everyone unless off, at the given revision. */
function datafile(revision = "first", off = false): DatafileContent {
  return {
    schemaVersion: "4",
    revision,
    segments: {},
    features: {
      checkout: {
        hash: `checkout-${off}`,
        bucketBy: "userId",
        traffic: [{ key: "all", conditions: "*", percentage: off ? 0 : 100000 }],
      },
    },
    variables: {
      gate: { hash: "gate", type: "boolean", defaultValue: true },
    },
  };
}

function instance(revision?: string) {
  return createFeaturevisor({ logLevel: "fatal", datafile: datafile(revision) });
}

/** Records every listener the hook attaches, and whether it was removed. */
function observe(sdk: Featurevisor) {
  const original = sdk.on.bind(sdk);
  const cleanups: jest.Mock[] = [];
  const on = jest.spyOn(sdk, "on").mockImplementation((event, callback) => {
    const cleanup = jest.fn(original(event, callback));
    cleanups.push(cleanup);
    return cleanup;
  });
  return { on, cleanups, active: () => cleanups.filter((fn) => !fn.mock.calls.length) };
}

let renders = 0;
const commits: string[] = [];

function Revision({ duringLayout }: { duringLayout?: () => void }) {
  renders += 1;
  const revision = useRevision();
  React.useLayoutEffect(() => {
    commits.push(revision);
  });
  // Layout effects run before the hook subscribes, so changes made here test that gap.
  React.useLayoutEffect(() => {
    if (duringLayout) duringLayout();
  }, [duringLayout]);
  return <small data-testid="revision">{revision}</small>;
}

function tree(sdk: Featurevisor, duringLayout?: () => void) {
  return (
    <FeaturevisorProvider instance={sdk}>
      <Revision duringLayout={duringLayout} />
    </FeaturevisorProvider>
  );
}

const text = () => screen.getByTestId("revision").textContent;

beforeEach(() => {
  renders = 0;
  commits.length = 0;
});

describe("react: useRevision", function () {
  test("returns the revision of the instance's datafile", function () {
    render(tree(instance("first")));
    expect(text()).toBe("first");
  });

  test("renders again when a datafile with a new revision is set", function () {
    const sdk = instance("first");
    render(tree(sdk));

    act(() => sdk.setDatafile(datafile("second")));
    expect(text()).toBe("second");

    act(() => sdk.setDatafile(datafile("third"), true));
    expect(text()).toBe("third");
  });

  test("follows the first datafile when the instance starts without one", function () {
    const sdk = createFeaturevisor({ logLevel: "fatal" });
    render(tree(sdk));
    expect(text()).toBe("unknown");

    act(() => sdk.setDatafile(datafile("first")));
    expect(text()).toBe("first");
  });

  test("does not render again when the revision stays the same", function () {
    const sdk = instance("first");
    render(tree(sdk));
    const before = renders;

    act(() => {
      // The same revision with a changed feature, then every other kind of event.
      sdk.setDatafile(datafile("first", true));
      sdk.setContext({ userId: "user-2" });
      sdk.setStickyFeatures({ checkout: { enabled: false } });
      sdk.setStickyVariables({ gate: false });
    });
    expect(renders).toBe(before);
    expect(text()).toBe("first");
  });

  test("keeps its revision when a datafile is rejected", function () {
    const sdk = instance("first");
    render(tree(sdk));
    const before = renders;

    act(() => sdk.setDatafile("not a datafile"));
    expect(renders).toBe(before);
    expect(text()).toBe("first");
  });

  test("subscribes once, to datafile updates only, however often it renders", function () {
    const sdk = instance();
    const events = observe(sdk);
    const view = render(tree(sdk));

    for (let i = 0; i < 3; i++) {
      view.rerender(tree(sdk));
    }

    expect(events.on).toHaveBeenCalledTimes(1);
    expect(events.on).toHaveBeenCalledWith("datafile_set", expect.any(Function));
    expect(events.active()).toHaveLength(1);
  });

  test("follows a new instance from the provider, and leaves the old one", function () {
    const first = instance("first");
    const second = instance("second");
    const firstEvents = observe(first);
    const view = render(tree(first));

    view.rerender(tree(second));
    expect(text()).toBe("second");
    firstEvents.cleanups.forEach((cleanup) => expect(cleanup).toHaveBeenCalledTimes(1));

    const before = renders;
    act(() => first.setDatafile(datafile("first-updated")));
    expect(renders).toBe(before);

    act(() => second.setDatafile(datafile("second-updated")));
    expect(text()).toBe("second-updated");
  });

  test("removes its listener on unmount", function () {
    const sdk = instance();
    const events = observe(sdk);
    const view = render(tree(sdk));

    view.unmount();
    expect(events.cleanups).toHaveLength(1);
    events.cleanups.forEach((cleanup) => expect(cleanup).toHaveBeenCalledTimes(1));

    const before = renders;
    act(() => sdk.setDatafile(datafile("unmounted")));
    expect(renders).toBe(before);
  });

  test.each(["mount", "provider"])(
    "catches a datafile set before it subscribes, on %s",
    function (change) {
      const first = instance("first");
      const second = instance("second");
      const target = change === "provider" ? second : first;
      let changed = false;
      const duringLayout = () => {
        if (changed) return;
        changed = true;
        target.setDatafile(datafile("between"));
      };

      const view = render(change === "mount" ? tree(target, duringLayout) : tree(first));
      if (change === "provider") {
        commits.length = 0;
        view.rerender(tree(target, duringLayout));
      }

      expect(commits[0]).toBe(change === "mount" ? "first" : "second");
      expect(commits[commits.length - 1]).toBe("between");
      expect(text()).toBe("between");
    },
  );

  test("keeps one listener in StrictMode", function () {
    const sdk = instance("first");
    const events = observe(sdk);
    const view = render(<React.StrictMode>{tree(sdk)}</React.StrictMode>);
    expect(events.active()).toHaveLength(1);

    act(() => sdk.setDatafile(datafile("second")));
    expect(text()).toBe("second");

    view.unmount();
    expect(events.active()).toHaveLength(0);
  });

  test("commits the revision together with the flags of the same datafile", function () {
    const sdk = instance("first");
    const seen: string[] = [];

    function Status() {
      const revision = useRevision();
      const checkout = useFlag("checkout");
      React.useLayoutEffect(() => {
        seen.push(`${revision}:${checkout}`);
      });
      return null;
    }

    render(
      <FeaturevisorProvider instance={sdk}>
        <Status />
      </FeaturevisorProvider>,
    );
    expect(seen[seen.length - 1]).toBe("first:true");

    seen.length = 0;
    act(() => sdk.setDatafile(datafile("second", true)));
    expect(seen.length).toBeGreaterThan(0);
    seen.forEach((value) => expect(value).toBe("second:false"));
  });

  test("returns a string", function () {
    function Types() {
      const revision = useRevision();
      expectExactType<IsExact<typeof revision, string>>(true);
      return <p data-testid="types">{revision}</p>;
    }

    render(
      <FeaturevisorProvider instance={instance("first")}>
        <Types />
      </FeaturevisorProvider>,
    );
    expect(screen.getByTestId("types")).toHaveTextContent("first");
  });
});
