.PHONY: install build test test-cli-integration typecheck bundle-sizes lint format check

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
