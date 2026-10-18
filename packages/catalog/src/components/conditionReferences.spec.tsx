import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { ConditionTree } from "./trees";
import { describeConditions, parseConditions } from "./conditionExpression";

const mockIndex = {
  set: "",
  counts: {},
  entities: {
    segment: [{ key: "netherlands", description: "Visitors from the Netherlands" }],
    attribute: [{ key: "account", description: "The signed in account" }],
    feature: [{ key: "beta", description: "Early adopter programme", deprecated: true }],
    variable: [{ key: "limit", description: "Request limit" }],
  },
};

jest.mock("../useCatalogIndex", () => ({
  useCatalogIndex: () => ({ index: mockIndex, error: null }),
}));

function render(conditions: unknown) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ConditionTree conditions={conditions as any} />
    </MemoryRouter>,
  );
}

describe("condition references", () => {
  it("shows each referenced definition's description on hover", () => {
    const html = render([
      "netherlands",
      { attribute: "account.seats", operator: "greaterThan", value: 3 },
      { feature: "beta" },
      { variable: "limit", operator: "greaterThan", value: 0 },
    ]);
    for (const description of [
      "Visitors from the Netherlands",
      "The signed in account",
      "Early adopter programme",
      "Request limit",
    ])
      expect(html).toContain(`title="${description}"`);
  });

  it("marks a deprecated reference next to its chip", () => {
    const html = render({ feature: "beta" });
    expect(html).toContain(">deprecated</span>");
    expect(html.indexOf(">deprecated<")).toBeLessThan(html.indexOf(">is enabled<"));
  });

  it("never describes a feature variable with its feature's summary", () => {
    const html = render({ feature: "beta", variable: "config", operator: "notNull" });
    expect(html).not.toContain("title=");
    expect(html).not.toContain(">deprecated<");
  });
});

describe("regex operands", () => {
  const describe = (leaf: Record<string, unknown>) =>
    describeConditions(parseConditions({ attribute: "email", ...leaf })!);

  it("reads as the pattern its author wrote, not doubly escaped JSON", () => {
    expect(describe({ operator: "matches", value: "@example\\.com$", regexFlags: "i" })).toBe(
      "email matches /@example\\.com$/i",
    );
    expect(describe({ operator: "notMatches", value: "^https?://a/" })).toBe(
      "email notMatches /^https?:\\/\\/a\\//",
    );
  });

  it("keeps other string operands quoted", () => {
    expect(describe({ operator: "equals", value: "a\\b" })).toBe('email equals "a\\\\b"');
  });
});
