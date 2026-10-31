.PHONY: install build test test-extended test-cli-integration test-catalog-browser test-runner-conformance test-mutation-conformance check-conformance-fixtures test-global-variables-performance test-datafile-build-performance benchmark-sdk-dependencies benchmark-catalog audit-production typecheck bundle-sizes lint format fmt-examples check

##
# Packages
#
install:
	npm ci

build:
	npm run build

test:
	npm test

# Slower checks kept out of CI so it stays fast: compiled package consumers,
# browsers, the CLI end to end, JavaScript conformance, editor schemas, release
# configuration and bundle size budgets. `make check` runs them after a build.
# The browser checks need a local Chromium compatible browser.
test-extended:
	node scripts/test-editor-schemas.mjs
	node scripts/test-release-config.mjs
	npm run test:package-exports
	npm run test:packed-packages
	npm run test:react-minimum
	npm run test:vue-minimum
	npm run test:browser
	npm run test:catalog-browser
	node scripts/test-cli-integration.mjs
	node scripts/test-runner-conformance.mjs javascript
	node scripts/test-mutation-conformance.mjs javascript
	make bundle-sizes

# Local end to end confidence check for the current CLI checkout.
# `make check` runs the script after its build. This target builds the CLI first.
test-cli-integration:
	npx lerna run build --scope @featurevisor/cli --include-dependencies
	node scripts/test-cli-integration.mjs

# Isolated browser check, also part of `make check`. Requires a local Chromium compatible browser.
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

# Restyles every example with the built CLI, after a change to the house style in
# packages/core/src/formatter/style.ts. Run make build first.
fmt-examples:
	@for example in examples/*/; do \
		if [ -f "$$example/featurevisor.config.js" ]; then \
			printf "%s " "$$example"; (cd "$$example" && node ../../packages/cli/bin.js fmt | tail -1); \
		fi; \
	done

# CI runs install, build, lint, typecheck and test. Run this locally before publishing.
check:
	make install
	make build
	make lint
	make typecheck
	make test
	make test-extended
