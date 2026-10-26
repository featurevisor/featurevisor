# example-schema-v2

A project whose newer applications read schema "4" datafiles, while older iOS and Android releases still run `@featurevisor/sdk` 3 and read schema "2".

- `targets/web.yml` and `targets/ios.yml` build schema "4" datafiles for current applications.
- `targets/ios-legacy.yml` and `targets/android-legacy.yml` set `schemaVersion: "2"`. The build converts their datafiles, and lint checks every definition they carry.
- `features/newOnboarding.yml`, `segments/writers.yml` and `variables/onboardingCopy.yml` use v4 only syntax. Neither legacy target selects them, so lint accepts them.

```sh
npm run lint
npm test
npm run build
```
