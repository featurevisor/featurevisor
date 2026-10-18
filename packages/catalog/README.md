# @featurevisor/catalog

A read only website for browsing Featurevisor definitions, targeting, dependencies and test specs.

## Installation

```bash
npm install --save-dev @featurevisor/cli
```

## Usage

Catalog is included with the CLI. Run it from a Featurevisor project:

```bash
npx featurevisor catalog
```

This package contains the UI assets used by the CLI. See the guide for static exports and hosting.

See the [documentation](https://featurevisor.com/docs/catalog/).

## Browser checks

From the monorepo root, build Catalog and run the isolated Chrome suite:

```bash
npm run build --workspace @featurevisor/catalog
node scripts/test-catalog-browser.mjs
```

Set `FEATUREVISOR_BROWSER_BIN` or `CHROME_BIN` if Chrome or Chromium is not in a
standard location. The suite uses a temporary profile, temporary exported
fixtures and local servers on automatically selected ports. It never opens a
personal browser or changes an example project. It needs no additional packages.
Copy checks capture the Clipboard API payload inside the test page without
reading or changing the system clipboard.

Coverage includes root and nested deployment paths, browser and hash routing,
static hosting, Sets with and without environments, slash keys, test and scenario
matrix permalinks, the clipboard, filters, browser history, Git history pages
and live prefix changes without copying assets again.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
