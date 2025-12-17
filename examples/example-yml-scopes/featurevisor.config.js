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
    {
      name: "ios",
      tag: "ios",
      context: { platform: "ios" },
    },
    {
      name: "android",
      tag: "android",
      context: { platform: "android" },
    },
    {
      name: "web-and-mobile",
      tags: ["web", "mobile"],
      context: {},
    },
  ],
  prettyState: true,
  prettyDatafile: true, // enabled for readability while developing
};
