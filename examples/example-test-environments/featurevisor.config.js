/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  sets: true,
  environments: false,
  promotionFlows: [
    { from: "dev", to: "staging" },
    { from: "staging", to: "production" },
  ],
  tags: ["all"],
  prettyState: true,
};
