const path = require("path");

module.exports = function getWebpackConfig(options) {
  const {
    // required
    entryFilePath,
    entryKey,
    outputDirectoryPath,
    outputLibrary,

    // optional
    outputFileName,
    outputLibraryTarget,
    mode,
    devtool,
    tsConfigFilePath,
  } = options;

  const entry = {};
  entry[entryKey] = entryFilePath;

  return {
    entry: entry,
    output: {
      path: outputDirectoryPath,
      filename: outputFileName || "[name].js",
      library: outputLibrary,
      libraryTarget: outputLibraryTarget || "umd",
      globalObject: "this",
    },
    externals: {},
    mode: mode || "production",
    devtool: devtool || "source-map",
    plugins: [],
    performance: {
      hints: false,
    },
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
            configFile: tsConfigFilePath || path.join(__dirname, "..", "tsconfig.cjs.json"),
          },
        },
      ],
    },
  };
};
