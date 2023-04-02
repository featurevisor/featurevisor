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
} from "@featurevisor/types";

import { ProjectConfig } from "./config";
import { parseYaml } from "./utils";

export function generateHistory(rootDirectoryPath, projectConfig: ProjectConfig): HistoryEntry[] {
  try {
    // raw history
    const rawHistoryFilePath = path.join(projectConfig.siteExportDirectoryPath, "history-raw.txt");

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

export function generateSiteSearchIndex(
  projectConfig: ProjectConfig,
  fullHistory: HistoryEntry[],
): SearchIndex {
  const result: SearchIndex = {
    entities: {
      attributes: [],
      segments: [],
      features: [],
    },
  };

  /**
   * Entities
   */

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

      result.entities.segments.push({
        ...parsed,
        key: entityName,
        lastModified: getLastModifiedFromHistory(fullHistory, "segment", entityName),
      });
    });

  // features
  const featureFiles = fs.readdirSync(projectConfig.featuresDirectoryPath);
  featureFiles
    .filter((fileName) => fileName.endsWith(".yml"))
    .forEach((fileName) => {
      const filePath = path.join(projectConfig.featuresDirectoryPath, fileName);
      const entityName = fileName.replace(".yml", "");

      const fileContent = fs.readFileSync(filePath, "utf8");
      const parsed = parseYaml(fileContent) as ParsedFeature;

      result.entities.features.push({
        ...parsed,
        key: entityName,
        lastModified: getLastModifiedFromHistory(fullHistory, "feature", entityName),
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
  const searchIndex = generateSiteSearchIndex(projectConfig, fullHistory);
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
