module.exports = {
  // this will be made available as "example" command:
  //
  //   $ npx featurevisor example
  //
  command: "example",

  // handle the command
  handler: async function ({ rootDirectoryPath, projectConfig, parsed, datasource }) {
    console.log("Running the example command!");

    return false;
  },

  // self-documenting examples
  examples: [
    {
      command: "example",
      description: "run the example command",
    },
    {
      command: "example --foo=bar",
      description: "run the example command with additional options",
    },
  ],
};
