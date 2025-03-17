---
title: Bucketing
description: Learn how Featurevisor bucketing works
ogImage: /img/og/docs-bucketing.png
---

Bucketing is the process of assigning users to a specific cohort of a feature. It is a crucial part of the feature's rollout process, as it determines which users will be exposed to a feature, and which variation (if any) of the feature they will be assigned to consistently. {% .lead %}

## Factors

Few factors are involved in the bucketing process:

- The [feature](/docs/features) key (name of the feature)
- If it has [variations](/docs/features/#variations), then their `weight` values
- The [`bucketBy`](/docs/features/#bucketing) property of the feature (usually `userId`)
- The rollout [rules](/docs/features/#rules), and their `percentage` values

## Bucketing process

When a feature is evaluated in an application using [SDKs](/docs/sdks/), the following steps take place:

- Create a bucketing key from:
  - the `bucketBy` attribute's value as found in [`context`](/docs/sdks/javascript/#context), and
  - the feature's own key
- Generate a hash from the bucketing key, that ranges between 0 to 100 (inclusive)
- Iterate through the rollout rules, and check if the segments have matched and the hash is within the range of the rule's `percentage` value
- If a match is found, the feature is meant to be exposed to the user
- If the feature has variations, then find the variation that the user is assigned to based on the `weight` of the variations and the hash

## Consistent bucketing

The bucketing process is consistent, which means Featurevisor [SDKs](/docs/sdks/) will evaluate the same value for the same user and feature key repeatedly, irrespective of the number of different devices or sessions the user has.

It is because of maintaining this consistency that we have the need for [state files](/docs/state-files).

As long as the feature's rollout rules' `percentage` keeps increasing over time, it is possible to maintain consistent bucketing. The expectation is we will always gradually increase the rollout percentage of a feature, and never decrease it.

If the `percentage` of a rollout rule decreases and/or the `weight`s of variations change, then the bucketing process will not be consistent for all users any more. Even though Featurevisor tries its best to maintain consistent bucketing, it is not possible to guarantee it in all cases if the percentage value decreases.
