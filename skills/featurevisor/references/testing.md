# Testing reference

Full docs: <https://featurevisor.com/docs/testing>

Featurevisor ships an in-process test runner. Specs live in `tests/features/`, `tests/segments/`, and `tests/variables/` by default. File names are conventional, not load-bearing.

In a sets project, `promotable: false` can be set at the top level of either kind of test spec. If the matching destination spec exists, it is preserved when either the source or destination spec has this field. A missing destination spec is still created.

Individual assertions can also set `promotable: false`. Give every assertion in that spec a unique stable `key`. A protected source assertion is omitted, while a protected destination assertion is preserved when the source contains the same key. Both source and destination specs must use assertion keys when protection is involved. Matrix cases and child assertions are protected together through their parent assertion.

Assertion `key`s are useful beyond promotions: they become stable labels and permalinks in the [Catalog](querying.md), with expanded matrix cases labelled `<key>.1`, `<key>.2`, and so on, so a failing case can be linked to directly.

Run:

```bash
npx featurevisor test
npx featurevisor test --keyPattern="myFeature"
npx featurevisor test --keyPattern="myFeature" --assertionPattern="in NL"
npx featurevisor test --verbose                  # SDK trace per assertion
npx featurevisor test --onlyFailures
```

## Feature spec

```yaml
feature: foo
assertions:
  - key: control-in-nl
    description: Control in NL at 40th percentile
    environment: production       # omit if project has no environments configured
    at: 40                        # bucketed percentile (0–100) the assertion runs at
    context:
      userId: '123'
      country: nl
    expectedToBeEnabled: true
    expectedVariation: control
    expectedVariables:
      bgColor: red
```

Available expectations on a feature assertion:

| Field                 | Type    | Notes                                           |
| --------------------- | ------- | ----------------------------------------------- |
| `expectedToBeEnabled` | boolean | Flag check                                      |
| `expectedVariation`   | string  | Expected variation value                        |
| `expectedVariables`   | object  | Map of variable key → expected value            |
| `expectedEvaluations` | object  | Lower-level evaluation result checks (advanced) |

Additional inputs an assertion can set up (advanced, all optional):

| Field                                             | Purpose                                                                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sticky`                                          | Sticky features for the test SDK instance, consulted before evaluation exactly like `f.setStickyFeatures()` at runtime                                                                      |
| `defaultVariationValue` / `defaultVariableValues` | Fallback values the SDK would return instead of `null`. Presence-based: `""`, `0`, `false`, and `null` are honored as explicit defaults, not ignored as "empty"                             |
| `children`                                        | List of child-instance assertions — each entry spawns a child (`f.spawn()`) with its own `context` / `sticky` and its own `expectedToBeEnabled` / `expectedVariation` / `expectedVariables` |

```yaml
assertions:
  # child instances (server-side spawn behavior)
  - at: 10
    environment: production
    context: {}
    expectedToBeEnabled: true
    children:
      - context: { country: nl }
        expectedToBeEnabled: false

  # sticky input
  - at: 40
    environment: production
    sticky:
      redesign:
        enabled: true
    context: { country: de }
    expectedToBeEnabled: true
```

`expectedEvaluations` asserts fields of the raw evaluation objects (`flag:`, `variation:`, `variables.<key>:`) such as `reason` or `ruleKey` — useful for pinning _why_ a value was returned, not just what.

## Segment spec

```yaml
segment: netherlands
assertions:
  - description: NL context matches
    context:
      country: nl
    expectedToMatch: true

  - description: DE context does not match
    context:
      country: de
    expectedToMatch: false
```

## Global variable spec

```yaml
variable: supportEmail
assertions:
  - environment: production
    context: { country: nl }
    expectedValue: support-nl@example.com
    expectedEvaluation:
      reason: variable_override_rule
      variableOverrideKey: netherlands
```

Variable assertions support `matrix`, `target`, `stickyVariables`, and `defaultVariableValue`.

## Matrix expansion

Run the same assertion across combinations of values:

```yaml
feature: foo
assertions:
  - matrix:
      at: [40, 60]
      environment: [production]
      country: [nl, de, us]
      plan: [free, premium]
    description: At ${{ at }}% in ${{ country }}/${{ plan }}
    environment: ${{ environment }}
    at: ${{ at }}
    context:
      country: ${{ country }}
      plan: ${{ plan }}
    expectedToBeEnabled: true
```

Use `${{ name }}` to interpolate any matrix key. Mixing static and matrix driven fields is fine. Placeholders are replaced recursively inside nested objects and arrays, including context, sticky values, defaults, expected values, detailed expected evaluations, and child assertions. A placeholder used as the complete value preserves its original type.

## Testing against target datafiles

The runner builds target datafiles in memory. To imitate a real consumer that loads a target-specific datafile:

```yaml
assertions:
  - environment: production
    at: 90
    context: { country: nl }
    target: web
    expectedToBeEnabled: true
```

Then run:

```bash
npx featurevisor test
```

Pass `--target=web` to build only that target datafile and run untargeted assertions plus assertions for `web`. Repeat the option to select several targets. Segment tests are always run because they do not select a target datafile.

## When you create a feature or segment

Offer (don't force): "I can add a `tests/.../spec.yml` for this — want me to?" If yes, use [templates/test-feature.spec.yml](../templates/test-feature.spec.yml) / [templates/test-segment.spec.yml](../templates/test-segment.spec.yml).

Cover at minimum:

- The catch-all rule at a high `at` (e.g. 99) in each environment that should be enabled.
- One assertion **inside** any targeted segment (e.g. country = nl) and one outside it.
- If variations exist, one assertion per variation by picking `at` values in their weight bands.
- If variables override per rule/variation, assert the overridden values directly.

After authoring, run:

```bash
npx featurevisor test --keyPattern="<key>"
```

## Running the same specs through another language's SDK

Test specs aren't JavaScript-specific. Every non-JS SDK ships a CLI that runs **these same spec files** through its own implementation — proving the features behave identically in the language the application actually uses:

```bash
python -m featurevisor test
go run cmd/main.go test --projectDirectoryPath="/absolute/path/to/project"
bundle exec featurevisor test --projectDirectoryPath="/absolute/path/to/project"
```

Definitions, spec discovery, and datafile generation still come from the Node.js CLI; the language CLI supplies only the evaluation engine. Details and the full per-language list: [sdk-other-languages.md](sdk-other-languages.md#verifying-your-project-against-a-specific-sdk).
