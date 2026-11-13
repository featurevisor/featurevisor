/** @type {import('@featurevisor/core').ProjectConfig} */
module.exports = {
  environments: ["staging", "production"],
  tags: ["all", "checkout", "sign-in", "sign-up", "ecommerce"],
  metadataSchema: {
    type: "object",
    properties: {
      owner: {
        type: "string",
        enum: ["checkout-team", "growth-team", "platform-team"],
      },
      jira: {
        type: "string",
        pattern: "^[A-Z]+-[0-9]+$",
      },
      stakeholders: {
        type: "array",
        items: { type: "string" },
      },
      launchedOn: {
        type: "string",
        format: "date-time",
      },
      links: {
        type: "object",
        additionalProperties: { type: "string" },
      },
      deadlines: {
        type: "object",
        properties: {
          review: {
            description: "Check the flag still earns its place",
          },
          deprecate: {
            description: "Mark the flag deprecated, and tell the teams reading it",
          },
          remove: {
            description: "Remove the flag and the code that reads it",
            properties: {
              ticket: {
                type: "string",
                pattern: "^[A-Z]+-[0-9]+$",
              },
            },
            required: ["ticket"],
          },
        },
      },
    },
  },
  prettyState: true,
  prettyDatafile: true,
  // enforceCatchAllRule: true,
  // revisionFileName: "REVISION.txt",

  plugins: [require("./plugins/example")],
};
