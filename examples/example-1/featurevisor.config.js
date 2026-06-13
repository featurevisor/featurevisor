/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ["staging", "production"],
  tags: ["all", "checkout", "sign-in", "sign-up", "ecommerce"],
  prettyState: true,
  prettyDatafile: true,
  // enforceCatchAllRule: true,
  // revisionFileName: "REVISION.txt",

  plugins: [require("./plugins/example")],
};
