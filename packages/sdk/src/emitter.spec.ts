import { Emitter, EventDetails } from "./emitter";

describe("Emitter", () => {
  let emitter: Emitter;
  let handledDetails: EventDetails[] = [];

  function handleDetails(details: EventDetails) {
    handledDetails.push(details);
  }

  beforeEach(() => {
    emitter = new Emitter();
    handledDetails = [];
  });

  it("should add a listener for an event", function () {
    const unsubscribe = emitter.on("datafile_set", handleDetails);

    expect(emitter.listeners["datafile_set"]).toContain(handleDetails);
    expect(emitter.listeners["datafile_changed"]).toBeUndefined();
    expect(emitter.listeners["context_set"]).toBeUndefined();
    expect(emitter.listeners["datafile_set"].length).toBe(1);

    // trigger already subscribed event
    emitter.trigger("datafile_set", {
      revision: "2",
      previousRevision: "1",
      revisionChanged: true,
      features: ["feature"],
      replaced: false,
    });
    expect(handledDetails.length).toBe(1);
    expect(handledDetails[0]).toEqual({
      revision: "2",
      previousRevision: "1",
      revisionChanged: true,
      features: ["feature"],
      replaced: false,
    });

    // trigger unsubscribed event
    emitter.trigger("sticky_set", { features: ["feature"], replaced: false });
    expect(handledDetails.length).toBe(1);

    // unsubscribe
    unsubscribe();
    expect(emitter.listeners["datafile_set"].length).toBe(0);

    // clear all
    emitter.clearAll();
    expect(emitter.listeners).toEqual({});
  });

  it("triggers a snapshot of listeners even if listeners unsubscribe during dispatch", function () {
    const calls: string[] = [];
    let unsubscribeSecond: (() => void) | undefined;

    emitter.on("sticky_set", () => {
      calls.push("first");
      unsubscribeSecond?.();
    });
    unsubscribeSecond = emitter.on("sticky_set", () => {
      calls.push("second");
    });

    emitter.trigger("sticky_set", { features: ["feature"], replaced: false });
    emitter.trigger("sticky_set", { features: ["feature"], replaced: false });

    expect(calls).toEqual(["first", "second", "first"]);
  });
});
