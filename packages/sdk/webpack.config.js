const path = require("path");

module.exports = [
  // cjs
  {
    entry: {
      "index.cjs": path.join(__dirname, "src", "index.ts"),
    },
    output: {
      path: path.join(__dirname, "dist"),
      filename: "index.cjs.js",
      library: "FeaturevisorSDK",
      libraryTarget: "umd",
      globalObject: "this",
    },
    mode: "production",
    devtool: "source-map",
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx)$/,
          exclude: /(node_modules)/,
          use: [
            {
              loader: "ts-loader",
              options: {
                configFile: path.join(__dirname, "tsconfig.cjs.json"),
                transpileOnly: true,
              },
            },
          ],
        },
      ],
    },
    performance: {
      hints: false,
    },
    optimization: {
      minimize: true,
    },
  },

  // esm
  {
    entry: {
      "index.esm": path.join(__dirname, "src", "index.ts"),
    },
    output: {
      path: path.join(__dirname, "dist"),
      filename: "index.esm.js",
      library: {
        type: "module",
      },
    },
    experiments: {
      outputModule: true,
    },
    mode: "production",
    devtool: "source-map",
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx)$/,
          exclude: /(node_modules)/,
          loader: "ts-loader",
          options: {
            configFile: path.join(__dirname, "tsconfig.esm.json"),
          },
        },
      ],
    },
    performance: {
      hints: false,
    },
  },
];
