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

test:
	npx featurevisor test
	make test-datafiles
