const path = require("path");

const getWebpackConfig = require("../../tools/getWebpackConfig");

const wepbackConfig = getWebpackConfig({
  entryFilePath: path.join(__dirname, "src", "index.tsx"),
  entryKey: "index",
  outputDirectoryPath: path.join(__dirname, "dist"),
  outputLibrary: "FeaturevisorSite",
  tsConfigFilePath: path.join(__dirname, "tsconfig.cjs.json"),
  enableCssModules: true,
});

module.exports = wepbackConfig;
