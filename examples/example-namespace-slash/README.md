# Featurevisor example with slash namespaces

This project uses `/` as its `namespaceCharacter`. Entity directories therefore produce keys such
as `checkout/redesign`, `account/dashboard`, and `audience/netherlands`.

It includes simple flags, variations, variables, segments, and tests. It also serves as the Catalog
regression fixture for entity keys containing URL path separators.

Attributes cannot use namespaces. `attributes/user.yml` declares one object
attribute, with `user.id` used for bucketing and `user.country` for conditions.
Application context supplies a `user` object. These property paths use dots even
though entity namespaces use slashes.
