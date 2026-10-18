# SDK conformance

These fixtures define portable behaviour shared by Featurevisor SDKs. The JavaScript SDK is the reference implementation, but expected results are specified explicitly rather than accepted from whichever SDK runs a test.

External SDK maintainers should start with the normative
[`runtime.md`](runtime.md) contract. Native CLI runner maintainers should also
read the separate [`test-execution.md`](test-execution.md) input protocol. SDK
runtime fixture versions, datafile schema versions and native test execution
schema versions are independent.

## Main contract

`sdk-v3.json` retains its historical filename. Its `version` identifies the actual contract, which now includes v4 conditions. Consumers must check the version and execute its sections, not just copy the file or update a version assertion.

Version 12 adds `requiredFeatures.evaluationCases`, with nine explicit detailed evaluation expectations using `requiredFeatures.datafile`. Each case has a `type` (`flag`, `variation` or `variable`), an optional `feature` key, an optional `variable` key, and an `expected` object. A variable case without `feature` evaluates a global variable. Create an independent instance for each case, evaluate twice and compare every supplied expected field. Reject unsupported versions before evaluating any cases. The current expectations use `conditions_unmet` for root gates and retain variation and feature variable disabled value policies.

Version 13 adds 62 `includesAny` and `notIncludesAny` condition cases, bringing
`conditionCases` to 152. Execute them all, including malformed operands, empty
arrays, nested paths and strict primitive matching. `test-checks.json` version 3
contains 255 cases, including 36 array list membership checks with literal and
resolved operands, feature variables, comparison errors and short circuiting.
The native execution protocol and datafile schema versions are unchanged.

Version 14 adds 23 numeric comparison cases, bringing `conditionCases` to 175
and array list membership cases to 73. Preserve the literal `1.0` spellings
in this JSON file so native parsers exercise integer and floating values in
both operand positions. Large `1e30` and tiny `1e-100` numbers must compare
without decimal overflow or rounding to zero. JSON cannot encode NaN or
infinity, so native unit tests cover those host values separately. Do not
reserialize this fixture through JavaScript when syncing native copies.

Version 15 adds 14 further integer and floating comparison cases, bringing
`conditionCases` to 189. Both operand directions are covered for `notEquals`,
`in`, `notIn` and the four numeric comparisons. The existing `equals` cases
remain, and the array list membership count stays 73. Preserve all raw `1.0`
spellings when syncing this version too. These are runtime tests. Authored
condition `in` and `notIn` still require string attributes and string candidates.

## Unified conditions and the native release gate

The v4 CLI emits `schemaVersion: "4"`. The v4 SDK also reads v3 datafiles.
The JavaScript canonical fixtures migrate only unreleased requiredVariables
selectors and root evaluation expectations. Legacy segments and requiredFeatures
datafiles retain their original content and historical numeric spellings.
Section names in sdk-v3.json remain stable for existing fixture adapters.

`sdk-conditions.json` version 1 has capability `unified-conditions`. Each case
contains its own datafile, name, context, type (`flag` or `variable`), feature or
variable key, expected fields, and optional instance options and dependencies.
Create an independent instance per case and evaluate twice. For variable cases,
`expected.value` is the ordinary getter result. Other expected properties belong
to the detailed evaluation. For flag cases, compare the detailed enabled state
and use the ordinary boolean getter too. An error evaluation may omit enabled
while the getter returns false. Do not require unrelated metadata to be absent.

When dependencies are supplied, capture beforeEvaluation callbacks with a
dependencyPurpose during one detailed evaluation. Compare their ordered feature,
variable and dependencyPurpose fields exactly. Exclude the root callback and
reset observations between calls. This verifies short circuiting, memoization,
the condition tag and composition gates running before their sources.

The fixtures cover every leaf kind, wildcard and mixed groups, recursive
segments, segment cycles, gate reasons, force and sticky bypasses, rule fall
through, inherited overrides, composition fallbacks and legacy normalization.
Explicit null root gates are distinct from omitted gates in both schema 2 and
schema 4 inputs. They report conditions_unmet with conditions set to null and
use a variable's disabledValue. A NOT array containing a null child still
negates that child's ordinary false result. Do not confuse that case with a
malformed nonarray NOT operand.

Execute every case in each capability fixture twice. Assert that the number of
executed cases matches the fixture contents rather than a fixed historical
count. Portable metadata comparisons require field presence for `conditions`,
including expected nulls. Other fields compare values without requiring typed
nullable models to distinguish omission from null. Preserve JSON object and
list distinctions and primitive types, while comparing equivalent integer and
floating numbers numerically.

## Selector diagnostic sequence

`sdk-diagnostics.json` version 1 is a separate stateful diagnostic contract.
Start each case with an empty instance and an error level diagnostic handler.
Execute its operations in order, comparing each result and the diagnostic list
emitted during that operation. Compare diagnostics as an unordered list because
entity traversal order differs across platforms. Preserve duplicate counts.
Compare `code`, `level`, exact `details` and the current `revision` read from
the instance inside the handler.

For feature parse diagnostics, reenter the ordinary flag getter from the
handler once. The accepted entity must already be available, with no repeated
parse diagnostic. Run the complete sequence twice with independent instances.
The fixture checks eager legacy loading, lazy current reads, repeated reads,
unrelated partial updates and fresh diagnostics after entity replacement.

`native-baseline/` preserves the earlier contract as the generator's historical
input. Do not regenerate it. The native copy guard now compares SDK and provider
copies with the current fixtures in this directory, including both capability
fixtures. Preserve the original bytes, especially numeric spellings. Matching
copies alone do not establish conformance. Each adapter must execute the cases,
and each native runner must pass the current Example 1 and composition project.

Regenerate with `node scripts/generate-sdk-v4-conformance.mjs --write`, after
building the SDK. Use `--check` to execute all generated runtime cases and check
freshness. The generator preserves historical JSON lexemes when migrating the
frozen source fixtures. Neither command writes native repositories.

## Composition capability

`sdk-composition.json` version 2 is a separate capability fixture with 26 named
cases. It covers all getter reference forms, decoded JSON, disabled and sticky
sources, nested composition, runtime overrides, nested continuation, required
features and variables, null members, literal replacement and failure cleanup.
Compare every expected value and evaluation field, keep source data unchanged
and verify fresh outer objects for successful nonsticky map compositions.
String compositions return the source value directly, including null, scalars,
arrays and decoded JSON. Their aliases can chain and apply runtime overrides.
JSON sources must be decoded exactly once. Mutations must not modify sources.

The native copy guard requires this fixture. Passing the older fixtures does
not establish composition support. Each adapter must execute every case and
cover ownership and callback behaviour in language specific tests.

## Shared experiment allocation

Example 1 defines `experimentAllocation`, whose bar, qux and
holdout variations gate dependent features through feature leaves in
`conditions`. Feature and scenario specs cover allocation boundaries and the holdout.
After the Node packages are built, verify ordinary hashing without fixed bucket
overrides from the monorepo root:

```sh
node scripts/test-experiment-allocation.mjs
```

This read only check evaluates 20,000 user IDs in each configured environment,
checks every assignment against both dependent flags and requires each cohort
to remain within three percentage points of its configured 40/40/20 share.
The CLI integration suite runs the same check.

## Version comparisons

`semver.json` contains 44 explicit order expectations, including invalid strings.
Run each pair in both directions through all six version operators. Exercise
attribute and variable conditions, and CLI checks using
literal and evaluated operands. Invalid strings must not become successful
conditions or checks through negation. The runtime contract defines ordering
without depending on a host language's integer size, Unicode digit parsing or
regular expression line anchors.

Native unit suites consume their local copy. The runner conformance script also
generates an isolated authored project with 528 comparisons from this corpus.
It verifies native evaluation and structured comparison failures after building
datafiles through the Node CLI. Example 1 keeps smaller readable demonstrations
in `versionGate`, `versionMessage`, `stableVersion` and their tests.

## Supplemental v4 cases

`sdk-v4-cases.json` version 1 contains 255 cases for accumulating overrides, all eight mutation operations, selectors, typed paths, primitive equality, malformed programs, null versus missing values, required variable errors, and shallow emptiness operators. Forty paired cases compare complete values with ordinary first match runtime programs, covering nested fallbacks, literal resets, prerequisites, and parsed or stringified selectors.

Each case contains:

- `name`: the test identifier.
- `datafile`: the complete input datafile.
- `context`: the evaluation context.
- `options`: instance options, using canonical SDK names.
- `expected.value`: the ordinary global variable getter result for `subject`.
- Other `expected` properties: the corresponding fields on its detailed evaluation.

Create an independent instance for each case. Evaluate it twice through both the ordinary getter and detailed evaluator. Compare the expected fields without requiring unrelated evaluation metadata to be absent. The SDK must not modify input defaults or mutation operands. Tests should also ensure mutation state does not carry over to the second evaluation.

Malformed input cases require failure, never a successful default or partial accumulated result. The reference SDK reports evaluation errors. A strongly typed SDK may reject a malformed datafile while decoding it; document that distinction and still test that it cannot evaluate successfully. Do not skip these cases because the language represents valid operations with an enum.

The portable fixture does not replace native tests for module callbacks, concurrency, child state, diagnostics, subscription cleanup, dependency notifications, or API removal. Those behaviours require assertions beyond JSON inputs and outputs.

## OpenFeature provider cases

`openfeature-provider.json` is a small, versioned provider contract. Every
provider suite checks `kind` and `schemaVersion`, loads the shared datafile,
and exercises resolution cases with its native OpenFeature client where feasible.
The sixteen resolution cases include map and alias compositions, JSON decoded
exactly once, copied override mutations, disabled gates and dependency errors.
Keep these reason mappings aligned: `variable_composed` is `TARGETING_MATCH`
and `conditions_unmet` is `DISABLED`.
`targetingCases` checks whether an absent targeting key preserves an existing
field and an explicitly empty key overrides it. Provider suites also check
custom targeting field configuration and input ownership. Lifecycle, events,
concurrency and callback ordering remain native tests. The Go, Swift,
Python and PHP OpenFeature clients cannot pass the distinction
between an omitted and explicitly empty targeting key through their normal
targeting key API. Their provider suites document and test the available field
attribute workaround.

Rust's upstream structured value API cannot represent JSON null. Its provider
suite checks the nonnull cases and records the two null cases as the accepted
upstream limitation.

The fixture is copied into the Go, Rust and Elixir provider modules, both Dart
provider packages, and the Java, Swift and .NET provider test resources. These
copies are checked by the guard so standalone provider tests do not rely on a
sibling repository path.
The Dart client also embeds the exact JSON in a generated Dart test constant so
the same corpus runs on the VM and in Chrome. The guard checks that embedded
copy against the canonical provider fixture too.

## Stateful runtime cases

`sdk-stateful.json` uses `kind: "featurevisor.sdk-stateful"` and
`schemaVersion: 1`. It covers ordered datafile updates, dependency propagation,
rejected input preserving previous state, and root versus child sticky ownership.
Consumers must reject an unsupported kind or version before applying an
operation. Run each case with a fresh root instance, apply operations in order
and compare the events and results after every operation.

The stateful fixture complements the stateless files. It does not replace native
tests for callback ordering, lock discipline, race safety, cleanup or package
ownership.

With the native SDK repositories checked out alongside this monorepo, verify
that every copied fixture matches its frozen native baseline:

```sh
make check-conformance-fixtures
```

This optional local check reports missing or changed copies, including Dart's
package copy. It never rewrites files and is not part of `make check` or CI.
Keep the baseline untouched during this JavaScript migration. After the native
ports are authorised, review fixture changes deliberately, update every adapter,
then change the guard to the current contract and rerun native tests.

## Native CLI runner contract

`test-checks.json` contains portable check operator and evaluation cases. The
versioned transport from the Node.js CLI to native runners is specified only in
`test-execution.md`. Runners request it with:

```sh
npx featurevisor list --tests --execution-protocol
```

They must validate the envelope before building datafiles and preflight all root
and child references before invoking any SDK getter. Ordinary
`list --tests --json` output is not a compatibility fallback.

## Authored mutation parity

Example 1 includes the `mutationConformance` global variable and a focused
`mutation-conformance` Target. Its test spec compares complete expected values
for nested first match overrides, continuing mutations and child sticky state.

Build the Node.js packages and the native CLI runners first, then run from the
monorepo root:

```sh
make test-mutation-conformance RUNNERS="javascript go"
```

Omit `RUNNERS` to include all native SDKs. JavaScript always runs as the reference.
The script copies Example 1 to temporary directories and executes the focused
spec with `precomputeMutations` set to both true and false. It checks the emitted
representations, Target dependencies, hashes, explicit expected values and
portable runner reports. It never changes the original project configuration.
The native sweep remains an optional local check outside `make check`. CI runs
the JavaScript only mode without installing native SDK toolchains.

## Maintaining the supplemental fixture

After building the JavaScript SDK, run:

```sh
node scripts/generate-sdk-v4-conformance.mjs
```

The generator verifies explicit expected results against the current SDK and prints the fixture. Update the tracked JSON deliberately and run `packages/sdk/src/v4-port-conformance.spec.ts`. Keep copies identical in every port which implements this contract. Do not distribute the fixture to older SDK branches as though changing the version assertion completes the port.

Use `node scripts/generate-sdk-v4-conformance.mjs --check` to verify that the
generator reproduces the complete tracked fixture without writing any files.
This catches cases added to the fixture but accidentally omitted from its
generator. Parsed segment expressions may be cached internally during SDK
evaluation; their meaning, variable defaults and mutation operands must remain
unchanged.
