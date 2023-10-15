import { TestSegment, Condition } from "@featurevisor/types";
import { allConditionsAreMatched } from "@featurevisor/sdk";

import { Datasource } from "../datasource";

import { CLI_FORMAT_RED } from "./cliFormat";

export function testSegment(datasource: Datasource, test: TestSegment): boolean {
  let hasError = false;

  const segmentKey = test.segment;

  console.log(`     => Segment "${segmentKey}":`);

  const segmentExists = datasource.entityExists("segment", segmentKey);

  if (!segmentExists) {
    console.error(`        => Segment does not exist: ${segmentKey}`);
    hasError = true;

    return hasError;
  }

  const parsedSegment = datasource.readSegment(segmentKey);
  const conditions = parsedSegment.conditions as Condition | Condition[];

  test.assertions.forEach(function (assertion, aIndex) {
    const description = assertion.description || `#${aIndex + 1}`;

    console.log(`        => Assertion #${aIndex + 1}: ${description}`);

    const expected = assertion.expectedToMatch;
    const actual = allConditionsAreMatched(conditions, assertion.context);

    if (actual !== expected) {
      hasError = true;

      console.error(
        CLI_FORMAT_RED,
        `           Segment failed: expected "${expected}", got "${actual}"`,
      );
    }
  });

  return hasError;
}
