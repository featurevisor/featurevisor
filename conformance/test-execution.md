# Test execution protocol

This is the portable input contract between the Featurevisor Node.js CLI and
native CLI test runners. It is independent of application SDK APIs, datafile
schema versions and test report versions.

Request it with:

```sh
npx featurevisor list --tests --execution-protocol
```

The option implies JSON output, matrix expansion and execution metadata. Existing
selection options, including set and exact case selection, still apply. Ordinary
`list --tests --json` and authored `list --scenarios --json` retain their existing
array output. They are not substitutes for this protocol.

## CLI option spelling

Native runners accept kebab case aliases for their existing camelCase options,
including `--key-pattern`, `--assertion-pattern`, `--entity-type`,
`--only-failures`, `--show-datafile` and `--populate-uuid` where supported by the
command. `--root-directory-path` and `--rootDirectoryPath` select the project,
alongside the native `--project-directory-path` and `--projectDirectoryPath`.
Keep existing invocations valid. Repeatable `--target` selections must retain
their order and support both `--target=value` and `--target value`.

Definition parsing, linting, test expansion and datafile building remain the
responsibility of the installed Node.js CLI. Native commands evaluate those
datafiles with their own SDK. Do not duplicate the authoring linter in each
language.

## Envelope version 1

```json
{
  "kind": "featurevisor.test-execution",
  "schemaVersion": 1,
  "tests": []
}
```

Runners must check the exact kind, a supported numeric version and an array of
test objects before building datafiles or invoking evaluators. Missing fields,
an unversioned array, an incorrect kind and unsupported versions are errors.
Do not silently fall back to another representation. Extra envelope metadata
may be ignored. Empty tests is valid and means no selected tests.

## Normalized tests

Each test has exactly one owner: `feature`, `segment`, `variable`, or the internal
`scenario` identity. All public spec keys are derived from their relative storage
keys with only a terminal `.spec` suffix removed. A scenario identity is never
derived from an authored name or a required directory. The explicit source path
retains the actual filename. Colliding identities, such as `checkout.yml` and
`checkout.spec.yml`, are rejected within and across the entity and scenario
collections rather than silently merged. Scenarios author root
checks but normalize into an `assertions` array, just like other tests.

`--keyPattern` matches this owner identity, not the test file's storage `key`.
For example, `^checkout$` selects specs owned by the `checkout` feature even
when their files are nested under `tests/features/`. Scenario patterns match
the derived scenario identity. Native runners must not discard a selected spec
by applying the same pattern again to its storage key.

`_test` contains source, set and entityType. Expanded assertions carry `_case`
with an opaque rerun id, authored assertion index, optional matrix index and
matrix values. Preserve ids exactly; do not interpret them as regular expressions.
The TypeScript definitions in `packages/types/src/test.d.ts` describe these fields.

Machine reports retain structured argument arrays and zero based paths. Human
output uses one based case, child and check positions and labels the shell for
which a rerun command is quoted. A POSIX command must not be presented as a
command for Windows cmd.exe. Human summaries separate entity assertions from
scenario cases, with one combined total. Coverage describes observed selections,
not exhaustive branch coverage.

Output reports may additionally include `provenance` with version `1`, algorithm
`sha256` and a `sets` array containing `{ set, fingerprint }` entries. A flat
project uses `set: null`. This optional metadata is independent of this execution
protocol. The JavaScript runner hashes its effective authored inputs,
configuration and allocation state using the same read snapshot as execution.
Only JSON output requests calculate this metadata; ordinary terminal runs do not.
If preparation fails, the runner warns on stderr and omits that Set's fingerprint.
Execution still fails when its own required inputs cannot be read. Timing includes
preparation. Inflated runs omit their provenance. Catalog displays current results only when
that fingerprint matches its exported inputs; absent or unsupported provenance
is unverified historical evidence. A fingerprint is not a signature or proof of
complete coverage. Native runners can continue emitting report version 1 without
this metadata and must not invent equivalent fingerprints from case results.

Datafile caches must distinguish every environment and Target pair, including
base datafiles without a Target. Use tuple keys or an unambiguous encoding such
as `[environment, target]`, with null for absent values. Delimiter concatenation
is unsafe: `prod` with Target `web` otherwise aliases environment
`prod-target-web`. This is internal runner storage, not a change to public case
identities. Explicit Set selections must fail when the project does not enable
Sets; do not silently discard `--set` before delegated Node calls.

`_segments` contains the referenced segment definitions from the active project
or set, including a segment spec's owner and its transitive segment references.
The execution protocol compiles their conditions, including variable path arrays,
without changing their authored order or metadata. Ordinary listings keep their
authored representation. Native runners must not parse authored variable paths.
Use the selected datafile's compiled segments when present, preserving Target
context specialization. Restore missing segments from `_segments` with the
effective assertion context. This applies to segment specs and segment checks.
Authors must not supply internal fields themselves.

Segment conditions may reference other segments, feature flags, variations and
global or feature variables. Include the transitive authored segment closure in
`_segments`. Evaluate these definitions through the SDK with the enclosing
assertion's datafile, environment, fixed bucket `at` and sticky feature and
variable maps. Do not use an attribute only helper for dependent segments.
Segment specs accept optional environment, at, stickyFeatures and stickyVariables
fields. An environment is required when the project configures environments and
the segment depends, directly or transitively, on a feature or variable.
Attribute only segment specs can still omit it.

Every spec kind names sticky values `stickyFeatures` and `stickyVariables`.
Feature assertions used `sticky` before v4. Node rejects that field before the
envelope is produced, so runners read only the current names. Each child owns its
sticky values and never inherits the parent assertion's. Child `description`
fields are documentation and are removed from the envelope.

New authoring uses conditions exclusively. Expected evaluations use
`conditions_unmet` and `conditions`, including normalized object feature leaves
when reading legacy inputs. Test checks retain their own grammar: bare strings
inside definition conditions are segment references, not feature shorthand.

## Resolution and validation

Before any getter in an expanded assertion runs, validate the complete root and
child check trees, including branches which evaluation might skip. Validate
feature and variable membership against that assertion's selected datafile and
segment membership against `_segments`. Check comparison operands too. Sticky
values do not make absent definitions present. Reference validation must not
evaluate conditions or call an SDK getter.

This membership requirement applies to references inside checks, not the owning
entity of a feature or variable assertion. An assertion may deliberately test an
owner excluded from its Target, expecting a disabled feature or a missing
variable result. Its root and child checks still undergo strict preflight before
the owner getter runs.

After preflight, preserve authored ordering and ordinary short circuiting.
An array implies AND; NOT negates the implicit AND of its children. A reached
evaluation or comparison error is a test failure, not a false value which NOT
can invert. Missing nested paths remain distinct from explicit null. The shared
`test-checks.json` fixture specifies operators, portable regex and date handling.

The assertion Target selects the datafile for every feature and variable getter,
including children and comparison operands. A missing Target datafile is an error;
never fall back to an unfiltered datafile. Children merge context and use isolated
sticky state. Segment checks can restore omitted segment definitions from the
execution protocol. When a selected Target includes the segment, its specialized
conditions remain authoritative. Feature and variable dependencies still have to
exist in that selected datafile.

The unary `empty` and `notEmpty` operators accept strings, arrays and JSON
objects, and inspect their shallow content size. Neither accepts `value`,
`compareTo` or `regexFlags`, including on a skipped branch. Null and missing
values return false for both operators. A reached incompatible value, such as a
number or boolean, is an error which logical NOT must not invert. Whitespace and
collections containing null still have content. Runtime semantics are detailed
in [the SDK contract](runtime.md#emptiness-operators).

`includesAny` and `notIncludesAny` require an actual array and a candidate array
of JSON primitives. Candidates can be supplied by `value` or resolved from
`compareTo`. Empty valid arrays give false and true respectively. A reached
nonarray actual value, including null, or any malformed candidate produces a
comparison error. Logical NOT must not invert that error. Missing paths retain
their existing false predicate result. See
[array list membership](runtime.md#array-list-membership) for strict equality
and the separate runtime fallback behaviour.

## Evolution and verification

Increment this version when normalized execution semantics require new runner
behaviour. Update every native consumer and shared runner conformance together.
Do not use the output report version to infer input compatibility.

The local `make test-runner-conformance` command exercises actual CLI delegation,
`example-1`, `example-test-environments` and `example-composition`, case identities,
reports and evaluation outcomes. Dedicated projects verify dependent segments
with and without environments, Target specialization, compiled variable paths,
sticky state and child checks. Native unit tests must also
reject malformed or future envelopes before datafile building or evaluation.
SDK consumers do not need Node.js; this dependency belongs to CLI tooling only.

The envelope remains version 1 for this migration. Native runners must support
unified conditions and dependent segment evaluation to consume schema 4 datafiles
and the migrated Example 1. The current fixtures in this directory are the
native acceptance contract. The frozen `native-baseline` directory is historical
generator input, not a substitute for current capability and runner tests.
