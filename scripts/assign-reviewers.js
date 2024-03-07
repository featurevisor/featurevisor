import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { Octokit, context as github } from '@octokit/rest';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const getFeatureOwners = (featureFile) => {
  const featureOwners = yaml.safeLoad(fs.readFileSync('.github/FEATUREOWNERS', 'utf8'));
  const featureName = path.basename(featureFile, '.yml');
  return featureOwners[featureName] || featureOwners['*'];
};

const assignReviewers = async () => {
  const { owner, repo, number } = github.context.issue;
  const files = await octokit.pulls.listFiles({ owner, repo, pull_number: number });

  console.log('Files:', files.data);

  const featureFiles = files.data.filter(file => file.filename.endsWith('.yml'));
  const reviewers = new Set();

  for (const file of featureFiles) {
    const owners = getFeatureOwners(file.filename);
    owners.forEach(owner => reviewers.add(owner));
  }

  if (reviewers.size > 0) {
    await octokit.pulls.createReviewRequest({
      owner,
      repo,
      pull_number: number,
      reviewers: Array.from(reviewers),
    });
  }
};

assignReviewers().catch(err => {
  console.error(err);
  process.exit(1);
});