/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ["staging", "production"],
  tags: ["web", "ios", "android"],
  scopes: [
    {
      name: "browsers",
      tag: "web",
      context: { platform: "web" },
    },
  ],
  prettyState: true,
  prettyDatafile: true, // enabled for readability while developing
};
