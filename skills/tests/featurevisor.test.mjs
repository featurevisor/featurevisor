import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import yaml from "js-yaml";

import { getBuiltinCLIOptions } from "../../packages/core/src/cli/options.ts";

const skillRoot = fileURLToPath(new URL("../featurevisor/", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => readFileSync(path.join(skillRoot, file), "utf8");

const files = readdirSync(skillRoot, { recursive: true }).map(String);
const documents = files.filter((file) => file.endsWith(".md")).map((file) => [file, read(file)]);
const yamlFiles = files.filter((file) => /\.ya?ml$/.test(file));
const upgradeGuides = ["references/upgrading-to-v3.md", "references/upgrading-to-v4.md"];

function withoutCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

function fences(markdown, languages) {
  const pattern = new RegExp("```(?:" + languages.join("|") + ")\\n([\\s\\S]*?)```", "g");
  return [...markdown.matchAll(pattern)].map((match) => match[1]);
}

// GitHub style heading anchors, including -1 suffixes for repeated headings.
function anchors(markdown) {
  const result = new Set();
  const seen = new Map();
  for (const [, id] of markdown.matchAll(/<a id="([^"]+)"/g)) result.add(id);
  for (const [, heading] of withoutCode(markdown.replace(/`([^`\n]*)`/g, "$1")).matchAll(
    /^#{1,6} (.+)$/gm,
  )) {
    const base = heading
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  return result;
}

const REMOVED_FIELDS = ["segments", "requiredFeatures", "requiredVariables", "groups"];
const REMOVED_TYPES = ["double", "date", "semver"];
const REMOVED_REASONS = ["required", "required_features_unmet", "required_variables_unmet"];

function findRemovedSyntax(value, where, problems, parentKey) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => findRemovedSyntax(item, where, problems, parentKey));
    return;
  }
  for (const key of REMOVED_FIELDS) {
    if (Object.hasOwn(value, key)) problems.push(`${where}: ${key}`);
  }
  // Feature level `required` was replaced by conditions. Schema `required` lists stay.
  if (Array.isArray(value.required) && value.required.some((item) => typeof item === "object")) {
    problems.push(`${where}: feature required`);
  }
  if (REMOVED_TYPES.includes(value.type)) problems.push(`${where}: type ${value.type}`);
  if (REMOVED_REASONS.includes(value.reason)) problems.push(`${where}: reason ${value.reason}`);
  for (const [key, child] of Object.entries(value)) {
    if (["value", "defaultValue", "disabledValue", "mutate", "context"].includes(key)) continue;
    findRemovedSyntax(child, where, problems, key);
  }
}

test("SKILL.md frontmatter is valid for skill installers", () => {
  const skill = read("SKILL.md");
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, "SKILL.md starts with YAML frontmatter");
  const data = yaml.load(frontmatter[1]);
  assert.equal(data.name, "featurevisor");
  assert.equal(typeof data.description, "string");
  assert.ok(data.description.length <= 1024, `description is ${data.description.length} chars`);
  assert.match(data.description, /Featurevisor/);
});

test("relative links and anchors resolve", () => {
  const problems = [];
  for (const [file, content] of documents) {
    for (const [, target] of withoutCode(content).matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue;
      const [linkPath, anchor] = target.split("#");
      const resolved = linkPath
        ? path.join(path.dirname(path.join(skillRoot, file)), linkPath)
        : path.join(skillRoot, file);
      if (!existsSync(resolved)) {
        problems.push(`${file}: missing ${target}`);
        continue;
      }
      if (
        anchor &&
        resolved.endsWith(".md") &&
        !anchors(readFileSync(resolved, "utf8")).has(anchor)
      ) {
        problems.push(`${file}: missing anchor ${target}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every reference and template is reachable from SKILL.md or a reference", () => {
  const linked = new Set();
  for (const [file, content] of documents) {
    for (const [, target] of content.matchAll(/\]\(([^)#\s]+)/g)) {
      if (/^[a-z]+:/i.test(target)) continue;
      linked.add(path.normalize(path.join(path.dirname(file), target)));
    }
  }
  const references = files.filter((file) => file.startsWith("references/") && file.endsWith(".md"));
  for (const reference of references)
    assert.ok(linked.has(reference), `${reference} is not linked`);
  for (const template of readdirSync(path.join(skillRoot, "templates"))) {
    if (template === "example-project") continue;
    assert.ok(linked.has(`templates/${template}`), `templates/${template} is not linked`);
  }
});

test("YAML examples parse and use only v4 syntax", () => {
  const problems = [];
  for (const file of yamlFiles) {
    findRemovedSyntax(yaml.load(read(file)), file, problems);
  }
  for (const [file, content] of documents) {
    fences(content, ["yaml", "yml"]).forEach((block, index) => {
      let parsed;
      try {
        parsed = yaml.load(block);
      } catch (error) {
        problems.push(`${file} block ${index + 1}: ${error.message.split("\n")[0]}`);
        return;
      }
      if (!upgradeGuides.includes(file))
        findRemovedSyntax(parsed, `${file} block ${index + 1}`, problems);
    });
  }
  assert.deepEqual(problems, []);
  assert.ok(yamlFiles.length > 30, `only ${yamlFiles.length} template files`);
});

test("command examples use options the CLI defines", () => {
  let checked = 0;
  for (const [file, content] of documents) {
    for (const flag of withoutCode(content).match(/--[a-z][a-zA-Z-]*[A-Z][a-zA-Z-]*/g) || []) {
      assert.fail(`${file}: camelCase option ${flag}`);
    }
    for (const block of fences(content, ["bash", "sh", "shell"])) {
      assert.doesNotMatch(block, /--[a-z]+[A-Z]/, `${file}: camelCase option in a command`);
      for (const line of block.replace(/\\\n\s*/g, " ").split("\n")) {
        const command = line.match(/\bnpx featurevisor ([a-z][a-z-]*)\b/);
        if (!command || ["version", "help"].includes(command[1])) continue;
        const options = getBuiltinCLIOptions(command[1]);
        assert.ok(options, `${file}: unknown command ${command[1]}`);
        for (const [, flag] of line.split(/\s+#/)[0].matchAll(/--([a-z][a-z0-9-]*)/g)) {
          const key = flag.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          const positive = key.startsWith("no") ? key[2]?.toLowerCase() + key.slice(3) : key;
          assert.ok(
            key in options ||
              positive in options ||
              ["rootDirectoryPath", "help", "version"].includes(key),
            `${file}: ${command[1]} --${flag}`,
          );
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 100, `only checked ${checked} options`);
});

test("local commands never write state, and debugging uses --explain", () => {
  for (const [file, content] of documents) {
    for (const block of fences(content, ["bash", "sh", "shell"])) {
      for (const line of block.split("\n")) {
        if (/npx featurevisor evaluate\b/.test(line)) {
          assert.doesNotMatch(line, /--verbose/, `${file}: prefer --explain over --verbose`);
        }
      }
    }
  }
  const skill = read("SKILL.md");
  assert.match(skill, /npx featurevisor build --no-state-files/);
  assert.match(skill, /Bare `build` is a \*\*CI command\*\*/);
  assert.match(skill, /npx featurevisor diff/);
  assert.match(skill, /--explain/);
});

test("the installed CLI version is checked before authoring", () => {
  const skill = read("SKILL.md");
  assert.ok(skill.indexOf("npx featurevisor --version") < skill.indexOf("npx featurevisor config"));
  assert.match(skill, /npm ls @featurevisor\/cli/);
  assert.match(skill, /If it is missing or `npx` offers to download a package, stop/);
  assert.match(
    skill,
    /Do not install a remote CLI or upgrade dependencies just to detect a version/,
  );
  assert.match(skill, /\*\*3\.x\*\*/);
  assert.match(skill, /\*\*2\.x\*\*/);
  const v3 = read("references/upgrading-to-v4.md")
    .split("## Working in a v3 project")[1]
    .split("\n## ")[0];
  for (const syntax of [
    "`segments`",
    "`requiredFeatures`",
    "`compose`",
    "`continue: true`",
    "`checks`",
    "scenario",
  ]) {
    assert.ok(v3.includes(syntax), syntax);
  }
});

test("consumer compatibility stays separate from lint success", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /every application consuming that datafile/);
  assert.match(skill, /Ask the user when this is unknown/);
  assert.match(skill, /Native version numbers differ/);
  assert.match(skill, /CLI lint success alone does not establish runtime support/);
  for (const file of [
    "SKILL.md",
    "references/global-variables.md",
    "references/testing.md",
    "references/upgrading-to-v4.md",
  ]) {
    assert.match(read(file), /https:\/\/featurevisor\.com\/docs\/sdks\/compatibility\//, file);
  }
});

test("archived references are rejected by lint, for every kind of definition", () => {
  for (const file of [
    "SKILL.md",
    "references/segments.md",
    "references/attributes.md",
    "references/features.md",
    "references/testing.md",
    "references/upgrading-to-v4.md",
  ]) {
    assert.match(read(file), /archived_reference/, file);
  }
  for (const [file, content] of documents) {
    assert.doesNotMatch(content, /[Ll]int does not (stop|reject)[^.]*archived/, file);
  }
});

test("retiring prefers archiving to deleting and warns on deprecated references", () => {
  assert.match(read("SKILL.md"), /prefer archiving to deleting/);
  for (const file of ["SKILL.md", "references/features.md", "references/cli.md"]) {
    assert.match(read(file), /deprecated_reference/, file);
  }
  assert.doesNotMatch(read("references/recipes.md"), /[Aa]rchive or delete|or delete the file/);
});

test("feature specs name sticky feature results stickyFeatures", () => {
  for (const [file, content] of documents) {
    if (/upgrading-to-v[34]\.md$/.test(file)) continue;
    assert.doesNotMatch(content, /^\s+sticky:/m, file);
  }
  assert.match(read("references/upgrading-to-v4.md"), /`removed_test_field` on `sticky`/);
});

test("prose avoids em dashes and semicolons", () => {
  for (const [file, content] of documents) {
    const prose = withoutCode(content);
    assert.doesNotMatch(prose, /—/, `${file}: em dash`);
    assert.doesNotMatch(prose, / – /, `${file}: spaced en dash`);
    assert.doesNotMatch(prose, /;/, `${file}: semicolon`);
  }
});

test("the example project passes lint and test", (t) => {
  const bin = path.join(repoRoot, "packages/cli/bin.js");
  if (!existsSync(path.join(repoRoot, "packages/cli/lib"))) {
    t.skip("build the CLI first with npm run build");
    return;
  }
  const cwd = path.join(skillRoot, "templates/example-project");
  for (const command of ["lint", "test"]) {
    const result = spawnSync(process.execPath, [bin, command], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  }
  const report = spawnSync(process.execPath, [bin, "test", "--json"], { cwd, encoding: "utf8" });
  const parsed = JSON.parse(report.stdout);
  assert.equal(parsed.passed, true);
  assert.ok(parsed.summary, "report has a summary");
  const scenarios = parsed.results.filter((result) => result.type === "scenario");
  assert.ok(scenarios.length > 0, "the example demonstrates a scenario");
  const uncovered = spawnSync(process.execPath, [bin, "test", "--uncovered"], {
    cwd,
    encoding: "utf8",
  });
  assert.match(uncovered.stdout, /Features: none/);
  assert.match(uncovered.stdout, /Global variables: none/);
});
