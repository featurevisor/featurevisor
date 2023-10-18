const fs = require("fs");
const path = require("path");
const YAML = require("js-yaml");

function includeLoader(content, filePath) {
  const basePath = path.dirname(filePath);

  const includeRegex = /^!include\s+(.+)$/gm;
  let match;
  while ((match = includeRegex.exec(content))) {
    const includePath = match[1];
    const includeFilePath = path.resolve(basePath, includePath);
    const includeContent = fs.readFileSync(includeFilePath, "utf8");
    content = content.replace(match[0], includeContent);
  }

  // Parse the modified YAML content.
  return YAML.load(content);
}

module.exports = {
  environments: ["staging", "production"],
  tags: ["all"],
  prettyState: true,
  parser: {
    extension: "yml",
    parse: function (content, filePath) {
      return includeLoader(content, filePath);
    },
  },
};
