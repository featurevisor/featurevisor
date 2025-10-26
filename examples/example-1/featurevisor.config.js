/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ["staging", "production"],
  tags: ["all", "checkout"],
  prettyState: true,
  prettyDatafile: true,
  // enforceCatchAllRule: true,
  // revisionFileName: "REVISION.txt",

  plugins: [require("./plugins/example")],
};
