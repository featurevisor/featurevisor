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
    tsConfigFilePath,
    enableCssModules,
    enableTailwind,
    enableAssets,

    // webpack specific
    mode,
    devtool,
    externals,
    devServer,
    plugins,

    // new option for bundle type
    bundleType,
  } = options;

  const entry = {};
  entry[entryKey] = entryFilePath;

  const config = {
    entry: entry,
    output: {
      path: outputDirectoryPath,
      filename: outputFileName || "[name].js",
      library: outputLibrary,
      libraryTarget: outputLibraryTarget || (bundleType === "esm" ? "module" : "umd"),
      globalObject: "this",
    },
    devServer,
    mode: mode || "production",
    devtool: devtool || "source-map",
    plugins: plugins || [],
    performance: {
      hints: false,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
    },
    externals: externals || {},
    module: {
      rules: [
        {
          test: /\.(ts|tsx)$/,
          exclude: /(node_modules)/,
          loader: "ts-loader",
          options: {
            configFile:
              tsConfigFilePath ||
              (bundleType === "esm"
                ? path.join(__dirname, "..", "tsconfig.esm.json")
                : path.join(__dirname, "..", "tsconfig.cjs.json")),
          },
        },
      ],
    },
  };

  if (bundleType === "esm") {
    config.experiments = {
      outputModule: true,
    };
  }

  if (enableCssModules) {
    config.resolve.extensions = [...config.resolve.extensions, ".css"];

    config.module.rules.push({
      test: /\.module.css$/,
      use: [
        {
          loader: "style-loader",
        },
        {
          loader: "css-loader",
          options: {
            importLoaders: 1,
            modules: true,
          },
        },
      ],
    });
  }

  if (enableTailwind) {
    config.resolve.extensions = [...config.resolve.extensions, ".css"];

    config.module.rules.push({
      test: /\.css$/,
      exclude: /\.module.css$/,
      use: ["style-loader", "css-loader", "postcss-loader"],
    });
  }

  if (enableAssets) {
    config.module.rules.push({
      test: /\.(eot|svg|ttf|woff|woff2|png|jpg|jpeg|gif)$/i,
      type: "asset/resource",
    });
  }

  return config;
};
