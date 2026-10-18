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
      require("smol-toml").parse(
        content,
      ),
    stringify: (content) =>
      require("smol-toml").stringify(
        content,
      ),
  },
  prettyState: true,
};
