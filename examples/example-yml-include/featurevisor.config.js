const fs = require("fs");
const path = require("path");
const YAML = require("js-yaml");

let baseDir;
const includeTag = "!include";

const includeYamlType = new YAML.Type(includeTag, {
  kind: "scalar",
  resolve: function (data) {
    return data !== null && typeof data === "string";
  },
  construct: function (data) {
    const fullPath = path.join(baseDir, data).split(" " + includeTag + " ")[0];

    return YAML.load(fs.readFileSync(fullPath, "utf8"));
  },
});

const SCHEMA = YAML.DEFAULT_SCHEMA.extend([includeYamlType]);

module.exports = {
  environments: ["staging", "production"],
  tags: ["all"],
  prettyState: true,
  parser: {
    extension: "yml",
    parse: function (content, filePath) {
      baseDir = path.dirname(filePath);

      return YAML.load(content, { schema: SCHEMA, filePath: filePath });
    },
  },
};
