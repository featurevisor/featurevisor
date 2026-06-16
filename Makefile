.PHONY: install build test lint format check

##
# Packages
#
install:
	npm ci

build:
	npm run build

test:
	npm test

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

##
# Misc.
#
print-bundle-size:
	@echo 'Bundle size reporting skipped: library packages are TypeScript-only builds now.'
