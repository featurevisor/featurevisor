// Publishes the packages whose versions npm does not have yet, for the Publish workflow after
// `lerna version`. `--dry-run` says what it would publish, and publishes nothing.
//
// Publishing every package in one go kept stopping part way: v4.12.0, with catalog, core and
// cli to publish, took four runs of the workflow, each publishing a single package. So this
// script:
//
// - publishes one package at a time, in dependency order and a pause apart, so npm has taken a
//   package before the packages depending on it follow,
// - after a failure, waits a few minutes and publishes again, which skips what npm already has
//   and signs provenance with a fresh key, rather than leave the whole job to be rerun, and
// - once everything is published, waits until npm serves every new version.
import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const REGISTRY = "https://registry.npmjs.org";

function setting(name, fallback) {
  const value = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Runs of `lerna publish` before giving up */
const ATTEMPTS = Math.max(1, setting("PUBLISH_ATTEMPTS", 4));
/** The pause after a failed run, before the next */
const RETRY_WAIT_SECONDS = setting("PUBLISH_RETRY_WAIT_SECONDS", 180);
/** The pause after one package is published, before the next starts */
const PACE_SECONDS = setting("PUBLISH_PACE_SECONDS", 120);
/** How long to wait, once everything is published, for npm to serve it */
const SERVE_TIMEOUT_SECONDS = setting("PUBLISH_SERVE_TIMEOUT_SECONDS", 600);

const dryRun = process.argv.includes("--dry-run");

// Lerna's throttle publishes one package at a time, starting the next one the given number of
// seconds after the one before ends. Packages go in dependency order, and `from-package` skips
// versions npm already has. A version npm took but does not show yet is tried again, and Lerna
// counts npm's refusal to publish over it as published.
const lernaPublish = [
  "lerna",
  "publish",
  "from-package",
  "--no-private",
  "--yes",
  "--throttle-size=1",
  `--throttle-delay=${PACE_SECONDS}`,
];

/** The public packages, in dependency order */
function publicPackages() {
  const output = execFileSync("npx", ["lerna", "ls", "--toposort", "--json", "--loglevel=silent"], {
    encoding: "utf8",
  });
  return JSON.parse(output).filter((pkg) => !pkg.private);
}

/** Whether npm serves this version, as an install would see it */
async function served(pkg) {
  try {
    const response = await fetch(`${REGISTRY}/${pkg.name.replace("/", "%2F")}/${pkg.version}`, {
      headers: { accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function notServed(packages) {
  const results = await Promise.all(packages.map(served));
  return packages.filter((_, index) => !results[index]);
}

const named = (packages) => packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ");
const duration = (seconds) =>
  seconds < 90 ? `${seconds} seconds` : `${Math.round((seconds / 60) * 10) / 10} minutes`;

async function waitUntilServed(packages) {
  const deadline = Date.now() + SERVE_TIMEOUT_SECONDS * 1000;
  let waiting = await notServed(packages);
  while (waiting.length > 0 && Date.now() < deadline) {
    await delay(Math.min(15_000, deadline - Date.now()));
    waiting = await notServed(waiting);
  }
  return waiting;
}

async function main() {
  const packages = publicPackages();
  for (let attempt = 1; ; attempt++) {
    const missing = await notServed(packages);
    if (missing.length === 0) {
      console.log("npm has every package's version.");
      return;
    }
    console.log(`Publishing ${named(missing)}, attempt ${attempt} of ${ATTEMPTS}.`);
    if (dryRun) {
      console.log(`Would run: npx ${lernaPublish.join(" ")}`);
      return;
    }

    const { status } = spawnSync("npx", lernaPublish, { stdio: "inherit" });
    if (status === 0) {
      const late = await waitUntilServed(missing);
      if (late.length > 0) {
        console.log(
          `::warning::npm does not serve ${named(late)} yet, ${duration(SERVE_TIMEOUT_SECONDS)} after publishing.`,
        );
      }
      return;
    }

    if (attempt >= ATTEMPTS) {
      console.log(`::error::Publishing failed ${ATTEMPTS} times. Rerun the job to try again.`);
      process.exit(1);
    }
    console.log(
      `::warning::Publishing failed on attempt ${attempt} of ${ATTEMPTS}. Trying again in ${duration(RETRY_WAIT_SECONDS)}.`,
    );
    await delay(RETRY_WAIT_SECONDS * 1000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
