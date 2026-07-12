/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ["staging", "production"],
  tags: ["all", "web"],
  prettyDatafile: true,
  // enforceCatchAllRule: true,         // uncomment to require '*' last rule per env
};
