const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

const getWebpackConfig = require("../../tools/getWebpackConfig");

const webpackConfig = getWebpackConfig({
  entryFilePath: path.join(__dirname, "src", "index.tsx"),
  entryKey: "index",
  outputDirectoryPath: path.join(__dirname, "dist"),
  outputLibrary: "FeaturevisorGui",
  tsConfigFilePath: path.join(__dirname, "tsconfig.cjs.json"),
  enableCssModules: true,
  enableTailwind: true,
  enableAssets: true,
  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(__dirname, "public", "index.html"),
    }),
  ],
});

module.exports = webpackConfig;
