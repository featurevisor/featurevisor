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
    // smol-toml writes values, not comments, so a file with a # is left as it is
    format: (source, layout) =>
      source.includes("#")
        ? undefined
        : require("smol-toml").stringify(
            layout.orderValue(
              require("smol-toml").parse(
                source,
              ),
            ),
          ),
  },
  prettyState: true,
};
