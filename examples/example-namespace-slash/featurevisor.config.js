/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  namespaceCharacter: "/",
  environments: ["staging", "production"],
  tags: ["all", "account", "checkout", "platform"],
  prettyState: true,
  prettyDatafile: true,
};
