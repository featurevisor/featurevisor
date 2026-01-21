/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ["staging", "production"],
  tags: ["all", "web", "ios", "android"],
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
      name: "nl",
      tags: ["web"],
      context: { country: "nl" },
    },
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

    // new scopes for subscription and browser
    {
      name: "premium",
      tag: "all",
      context: { subscription: "premium" },
    },
    {
      name: "chrome",
      tag: "web",
      context: { browser: "chrome" },
    },
    {
      name: "premium-chrome",
      tag: "web",
      context: {
        subscription: "premium",
        browser: "chrome",
      },
    },
  ],
  prettyState: true,
  prettyDatafile: true, // enabled for readability while developing
};
