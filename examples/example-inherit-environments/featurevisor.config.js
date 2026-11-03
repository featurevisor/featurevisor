/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ["dev", "staging", "production"],

  // A definition that leaves out dev uses what it has for staging
  inheritEnvironments: {
    dev: { from: "staging" },
  },

  // Production is always a deliberate choice, even if only `production: []`
  requiredEnvironmentsInRules: ["production"],
  requiredEnvironmentsInOverrides: ["production"],

  tags: ["all"],
  prettyState: true,
};
