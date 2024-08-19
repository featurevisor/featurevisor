##
# Packages
#
install:
	npm ci
	npm run bootstrap

build:
	npm run build
	make print-bundle-size

test:
	npm test

lint:
	npm run format
	npm run lint

##
# Misc.
#
print-bundle-size:
	@gzip -c packages/sdk/dist/index.cjs.js > packages/sdk/dist/index.cjs.js.gz
	@echo 'SDK package size:'
	@ls -alh packages/sdk/dist | grep index.cjs.js | awk '{print $$9 "\t\t" $$5}'

	@echo ''

	@gzip -c packages/react/dist/index.js > packages/react/dist/index.js.gz
	@echo 'React package size:'
	@ls -alh packages/react/dist | grep index.js | awk '{print $$9 "\t\t" $$5}'

	@echo ''

	@gzip -c packages/vue/dist/index.js > packages/vue/dist/index.js.gz
	@echo 'Vue package size:'
	@ls -alh packages/vue/dist | grep index.js | awk '{print $$9 "\t\t" $$5}'
