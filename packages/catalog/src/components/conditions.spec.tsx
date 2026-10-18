import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { ConditionTree } from "./trees";
import { describeCheck, CheckSentence } from "./checkSentence";
import { describeConditions, parseConditions } from "./conditionExpression";
import { formatComparison, formatComparisonOperator } from "./valueFormat";
import { getEntityRoute } from "../entityTypes";

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe("unified conditions", () => {
  it.each([undefined, "release/eu"])("links every leaf kind in Set %s", (setKey) => {
    const conditions = [
      "audience/premium",
      { attribute: "user.country", operator: "equals", value: "nl" },
      {
        or: [
          { feature: "checkout/ready", enabled: false },
          { feature: "allocation", variation: "on" },
        ],
      },
      {
        not: [
          { variable: "policy", path: ["a.b", 0], operator: "equals", value: "3" },
          {
            feature: "checkout/ready",
            variable: "button.label",
            operator: "matches",
            value: "^ready",
            regexFlags: "i",
          },
        ],
      },
    ];
    const html = render(<ConditionTree conditions={conditions as any} setKey={setKey} />);
    for (const [type, key, suffix] of [
      ["segment", "audience/premium", ""],
      ["attribute", "user", ""],
      ["feature", "checkout/ready", ""],
      ["variable", "policy", ""],
      ["feature", "checkout/ready", "/variables#button-label"],
    ] as const)
      expect(html).toContain(`href="${getEntityRoute(type, key, setKey)}${suffix}"`);
    expect(html).toContain("is disabled");
    expect(html).toContain("/^ready/i");
    expect(html).not.toContain("flags i");
    expect(describeConditions(parseConditions(conditions)!)).toBe(
      'audience/premium and user.country equals "nl" and (checkout/ready is disabled or allocation has variation "on") and not (policy["a.b"][0] equals "3" and checkout/ready › button.label matches /^ready/i)',
    );
  });

  it("treats bare strings as segments, never feature shorthand", () => {
    expect(render(<ConditionTree conditions="checkout" />)).toContain('href="/segments/checkout"');
    expect(render(<ConditionTree conditions="checkout" />)).not.toContain("/features/checkout");
    expect(render(<ConditionTree conditions="*" />)).toContain("Everyone");
  });

  it.each([[], { and: [] }, { or: [] }, { not: [] }].map((conditions) => [conditions]))(
    "keeps an empty expression visibly nonmatching: %j",
    (conditions) => {
      expect(render(<ConditionTree conditions={conditions as any} />)).toContain(
        "No match (empty group)",
      );
    },
  );
});

describe("condition outline", () => {
  const count = (html: string, text: string) => html.split(text).length - 1;

  it("gives every operand of a list its own row, joined by the group operator", () => {
    const html = render(
      <ConditionTree
        conditions={["netherlands", { attribute: "plan", operator: "equals", value: "pro" }]}
      />,
    );
    expect(count(html, "<li")).toBe(2);
    expect(count(html, ">and<")).toBe(1);
    expect(html).not.toContain("border-l-2");
  });

  it("indents nested groups once, including the children of not", () => {
    const html = render(
      <ConditionTree
        conditions={{
          and: [
            "eligible",
            { or: ["staff", "admins"] },
            { not: ["blocked", { attribute: "plan", operator: "equals", value: "free" }] },
          ],
        }}
      />,
    );
    // One rule for the or group and one for the children of not, never one inside another.
    expect(count(html, "border-l-2")).toBe(2);
    expect(html).not.toMatch(/border-l-2[^>]*><div[^>]*border-l-2/);
    expect(count(html, "<li")).toBe(7);
    expect(count(html, ">or<")).toBe(1);
    expect(count(html, ">not<")).toBe(1);
  });

  it("keeps a single leaf, a negated leaf and everyone on one line", () => {
    for (const conditions of ["*", "netherlands", { not: ["blocked"] }]) {
      const html = render(<ConditionTree conditions={conditions as any} />);
      expect(html).not.toContain("<li");
      expect(html).not.toContain("border-l-2");
    }
  });

  it("says what a feature leaf requires", () => {
    const describe = (conditions: unknown) => describeConditions(parseConditions(conditions)!);
    expect(describe({ feature: "chat" })).toBe("chat is enabled");
    expect(describe({ feature: "chat", enabled: false })).toBe("chat is disabled");
    expect(describe({ feature: "pricing", variation: "control" })).toBe(
      'pricing has variation "control"',
    );
    expect(render(<ConditionTree conditions={{ feature: "chat" } as any} />)).toContain(
      ">is enabled<",
    );
  });

  it("shows a variable path outside the linked key, since keys may contain dots", () => {
    const html = render(
      <ConditionTree
        conditions={
          {
            feature: "source",
            variable: "config.policy",
            path: ["retries"],
            operator: "greaterThanOrEquals",
            value: 3,
          } as any
        }
      />,
    );
    const link = html.slice(html.indexOf("<a"), html.indexOf("</a>"));
    expect(link).toContain("source › config.policy");
    expect(link).not.toContain("retries");
    expect(html).toContain(">.retries</code>");
  });
});

describe("array list condition presentation", () => {
  it.each([
    ["includesAny", "includes any of"],
    ["notIncludesAny", "includes none of"],
  ])("renders %s consistently in conditions, requirements and checks", (operator, label) => {
    const value = ["write", "admin"];
    const condition = { attribute: "account.permissions", operator, value };
    const requirement = { variable: "checkoutSettings", path: "paymentMethods", operator, value };
    const html = render(<ConditionTree conditions={condition as any} setKey="web" />);
    expect(html).toContain(label);
    expect(html).toContain("account.permissions");
    expect(html).toContain("write");
    expect(html).toContain("admin");
    expect(html).not.toContain(`>${operator}<`);
    expect(render(<ConditionTree conditions={requirement as any} />)).toContain(label);
    expect(describeConditions(parseConditions(requirement)!)).toContain(label);
    expect(describeCheck(requirement as any)).toContain(label);
    expect(render(<CheckSentence check={requirement as any} />)).toContain(label);

    const comparison = {
      variable: "checkoutSettings",
      path: "paymentMethods",
      operator,
      compareTo: { variable: "checkoutPolicy", path: "blockedPaymentMethods" },
    };
    expect(describeCheck(comparison as any)).toContain(label);
    expect(render(<CheckSentence check={comparison as any} />)).toContain(label);
  });

  it("keeps empty candidate lists visible", () => {
    expect(
      render(
        <ConditionTree
          conditions={{ attribute: "permissions", operator: "includesAny", value: [] } as any}
        />,
      ),
    ).toContain("[]");
    expect(formatComparison({ operator: "notIncludesAny", value: [], hasValue: true })).toBe(
      "includes none of []",
    );
  });

  it("preserves primitive types in comparison summaries", () => {
    expect(
      formatComparison({
        operator: "includesAny",
        value: ["1", 1, true, null],
        hasValue: true,
      }),
    ).toBe('includes any of ["1", 1, true, null]');
  });

  it.each(["includes", "notIncludes", "equals", "notEmpty", "unknown"])(
    "retains the existing %s label",
    (operator) => {
      expect(formatComparisonOperator(operator)).toBe(operator);
      expect(
        render(
          <ConditionTree
            conditions={{ attribute: "permissions", operator, value: "read" } as any}
          />,
        ),
      ).toContain(operator);
    },
  );
});
