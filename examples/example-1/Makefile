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
	$(call notExists,showBanner,./dist/staging/datafile-tag-all.json)
	$(call exists,showBanner,./dist/staging/datafile-tag-checkout.json)
	$(call exists,hidden,./dist/staging/datafile-tag-all.json)

	@echo "\nTesting production datafiles"
	$(call exists,showBanner,./dist/production/datafile-tag-all.json)
	$(call exists,showBanner,./dist/production/datafile-tag-checkout.json)
	$(call notExists,hidden,./dist/production/datafile-tag-all.json)

test:
	npx featurevisor test
	make test-datafiles
