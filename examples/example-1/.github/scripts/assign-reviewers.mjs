import fs from "fs";

import { exec } from "child_process";
import { parseFeatureOwners } from "./parsefeatureowners.mjs";

import { Octokit } from "@octokit/rest";

// Octokit.js
// https://github.com/octokit/core.js#readme
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const ENVIROMENT = process.env.ENVIRONMENT || "staging";

function assignReviewers(users) {
  return octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers", {
    owner: "OWNER",
    repo: "REPO",
    pull_number: "PULL_NUMBER",
    reviewers: users,
    team_reviewers: [],
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

const execPromise = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(stderr);
        reject(error);
      }
      resolve(stdout.trim());
    });
  });
};

const getFeatureOwners = () => {
  const content = fs.readFileSync("../.github/FEATUREOWNERS", "utf8");
  const mappings = parseFeatureOwners(content);
  return mappings;
};

const process = async () => {
  let files = await execPromise(`git diff --name-only HEAD~1 HEAD`);
  files = files
    .split("\n")
    .filter(Boolean)
    .filter((file) => file.endsWith(".yml"));

  const featureFiles = files.filter((file) => file.endsWith(".yml"));

  console.log("Files:", files);

  const owners = getFeatureOwners();

  console.log("Owners:", owners);

  const reviewers = new Set(owners["*"]);

  for (let file of featureFiles) {
    file = file.split("/").at(-1);
    const feature = file.split(".")[0];
    if (owners[feature]) {
      for (const owner of owners[feature]) {
        for (const reviewer of owner["*"]) {
          reviewers.add(reviewer);
        }
        for (const reviewer of owner[ENVIROMENT]) {
          reviewers.add(reviewer);
        }
      }
    }
  }

  console.log("Reviewers:", reviewers);

  assignReviewers(Array.from(reviewers));
};

process().catch((err) => {
  console.error(err);
  process.exit(1);
});