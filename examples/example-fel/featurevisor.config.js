/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ["staging", "production"],
  tags: ["all", "checkout", "sign-in", "sign-up", "ecommerce", "fel"],
  prettyState: true,
  prettyDatafile: true,
  allowFEL: true,
  // enforceCatchAllRule: true,
  // revisionFileName: "REVISION.txt",

  plugins: [require("./plugins/example")],
};
