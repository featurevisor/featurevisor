/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ["staging", "production"],
  tags: ["all", "web", "ios", "android", "mobile"],
  prettyState: true,
  prettyDatafile: true, // enabled for readability while developing
};
