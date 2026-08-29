# SDKs in other languages

Full index: <https://featurevisor.com/docs/sdks>

Featurevisor SDKs exist for many runtimes. They all consume the **same datafiles**, expose the same concepts, and are held to a shared cross-SDK contract — so a user bucketed into `treatment` on the web gets `treatment` on the backend and on mobile.

For JavaScript/TypeScript specifics read [sdk-javascript.md](sdk-javascript.md) — the concepts there (context, evaluation types, sticky, child instances, datafile refresh, modules, diagnostics) transfer to every language; only syntax and packaging differ.

| Platform                      | Docs                                                    |
| ----------------------------- | ------------------------------------------------------- |
| JavaScript / TypeScript       | <https://featurevisor.com/docs/sdks/javascript>         |
| Node.js                       | <https://featurevisor.com/docs/sdks/nodejs>             |
| Browser                       | <https://featurevisor.com/docs/sdks/browser>            |
| React / React Native          | [sdk-react.md](sdk-react.md)                            |
| Vue                           | [sdk-vue.md](sdk-vue.md)                                |
| Go                            | <https://featurevisor.com/docs/sdks/go>                 |
| Python                        | <https://featurevisor.com/docs/sdks/python>             |
| Ruby                          | <https://featurevisor.com/docs/sdks/ruby>               |
| Java                          | <https://featurevisor.com/docs/sdks/java>               |
| Kotlin / Android              | <https://featurevisor.com/docs/sdks/kotlin>             |
| Swift                         | <https://featurevisor.com/docs/sdks/swift>              |
| PHP                           | <https://featurevisor.com/docs/sdks/php>                |
| OpenFeature (multi-language)  | [openfeature.md](openfeature.md)                        |

Framework guides (Next.js, Express, Fastify, Astro, Nuxt): <https://featurevisor.com/docs/frameworks>

**Don't guess an API you can't see.** When helping with a language this skill doesn't detail, fetch its docs page rather than transliterating JavaScript — factory names and idioms differ (v3 uses `createFeaturevisor` in JS/Go/Swift/Java, `create_featurevisor` in Python/Ruby, `Featurevisor::createFeaturevisor` in PHP). Upgrading an app from v2 SDK names: [upgrading-to-v3.md](upgrading-to-v3.md#other-languages).

## Kotlin and Android

**There is no separate Kotlin SDK. The Java SDK is the Kotlin SDK**, used through normal JVM interop. Don't go looking for a `featurevisor-kotlin` package.

It ships via **GitHub Packages**, not Maven Central, so the repository has to be declared in `settings.gradle.kts` with credentials (a GitHub username plus a token carrying `read:packages`, kept in `~/.gradle/gradle.properties`, never in the repo). That authentication step is the usual reason a build fails to resolve `com.featurevisor:featurevisor-java`, so check it before debugging anything else.

```kotlin
implementation("com.featurevisor:featurevisor-java:3.0.0")
```

```kotlin
val datafile = DatafileContent.fromJson(datafileJson)
val f = Featurevisor.createFeaturevisor(
    Featurevisor.FeaturevisorOptions().datafile(datafile),
)

val enabled: Boolean = f.isEnabled("my_feature", mapOf("userId" to "123"))
val variation: String? = f.getVariation("my_feature")   // instance context when omitted
```

On Android: fetch and parse the datafile **off the main thread**, hold one instance for the owning lifecycle rather than per evaluation, and call `f.close()` when that lifecycle ends. The full API (typed variables, datafile updates, diagnostics, events, modules, sticky, child instances) is the Java SDK's, documented at <https://featurevisor.com/docs/sdks/java>. Example app: <https://github.com/featurevisor/featurevisor-example-android>.

## What every SDK guarantees

The monorepo keeps a machine-readable contract at [`conformance/sdk-v3.json`](https://github.com/featurevisor/featurevisor/blob/main/conformance/sdk-v3.json) that all v3 SDKs are verified against. The practically important guarantees:

- **Identical bucketing** — same feature key + same `bucketBy` value ⇒ same bucket, in every language.
- **Portable conditions** — the regex subset and ISO 8601 date format described in [operators.md](operators.md) are exactly what every SDK supports. This is *why* those authoring restrictions exist: a pattern that only works in JavaScript would silently diverge elsewhere.
- **Same child-instance context model** — snapshot the parent keys present at spawn, inherit parent keys added later, child keys win ([sdk-javascript.md](sdk-javascript.md#child-instances-server-side)).
- **Presence-based defaults** — `""`, `0`, `false`, and `null` are valid explicit defaults everywhere, never treated as "missing".
- **Same diagnostics shape** — level, code, message, object-shaped details.

When a user reports "it evaluates differently in our Go service than in the browser", the cause is nearly always **different context** or a **different datafile revision** — not the SDKs. Compare those two first.

## Global variables

[Global variables](global-variables.md) live in the same datafile as features and evaluate identically in every v3 SDK. Only the **spelling of the call** differs, because the JavaScript API distinguishes a feature variable from a global one by argument count:

| Language                              | Global variable read                             |
| ------------------------------------- | ------------------------------------------------ |
| JavaScript/TypeScript, Java, Swift    | `getVariable(variableKey, context)` (overloaded) |
| Python, Ruby, PHP                     | `get_variable` / `getVariable` with the shorter argument list, dispatched at runtime |
| Go, Rust, Elixir                      | `GetGlobalVariable` / `get_global_variable`      |

Typed accessors follow the same rule: `getVariableString(key, context)` in the first two groups, `GetGlobalVariableString` / `get_global_variable_string` in the third. Listing works the same way, with `getVariableKeys()` (no feature key) returning global variable keys and `getVariableKeys(featureKey)` returning that feature's own.

Two consequences worth stating to anyone porting code between services:

- **A global variable key and a feature key can collide** only if the project allows it (`allowFeatureAndGlobalVariableKeyCollisions`, see [configuration.md](configuration.md)). In the overload-based languages a collision makes the call ambiguous to a reader even when the compiler is happy, which is why the default is to forbid it.
- **`requiredFeatures` gating is evaluated inside the SDK**, so an unmet requirement returns `disabledValue` and `reason: required_features_unmet` in every language, with no application-side branching.

## Verifying your project against a specific SDK

Every non-JavaScript SDK ships a CLI that runs **your project's own test specs** through that language's implementation. This is the highest-value trick in this file: it proves the features you authored behave identically in the language your application actually uses.

```bash
# Python
python -m featurevisor test

# Go
go run cmd/main.go test --projectDirectoryPath="/absolute/path/to/project"

# Ruby
bundle exec featurevisor test --projectDirectoryPath="/absolute/path/to/project"

# PHP
vendor/bin/featurevisor test --projectDirectoryPath="/absolute/path/to/project"

# Swift
swift run featurevisor test --projectDirectoryPath="/absolute/path/to/project"

# Java
mvn exec:java -Dexec.mainClass="com.featurevisor.cli.CLI" \
  -Dexec.args="test --projectDirectoryPath=/absolute/path/to/project"
```

All of them also support `benchmark` and `assess-distribution`, the familiar filters (`--keyPattern`, `--assertionPattern`, `--onlyFailures`, `--quiet`, `--showDatafile`), and repeatable `--target=<target>` selection with the same semantics as the Node.js CLI ([cli.md](cli.md)).

Two things to remember before suggesting these:

- They **rely on the Node.js CLI** (`npx featurevisor`) being available in the project: definitions, test specs, target discovery, and datafile generation always come from there. The language CLI supplies only the evaluation engine.
- They run against the project directory, so point `--projectDirectoryPath` at the Featurevisor project repo, not the application repo.

Suggest this when a team's production traffic is served by a non-JavaScript SDK, when someone suspects a cross-language discrepancy, or when a polyglot org wants CI proof that one project behaves the same everywhere.
