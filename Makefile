.PHONY: install build test bundle-sizes lint format check

##
# Packages
#
install:
	npm ci

build:
	npm run build

test:
	npm test

bundle-sizes:
	npm run bundle-sizes

lint:
	npx prettier examples/ packages/ docs/ --check
	npx eslint .
	npx lerna run lint

format:
	npx prettier examples/ packages/ docs/ --write

check:
	make install
	make build
	make test
	make lint
