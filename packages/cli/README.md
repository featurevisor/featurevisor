# @featurevisor/cli

Lint, test and build Featurevisor projects from the command line. Requires Node.js 24 or later.

## Create a project

Create a project in an empty directory, then check and build it:

```bash
mkdir my-project && cd my-project
npx @featurevisor/cli init
npm install
npx featurevisor lint
npx featurevisor test
npx featurevisor build
```

Use `npx @featurevisor/cli` before the CLI is installed. After `npm install`, the project provides the `featurevisor` executable used by `npx featurevisor`.

## Add to an existing project

Install the CLI in a project that already has its Featurevisor definitions and configuration:

```bash
npm install --save-dev @featurevisor/cli
```

Do not run `init` after this step. Initialization expects an empty directory and will not overwrite an existing `package.json`.

See the [documentation](https://featurevisor.com/docs/cli/).

## License

MIT © [Fahad Heylaal](https://fahad19.com)
