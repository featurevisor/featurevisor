import { ProjectConfig } from "./config";
import { Datasource } from "./datasource";

export interface Options {
  [key: string]: any;
}

export interface Dependencies {
  rootDirectoryPath: string;
  projectConfig: ProjectConfig;
  datasource: Datasource;
  options: Options;
}
