const path = require("path");

const getWebpackConfig = require("../../tools/getWebpackConfig");

const wepbackConfig = getWebpackConfig({
  entryFilePath: path.join(__dirname, "src", "index.ts"),
  entryKey: "index",
  outputDirectoryPath: path.join(__dirname, "dist"),
  outputLibrary: "FeaturevisorTypes",
  tsConfigFilePath: path.join(__dirname, "tsconfig.cjs.json"),
});

module.exports = wepbackConfig;
