# Frozen native fixture baseline

Captured on 15 October 2026 from monorepo commit
`81cd75ff0aa89fe7abf94884e55c0359dff24270` (`81cd75ff`). The seven JSON files
are immutable, byte for byte copies of the canonical fixtures at that commit.
Preserve their formatting and numeric spellings as well as their values.

These snapshots are not a new canonical contract. Current JavaScript fixtures
remain in the parent conformance directory. During the unified conditions
migration, the native copy guard compares native SDK and provider copies with
this frozen baseline rather than the evolving JavaScript contract. Equality
checks do not execute native tests or establish support for new conditions.
The historical fixture generator also reads selected snapshots as migration
inputs so it can preserve existing legacy datafile cases exactly.

Do not regenerate these JSON files, migrate their selectors or replace them
with current JavaScript output. Native SDKs, native OpenFeature providers and
native test runners must implement unified conditions, legacy datafile reading
and the outstanding composition capability before publication is approved.
The migrated examples can fail on unported native runners; do not weaken their
assertions to conceal that release gate.

## Retirement

After the native ports and fixture copies have been reviewed and approved:

1. Update every native fixture adapter for the current canonical contract,
   including the conditions and composition capability fixtures.
2. Copy the approved canonical fixtures into the native SDK and provider
   locations and run their actual tests and runner conformance checks.
3. Change the copy guard back to the current canonical directory and verify all
   required copies, including embedded provider fixtures.
4. Make historical fixture generation independent of this directory, retaining
   its legacy input corpus in an explicitly named generator input location.
5. Remove these snapshots and this README only after the guard, generator and
   documentation no longer depend on them.

Changing the source of the copy guard or deleting these snapshots is part of
that approved native migration, not this JavaScript implementation pass.
