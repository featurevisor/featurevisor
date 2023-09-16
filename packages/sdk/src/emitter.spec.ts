import { Emitter } from "./emitter";

describe("sdk :: Emitter", () => {
  let emitter: Emitter;

  beforeEach(() => {
    emitter = new Emitter();
  });

  describe("addListener", () => {
    it("should add a listener", () => {
      const fn = jest.fn();

      emitter.addListener("ready", fn);

      expect(emitter["_listeners"]["ready"]).toEqual([fn]);
    });

    it("should add multiple listeners", () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();

      emitter.addListener("ready", fn1);
      emitter.addListener("ready", fn2);

      expect(emitter["_listeners"]["ready"]).toEqual([fn1, fn2]);
    });

    it("should add multiple listeners for different events", () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();

      emitter.addListener("ready", fn1);
      emitter.addListener("update", fn2);

      expect(emitter["_listeners"]["ready"]).toEqual([fn1]);
      expect(emitter["_listeners"]["update"]).toEqual([fn2]);
    });
  });

  describe("removeListener", () => {
    it("should remove a listener", () => {
      const fn = jest.fn();

      emitter.addListener("ready", fn);
      emitter.removeListener("ready", fn);
      emitter.removeListener("update", fn);

      expect(emitter["_listeners"]["ready"]).toEqual([]);
    });

    it("should remove multiple listeners", () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();

      emitter.addListener("ready", fn1);
      emitter.addListener("ready", fn2);
      emitter.removeListener("ready", fn1);
      emitter.removeListener("ready", fn2);

      expect(emitter["_listeners"]["ready"]).toEqual([]);
    });

    it("should remove multiple listeners for different events", () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();

      emitter.addListener("ready", fn1);
      emitter.addListener("update", fn2);
      emitter.removeListener("ready", fn1);
      emitter.removeListener("update", fn2);

      expect(emitter["_listeners"]["ready"]).toEqual([]);
      expect(emitter["_listeners"]["update"]).toEqual([]);
    });
  });

  describe("removeAllListeners", () => {
    it("should remove all listeners", () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();

      emitter.addListener("ready", fn1);
      emitter.addListener("update", fn2);
      emitter.removeAllListeners();
    });

    it("should remove all listeners for a specific event", () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();

      emitter.addListener("ready", fn1);
      emitter.addListener("update", fn2);
      emitter.removeAllListeners("ready");

      expect(emitter["_listeners"]["ready"]).toEqual([]);
      expect(emitter["_listeners"]["update"]).toEqual([fn2]);
    });
  });
});
