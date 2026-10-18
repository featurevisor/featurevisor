# JSON Schema

These JSON schemas offer editor completion for authored attributes, segments,
features, global variables, Targets, tests and scenarios. Generate them from
the current Zod authoring schemas with `node scripts/generate-editor-schemas.mjs`.
Run `node scripts/test-editor-schemas.mjs` to check reproducibility and validate
the Example 1 definitions with AJV.

Generation uses Zod's input view, not its normalized output view. Environment
names and references are left open because they come from each project. Zod
uses unrestricted shapes for some authored values and test expectations. These
carry comments in the JSON schemas and still require semantic linting. The
JavaScript Date branch cannot be represented in JSON, so editor schemas use
its textual authored value. Test checks expose recursive groups and typed
leaves. Mutation maps expose their object shape. Project reference resolution,
matrix expansion and detailed value validation remain the linter's job.

Run `featurevisor lint` for project keys, reference resolution, value types,
mutation rules, checks and cross file constraints. An editor accepting a file
does not mean that the project will build.
