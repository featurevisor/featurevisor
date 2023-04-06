import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { execSync } from "child_process";

import * as mkdirp from "mkdirp";

import {
  Attribute,
  ParsedFeature,
  Segment,
  HistoryEntry,
  LastModified,
  SearchIndex,
  FeatureKey,
  SegmentKey,
  AttributeKey,
  Condition,
} from "@featurevisor/types";

import { ProjectConfig } from "./config";
import {
  parseYaml,
  extractAttributeKeysFromConditions,
  extractSegmentKeysFromGroupSegments,
} from "./utils";

function getRelativePaths(rootDirectoryPath, projectConfig: ProjectConfig) {
  const relativeFeaturesPath = path.relative(
    rootDirectoryPath,
    projectConfig.featuresDirectoryPath,
  );
  const relativeSegmentsPath = path.relative(
    rootDirectoryPath,
    projectConfig.segmentsDirectoryPath,
  );
  const relativeAttributesPath = path.relative(
    rootDirectoryPath,
    projectConfig.attributesDirectoryPath,
  );

  return {
    relativeFeaturesPath,
    relativeSegmentsPath,
    relativeAttributesPath,
  };
}

export function generateHistory(rootDirectoryPath, projectConfig: ProjectConfig): HistoryEntry[] {
  try {
    // raw history
    const rawHistoryFilePath = path.join(projectConfig.siteExportDirectoryPath, "history-raw.txt");

    const { relativeFeaturesPath, relativeSegmentsPath, relativeAttributesPath } = getRelativePaths(
      rootDirectoryPath,
      projectConfig,
    );

    const separator = "|";

    const cmd = `git log --name-only --pretty=format:"%h${separator}%an${separator}%aI" --no-merges --relative -- ${relativeFeaturesPath} ${relativeSegmentsPath} ${relativeAttributesPath} > ${rawHistoryFilePath}`;
    const output = execSync(cmd);

    console.log(`History (raw) generated at: ${rawHistoryFilePath}`);

    // structured history
    const rawHistory = fs.readFileSync(rawHistoryFilePath, "utf8");

    let commit;
    let author;
    let timestamp;

    const fullHistory: HistoryEntry[] = [];

    let entry: HistoryEntry = {
      commit: "",
      author: "",
      timestamp: "",
      entities: [],
    };

    rawHistory.split("\n").forEach((line, index) => {
      if (index === 0 && line.length === 0) {
        // no history found
        return;
      }

      if (index > 0 && line.length === 0) {
        // commit finished
        fullHistory.push(entry);

        return;
      }

      if (line.indexOf(separator) > -1) {
        // commit line
        const parts = line.split("|");

        entry = {
          commit: parts[0],
          author: parts[1],
          timestamp: parts[2],
          entities: [],
        };
      } else {
        // file line
        const lineSplit = line.split(path.sep);
        const fileName = lineSplit.pop() as string;
        const relativeDir = lineSplit.join(path.sep);

        const key = fileName.replace(".yml", "");

        let type = "feature" as "attribute" | "segment" | "feature";

        if (relativeDir === relativeSegmentsPath) {
          type = "segment";
        } else if (relativeDir === relativeAttributesPath) {
          type = "attribute";
        }

        entry.entities.push({
          type,
          key,
        });
      }
    });

    const fullHistoryFilePath = path.join(
      projectConfig.siteExportDirectoryPath,
      "history-full.json",
    );
    fs.writeFileSync(fullHistoryFilePath, JSON.stringify(fullHistory));
    console.log(`History (full) generated at: ${fullHistoryFilePath}`);

    return fullHistory;
  } catch (error) {
    console.error(
      `Error when generating history from git: ${error.status}\n${error.stderr.toString()}`,
    );

    return [];
  }
}

export function getLastModifiedFromHistory(
  fullHistory: HistoryEntry[],
  type,
  key,
): LastModified | undefined {
  const lastModified = fullHistory.find((entry) => {
    return entry.entities.find((entity) => {
      return entity.type === type && entity.key === key;
    });
  });

  if (lastModified) {
    return {
      commit: lastModified.commit,
      timestamp: lastModified.timestamp,
      author: lastModified.author,
    };
  }
}

function getOwnerAndRepoFromUrl(url: string): { owner: string; repo: string } {
  let owner;
  let repo;

  if (url.startsWith("https://")) {
    const parts = url.split("/");
    repo = (parts.pop() as string).replace(".git", "");
    owner = parts.pop();
  } else if (url.startsWith("git@")) {
    const urlParts = url.split(":");
    const parts = urlParts[1].split("/");
    repo = (parts.pop() as string).replace(".git", "");
    owner = parts.pop();
  }

  return { owner, repo };
}

interface RepoDetails {
  branch: string;
  remoteUrl: string;
  blobUrl: string;
  commitUrl: string;
  topLevelPath: string;
}

export function getDetailsFromRepo(rootDirectoryPath): RepoDetails | undefined {
  try {
    const topLevelPathOutput = execSync(`git rev-parse --show-toplevel`);
    const topLevelPath = topLevelPathOutput.toString().trim();

    const remoteUrlOutput = execSync(`git remote get-url origin`);
    const remoteUrl = remoteUrlOutput.toString().trim();

    const branchOutput = execSync(`git rev-parse --abbrev-ref HEAD`);
    const branch = branchOutput.toString().trim();

    if (!remoteUrl || !branch) {
      return;
    }

    const { owner, repo } = getOwnerAndRepoFromUrl(remoteUrl);

    if (!owner || !repo) {
      return;
    }

    let blobUrl;
    let commitUrl;

    if (remoteUrl.indexOf("github.com") > -1) {
      blobUrl = `https://github.com/${owner}/${repo}/blob/${branch}/{{blobPath}}`;
      commitUrl = `https://github.com/${owner}/${repo}/commit/{{hash}}`;
    } else if (remoteUrl.indexOf("bitbucket.org") > -1) {
      blobUrl = `https://bitbucket.org/${owner}/${repo}/src/${branch}/{{blobPath}}`;
      commitUrl = `https://bitbucket.org/${owner}/${repo}/commits/{{hash}}`;
    }

    if (!blobUrl || !commitUrl) {
      return;
    }

    return {
      branch,
      remoteUrl,
      blobUrl,
      commitUrl,
      topLevelPath,
    };
  } catch (e) {
    console.error(e);
    return;
  }

  return;
}

export function generateSiteSearchIndex(
  rootDirectoryPath: string,
  projectConfig: ProjectConfig,
  fullHistory: HistoryEntry[],
  repoDetails: RepoDetails | undefined,
): SearchIndex {
  const result: SearchIndex = {
    links: undefined,
    entities: {
      attributes: [],
      segments: [],
      features: [],
    },
  };

  /**
   * Links
   */
  if (repoDetails) {
    const { relativeAttributesPath, relativeSegmentsPath, relativeFeaturesPath } = getRelativePaths(
      rootDirectoryPath,
      projectConfig,
    );

    let prefix = "";
    if (repoDetails.topLevelPath !== rootDirectoryPath) {
      prefix = rootDirectoryPath.replace(repoDetails.topLevelPath + "/", "") + "/";
    }

    result.links = {
      attribute: repoDetails.blobUrl.replace(
        "{{blobPath}}",
        prefix + relativeAttributesPath + "/{{key}}.yml",
      ),
      segment: repoDetails.blobUrl.replace(
        "{{blobPath}}",
        prefix + relativeSegmentsPath + "/{{key}}.yml",
      ),
      feature: repoDetails.blobUrl.replace(
        "{{blobPath}}",
        prefix + relativeFeaturesPath + "/{{key}}.yml",
      ),
      commit: repoDetails.commitUrl,
    };
  }

  /**
   * Entities
   */
  // usage
  const attributesUsedInFeatures: {
    [key: AttributeKey]: Set<FeatureKey>;
  } = {};
  const attributesUsedInSegments: {
    [key: AttributeKey]: Set<SegmentKey>;
  } = {};
  const segmentsUsedInFeatures: {
    [key: SegmentKey]: Set<FeatureKey>;
  } = {};

  // features
  const featureFiles = fs.readdirSync(projectConfig.featuresDirectoryPath);
  featureFiles
    .filter((fileName) => fileName.endsWith(".yml"))
    .forEach((fileName) => {
      const filePath = path.join(projectConfig.featuresDirectoryPath, fileName);
      const entityName = fileName.replace(".yml", "");

      const fileContent = fs.readFileSync(filePath, "utf8");
      const parsed = parseYaml(fileContent) as ParsedFeature;

      parsed.variations.forEach((variation) => {
        if (!variation.variables) {
          return;
        }

        variation.variables.forEach((v) => {
          if (v.overrides) {
            v.overrides.forEach((o) => {
              if (o.conditions) {
                extractAttributeKeysFromConditions(o.conditions).forEach((attributeKey) => {
                  if (!attributesUsedInFeatures[attributeKey]) {
                    attributesUsedInFeatures[attributeKey] = new Set();
                  }

                  attributesUsedInFeatures[attributeKey].add(entityName);
                });
              }

              if (o.segments && o.segments !== "*") {
                extractSegmentKeysFromGroupSegments(o.segments).forEach((segmentKey) => {
                  if (!segmentsUsedInFeatures[segmentKey]) {
                    segmentsUsedInFeatures[segmentKey] = new Set();
                  }

                  segmentsUsedInFeatures[segmentKey].add(entityName);
                });
              }
            });
          }
        });
      });

      Object.keys(parsed.environments).forEach((environmentKey) => {
        const env = parsed.environments[environmentKey];

        env.rules.forEach((rule) => {
          if (rule.segments && rule.segments !== "*") {
            extractSegmentKeysFromGroupSegments(rule.segments).forEach((segmentKey) => {
              if (!segmentsUsedInFeatures[segmentKey]) {
                segmentsUsedInFeatures[segmentKey] = new Set();
              }

              segmentsUsedInFeatures[segmentKey].add(entityName);
            });
          }
        });

        if (env.force) {
          env.force.forEach((force) => {
            if (force.segments && force.segments !== "*") {
              extractSegmentKeysFromGroupSegments(force.segments).forEach((segmentKey) => {
                if (!segmentsUsedInFeatures[segmentKey]) {
                  segmentsUsedInFeatures[segmentKey] = new Set();
                }

                segmentsUsedInFeatures[segmentKey].add(entityName);
              });
            }

            if (force.conditions) {
              extractAttributeKeysFromConditions(force.conditions).forEach((attributeKey) => {
                if (!attributesUsedInFeatures[attributeKey]) {
                  attributesUsedInFeatures[attributeKey] = new Set();
                }

                attributesUsedInFeatures[attributeKey].add(entityName);
              });
            }
          });
        }
      });

      result.entities.features.push({
        ...parsed,
        key: entityName,
        lastModified: getLastModifiedFromHistory(fullHistory, "feature", entityName),
      });
    });

  // segments
  const segmentFiles = fs.readdirSync(projectConfig.segmentsDirectoryPath);
  segmentFiles
    .filter((fileName) => fileName.endsWith(".yml"))
    .forEach((fileName) => {
      const filePath = path.join(projectConfig.segmentsDirectoryPath, fileName);
      const entityName = fileName.replace(".yml", "");

      const fileContent = fs.readFileSync(filePath, "utf8");
      const parsed = parseYaml(fileContent) as Segment;

      extractAttributeKeysFromConditions(parsed.conditions as Condition | Condition[]).forEach(
        (attributeKey) => {
          if (!attributesUsedInSegments[attributeKey]) {
            attributesUsedInSegments[attributeKey] = new Set();
          }

          attributesUsedInSegments[attributeKey].add(entityName);
        },
      );

      result.entities.segments.push({
        ...parsed,
        key: entityName,
        lastModified: getLastModifiedFromHistory(fullHistory, "segment", entityName),
        usedInFeatures: Array.from(segmentsUsedInFeatures[entityName] || []),
      });
    });

  // attributes
  const attributeFiles = fs.readdirSync(projectConfig.attributesDirectoryPath);
  attributeFiles
    .filter((fileName) => fileName.endsWith(".yml"))
    .forEach((fileName) => {
      const filePath = path.join(projectConfig.attributesDirectoryPath, fileName);
      const entityName = fileName.replace(".yml", "");

      const fileContent = fs.readFileSync(filePath, "utf8");
      const parsed = parseYaml(fileContent) as Attribute;

      result.entities.attributes.push({
        ...parsed,
        key: entityName,
        lastModified: getLastModifiedFromHistory(fullHistory, "attribute", entityName),
        usedInFeatures: Array.from(attributesUsedInFeatures[entityName] || []),
        usedInSegments: Array.from(attributesUsedInSegments[entityName] || []),
      });
    });

  return result;
}

export function exportSite(rootDirectoryPath: string, projectConfig: ProjectConfig) {
  const hasError = false;

  mkdirp.sync(projectConfig.siteExportDirectoryPath);

  const sitePackagePath = path.dirname(require.resolve("@featurevisor/site/package.json"));

  // copy site dist
  const siteDistPath = path.join(sitePackagePath, "dist");
  fs.cpSync(siteDistPath, projectConfig.siteExportDirectoryPath, { recursive: true });
  console.log("Site dist copied to:", projectConfig.siteExportDirectoryPath);

  // generate history
  const fullHistory = generateHistory(rootDirectoryPath, projectConfig);

  // site search index
  const repoDetails = getDetailsFromRepo(rootDirectoryPath);
  const searchIndex = generateSiteSearchIndex(
    rootDirectoryPath,
    projectConfig,
    fullHistory,
    repoDetails,
  );
  const searchIndexFilePath = path.join(projectConfig.siteExportDirectoryPath, "search-index.json");
  fs.writeFileSync(searchIndexFilePath, JSON.stringify(searchIndex));
  console.log(`Site search index written at: ${searchIndexFilePath}`);

  // copy datafiles
  fs.cpSync(
    projectConfig.outputDirectoryPath,
    path.join(projectConfig.siteExportDirectoryPath, "datafiles"),
    { recursive: true },
  );

  // @TODO: replace placeoholders in index.html

  return hasError;
}

export function serveSite(
  rootDirectoryPath: string,
  projectConfig: ProjectConfig,
  options: any = {},
) {
  const port = options.p || 3000;

  http
    .createServer(function (request, response) {
      const requestedUrl = request.url;
      const filePath =
        requestedUrl === "/"
          ? path.join(projectConfig.siteExportDirectoryPath, "index.html")
          : path.join(projectConfig.siteExportDirectoryPath, requestedUrl as string);

      console.log("requesting: " + filePath + "");

      const extname = path.extname(filePath);
      let contentType = "text/html";
      switch (extname) {
        case ".js":
          contentType = "text/javascript";
          break;
        case ".css":
          contentType = "text/css";
          break;
        case ".json":
          contentType = "application/json";
          break;
        case ".png":
          contentType = "image/png";
          break;
      }

      fs.readFile(filePath, function (error, content) {
        if (error) {
          if (error.code == "ENOENT") {
            response.writeHead(404, { "Content-Type": "text/html" });
            response.end("404 Not Found", "utf-8");
          } else {
            response.writeHead(500);
            response.end("Error 500: " + error.code);
            response.end();
          }
        } else {
          response.writeHead(200, { "Content-Type": contentType });
          response.end(content, "utf-8");
        }
      });
    })
    .listen(port);

  console.log(`Server running at http://127.0.0.1:${port}/`);
}
