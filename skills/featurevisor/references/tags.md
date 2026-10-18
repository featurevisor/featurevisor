# Tags

Full docs: <https://featurevisor.com/docs/tags/>

Tags mark which applications use a feature or global variable, so [targets](targets.md) can build a datafile per application. Smaller datafiles mean less to download and hold in memory.

## Declare

Every tag must be listed in `featurevisor.config.js`:

```js
module.exports = {
  tags: ['web', 'ios', 'android'],
}
```

Lint rejects a definition using an undeclared tag, so add the tag to the configuration first.

## Tag definitions

```yaml
description: Live chat widget

tags:
  - web
  - ios
```

Features and global variables both take `tags`. A tag means nothing until a target selects it: the default `all` target has no selectors and ignores tags.

## Select by tag

```yaml
# targets/web.yml
description: Web app

tag: web
```

This builds `datafiles/featurevisor-web.json`, or one per environment when environments are configured. A global variable needs the tag too, or a tag selected target leaves it out, unless a selected definition references it.

## Choosing tags

| Tag by                           | When                                        |
| -------------------------------- | ------------------------------------------- |
| Surface: `web`, `ios`, `android` | one project serves several client platforms |
| Microfrontend                    | each frontend loads its own datafile        |
| Service                          | backend services each read a subset         |

## Hide a feature from some tags

`expose: [web]` on a feature restricts which tag selected targets include it, without removing its tags. It is a temporary tool, mostly for migrations ([features.md](features.md#expose)).

## Adding, renaming or removing a tag

1. Add it to `tags` in the configuration.
2. Add it to the definitions that need it.
3. Create or update the target that selects it.
4. Run `npx featurevisor lint` and `npx featurevisor build --no-state-files`.
5. Point the application at the new datafile URL.

To rename, change the configuration, every definition's `tags`, and the targets. To remove, remove it from definitions and targets before the configuration, or lint fails.

`npx featurevisor list --features --tag=web --json` lists what carries a tag.

## Tags, targets and namespaces

- **Tags**: metadata on definitions that targets select.
- **[Targets](targets.md)**: the datafiles that get built, selected by tags, keys and known context.
- **[Namespaces](namespaces.md)**: key prefixes from subdirectories. Organization only, with no effect on which datafile a definition lands in.
