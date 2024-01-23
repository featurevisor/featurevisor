test-datafiles:
	@echo "Testing staging datafiles"

	@[ "$$(cat ./dist/staging/datafile-tag-all.json | grep -o 'showBanner')" = "" ] && echo "Test passed" || (echo "Expose test for showBanner in staging/datafile-tag-all.json failed" && exit 1)
	@[ "$$(cat ./dist/staging/datafile-tag-checkout.json | grep -o 'showBanner')" = "showBanner" ] && echo "Test passed" || (echo "Expose test for showBanner in staging/datafile-tag-checkout.json failed" && exit 1)

	@[ "$$(cat ./dist/staging/datafile-tag-all.json | grep -o 'hidden')" = "hidden" ] && echo "Test passed" || (echo "Expose test for hidden in staging/datafile-tag-all.json failed" && exit 1)

	@echo "\nTesting production datafiles"

	@[ "$$(cat ./dist/production/datafile-tag-all.json | grep -o 'showBanner')" = "showBanner" ] && echo "Test passed" || (echo "Expose test for showBanner in production/datafile-tag-all.json failed" && exit 1)
	@[ "$$(cat ./dist/production/datafile-tag-checkout.json | grep -o 'showBanner')" = "showBanner" ] && echo "Test passed" || (echo "Expose test for showBanner in production/datafile-tag-checkout.json failed" && exit 1)

	@[ "$$(cat ./dist/production/datafile-tag-all.json | grep -o 'hidden')" = "" ] && echo "Test passed" || (echo "Expose test for hidden in production/datafile-tag-all.json failed" && exit 1)

test:
	npx featurevisor test
	make test-datafiles
