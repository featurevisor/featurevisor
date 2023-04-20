const path = require("path");

const getWebpackConfig = require("../../tools/getWebpackConfig");

const wepbackConfig = getWebpackConfig({
  entryFilePath: path.join(__dirname, "src", "index.ts"),
  entryKey: "index",
  outputDirectoryPath: path.join(__dirname, "dist"),
  outputLibrary: "FeaturevisorReact",
  tsConfigFilePath: path.join(__dirname, "tsconfig.cjs.json"),
  externals: {
    react: {
      commonjs: "react",
      commonjs2: "react",
      amd: "react",
      root: "React",
    },
  },
});

module.exports = wepbackConfig;
