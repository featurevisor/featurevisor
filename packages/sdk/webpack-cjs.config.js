const path = require("path");

const getWebpackConfig = require("../../tools/getWebpackConfig");

const wepbackConfig = getWebpackConfig({
  entryFilePath: path.join(__dirname, "src", "index.ts"),
  entryKey: "index.cjs",
  outputDirectoryPath: path.join(__dirname, "dist"),
  outputLibrary: "FeaturevisorSDK",
  tsConfigFilePath: path.join(__dirname, "tsconfig.cjs.json"),
});

module.exports = wepbackConfig;
