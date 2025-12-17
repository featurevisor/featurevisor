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

    // multiple tags
    {
      name: "web-or-mobile-simple",
      tags: {
        or: ["web", "ios"],
      },
      context: {},
    },
    {
      name: "web-or-mobile-explicit",
      tags: {
        or: ["web", "ios"],
      },
      context: {},
    },
    {
      name: "web-and-mobile",
      tags: {
        and: ["web", "ios"],
      },
      context: {},
    },
  ],
  prettyState: true,
  prettyDatafile: true, // enabled for readability while developing
};
