export interface CLIOptionDefinition {
  type: "array" | "boolean" | "number" | "string";
  alias?: string | string[];
  choices?: readonly string[];
  description?: string;
  hidden?: boolean;
  demandOption?: boolean;
}

export type CLIOptionDefinitions = Record<string, CLIOptionDefinition>;

const outputOptions: CLIOptionDefinitions = {
  json: { type: "boolean", description: "print structured JSON output" },
  pretty: { type: "boolean", description: "pretty print JSON output" },
};

const setOption: CLIOptionDefinitions = {
  set: { type: "string", description: "select a project set" },
};

const targetOption: CLIOptionDefinitions = {
  target: { type: "array", description: "select one or more targets" },
};

const legacyOptions: CLIOptionDefinitions = {
  withScopes: { type: "boolean", alias: "with-scopes", hidden: true },
  withTags: { type: "boolean", alias: "with-tags", hidden: true },
  schemaVersion: { type: "string", alias: "schema-version", hidden: true },
};

export function getCompatibilityCLIOptions(): CLIOptionDefinitions {
  return legacyOptions;
}

const definitions: Record<string, CLIOptionDefinitions> = {
  "assess-distribution": {
    ...setOption,
    ...targetOption,
    environment: { type: "string", description: "environment to evaluate" },
    feature: { type: "string", description: "feature key to evaluate" },
    context: { type: "string", description: "JSON targeting context" },
    populateUuid: { type: "array", description: "context attributes to populate with UUIDs" },
    n: { type: "number", description: "number of evaluations" },
    inflate: { type: "number", description: "inflate the generated datafile" },
    verbose: { type: "boolean", description: "print generated contexts" },
  },
  benchmark: {
    ...setOption,
    ...targetOption,
    environment: { type: "string", description: "environment to evaluate" },
    feature: { type: "string", description: "feature key to evaluate" },
    context: { type: "string", description: "JSON targeting context" },
    variation: { type: "boolean", description: "benchmark variation evaluation" },
    variable: { type: "string", description: "benchmark a variable key" },
    n: { type: "number", description: "number of evaluations" },
    inflate: { type: "number", description: "inflate the generated datafile" },
  },
  build: {
    ...outputOptions,
    ...setOption,
    ...targetOption,
    print: { type: "boolean", description: "print a generated datafile as JSON" },
    revision: { type: "string", description: "override the generated revision" },
    revisionFromHash: { type: "boolean", description: "generate revision from content hash" },
    environment: { type: "string", description: "build one environment" },
    feature: { type: "string", description: "build one feature" },
    variable: { type: "string", description: "build one global variable" },
    stateFiles: { type: "boolean", description: "write build state files" },
    inflate: { type: "number", description: "inflate the generated datafile" },
    datafilesDir: { type: "string", description: "override the datafiles directory" },
  },
  catalog: {
    outDir: { type: "string", description: "Catalog output directory" },
    port: { type: "number", alias: "p", description: "server port" },
    assets: { type: "boolean", description: "copy Catalog UI assets" },
    noAssets: { type: "boolean", description: "skip copying Catalog UI assets" },
    hashRouter: { type: "boolean", description: "use hash based browser routes" },
  },
  config: outputOptions,
  evaluate: {
    ...outputOptions,
    ...setOption,
    ...targetOption,
    environment: { type: "string", description: "environment to evaluate" },
    feature: { type: "string", description: "feature key to evaluate" },
    variable: { type: "string", description: "global variable key to evaluate" },
    context: { type: "string", description: "JSON targeting context" },
    inflate: { type: "number", description: "inflate the generated datafile" },
    verbose: { type: "boolean", description: "print detailed evaluation logs" },
  },
  "find-duplicate-segments": {
    ...setOption,
    authors: { type: "boolean", description: "include entity authors" },
  },
  "find-usage": {
    ...setOption,
    feature: { type: "string", description: "find usage of a feature" },
    variable: { type: "string", description: "show dependencies of a global variable" },
    segment: { type: "string", description: "find usage of a segment" },
    attribute: { type: "string", description: "find usage of an attribute" },
    unusedSegments: { type: "boolean", description: "find unused segments" },
    unusedAttributes: { type: "boolean", description: "find unused attributes" },
    authors: { type: "boolean", description: "include entity authors" },
  },
  "generate-code": {
    ...setOption,
    language: { type: "string", choices: ["typescript"] },
    outDir: { type: "string", description: "generated code output directory" },
    tag: { type: "array", description: "include one or more feature or variable tags" },
    target: { type: "array", description: "include one or more feature or variable targets" },
    react: { type: "boolean", description: "generate React helpers" },
    importSdkPath: { type: "string", hidden: true },
    importReactPath: { type: "string", hidden: true },
  },
  info: {
    ...setOption,
    ...targetOption,
  },
  init: {
    example: { type: "string", description: "initialize from an example project" },
  },
  lint: {
    ...outputOptions,
    ...setOption,
    entityType: {
      type: "string",
      choices: ["feature", "segment", "group", "schema", "attribute", "target", "variable", "test"],
    },
    keyPattern: { type: "string", description: "filter entity keys by regular expression" },
    authors: { type: "boolean", description: "include entity authors" },
  },
  list: {
    ...outputOptions,
    ...setOption,
    datafiles: { type: "boolean" },
    features: { type: "boolean" },
    segments: { type: "boolean" },
    groups: { type: "boolean" },
    schemas: { type: "boolean" },
    attributes: { type: "boolean" },
    targets: { type: "boolean" },
    variables: { type: "boolean" },
    tests: { type: "boolean" },
    target: { type: "array", description: "filter features or variables by one or more targets" },
    entityType: { type: "string", choices: ["feature", "segment", "variable"] },
    applyMatrix: { type: "boolean", description: "expand test assertion matrices" },
    assertionPattern: { type: "string", description: "filter assertion descriptions" },
    keyPattern: { type: "string", description: "filter keys by regular expression" },
    description: { type: "string", description: "filter descriptions by regular expression" },
    archived: { type: "boolean", description: "filter by archived status" },
    promotable: { type: "boolean", description: "filter by promotable status" },
    disabledIn: { type: "string", description: "filter features disabled in an environment" },
    enabledIn: { type: "string", description: "filter features enabled in an environment" },
    tag: { type: "array", description: "filter features or variables by one or more tags" },
    variable: { type: "array", description: "filter features by variable keys" },
    variation: { type: "array", description: "filter features by variation values" },
    withTests: { type: "boolean" },
    withoutTests: { type: "boolean" },
    withVariables: { type: "boolean" },
    withoutVariables: { type: "boolean" },
    withVariations: { type: "boolean" },
    withoutVariations: { type: "boolean" },
  },
  promote: {
    from: { type: "string", description: "source project set" },
    to: { type: "string", description: "destination project set" },
    target: { type: "array", description: "include definitions needed by targets" },
    tag: { type: "array", description: "include features with tags" },
    includeFeatures: { type: "array", description: "include matching feature keys" },
    excludeFeatures: { type: "array", description: "exclude matching feature keys" },
    conflicts: { type: "string", choices: ["source", "destination", "fail"] },
    allowEmpty: { type: "boolean" },
    apply: { type: "boolean" },
    audit: { type: "string" },
    showUnchanged: { type: "boolean" },
  },
  test: {
    ...setOption,
    ...targetOption,
    keyPattern: { type: "string", description: "filter test keys by regular expression" },
    assertionPattern: { type: "string", description: "filter assertions by regular expression" },
    entityType: { type: "string", choices: ["feature", "segment", "variable"] },
    onlyFailures: { type: "boolean" },
    quiet: { type: "boolean", description: "suppress SDK warnings" },
    showDatafile: { type: "boolean" },
    verbose: { type: "boolean" },
    inflate: { type: "number", description: "inflate generated datafiles" },
  },
};

export function getBuiltinCLIOptions(command: string): CLIOptionDefinitions | undefined {
  const commandOptions = definitions[command.split(" ")[0]];

  if (!commandOptions) {
    return undefined;
  }

  return {
    ...commandOptions,
    ...legacyOptions,
  };
}
