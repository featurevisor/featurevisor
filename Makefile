##
# Packages
#
install:
	npm ci
	npm run bootstrap

build:
	npm run build
	make print-sdk-size

test:
	npm test

lint:
	npm run lint

##
# Misc.
#
print-sdk-size:
	gzip -c packages/sdk/dist/index.js > packages/sdk/dist/index.js.gz
	ls -alh packages/sdk/dist | grep index.js | awk '{print $$9 "\t" $$5}'
