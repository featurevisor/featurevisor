define check_string
	@[ "$$(cat $(2) | grep -o $(1))" = "$(3)" ] && echo "Test passed" || (echo "Expose test for $(1) in $(2) failed" && exit 1)
endef

define exists
	$(call check_string,$(1),$(2),$(1))
endef

define notExists
	$(call check_string,$(1),$(2),"")
endef

test-datafiles:
	@echo "Testing staging datafiles"
	$(call notExists,showBanner,./datafiles/staging/featurevisor-tag-all.json)
	$(call exists,showBanner,./datafiles/staging/featurevisor-tag-checkout.json)
	$(call exists,hidden,./datafiles/staging/featurevisor-tag-all.json)

	@echo "\nTesting production datafiles"
	$(call exists,showBanner,./datafiles/production/featurevisor-tag-all.json)
	$(call exists,showBanner,./datafiles/production/featurevisor-tag-checkout.json)
	$(call notExists,hidden,./datafiles/production/featurevisor-tag-all.json)

test-assess-distribution:
	@echo "Testing distribution files"
	npx featurevisor assess-distribution --feature=foo --environment=staging    --populateUuid=userId --context='{"device": "mobile", "country": "nl"}' -n=1000
	npx featurevisor assess-distribution --feature=foo --environment=production --populateUuid=userId --context='{"device": "mobile", "country": "nl"}' -n=1000
	npx featurevisor assess-distribution --feature=foo --environment=production --populateUuid=userId --context='{"device": "mobile", "country": "de"}' -n=1000

test-benchmark:
	@echo "Testing benchmark files"
	npx featurevisor benchmark --feature=foo --environment=staging --context='{"device": "mobile", "country": "nl"}' -n=1000

test-evaluate:
	@echo "Testing evaluation"
	npx featurevisor evaluate --feature=foo --environment=staging --context='{"device": "mobile", "country": "nl"}'

test:
	npx featurevisor test

	make test-datafiles
	make test-assess-distribution
	make test-benchmark
	make test-evaluate

	npx featurevisor find-duplicate-segments

	npx featurevisor find-usage --segment=mobile
	npx featurevisor find-usage --unusedSegments

	npx featurevisor find-usage --attribute=country
	npx featurevisor find-usage --unusedAttributes

	npx featurevisor list --attributes
	npx featurevisor list --segments
	npx featurevisor list --features

	npx featurevisor info
