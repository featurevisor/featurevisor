/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ["staging", "production"],
  tags: ["all", "checkout"],
  prettyState: true,
  prettyDatafile: true,
  // enforceCatchAllRule: true,

  plugins: [require("./plugins/example")],
};
