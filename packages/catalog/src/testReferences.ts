import type { Test, TestCheck } from "@featurevisor/types";
import {
  expandTestAssertions,
  getTestCheckPath,
  getTestCheckPermalink,
  getTestCheckDisplayLabel,
  type TestCheckPathPart,
} from "./testModel";

export interface TestEntityReference {
  type: "feature" | "variable" | "segment";
  key: string;
  reason: string;
  permalink?: string;
  caseLabel?: string;
  checkLabel?: string;
}

export function getTestOwner(test: Test): TestEntityReference | undefined {
  if ("feature" in test) return { type: "feature", key: test.feature, reason: "Own test spec" };
  if ("segment" in test) return { type: "segment", key: test.segment, reason: "Own test spec" };
  if ("variable" in test) return { type: "variable", key: test.variable, reason: "Own test spec" };
}

/** Static references describe authored expectations, not observed test coverage. */
export function getTestReferences(test: Test): TestEntityReference[] {
  const references: TestEntityReference[] = [];
  const owner = getTestOwner(test);
  if (owner) references.push(owner);
  // Catalog can retain malformed entity specs so users can inspect their source.
  if (!Array.isArray(test.assertions)) return references;
  const testKey = test.key || ("scenario" in test ? test.scenario : "");
  for (const { assertion, label } of expandTestAssertions(test)) {
    const visit = (
      checks: TestCheck[] | undefined,
      parent: TestCheckPathPart[] = [],
      parentLabel?: string,
      childIndex?: number,
    ) => {
      for (const [index, check] of (checks || []).entries()) {
        const path = getTestCheckPath(check, index, parent);
        const checkLabel = getTestCheckDisplayLabel(check, index, parentLabel);
        if ("and" in check) visit(check.and, path, checkLabel, childIndex);
        else if ("or" in check) visit(check.or, path, checkLabel, childIndex);
        else if ("not" in check) visit(check.not, path, checkLabel, childIndex);
        else if ("segment" in check && check.segment) {
          references.push({
            type: "segment",
            key: check.segment,
            reason: check.matches ? "Segment matches" : "Segment does not match",
            permalink: getTestCheckPermalink(testKey, label, path),
            caseLabel: label,
            checkLabel: `${childIndex === undefined ? "" : `Child ${childIndex + 1} · `}Check ${checkLabel}`,
          });
        } else {
          const add = (reference: { feature?: string; variable?: string }, comparison = false) => {
            const key =
              reference.feature ||
              reference.variable ||
              (owner?.type === "variable" ? owner.key : undefined);
            if (!key) return;
            const kind = reference.feature
              ? reference.variable
                ? `Variable ${reference.variable}`
                : [
                    "enabled" in check ? "Enabled state" : "",
                    "variation" in check ? "Variation" : "",
                  ]
                    .filter(Boolean)
                    .join(" and ")
              : "Variable value";
            references.push({
              type: reference.feature ? "feature" : "variable",
              key,
              reason: comparison
                ? `Comparison operand: ${kind.charAt(0).toLowerCase()}${kind.slice(1)}`
                : kind,
              permalink: getTestCheckPermalink(testKey, label, path),
              caseLabel: label,
              checkLabel: `${childIndex === undefined ? "" : `Child ${childIndex + 1} · `}Check ${checkLabel}`,
            });
          };
          add(check);
          if ("compareTo" in check && check.compareTo) add(check.compareTo, true);
        }
      }
    };
    if ("checks" in assertion) visit(assertion.checks);
    if ("children" in assertion) {
      assertion.children?.forEach((child, index) => {
        if ("checks" in child) visit(child.checks, [["child", index]], undefined, index);
      });
    }
  }
  return references;
}

export function groupEntityTests(tests: Test[], entity: { type: string; key: string }) {
  const groups: { title: string; tests: Test[] }[] = [
    { title: "Own test specs", tests: [] },
    { title: "Referenced by scenarios", tests: [] },
    { title: "Referenced by other test specs", tests: [] },
  ];
  for (const test of tests) {
    const owner = getTestOwner(test);
    const index =
      owner?.type === entity.type && owner.key === entity.key ? 0 : "scenario" in test ? 1 : 2;
    groups[index].tests.push(test);
  }
  return groups.filter((group) => group.tests.length);
}
