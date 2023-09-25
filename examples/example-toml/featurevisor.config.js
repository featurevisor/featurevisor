/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: [
    "staging",
    "production",
  ],
  tags: ["all"],
  parser: {
    extension: "toml",
    parse: (content) =>
      require("toml").parse(content),
  },
  prettyState: true,
};
