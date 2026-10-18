# example-composition

Composed variables assemble flags, variations, feature variables and other
variables into one evaluated object. This project demonstrates all four forms,
nested compositions, sticky values and ordinary test assertions. The
regionalScreen variable then applies nested and continuing overrides to its
assembled object. A full replacement demonstrates nullable members while
preserving every output property. Tests also confirm the source policy stays
unchanged.

Run lint, build and test through the package scripts. The web Target selects
only screen and still includes its sources regardless of their root tags or
exclusion filters. Feature exposure restrictions remain authoritative.

The regional Target selects regionalScreen and includes both composition
sources and override prerequisites. Composed overrides always compile to runtime
programs, even when precomputeMutations is true. They cannot be calculated from
a static default. Example 1 now uses unified conditions. Native runners need
their conditions ports before evaluating either example.

The guarded Target selects guardedScreen. Its nullablePolicy source has feature
conditions and no disabled fallback. A notNull condition selects the
override only when that source has a value. Tests cover the available, disabled
and sticky source cases without changing the source policy itself.

Lint intentionally warns about regionalScreen overriding a variable from the
delivery feature, which declares variations. Composition evaluates its sources
before applying overrides, so changing the displayed value cannot change an
experiment assignment or exposure already recorded by a module. Keep experiment
audience changes on the source feature when assignment must match display.

String compositions reuse another variable's evaluated value without an outer
object. policyAlias reads policy, then applies its own regional and nested
overrides. policyChain reads that final result. rawAlias returns decoded JSON.
The aliases Target includes their sources even though it excludes them from
root selection. Tests cover source isolation, sticky values and null results.

gatedPolicy and gatedPolicyWithoutFallback demonstrate root conditions on
compositions. The gate runs before sources. An unmet gate returns disabledValue
when supplied, otherwise null. Compositions have no defaultValue.
