.PHONY: install build test test-cli-integration test-catalog-browser test-runner-conformance test-mutation-conformance check-conformance-fixtures test-global-variables-performance test-datafile-build-performance benchmark-sdk-dependencies benchmark-catalog audit-production typecheck bundle-sizes lint format check

##
# Packages
#
install:
	npm ci

build:
	npm run build

test:
	npm test

# Local end to end confidence check for the current CLI checkout.
# CI runs the script after its build. This convenience target stays outside `check`.
test-cli-integration:
	npx lerna run build --scope @featurevisor/cli --include-dependencies
	node scripts/test-cli-integration.mjs

# Optional isolated browser check. Requires a local Chromium compatible browser.
test-catalog-browser:
	npx lerna run build --scope @featurevisor/cli --scope @featurevisor/catalog --include-dependencies
	npm run test:catalog-browser

# Optional local parity check. Build native CLI runners before invoking it.
test-runner-conformance:
	node scripts/test-runner-conformance.mjs $(RUNNERS)

# Optional two mode parity check for portable Example 1 map and list mutations.
# Build native CLI runners before invoking it. The JavaScript runner is always included.
test-mutation-conformance:
	node scripts/test-mutation-conformance.mjs $(RUNNERS)

# Optional local guard for canonical fixtures copied into the ten native SDK repositories.
# This is read only and intentionally stays outside `check` and CI.
check-conformance-fixtures:
	node scripts/check-conformance-fixtures.mjs

# Local large-datafile confidence check for aggregate feature and global variable evaluation.
# This intentionally stays outside `check` and CI.
test-global-variables-performance:
	npx lerna run build --scope @featurevisor/sdk --include-dependencies
	node scripts/test-global-variables-performance.mjs

# Local large-project confidence check for complete, tag-filtered, and Target-filtered builds.
# This intentionally stays outside `check` and CI.
test-datafile-build-performance:
	npx lerna run build --scope @featurevisor/core --include-dependencies
	node scripts/test-datafile-build-performance.mjs

# Repeatable large-datafile benchmark for SDK datafile updates and evaluations.
# This intentionally stays outside `check` and CI.
benchmark-sdk-dependencies:
	npx lerna run build --scope @featurevisor/sdk --include-dependencies
	npm run benchmark:sdk-dependencies

# Local Catalog export benchmark. Set CATALOG_BENCH_LARGE=1 for 5,500 definitions.
benchmark-catalog:
	npx lerna run build --scope @featurevisor/core --scope @featurevisor/catalog --include-dependencies
	node scripts/benchmark-catalog.mjs $(OUTPUT)

# Network enabled release check for dependencies shipped to consumers.
# Development-only advisories are reviewed separately from release blockers.
audit-production:
	npm run audit:production

typecheck:
	npm run typecheck

bundle-sizes:
	npm run bundle-sizes

lint:
	npx prettier examples/ packages/ --check
	npx eslint .
	npx lerna run lint

format:
	npx prettier examples/ packages/ --write

check:
	make install
	make build
	make test
	make lint
	make typecheck
