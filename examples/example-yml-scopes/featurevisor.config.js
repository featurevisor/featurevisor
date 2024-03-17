/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ["staging", "production"],
  tags: ["web", "ios", "android"],
  scopes: [
    {
      name: "browsers",
      context: { platform: "web" },
      forTags: ["web"],
    },
  ],
  prettyState: true,
  prettyDatafile: true, // enabled for readability while developing
};
