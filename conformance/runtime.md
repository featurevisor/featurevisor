# SDK runtime conformance

This document defines the portable runtime contract for Featurevisor SDK maintainers. It is independent of any one language's public syntax. The JavaScript SDK is the reference implementation, while the explicit fixture expectations are the executable authority.

This contract concerns generated datafiles and application SDKs. Native CLI test
runners have a separate [test execution protocol](test-execution.md).

## Contract files

An implementation must reject an unsupported contract version before executing
cases.

- `sdk-v3.json` retains its historical filename. Its top level `version`
  identifies the shared baseline contract, including later runtime additions.
- `sdk-v4-cases.json` supplements that baseline with compiled accumulation,
  mutation, path, error and variable prerequisite cases.
- `sdk-stateful.json` uses `kind: "featurevisor.sdk-stateful"` and
  `schemaVersion: 1` for ordered lifecycle and update cases.

The v4 CLI emits datafile `schemaVersion: "4"`. V4 SDKs also read v3 CLI
datafiles, including the historical schema 2 fixtures. Do not confuse a datafile
schema version with a fixture version or the test execution schema version.

## V4 datafile fields

Every selector uses `conditions`: segment membership, feature and global variable
root gates, force entries, traffic rules, feature variable overrides and global
variable override steps. Four leaf kinds share the same expression grammar:

| Leaf      | Shape                                                                  |
| --------- | ---------------------------------------------------------------------- |
| Attribute | `{ "attribute": "country", "operator": "equals", "value": "nl" }`      |
| Segment   | `"audience"`                                                           |
| Feature   | `{ "feature": "checkout", "enabled": true, "variation": "treatment" }` |
| Variable  | `{ "variable": "policy", "operator": "notNull" }`                      |

Bare strings always reference segments, never features. Feature `enabled`
defaults to true. Its optional variation compares the ordinary variation getter,
including features which declare only a disabledVariationValue.
A variable leaf may also specify `feature`, as below:

```json
{
  "feature": "optionalFeatureOwner",
  "variable": "literalVariableKey",
  "path": ["items", 0, "enabled"],
  "operator": "equals",
  "value": true
}
```

`feature` is absent for a global variable dependency. `variable` is always a
literal key. `path`, when present, is an already compiled array of string and
non negative integer components. SDKs never parse authored dotted or selector
notation.
Attribute and variable leaves share comparison operators. Optional regexFlags
belong only to matches and notMatches. Disallowed operators fail the comparison
at every reached leaf under the existing SDK operator policy.

Global variables may contain `overrideProgram`, an ordered array of steps:

```json
{
  "key": "regional",
  "keyPath": ["base", "regional"],
  "conditions": "*",
  "operations": [],
  "onMatch": 2,
  "onMiss": 3
}
```

`conditions` may be an expression, an implicit AND array, or the whole value
`"*"`. The wildcard is not valid inside arrays or groups. Expressions support
`and`, `or` and `not`; NOT negates the AND of its children. Empty arrays and
groups are invalid authoring and defensively false at runtime. Conditions may
be JSON stringified by the builder. Preserve authored order and short circuiting.
An explicit null root gate is not an omitted gate. It fails with
conditions_unmet, preserving null in evaluation.conditions. This defensive
behaviour also applies when reading schema 2 inputs.
Feature and variable leaves use ordinary dependency getters with per root call
memoization and `dependencyPurpose: "condition"`.

Feature evaluation order is sticky state, force, root gate, bucketing, rules,
then variable overrides. Force bypasses the gate. Global variables evaluate
sticky state, root gate, composition sources when present, then overrides.
Override children must also satisfy every ancestor.

At setDatafile and partial update boundaries, normalize legacy `segments`,
attribute `conditions` and `requiredFeatures` selectors into conditions once.
Convert legacy feature strings to `{ "feature": "key" }`. AND new and legacy
fields when both exist; never mutate caller data. Legacy `required` remains
unsupported. Unreleased `requiredVariables` is not read. V4 authoring and
generated output never use any of these legacy selectors.
Legacy empty segment arrays and empty segment AND groups normalize to `"*"`,
preserving v3 matching. Schema 2 segment conditions, force conditions and ordinary
override conditions also preserve their historical empty AND behaviour. New root
gates, traffic conditions and override programs keep empty expressions false,
including when they occur in a schema 2 datafile.

Referenced segments may themselves reference segments, features and variables.
Unknown segments do not match. An active segment cycle fails the complete
evaluation through the ordinary error path, even inside NOT. Retain the session
depth limit and dependency cycle protection for feature and variable leaves.
`keyPath` records authored nested provenance.
`onMatch` and `onMiss` are forward only absolute step indexes and may equal the
program length to terminate. A jump must be an integer greater than the current
step and no greater than the program length. `overrides` remains the legacy
first match representation for datafiles which do not use accumulation. An SDK
must not treat both as two programs to execute.

### Variable types

Variable `type` values are `boolean`, `string`, `integer`, `number`, `array`,
`object` and `json`. The v4 CLI emits `number` for numbers that may have a
fractional part. Datafiles built earlier, including every v3 datafile, say
`double` instead. Treat both spellings identically in both schema versions.
Typed getters such as getVariableDouble keep their names and return the same
values for either spelling. Never reject a datafile because of `double`.

## Composed variables

The JavaScript implementation supports composition. Native implementations must
add and verify this capability before consuming datafiles containing `compose`.
The separate `sdk-composition.json` capability fixture tests composition and
overrides. Passing only the historical baseline fixtures is not evidence of
composition support.

A composed variable has optional hash and deprecation metadata, and either a
nonempty `compose` list or a source variable key string. It has no defaultValue.
Optional root conditions run before any source is read. When unmet, return the
optional disabledValue, otherwise null. Validate disabledValue against the
source or inferred composition schema. An optional `overrideProgram` transforms
the evaluated source value after a matching gate.
Caller or module defaultVariableValue options do not replace that null result
from a missed composition gate. No composition source is read and no override
runs there. Modules can still explicitly transform the final evaluation result.
The list form has `type: "object"` and assembles a flat object.
Each entry has a literal output `key` and one reference:

| Reference                                                        | Getter result                    |
| ---------------------------------------------------------------- | -------------------------------- |
| `{ "key": "enabled", "feature": "checkout" }`                    | Feature enabled state            |
| `{ "key": "layout", "feature": "checkout", "variation": true }`  | Feature variation                |
| `{ "key": "label", "feature": "checkout", "variable": "label" }` | Feature variable                 |
| `{ "key": "policy", "variable": "deliveryPolicy" }`              | Variable without a feature owner |

The builder sorts entries by ordinal property order. Property names are literal,
including dots and slashes. Empty names and `__proto__`, `constructor` and `prototype`
are invalid. Authoring rejects them. JavaScript also fails the whole evaluation
for unsafe properties in externally supplied datafiles.

The string form, such as `compose: "deliveryPolicy"`, calls the ordinary variable
getter for that literal key. Dots and slashes are part of the key, not paths.
The builder emits the source's type, following chains of compositions. Return
its evaluated value directly, including false, zero, empty strings, arrays and
null. Do not wrap it in an object or flatten it. JSON sources are decoded by
their own getter exactly once, including when their decoded result is a string
such as `"null"` or `"123"`. Composed getters and variable condition comparisons must
not decode that result again.

Evaluate each source through the existing module pipeline with the composition's
effective context and sticky state. Do not pass the outer getter's explicit
default to a member. False flags and null values are successful member results,
not gates. JSON variable getters decode their value. Disabled feature fallbacks
and module supplied null variations behave exactly as ordinary getters do.
Whole variable sticky state bypasses assembly and overrides. Nested compositions are allowed
when acyclic. The map output is one fresh ordinary object, without flattening
or merging source objects. The string output retains ordinary getter ownership.
Its detailed reason is `variable_composed` unless an
override matches, in which case it is `variable_override_rule`.

Evaluate all members before running any composed override. The program follows
the same first match, nested child and continuation control flow as ordinary
variable programs. Its initial value is the assembled object or evaluated
string source, not a static
default. Match conditions through the normal runtime pipeline.
Record matched keys and paths with the existing override metadata. A nested
composition consumes the final overridden source value. Do not reevaluate
sources to explain or replay this input.

Composed overrides always run at runtime, regardless of `precomputeMutations`.
They use existing operation formats and forward jumps, not a second interpreter.
Use immutable path copying so a mutation does not change a borrowed source,
another property or alias sharing it, or a sticky source. Literal root replacement for the
map form also returns a fresh ordinary outer object. For the string form,
replacement has ordinary variable ownership and may be scalar, null or an array.
Descendants can remain borrowed, just
as unmodified source values do. The whole variable sticky and module return
ownership policies remain unchanged.

Authoring preserves the inferred property set and member types for map composition.
Whole map replacements must supply all declared properties without adding others.
String compositions infer the evaluated source schema and validate replacements
and mutation operations against it. JSON source shapes remain unknown rather
than being inferred from their current literal default. Getter members can be
null except feature flags. Decoded JSON members have no statically known shape.
Known mutation paths, required properties and operands are validated during
lint. Literal dotted properties still require whole replacements or a simpler
property name when mutation path notation would be ambiguous. Do not add runtime
schema checks or pretend that lint can prove every result of a dynamic source.

Members retain normal getter ownership. In JavaScript object and array results
are borrowed and must be treated as read only. Do not deep copy them simply to
memoize a composition. Prerequisite comparisons still store owned snapshots.
Memo entries distinguish the two purposes, dependency and requester identities,
context and state generations. They live only for the current public call and
are released on success or failure. Multiple properties or aliases may share source objects.

Internal module options include the immediate `dependencyOf` and a
`dependencyPurpose` of `composition` or `condition`. Direct application calls
have neither. Composition consumes values rather than gating eligibility, so
tracking modules must not automatically discard every internal evaluation.
Callbacks must remain stable for equivalent inputs within a call. Setter or
context changes can affect later members, so assembly is not a transactional
snapshot. Independent public calls from callbacks still start fresh sessions.

Cycles and dependency depth beyond 256 internal handoffs fail the complete
evaluation. No successful partial composition is published. Normal source
getter errors retain their false or null fallback. A later independent call
must not retain failed session state.
The bound counts active getter and segment frames, not attribute comparisons.
An optimized terminal attribute segment does not enter another frame. Include
both wildcard and attribute terminals in boundary tests rather than treating
every segment name as an additional recursive handoff.

A failed dependency session reports one `evaluation_error` diagnostic, from the
public call that started it. Nested getters propagate the failure without
reporting it again. Each independent public call reports its own failure.

Preserve the host application's runtime resource settings. In Python, the
interpreter recursion limit can stop very deep chains before the logical
256 handoff bound. Native threads can also be smaller than the bound needs,
such as 512 KB threads on Apple platforms and in mobile .NET. Detect stack
exhaustion before it happens and report it as an error evaluation, never a
process crash, an exception from a public getter, a partial composition or a
successful negated dependency. Do not raise the process wide recursion limit
from SDK code. Later independent evaluations must still work. Lint and build
reject static chains beyond the bound, so a chain of exactly 256 handoffs stays
valid. Lint also warns above 32 handoffs. Measured release builds evaluate
that depth on a 512 KB thread, Swift with the least margin at about 33. Swift
debug builds reach about 20, and smaller host stacks can fail sooner, so the
warning is advice rather than a guarantee.

Dependency closure, hashes and change notifications include every source and its
transitive dependencies. Root filtering cannot remove required sources. Feature
exposure and archiving remain authoritative, and building an incomplete selected
composition fails. Target filtering does not project individual feature fields
and is not a confidentiality boundary. Plain composition needs no mutation
precomputation. Composed overrides reuse the existing runtime mutation operations.

The JavaScript OpenFeature provider resolves compositions through its normal
variable key path and maps `variable_composed` to `TARGETING_MATCH`.
Matched composed overrides also map to `TARGETING_MATCH` using their existing
`variable_override_rule` reason.
Provider JSON normalization must not decode an already evaluated composition
again. A string alias can return a plain string such as `"null"` from a JSON
source. A null alias uses the provider's existing default value policy, just
like an ordinary null variable.

## Shared experiment allocation

Traffic percentages control enabled state. Variation assignments use the
ordinary traffic `allocation.range` values. Unknown feature metadata does not
alter either evaluation.

For mutually exclusive experiments, use one ordinary allocation feature with
variations for each experiment and, when needed, an explicit holdout variation.
Each dependent feature requires its corresponding allocation variation through
feature leaves in its root conditions. Hashing that shared feature gives one assignment
for the same context. Do not infer mutual exclusion from identical `bucketBy`
attributes on independently bucketed features. Sticky values, force rules and
application modules can override normal evaluation, so keep those consistent
with the intended allocation policy.

## Getter semantics

An SDK exposes ordinary getters and detailed evaluators for:

- feature enabled state;
- feature variation;
- variables owned by a feature;
- global variables.

Ordinary getters project the detailed result into a safe value. A missing or
failed flag returns false. A missing or failed variation or variable returns the
call's explicit default when supplied, otherwise null. False, zero, an empty
string, an empty array, an empty object and explicit null are values and must not
be replaced by truthiness based fallback logic.

Detailed evaluations preserve their reason, relevant entity metadata,
provenance and error. Global variable outcomes distinguish at least sticky,
missing, unmet root conditions, default,
matched override and error paths. Exact expected fields are fixture driven.
Extra diagnostic metadata may be present unless a native API promises an exact
shape. Portable field presence comparisons apply to `conditions` only,
including an expected explicit null. Other supplied fields compare their JSON
values and types, with integer and floating representations of the same number
equal. Typed nullable evaluation fields need not preserve the distinction
between omission and null.

Evaluation order is:

1. Merge instance and call context according to the SDK's public API.
2. Run module `beforeEvaluation` hooks in registration order.
3. Resolve sticky state for the requested entity.
4. Resolve the entity, force selection and root gate in the order above.
5. Evaluate the first match representation or compiled accumulation program.
6. Build one final detailed evaluation.
7. Run module `afterEvaluation` hooks in registration order.
8. Report the final diagnostic and return the ordinary or detailed result.

The `beforeEvaluation` and `afterEvaluation` phases each iterate the module
membership at the start of that phase, in registration order. Where an
evaluation uses bucketing, the `bucketKey` and `bucketValue` phases each use
their own starting membership. Adding or removing a module while a phase is
running does not change that phase's iteration. A newly
added module does not join the running phase, and a removed module remains in
that phase's starting membership. The next phase uses the membership installed
when it starts.

A module installed during a diagnostic or dependency read can receive the after
callback of an evaluation already in progress, even though it did not receive
that evaluation's before callback. A module removed before the after phase
receives no after callback. Do not retain an evaluation start snapshot for the
later phase. This membership rule does not change callback error handling or
instance closure semantics.

Intermediate accumulation matches are not published to callbacks. A late error
invalidates the whole evaluation and must not expose a partial value or partial
provenance.

Defaults supplied to one getter are local to that outer request. A prerequisite
evaluation uses ordinary getter semantics with shared context,
modules, diagnostics and relevant sticky state, but without the parent's
feature key, variable key, default variation or default variable value. This
prevents a caller default from satisfying a missing prerequisite.

## Request scoped prerequisite evaluation

Every public evaluation begins a fresh session, including an independent public
getter called from a module callback. Only internal prerequisite calls inherit
the active session. Never keep its active stack or value memo on the instance.
Concurrent requests and parent or child instance calls must not share them.

Memoize completed prerequisite results for equivalent inputs within that session.
The identity includes evaluation kind, feature and variable keys, effective
context, sticky feature and variable state, and relevant instance state changes.
When callbacks can observe `dependencyOf`, its immediate requester identity is
also an input. Do not include the entire ancestry: shared dependency graphs must
not expand into exponentially repeated evaluations.

Module options for internal prerequisites contain `dependencyOf`, with `type`
and the applicable `featureKey` and `variableKey` of the immediate requester.
It is absent on independent application calls. Use idiomatic field naming in
native SDKs. Track both original and callback transformed identities for cycle
detection. A module changing an identity must not hide a cycle.

Fingerprint supported context values by content, not mutable object identity.
Distinguish absent, null, boolean, numeric, string, array and object values.
Object key order is immaterial. Unsupported host values may bypass memoization;
they must not collide through string conversion. State changes during callbacks,
including datafile, context, sticky and module changes, must invalidate affected
memo entries before another dependency read. Module transformed context and
sticky values remain part of the effective input.

Sticky maps and their nested values are read only once supplied to the SDK.
Use sticky setters for changes. Implementations may compare their references
and owner generations instead of traversing every entry per prerequisite.
Module replacements of a sticky map must also be distinguished. Do not copy
unrelated sticky entries on the evaluation hot path.

Regression tests should guard this complexity property independently of machine
speed. Instrument traversal or ownership boundaries to prove that increasing
unrelated sticky entries does not increase prerequisite snapshot work. Cover
primary instances and children, feature and global variable sticky maps, and
state changes between repeated reads. Keep wall clock benchmarks separate from
deterministic correctness tests.

Store only the result needed by the getter, not whole datafiles or feature
definitions. Do not expose cached mutable values to callbacks or callers.
An owned result snapshot can be shared between private, read only prerequisite
comparisons without being copied on each cache hit.
Cache hits do not repeat evaluation hooks. Hooks should not depend on invocation
counts; tracking hooks should skip `dependencyPurpose: "condition"` calls when
measuring direct application exposures. Composition dependencies remain distinct.
Evaluate every condition expression in authored order without reordering leaves
at build time. Put cheap attribute leaves first when appropriate. Short
circuiting must skip all later dependency callbacks when the outcome is known.

Modules must produce stable results for equivalent inputs during one public
evaluation. Object identity and mutable external state are not memo inputs.
If a module reads changing application state, pass the relevant value through
context instead. SDK setters invalidate affected reads, but the SDK cannot
observe arbitrary changes to state captured by a callback.

Release session state on successful and exceptional exits. Retaining public
module options must not retain private request memos, active frames or callbacks
that keep the instance alive. In concurrent runtimes, release instance locks
before invoking application callbacks.

## Conditions and errors

SDKs consume datafiles generated by the Featurevisor CLI. Full structural
validation belongs to CLI linting rather than every runtime evaluator.
Handwritten datafiles with unknown selector shapes, duplicate JSON keys or
unknown composition entry kinds are outside this contract. Do not use their
platform specific outcomes as portable behaviour. This does not weaken the
selector parse failure and dependency error guarantees below.

Normalize schema version "2" datafiles eagerly on loading and store their
selectors in the unified shape. Schema version "4" entities are normalized
on first read and cached. Partial updates invalidate only incoming entities.
Retained definitions keep their semantics across mixed version updates without
retaining per entity version metadata. Never mutate caller supplied definitions.
Segment change detection compares stored JSON. Switching between parsed and
stringified input may announce an additional change even if results are equal.

Malformed stringified selector JSON fails the whole selector, not the datafile.
Represent the parse failure explicitly so negation cannot turn it into a match,
including through segment references. Other selectors and entities keep working.
Report `conditions_parse_error` at error level once per selector per entity
load: during setDatafile for schema "2", and on first read for schema "4".
Details contain only conditions with the original string, entityType and
entityKey. Do not include location paths. Store accepted legacy definitions
before reporting their diagnostics. Cache normalized v4 entities before
reporting so callbacks can safely read them again. Dependency indexing reads
only conditions, parsing stringified v4 selectors without warming these caches
or emitting parse diagnostics. V3 selectors are already converted before indexing.

Feature flags and global variables report `conditions_unmet` when their root
gate fails. `evaluation.conditions` records the normalized root expression,
including object feature leaves for legacy feature strings. The old reasons
and evaluation fields are not aliases. Variation and feature variable
evaluations retain their existing disabled result reasons. Ordinary global
variables retain disabledValue and useDefaultWhenDisabled behaviour.

Feature leaves evaluate enabled state and, when present, variation.
Variable leaves call the ordinary feature variable or global variable
getter, then apply their compiled path and condition operator.

Track active prerequisite identities for the complete evaluation chain. A cycle
is an evaluation error, not a null value and not an unmet prerequisite which a
NOT group may invert. Errors while traversing a compiled prerequisite path or
performing its comparison also propagate to the requested evaluation's error
result and diagnostic path.

Keep that distinction separate from an ordinary getter result. When an upstream
getter handles an evaluation or module failure and normally returns null or
false, prerequisites compare that ordinary result, as the portable fixtures
require. Do not add datafile membership checks or reinterpret a completed null
result as an exception. CLI test checks have their own stricter reached error
policy, documented in the test execution protocol.

Use the portable condition grammar from `sdk-v3.json`. Do not substitute a host
language parser with a broader date, semantic version or regular expression
grammar. JSON numbers compare numerically, but booleans do not equal numbers.

### Version comparisons

All six `semver` operators share one comparison. Match the entire input, using
ASCII digits and letters only. Whitespace, trailing newlines, embedded lines
and Unicode digits are invalid. Keep the existing permissive version grammar:
optional `v`, `^`, `~`, `<`, `>` and `=` prefixes, one to four numeric core
components, `x`, `X` or `*` in components after the first, and prerelease and
build suffixes after the third or fourth component. Prefixes do not express
ranges. Build metadata does not affect ordering.

Compare all four core components, with missing components equal to zero.
A wildcard matches the corresponding core component only. Numeric components
compare as decimal integers of arbitrary length, ignoring leading zeroes.
Do not convert them to floating point or a fixed width integer.

A prerelease sorts before the corresponding release, including prerelease `0`.
Compare dot separated prerelease identifiers in order. An identifier is numeric
only if every character is an ASCII digit. Numeric identifiers compare by their
decimal values and sort before nonnumeric identifiers. Other identifiers compare
case sensitively by ASCII order. When all shared identifiers match, the shorter
prerelease sorts first. Wildcards have no special meaning inside a prerelease.
For example, `1.0.0-1a` sorts before `1.0.0-1b`, and `1.0.0-alpha` sorts before
`1.0.0-alpha.0`.

Invalid operands do not match ordinary conditions, including `semverNotEquals`.
In variable condition leaves they propagate as evaluation errors. CLI
checks report a structured comparison error. Negation must not turn a condition
or check error into a successful result.

Date strings use `YYYY-MM-DDTHH:mm:ss`, optionally followed by one to nine
fractional digits, and an explicit `Z` or `+HH:mm` or `-HH:mm` timezone. Calendar
dates must exist, hours stop at 23 and seconds at 59. Offset magnitude cannot
exceed 14 hours. Both the written year and the resulting UTC instant must be
within years 0001 to 9999. Comparisons truncate fractional seconds to the first
three digits, without rounding, for millisecond precision. Invalid
operands make both `before` and `after` false; they must not roll into another
month. CLI validation uses the same format for authored operands and test checks.

Native date values are accepted only when they represent an instant, with a time
and an offset or UTC. They use the same calendar range and millisecond precision
as strings, including fractions before the Unix epoch. Where a native type
retains a local year or explicit offset, the written year must also be within
0001 to 9999 and the offset magnitude must not exceed 14 hours. Native offset
precision is retained when converting to UTC, before truncating milliseconds.
Date only or timezone
free values are not timestamps. Plain Ruby `Date`, Python `date` and naive
`datetime`, Java `LocalDate` and `LocalDateTime`, .NET `DateOnly` and unspecified
`DateTime`, and Elixir `Date` and `NaiveDateTime` do not match date comparisons.

| SDK        | Accepted native values, besides portable strings               |
| ---------- | -------------------------------------------------------------- |
| JavaScript | `Date`                                                         |
| Go         | `time.Time`                                                    |
| Swift      | None                                                           |
| Java       | `Instant`, `java.util.Date`, `OffsetDateTime`, `ZonedDateTime` |
| Ruby       | `Time`, `DateTime`                                             |
| Python     | `datetime` with a usable timezone offset                       |
| PHP        | `DateTimeInterface`                                            |
| Rust       | `AttributeValue::Date`                                         |
| Elixir     | `DateTime`                                                     |
| Dart       | `DateTime`                                                     |
| .NET       | `DateTimeOffset`, `DateTime` with `Kind` `Utc` or `Local`      |

Go's zero `time.Time` is the valid instant at the start of year 0001, not a
missing date. Omit the context entry or use a nil pointer for an unknown date.

Authoring lint restricts date only attribute schemas to `before`, `after`,
`exists`, `notExists`, `isNull` and `notNull`. It validates date enum and const
literals as timestamps. Variable schemas may constrain strings with
`format: date-time`; this remains an authoring constraint, not a datafile field.
Unannotated string variables may still use date comparisons. Context schema
mismatches are nonblocking warnings in lint and CLI evaluation, not new SDK
validation or test runner errors. Datafile builds do not run these lint checks.

For case sensitive matching, portable regex classes `\d` and `\w` mean `[0-9]`
and `[A-Za-z0-9_]`, respectively. `\D` and `\W` are their complements, including inside character
classes. Escaped backslashes remain literal. Native engines must not broaden
these classes to Unicode digits or letters. This does not make arbitrary native
regex syntax portable. Unicode case folding and character counting, word
boundaries, whitespace and line anchors still depend on the engine beyond the tested subset; use explicit
classes and shared tests when those distinctions affect targeting. Do not enable
a global ASCII mode to fix digits if it changes unrelated whitespace matching.

## Null, missing and paths

Explicit null and a missing path are distinct internal states.

- `isNull` matches explicit null and the ordinary null result of a missing
  variable getter as required by fixture cases.
- `notNull` matches a present, nonnull value, including false, zero and empty
  strings, arrays and objects. It does not match a missing path.
- `exists` is path presence and therefore distinguishes an own null property
  from an absent property.
- Selectors match only an own property. A missing property never matches a
  selector value of null.

After compiled path traversal, an absent component is the internal missing value:
`exists`, `isNull` and `notNull` are false, while `notExists` is true. This is
different from an absent variable key, whose ordinary getter returns null before
the variable condition operator is applied.

Logical NOT around `isNull` is not equivalent to `notNull`: negation can match a
missing path, whereas `notNull` requires presence. Ordinary null returned by a
variable getter remains null; do not add a separate membership check.

String path components address own object properties. Integer components address
array indexes only. Reject negative, fractional or otherwise invalid indexes.
Reject `__proto__`, `prototype` and `constructor` at every object path or
selector property boundary. Missing intermediate components cause the operation
or lookup to miss according to its contract; they must not create an object tree.

For variable condition reads, a canonical decimal string such as `"0"` can also
address an array element, and `"length"` reads its length. Mutation paths keep
their stricter typed distinction between object keys and numeric array indexes.
JSON numeric indexes such as `1` and `1.0` have the same integral value. Native
decoders must not reject the latter solely because it was parsed as a floating
point number. Authoring rejects indexes outside the safe integer range.

Languages which do not naturally distinguish JSON objects from maps or arrays
must preserve enough internal representation to implement these rules. Public
getters may project into idiomatic values only after evaluation is complete.

## Array list membership

`includesAny` and `notIncludesAny` compare an actual array with a candidate array
of strings, numbers, booleans or null. Primitive equality is strict and case
sensitive. JSON numbers compare numerically, but booleans are not numbers.
Structured elements in the actual array do not match primitive candidates.

`includesAny` is true when any candidate occurs in the actual array.
`notIncludesAny` is true when none occurs. Duplicates and ordering do not change
the result. An empty actual or candidate array gives false for `includesAny` and
true for `notIncludesAny`, provided both operands are valid arrays.

Both operators return false for a missing, null or nonarray actual value, a
nonarray candidate value, or a candidate array containing any structured value.
Validate the complete candidate list before returning, even if a match has
already been found, so a malformed entry after a matching primitive does not
become a successful result. Ordinary variable
getter null results are compared as null, without extra entity existence checks.

The same semantics apply to attribute and evaluated variable condition leaves.
CLI checks retain their stricter reached comparison error policy
for incompatible operands, support literal and resolved candidate arrays, and
do not invert comparison errors through logical NOT. Missing check paths retain
their existing false predicate behaviour. Older SDKs do not understand these
operators. Upgrade SDKs before adopting new CLI syntax and keep using
`disallowOperators` until every consumer supports the new operators. Unknown
operators or leaf kinds have no uniform compatibility behaviour: most SDKs
return false, which logical NOT can turn into a match; Java errors on unknown
variable operators; Swift rejects a datafile containing unknown object form
leaves and fails the selector when it is stringified. This is rollout guidance,
not a portable runtime validation policy for unknown syntax.

## Emptiness operators

`empty` and `notEmpty` are unary operators for strings, arrays and JSON objects.
They take no comparison value or regular expression flags. Strings count
characters, arrays count elements, and objects count their own enumerable string
properties. Only zero versus nonzero size matters, not a particular character
encoding or count of Unicode code points.

The test is shallow. Whitespace is content. `[null]`, `[[]]` and `{ "x": null }`
are nonempty. Inherited, nonenumerable and symbol properties do not count as JSON
object content. Native date, set and other unrelated host types are not JSON
objects for this purpose.

Both operators return false for null and missing values. Runtime comparisons
also return false for incompatible scalar types such as booleans and numbers.
Linting rejects a known incompatible type, while CLI checks report an
incompatible reached value as a test error. Null and missing remain ordinary
false predicates in CLI checks. Consequently `notEmpty` differs from a logical
NOT around `empty` for null or missing values.

These rules apply to attribute and evaluated variable leaves. Keep the
existing null and presence operators unchanged. Do not implement emptiness using
host language truthiness.

## Accumulation program

The same program format also represents ordinary first match overrides when a
project sets `precomputeMutations: false`. The setting defaults to `true` and
belongs only to project configuration. With `false`, a selected global variable
override tree containing mutations uses this program even without continuation.
Any tree containing `continue: true` uses it regardless of the setting. Literal
only trees without continuation stay as complete values. Feature variable
mutations are unaffected. No SDK option or additional operation is required.

Start with the global variable's `defaultValue`. At each program step:

1. Evaluate the step's conditions in authored order with ordinary short circuiting.
2. If the complete expression matches, apply all operations in order.
3. Record the step's `keyPath`, or `[key]` when no path is present.
4. Jump to `onMatch`; otherwise jump to `onMiss`.

The program is forward only and terminates at its length. Nested authored
overrides are therefore compiled control flow, not a runtime tree. The SDK must
not infer nesting or `continue` from keys. A match may continue to a sibling or
skip descendants solely through the two jump fields.

The final matched step supplies `variableOverrideIndex`, `variableOverrideKey`
and `variableOverridePath`. Program evaluations also expose the ordered
collection of applied paths where the language's detailed evaluation API carries
that field. If no step matches, return the untouched default with the default
reason.

## Mutation operations

Every operation has a compiled `path`. Supported operations are:

| Operation      | Value                                  | Behaviour                                                                                    |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `set`          | any variable value                     | Replace the root or addressed value. An array index equal to its length appends.             |
| `append`       | any variable value                     | Append to the addressed array, creating a missing or null final object property as an array. |
| `prepend`      | any variable value                     | Prepend to the addressed array, with the same final property rule as append.                 |
| `appendUnique` | string, finite number, boolean or null | Append only when strict primitive equality finds no existing item.                           |
| `removeValue`  | string, finite number, boolean or null | Remove every strictly equal item from the addressed array.                                   |
| `before`       | any variable value                     | Insert before an existing addressed array element.                                           |
| `after`        | any variable value                     | Insert after an existing addressed array element.                                            |
| `remove`       | none                                   | Remove an existing property or array element. Root removal is invalid.                       |

Path components are strings, non negative integers, or selectors of this form:

```json
{
  "select": {
    "property": "id",
    "values": ["primary", 1, true, null]
  }
}
```

A selector addresses the first array item whose own named property strictly
equals one of the primitive values. String `"1"`, number `1`, true, false, null
and zero are distinct where JSON permits them. Numbers `1` and `1.0` are equal.

Validate every operation, operand, path component and unsafe key before relying
on whether its path happens to match. A missing selector or intermediate path is
a no op. A null intermediate is a no op. Applying an array operation to an
existing non array value is an error. `before` and `after` require an array
element path. The fixture specifies the remaining edge cases.

## Datafile update acceptance

`setDatafile` and its language equivalents return a boolean acceptance result.
An accepted merge or replacement returns true, including an unchanged datafile.
Invalid input and calls on a closed instance return false. Rejection preserves
the last valid datafile and emits no datafile set event. Validation failures
retain the existing diagnostic. Isolated application callback failures do not
change acceptance of an already stored update. The return value does not indicate
whether evaluations changed. Merge remains the default.

## Immutable defaults and operands

Datafile values are immutable inputs. Never mutate a variable `defaultValue`, an
operation operand, sticky value, module supplied value or caller owned object.
Use copy on write along the changed path. An evaluation which performs no change
may reuse internal references. JavaScript deliberately shares object and array
values rather than cloning every getter result: consumers must treat supplied
datafiles and returned values as read only, copying a value before modifying it.
Native SDKs may provide stronger isolation where that is idiomatic. The portable
guarantee is that evaluation and mutations performed by the SDK do not modify
their inputs, not that every language returns a detached object graph.

Run every v4 case twice through both the ordinary getter and detailed evaluator.
The second result must equal the first and the original fixture datafile must be
unchanged. Apply the same ownership test after partial datafile updates and in
child instances.

## Dependency graphs and hashes

Dependency discovery includes every edge in:

- every root, rule, force and override condition expression;
- segments and every segment, feature or variable referenced by their conditions;
- feature variable override selectors;
- global variable `overrides` and `overrideProgram` steps;
- nested group leaves and every feature or global variable referenced by them.

Builder hashes for a feature or global variable must change when the effective
content or hash of any transitive dependency changes. Filtered and Target builds
must include the complete dependency closure. Cycle validation uses the mixed
segment, feature and global variable graph, not separate graphs which can miss
a cross type cycle.

Hash computation may memoize acyclic dependency results only inside one
synchronous `refreshDatafileHashes` pass over one completed graph. The memo is
created for that refresh and discarded when it returns. Standalone feature or
variable hash calls each create a fresh memo. Never attach the memo to a registry,
datafile or other object whose lifetime can outlive the call, because callers may
mutate the graph between calls. Regression tests must mutate a dependency through
the caller held graph and prove that both a fresh standalone hash call and a new
full refresh observe the change.

For `setDatafile`, compute affected entities from both the previous and next
dependency graphs. This catches added and removed edges. A partial merge updates
only supplied definitions while retaining others. A replacement removes absent
definitions. In both modes, change events include directly changed entities and
their transitive dependants. Perform parsing and validation before swapping the
live snapshot. Rejected input leaves the previous datafile, hashes and event
state intact.

`sdk-stateful.json` is the executable authority for update ordering, event
details and old versus new graph behaviour.

## Modules, lifecycle and concurrency

Modules are registered in stable order. Setup occurs once per owning root
instance. Evaluation hooks and diagnostic adapters must not corrupt the pipeline
when one callback fails. Close is idempotent, invokes module cleanup once,
detaches subscriptions and prevents child bookkeeping leaks.

User callbacks must run without internal state locks held. Take an immutable
snapshot of context, sticky state, datafile evaluation structures and module
registrations, then evaluate outside the mutation lock. Publish a new complete
snapshot atomically for `setDatafile`, context changes and sticky changes. Do not
expose half updated graphs or values to concurrent readers.

These snapshots do not pin a whole public evaluation to its starting datafile.
A definition already selected can finish on that definition, but later feature,
variable and segment dependency reads use the latest accepted datafile, including
updates made by callbacks. Inherited sticky state refreshes after setters without
overwriting a module's explicit sticky replacement. Preserve the effective
context passed through the evaluation. Native concurrency tests must verify safe
complete snapshots without promising that all reads use one datafile generation.

Child instances share the parent's current datafile and module pipeline. They own
their merged context, sticky feature map, sticky variable map and subscriptions.
Root sticky updates do not overwrite child sticky maps, and child updates do not
mutate root state. Closing a child does not close the parent. Closing the parent
must leave no live child subscription which can retain it accidentally.

Use the idiomatic ownership primitive of the language: immutable snapshots and
locks, actors, processes plus ETS, atomic references, or another mechanism with
the same observable guarantees. Conformance specifies behaviour, not one memory
model.

## SDK implementation sequence

Migrate in this order so each stage has a testable boundary:

1. Preserve all baseline `sdk-v3.json` behaviour and diagnostics.
2. Add unified conditions, legacy input normalization, compiled variable paths,
   `overrideProgram`, operations and jump fields.
3. Implement shared logical group matching and mixed cycle detection.
4. Implement required variable getters without leaking outer defaults.
5. Implement immutable typed path traversal and all mutation operations.
6. Execute forward only accumulation and publish only the final result.
7. Extend dependency collection, hashes, filtered builds and datafile update
   invalidation to mixed feature and variable edges.
8. Align sticky ownership, children, modules, diagnostics and close behaviour.
9. Run stateless fixtures twice and then the ordered stateful fixture.
10. Add native ownership, concurrency, packaging and provider tests which JSON
    cannot represent.

Do not restore removed aliases merely to make an old private checkpoint pass.
This implementation sequence is not the application deployment order. Consumers
first prepare their authoring with the latest compatible v3 CLI, including the
Group conversion and datafile replacement prerequisites above, then deploy
compatible v4 SDKs while still consuming the prepared v3 datafiles. Only then
upgrade the project CLI and publish schema 4 datafiles. V3 SDKs accept their
version string but do not match their conditions rules. Upgrade every consumer,
including cached and bundled datafiles, first. Once schema 4 is published,
rolling back to v3 SDKs is not supported.

## Fixture implementation contract

For each `sdk-v4-cases.json` case:

1. Create a fresh instance from the complete case datafile and options.
2. Evaluate global variable `subject` with the case context through the ordinary
   getter and detailed evaluator.
3. Repeat both evaluations on the same instance.
4. Compare every supplied `expected` field without requiring unspecified fields
   to be absent.
5. Verify the datafile, defaults and operands were not modified.
6. Close the instance and verify language specific cleanup.

Malformed cases require failure. A decoder rejection is acceptable in a
strongly typed SDK when documented, but silent fallback, a successful partial
value or skipping an enum impossible case is not acceptable.

For `sdk-stateful.json`, create the named root once per case, apply operations in
order and compare events and getter results after each operation. A `spawn`
operation creates a named child for subsequent operations. Reject an unknown
action, target, kind or schema version before mutating state.

Passing JSON fixtures does not replace native tests for module callback order,
concurrent readers and writers, child cleanup, diagnostic isolation, package
contents, provider ownership or platform compatibility.
