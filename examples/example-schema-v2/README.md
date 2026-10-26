# example-schema-v2

A project whose older iOS and Android releases still run `@featurevisor/sdk` v3 and read schema version "2" datafiles, while new releases read schema version "4".

- `targets/ios.yml` and `targets/android.yml` are the targets older releases already load. They set `schemaVersion: "2"`, so their datafile URLs stay the same. The build converts their datafiles, and lint checks every definition they carry.
- `targets/ios-v4.yml` is a new target for iOS releases on the v4 SDK, and `targets/web.yml` serves the web. Both write schema version "4".
- `features/newOnboarding.yml`, `segments/writers.yml` and `variables/onboardingCopy.yml` use v4 only syntax. They are tagged `ios-v4` and `web`, so neither schema version "2" target carries them.

```sh
npm run lint
npm test
npm run build
```
