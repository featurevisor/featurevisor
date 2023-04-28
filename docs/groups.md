---
title: Groups
description: Learn how to create groups in Featurevisor
---

Groups enable you to run mutually exclusive experiments. {% .lead %}

## Mutually exclusive experiments

Let's say you have two experiments defined as `firstFeature` and `secondFeature`.

You want to run them both together in production, but you do not want to expose both of them together to any single user.

That's what "mutually exclusive" means here. They will never overlap.

You can take advantage of groups in Featurevisor to achieve this.

## Create a group

We can create groups by creating a new file in the `groups` directory:

```yml
# groups/myGroup.yml
description: My exclusion group

slots:
  - feature: firstFeature  # referring features/firstFeature.yml
    percentage: 50

  - feature: secondFeature # referring features/secondFeature.yml
    percentage: 50
```

## Slots

Each slot in a group defines a feature (by its key) and a percentage value (from 0 to 100). All the percentage values of slots in a group should add up to 100.

In the example above, we have two slots, each with a percentage of 50. This means that each user will be exposed to one of the features, but not both.

The first 50% of the users will be exposed to `firstFeature`, and the other 50% will be exposed to `secondFeature`.

## Impact on affected features

The slot's percentage determines what's the maximum percentage value you can use in your Feature's rollout rules.

In the example above, the maximum percentage value you can use in `firstFeature` and `secondFeature` is 50.

```yml
# features/firstFeature.yml

# ...

environments:
  production:
    rules:
      - key: "1"
        segments: "*"
        percentage: 50 # can be any value between 0 and 50
```

## Bucketing

Whenever a feature is evaluated, it goes through a bucketing process where the user is assigned a number between 0 and 100. If the bucketed number falls into the range of any slot, it means that the user is exposed to that particular feature only in the group.

Read more in [Bucketing](/docs/bucketing).

## Limitations

- A feature can only belong to maximum one group at a time
- A feature cannot repeat in the same group's slots (this will be supported in a future version)

## Guides

To maintain consistent bucketing, you are advised to:

- keep mutual exclusions in mind before creating the feature and the group
- create them together, and then add the rollout rules to the feature
- plan the percentage distribution in your slots when creating the group, and do not change those values afterwards
- you can set `feature: false` if you want to remove a feature from a group's slot without any replacement

Rely on [Linting YAMLs](/docs/linting-yamls) to catch any mistakes.

## Archiving

Groups cannot be archived. If you don't need them any more, you can delete their YAML files.
