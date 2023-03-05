##
# Packages
#
install:
	npm ci
	npm run bootstrap

build:
	npm run build

test:
	npm test

lint:
	npm run lint

##
# Examples
#
# @TODO: loop through examples
#
lint-examples:
	(cd ./examples/example-1 && npm run lint)

build-examples:
	(cd ./examples/example-1 && npm run build)

test-examples:
	(cd ./examples/example-1 && npm test)

