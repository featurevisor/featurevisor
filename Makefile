.PHONY: install build test typecheck bundle-sizes lint format check

##
# Packages
#
install:
	npm ci

build:
	npm run build

test:
	npm test

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
