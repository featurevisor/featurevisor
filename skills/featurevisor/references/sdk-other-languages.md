# SDKs in other languages

Full index: <https://featurevisor.com/docs/sdks/>

Every Featurevisor SDK reads the **same datafiles**, buckets identically and evaluates the same conditions, so a user in `treatment` on the web is in `treatment` on the backend and on mobile. The concepts in [sdk-javascript.md](sdk-javascript.md) (context, evaluation types, sticky values, child instances, datafile updates, modules, diagnostics) apply to every language. Only naming and packaging differ.

| Language                  | Install                                                    | Docs                                         |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| JavaScript and TypeScript | `npm install @featurevisor/sdk@^4.0.0`                     | [sdk-javascript.md](sdk-javascript.md)       |
| Go                        | `go get github.com/featurevisor/featurevisor-go/v4@v4.0.0` | <https://featurevisor.com/docs/sdks/go/>     |
| Python                    | `pip install 'featurevisor>=4.0.0,<5.0.0'`                 | <https://featurevisor.com/docs/sdks/python/> |
| PHP                       | `composer require featurevisor/featurevisor-php:^4.0.0`    | <https://featurevisor.com/docs/sdks/php/>    |
| Ruby                      | `gem install featurevisor -v '~> 4.0'`                     | <https://featurevisor.com/docs/sdks/ruby/>   |
| Java and Kotlin           | Maven or Gradle, from GitHub Packages                      | <https://featurevisor.com/docs/sdks/java/>   |
| Swift                     | Swift Package Manager                                      | <https://featurevisor.com/docs/sdks/swift/>  |
| Rust                      | `cargo add featurevisor@2.0.0`                             | <https://featurevisor.com/docs/sdks/rust/>   |
| Elixir                    | Mix                                                        | <https://featurevisor.com/docs/sdks/elixir/> |

Major versions differ by language: Rust and Elixir start v4 support at 2.0.0, and Java at 5.0.0. The [compatibility matrix](https://featurevisor.com/docs/sdks/compatibility/) lists the first release of each with v4 support and with each later capability.

**Do not guess an API you cannot see.** Fetch the language's docs page rather than transliterating JavaScript. Factory names differ: `createFeaturevisor` in JavaScript and Swift, `CreateFeaturevisor` in Go, `Featurevisor.createFeaturevisor` in Java, `create_featurevisor` in Python and Rust, `Featurevisor.create_featurevisor` in Ruby and Elixir, and `Featurevisor::createFeaturevisor` in PHP.

## Global variables

The JavaScript API tells a global variable from a feature variable by the number of arguments. Other languages:

| Language                | Global variable read                                           |
| ----------------------- | -------------------------------------------------------------- |
| JavaScript, Java, Swift | `getVariable(variableKey, context)`, overloaded                |
| Python, Ruby, PHP       | `get_variable` or `getVariable` with the shorter argument list |
| Go, Rust, Elixir        | `GetGlobalVariable` or `get_global_variable`                   |

Typed getters follow the same split. `getVariableKeys()` without a feature key lists global variables.

## Number getters

`number` variables are read with `getVariableNumber` in JavaScript and PHP, `get_variable_number` in Python, Ruby and Elixir (with `getVariableNumber` also in Python), and `getVariableDouble` or its language's spelling in Java, Kotlin, Swift, Go, Rust, Dart and .NET, named after the double they return.

## Kotlin and Android

There is no separate Kotlin SDK: **the Java SDK is the Kotlin SDK**, used through JVM interop. It ships from **GitHub Packages**, which needs credentials even for public packages: a GitHub username and a token with `read:packages`, kept in `~/.gradle/gradle.properties`, never in the repository. A build failing to resolve `com.featurevisor:featurevisor-java` is almost always this.

On Android, fetch and parse the datafile off the main thread, hold one instance for the owning lifecycle, and call `close()` when it ends. Example app: <https://github.com/featurevisor/featurevisor-example-android>.

## Shared guarantees

- **Identical bucketing**: the same feature key and `bucketBy` values give the same bucket in every language.
- **Portable conditions**: the date, version and regular expression rules in [operators.md](operators.md) are exactly what every SDK supports. That is why lint enforces them.
- **Same child context model**: a child snapshots the parent context at spawn time, inherits parent keys added later, and its own keys win.
- **Presence based defaults**: `""`, `0`, `false` and `null` are valid explicit defaults everywhere.
- **Every v4 SDK reads v3 datafiles**, so applications can upgrade before the project does.

When "it evaluates differently in our Go service than in the browser", the cause is nearly always a **different context** or a **different datafile revision**. Compare those first.

## Run the project's specs through another SDK

Each non JavaScript SDK ships a CLI that runs the project's own specs through that language's engine. This proves the definitions behave the same in the language the application uses:

```bash
# Python
python -m featurevisor test --project-directory-path=/path/to/featurevisor-project

# Go, after: go build -o featurevisor ./cmd
./featurevisor test --project-directory-path=/path/to/featurevisor-project

# Ruby
bundle exec featurevisor test --project-directory-path=/path/to/featurevisor-project

# PHP
vendor/bin/featurevisor test --project-directory-path=/path/to/featurevisor-project

# Swift
swift run featurevisor test --project-directory-path=/path/to/featurevisor-project

# Java
mvn -q -pl featurevisor-sdk exec:java -Dexec.mainClass=com.featurevisor.cli.CLI \
  -Dexec.args="test --project-directory-path=/path/to/featurevisor-project"

# Rust, after: cargo install featurevisor --version "^2.0" --features cli
featurevisor test --project-directory-path=/path/to/featurevisor-project

# Elixir, after: mix escript.build
./featurevisor test --project-directory-path=/path/to/featurevisor-project
```

They also accept `--key-pattern`, `--assertion-pattern`, `--only-failures`, `--quiet`, `--show-datafile` and repeatable `--target`, and provide `benchmark` and `assess-distribution`. Options are kebab case.

- They rely on the Node.js CLI: `npx featurevisor` must work in the project, which needs `@featurevisor/cli` 4 and Node.js 24 or later. Node.js lists specs, expands matrices and builds datafiles. The native SDK evaluates.
- Point `--project-directory-path` at the Featurevisor project, not the application.
- Checks and scenarios need a runner version that supports them: check the compatibility matrix.

Suggest this when production traffic runs on a non JavaScript SDK, when someone suspects a cross language difference, or when a polyglot organization wants CI proof that one project behaves the same everywhere.
