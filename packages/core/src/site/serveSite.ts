import * as fs from "fs";
import * as path from "path";
import * as http from "http";

import { ProjectConfig } from "../config";

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
