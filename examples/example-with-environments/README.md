# Example with environments

Shared YAML definitions with separate staging and production rules. Staging
enables the cookie banner for everyone; production enables it only for users
in the Netherlands. The `all` target includes every active feature and global
variable without requiring tags.

## Initialize

Run in an empty directory:

```sh
npx @featurevisor/cli@latest init --example=with-environments
npm install
npm run lint
npm test
npm run build
```

Building writes `datafiles/staging/featurevisor-all.json` and
`datafiles/production/featurevisor-all.json`.

For the default project without environments, use `init`. The existing
`init --example=environments` choice uses Sets as separate release lanes,
not environment maps within shared definitions.

See [Environments](https://featurevisor.com/docs/environments/) for configuration
and conversion guidance.
