# Example inherit environments

A `dev` environment added to a project that already has `staging` and
`production`, without touching the definitions of teams that do not use it. A
definition that leaves out `dev` uses what it has for `staging`. A team that
wants something else in `dev` writes it for that definition only.

This project is mostly used by the Featurevisor team for testing and
development. Visit [featurevisor.com](https://featurevisor.com/docs/environments/)
for more information.

## Where to look

| What                                                     | Where                           |
| -------------------------------------------------------- | ------------------------------- |
| The settings                                             | `featurevisor.config.js`        |
| Rules inherited from staging                             | `features/checkout.yml`         |
| Inherited rules allocate as staging does                 | `features/pricing.yml`          |
| Own rules for dev, with force entries still inherited    | `features/newSearch.yml`        |
| `dev: []`, off in dev and not inherited                  | `features/promoBanner.yml`      |
| `expose` inherited, so the feature stays out of dev      | `features/legacyExport.yml`     |
| Own rules relying on another feature that inherits       | `features/checkoutDiscount.yml` |
| Overrides inherited from staging                         | `variables/supportEmail.yml`    |
| Own overrides for dev                                    | `variables/maxCartItems.yml`    |
| `dev: []`, the default value in dev                      | `variables/welcomeMessage.yml`  |
| Assertions naming `dev`, since assertions do not inherit | `tests/`                        |

## Try it

```sh
npm run lint
npm test
npm run build
```

Building writes `datafiles/dev`, `datafiles/staging` and `datafiles/production`.
See who has written their own rules for `dev`, and who still inherits:

```sh
npx featurevisor list --features --defined-in=dev
npx featurevisor list --features --not-defined-in=dev
```
