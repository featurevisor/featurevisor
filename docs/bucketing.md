---
title: Bucketing
description: Learn how Featurevisor bucketing works
---

Bucketing is the process how we assign users to a specific variation of a feature. {% .lead %}

## Factors

Few factors are involved in the bucketing process:

- Feature: the feature key (name of the feature), and the `weight` of the variations
- Attribute: the `bucketBy` property of the feature (usually `userId`)
- Rule: the rollout rules, and their `percentage` values

## Bucketing process

When a user is evaluated for a feature, the following steps take place:

- Create a bucketing key from the `bucketBy` attribute of the feature, and the feature's own key (the name of the feature)
- Generate a hash from the bucketing key, that ranges from 0 to 100
- Iterate through the rollout rules, and check if the segment has matched and the hash is within the range of the rule's `percentage` value
- If a match is found, the feature is meant to be exposed to the user
- Then find the variation that the user is assigned to, based on the `weight` of the variations and the hash

## Consistent bucketing

The bucketing process is consistent, which means that the same user will always be assigned to the same variation of the feature. This is achieved by using the same bucketing key for the same user, and the same feature.

It is possible to maintain consistent bucketing as long as the feature's rollout rules' `percentage` keeps increasing over time. The expectation is we will always gradually increase the rollout percentage of a feature, and never decrease it.

If the `percentage` of a rollout rule decreases, then the bucketing process will not be consistent for all users any more. Even though Featurevisor tries its best to maintain consistent bucketing, it is not possible to guarantee it in all cases if the percentage value decreases.
