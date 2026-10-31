import type { Plugin } from "../cli";

/**
 * `featurevisor convert` changes a project's shape, between no environments and no sets,
 * environments, and sets. A project rarely runs it, so the command loads its code only when it
 * runs, and nothing else imports from here.
 */
export const convertPlugin: Plugin = {
  command: "convert",
  description: "Convert a project between environments, sets, and neither",
  handler: async function (options) {
    const { runConversion } = require("./run") as typeof import("./run");
    return runConversion(options);
  },
  examples: [
    {
      command: "convert --to=sets",
      description: "Preview turning each environment into a set",
    },
    {
      command: "convert --to=sets --apply",
      description: "Turn each environment into a set",
    },
    {
      command: "convert --to=environments --environments=staging,production",
      description: "Give a project without environments staging and production",
    },
    {
      command: "convert --to=flat --keep=production --apply",
      description: "Keep only production, without environments or sets",
    },
  ],
};
