import { mergeContext } from "./context";
import { createFeaturevisor } from "./index";

describe("context copying", () => {
  const special = JSON.parse('{"__proto__":{"role":"admin"},"country":"nl"}');
  function expectSafe(value: Record<string, unknown>) {
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
    expect(value["role"]).toBeUndefined();
  }

  it("preserves own prototype keys from either input without changing the prototype", () => {
    expectSafe(mergeContext(special));
    expectSafe(mergeContext({}, special));
    const result = mergeContext(special, JSON.parse('{"__proto__":null,"country":"de"}'));
    expectSafe(result);
    expect(result["__proto__"]).toBeNull();
    expect(result.country).toBe("de");
    expect(special["__proto__"]).toEqual({ role: "admin" });
    expect(mergeContext({ country: "nl" }, { country: "de" })).toEqual({ country: "de" });
    expect(Object.getPrototypeOf(mergeContext({}))).toBe(Object.prototype);
  });

  it("preserves safe keys when merging parent and child context", () => {
    const f = createFeaturevisor({ context: special, logLevel: "fatal" });
    expectSafe(f.getContext({}));
    f.setContext({ country: "de" });
    expectSafe(f.getContext());
    const child = f.spawn({});
    expectSafe(child.getContext());
    child.setContext({ country: "fr" });
    expectSafe(child.getContext({}));
    f.setContext({}, true);
    f.setContext(special);
    expectSafe(f.getContext());
    child.setContext({}, true);
    child.setContext(special);
    expectSafe(child.getContext());
    child.close();
    f.close();
  });
});
