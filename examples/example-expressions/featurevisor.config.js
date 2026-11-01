/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ["staging", "production"],
  tags: ["all", "checkout", "sign-in", "sign-up", "ecommerce", "expressions"],
  prettyState: true,
  prettyDatafile: true,
  allowConditionExpressions: true,
  // enforceCatchAllRule: true,
  // revisionFileName: "REVISION.txt",

  plugins: [require("./plugins/example")],
};
