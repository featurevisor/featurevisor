const path = require("path");
const { merge } = require("webpack-merge");
const HtmlWebpackPlugin = require("html-webpack-plugin");

const webpackCommon = require("./webpack.common");

const webpackConfig = merge(webpackCommon, {
  devtool: "eval-source-map",
  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(__dirname, "public", "index.html"),
    }),
  ],
  devServer: {
    static: [
      {
        directory: path.join(__dirname, "public"),
      },
      {
        directory: path.join(__dirname, "mock"),
      },
    ],
    hot: true,
  },
});

module.exports = webpackConfig;
