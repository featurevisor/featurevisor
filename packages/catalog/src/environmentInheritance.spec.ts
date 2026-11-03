import {
  getInheritedEnvironments,
  getInheritedFrom,
  withInherited,
  withInheritedEntries,
} from "./environmentInheritance";

const inherit = { dev: { from: "staging" } };

describe("Catalog environment inheritance", () => {
  it("names where a list comes from, only when it is inherited", () => {
    expect(getInheritedFrom({ staging: [] }, "dev", inherit)).toBe("staging");
    expect(getInheritedFrom({ dev: [], staging: [] }, "dev", inherit)).toBeUndefined();
    expect(getInheritedFrom({ production: [] }, "dev", inherit)).toBeUndefined();
    expect(getInheritedFrom({ staging: [] }, "staging", inherit)).toBeUndefined();
    expect(getInheritedFrom({ staging: [] }, "dev", undefined)).toBeUndefined();
    expect(getInheritedFrom([{ key: "flat" }], "dev", inherit)).toBeUndefined();
    expect(getInheritedFrom(undefined, undefined, inherit)).toBeUndefined();
  });

  it("fills in what an environment inherits, and leaves the rest as written", () => {
    const rules = { staging: [{ key: "everyone" }] };
    expect(withInherited(rules, inherit)).toEqual({ staging: rules.staging, dev: rules.staging });
    expect(rules).toEqual({ staging: [{ key: "everyone" }] });

    const own = { dev: [], staging: rules.staging };
    expect(withInherited(own, inherit)).toEqual(own);

    const flat = [{ key: "everyone" }];
    expect(withInherited(flat, inherit)).toBe(flat);
    expect(withInherited(rules, undefined)).toBe(rules);
    expect(withInherited(undefined, inherit)).toBeUndefined();
  });

  it("resolves each key of a definition on its own", () => {
    const entity = {
      description: "Checkout",
      rules: { dev: [], staging: ["rule"] },
      force: { staging: ["force"] },
      expose: { staging: false },
    };
    expect(withInheritedEntries(entity, inherit)).toEqual({
      description: "Checkout",
      rules: { dev: [], staging: ["rule"] },
      force: { dev: ["force"], staging: ["force"] },
      expose: { dev: false, staging: false },
    });
    expect(withInheritedEntries(entity, undefined)).toBe(entity);
    expect(withInheritedEntries({ description: "None" }, inherit)).toEqual({
      description: "None",
    });
  });

  it("lists the environments whose rules or overrides are inherited", () => {
    expect(getInheritedEnvironments({ rules: { staging: [] } }, inherit)).toEqual(["dev"]);
    expect(getInheritedEnvironments({ overrides: { staging: [] } }, inherit)).toEqual(["dev"]);
    expect(getInheritedEnvironments({ rules: { dev: [], staging: [] } }, inherit)).toBeUndefined();
    expect(getInheritedEnvironments({}, inherit)).toBeUndefined();
    expect(getInheritedEnvironments({ rules: { staging: [] } }, undefined)).toBeUndefined();
  });
});
