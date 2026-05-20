# Groups (mutual exclusion)

Full docs: <https://featurevisor.com/docs/groups>

Use a group when two or more experiments must **never expose the same user to both** simultaneously. Files live in `groups/<name>.yml`.

## Minimum

```yaml
description: Checkout experiments — exclusive
slots:
  - feature: firstFeature
    percentage: 50
  - feature: secondFeature
    percentage: 50
```

- Slot percentages **must sum to 100**.
- Each user is bucketed once across the whole group; they land in exactly one slot's range.
- A slot's `percentage` is the **maximum** any rule in that feature can roll out to.

## Effect on member features

Given the group above, `firstFeature` can only roll out up to 50%:

```yaml
# features/firstFeature.yml
rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 50    # max allowed by the group slot
```

`npx featurevisor lint` enforces this cap.

## Removing a feature from a slot without replacement

```yaml
slots:
  - feature: firstFeature
    percentage: 50
  - feature: false        # placeholder; no feature occupies this slot
    percentage: 50
```

This is the right way to "shrink" a group's effective traffic without resizing slots.

## Hard rules (foot-guns)

- A feature can belong to **at most one** group.
- A feature cannot appear in the same group twice.
- A `required`/dependent pair cannot share a group.
- **Don't change slot percentages once users are bucketed** — that re-buckets everyone in the group. Plan up front and prefer leaving headroom (a 50% slot with the feature at 10% is fine; raise feature percentage over time within the slot's cap).
- Groups cannot be archived; delete the YAML file if no longer needed.

## Planning checklist

When the user asks for "mutually exclusive experiments":

1. Identify the features in advance.
2. Decide the **maximum** traffic each may ever need.
3. If they sum to ≤100, allocate slots accordingly (leave a `feature: false` slot for headroom if needed).
4. If they sum to >100, the user must choose which to drop or accept overlap.
5. Create the group file **before** authoring the features' rollout rules, so percentages start within their caps.
6. Run `npx featurevisor lint`.
