.PHONY: install build test test-cli-integration test-global-variables-performance test-datafile-build-performance benchmark-sdk-dependencies audit-production typecheck bundle-sizes lint format check

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
# This intentionally stays outside `check` and CI.
test-cli-integration:
	npx lerna run build --scope @featurevisor/cli --include-dependencies
	node scripts/test-cli-integration.mjs

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
