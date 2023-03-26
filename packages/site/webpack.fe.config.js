const path = require("path");

const getWebpackConfig = require("../../tools/getWebpackConfig");

const wepbackConfig = getWebpackConfig({
  entryFilePath: path.join(__dirname, "fe", "index.tsx"),
  entryKey: "index",
  outputDirectoryPath: path.join(__dirname, "dist"),
  outputLibrary: "FeaturevisorSite",
  tsConfigFilePath: path.join(__dirname, "tsconfig.fe.cjs.json"),
  enableCssModules: true,
});

module.exports = wepbackConfig;
