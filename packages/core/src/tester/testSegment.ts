import { TestSegment, Condition } from "@featurevisor/types";
import { allConditionsAreMatched } from "@featurevisor/sdk";

import { Datasource } from "../datasource";

import { CLI_FORMAT_BOLD, CLI_FORMAT_RED } from "./cliFormat";
import { getSegmentAssertionsFromMatrix } from "./matrix";

export async function testSegment(
  datasource: Datasource,
  test: TestSegment,
  patterns,
): Promise<boolean> {
  let hasError = false;

  const segmentKey = test.segment;

  console.log(CLI_FORMAT_BOLD, `  Segment "${segmentKey}":`);

  const segmentExists = await datasource.segmentExists(segmentKey);

  if (!segmentExists) {
    console.error(CLI_FORMAT_RED, `  Segment does not exist: ${segmentKey}`);
    hasError = true;

    return hasError;
  }

  const parsedSegment = await datasource.readSegment(segmentKey);
  const conditions = parsedSegment.conditions as Condition | Condition[];

  test.assertions.forEach(function (assertion, aIndex) {
    const assertions = getSegmentAssertionsFromMatrix(aIndex, assertion);

    assertions.forEach(function (assertion) {
      if (patterns.assertionPattern && !patterns.assertionPattern.test(assertion.description)) {
        return;
      }

      console.log(assertion.description);

      const expected = assertion.expectedToMatch;
      const actual = allConditionsAreMatched(conditions, assertion.context);

      if (actual !== expected) {
        hasError = true;

        console.error(
          CLI_FORMAT_RED,
          `    Segment failed: expected "${expected}", got "${actual}"`,
        );
      }
    });
  });

  return hasError;
}
