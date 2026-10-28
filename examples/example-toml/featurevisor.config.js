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
    // smol-toml writes values, not comments, so fmt orders keys only in a file without them
    format: (source, layout) =>
      /^\s*#/m.test(source)
        ? source
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
