/** @type {import('prettier').Config} */
const config = {
  printWidth: 100,
  singleQuote: false,
  trailingComma: "all",
  tabWidth: 2,
  semi: true,

  proseWrap: "preserve",
  embeddedLanguageFormatting: "off",

  overrides: [
    {
      files: ["*.md"],
      options: {
        proseWrap: "preserve",
        embeddedLanguageFormatting: "off",
      },
    },
  ],
};

module.exports = config;
